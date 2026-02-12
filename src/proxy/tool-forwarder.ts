import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TokenProvider } from "../auth/token-provider";
import { AppConfig, ResolvedServer } from "../config/types";

/**
 * Forwards tool calls from Claude Code to the appropriate Agent 365 MCP server.
 *
 * Maintains a map of tool names to their owning servers and handles
 * authentication header injection on each call.
 */
export class ToolForwarder {
  private config: AppConfig;
  private tokenProvider: TokenProvider;

  /** Maps tool name -> resolved server that owns it */
  private toolServerMap = new Map<string, ResolvedServer>();

  /** Cached MCP clients per server (reused across calls) */
  private clients = new Map<string, Client>();

  constructor(
    config: AppConfig,
    tokenProvider: TokenProvider,
    servers: ResolvedServer[]
  ) {
    this.config = config;
    this.tokenProvider = tokenProvider;

    // Build the tool -> server mapping
    for (const server of servers) {
      for (const tool of server.tools) {
        this.toolServerMap.set(tool.name, server);
      }
    }
  }

  /**
   * Forwards a tool call to the owning Agent 365 MCP server.
   *
   * @param toolName - The tool name as reported to Claude Code
   * @param args - The tool call arguments
   * @returns The tool call result
   */
  /**
   * Forwards a tool call to the owning Agent 365 MCP server.
   *
   * @param toolName - The tool name to call
   * @param args - The tool call arguments
   * @param targetServer - Optional: specific server to target (bypassing name lookup)
   * @returns The tool call result
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    targetServer?: ResolvedServer
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const server = targetServer ?? this.toolServerMap.get(toolName);
    if (!server) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Unknown tool "${toolName}". Available tools: ${Array.from(this.toolServerMap.keys()).join(", ")}`,
          },
        ],
      };
    }

    try {
      const client = await this.getOrCreateClient(server);
      const result = await client.callTool({ name: toolName, arguments: args });

      return {
        content: (result.content as Array<{ type: string; text: string }>) ?? [
          { type: "text", text: JSON.stringify(result) },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Tool call failed for ${toolName} on ${server.config.mcpServerName}: ${message}`);
      return {
        content: [
          {
            type: "text",
            text: `Error calling tool "${toolName}" on ${server.config.mcpServerName}: ${message}`,
          },
        ],
      };
    }
  }

  /**
   * Gets or creates a cached MCP client for the given server.
   * Creates a fresh client with current auth tokens.
   */
  private async getOrCreateClient(server: ResolvedServer): Promise<Client> {
    const key = server.config.mcpServerName;

    // Always create a fresh client to ensure fresh auth tokens.
    // The Agent 365 gateway may reject stale connections.
    const existing = this.clients.get(key);
    if (existing) {
      try {
        await existing.close();
      } catch {
        // Ignore close errors
      }
    }

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

    const transport = new StreamableHTTPClientTransport(
      new URL(server.url),
      { requestInit: { headers } }
    );

    const client = new Client({
      name: "agent365-claude-bridge",
      version: "1.0.0",
    });

    await client.connect(transport);
    this.clients.set(key, client);
    return client;
  }

  /**
   * Closes all cached MCP clients.
   */
  async closeAll(): Promise<void> {
    for (const [, client] of this.clients) {
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();
  }
}

function log(message: string): void {
  process.stderr.write(`[agent365-bridge] ${message}\n`);
}
