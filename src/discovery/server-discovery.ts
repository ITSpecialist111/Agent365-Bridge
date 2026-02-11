import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TokenProvider } from "../auth/token-provider";
import { AppConfig, DiscoveredTool, MCPServerConfig, ResolvedServer } from "../config/types";

/**
 * Discovers Agent 365 MCP servers and enumerates their tools.
 *
 * Two discovery paths:
 * 1. Manifest mode (development): reads from ToolingManifest.json
 * 2. Gateway mode (production): queries the Agent 365 tooling gateway API
 */
export class ServerDiscovery {
  private config: AppConfig;
  private tokenProvider: TokenProvider;

  constructor(config: AppConfig, tokenProvider: TokenProvider) {
    this.config = config;
    this.tokenProvider = tokenProvider;
  }

  /**
   * Discovers all configured MCP servers and their tools.
   */
  async discoverAll(): Promise<ResolvedServer[]> {
    const serverConfigs = await this.getServerConfigs();
    const resolved: ResolvedServer[] = [];

    for (const serverConfig of serverConfigs) {
      try {
        const url = this.buildServerUrl(serverConfig);
        const tools = await this.discoverTools(serverConfig.mcpServerName, url);
        resolved.push({ config: serverConfig, url, tools });
        log(`Discovered ${tools.length} tools from ${serverConfig.mcpServerName}`);
      } catch (err) {
        log(`Failed to discover tools from ${serverConfig.mcpServerName}: ${err}`);
      }
    }

    return resolved;
  }

  /**
   * Gets MCP server configurations from manifest or gateway.
   */
  private async getServerConfigs(): Promise<MCPServerConfig[]> {
    // Use manifest in development mode or when no agentic app ID is set
    if (this.config.nodeEnv === "development" || !this.config.agenticAppId) {
      return this.getFromManifest();
    }
    return this.getFromGateway();
  }

  /**
   * Reads server configs from ToolingManifest.json.
   */
  private getFromManifest(): MCPServerConfig[] {
    const servers = this.config.manifest.mcpServers;
    if (servers.length === 0) {
      log("Warning: ToolingManifest.json contains no MCP servers");
    }
    return servers;
  }

  /**
   * Queries the Agent 365 tooling gateway to discover available servers.
   */
  private async getFromGateway(): Promise<MCPServerConfig[]> {
    const token = await this.tokenProvider.getToken();
    const url = `${this.config.mcpPlatformEndpoint}/agents/${this.config.agenticAppId}/mcpServers`;

    const response = await fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Gateway discovery failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { mcpServers?: MCPServerConfig[] };
    return data.mcpServers ?? [];
  }

  /**
   * Constructs the full URL for an MCP server.
   * Pattern: {endpoint}/agents/servers/{serverName}/
   */
  private buildServerUrl(config: MCPServerConfig): string {
    if (config.url) {
      return config.url;
    }
    const base = this.config.mcpPlatformEndpoint.replace(/\/+$/, "");
    return `${base}/agents/servers/${config.mcpServerName}/`;
  }

  /**
   * Connects to a remote MCP server and discovers its available tools.
   */
  private async discoverTools(
    serverName: string,
    serverUrl: string
  ): Promise<DiscoveredTool[]> {
    const token = await this.tokenProvider.getToken();

    const headers: Record<string, string> = {
      "User-Agent": "Agent365SDK/1.0.0 (ClaudeCodeBridge; Node.js)",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (this.config.agenticAppId) {
      headers["x-ms-agentid"] = this.config.agenticAppId;
    }

    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      requestInit: { headers },
    });

    const client = new Client({
      name: "agent365-bridge",
      version: "1.0.0",
    });

    await client.connect(transport);

    const result = await client.listTools();
    const tools: DiscoveredTool[] = (result.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      serverName,
    }));

    await client.close();
    return tools;
  }
}

function log(message: string): void {
  process.stderr.write(`[agent365-bridge] ${message}\n`);
}
