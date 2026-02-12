import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ResolvedServer } from "../config/types";
import { ToolForwarder } from "./tool-forwarder";
import { CachedTool, loadToolsCache, saveToolsCache } from "../auth/tools-cache";

/**
 * MCP proxy server that exposes Agent 365 tools to Claude Code over stdio.
 *
 * Uses a two-layer strategy to work within Claude Desktop's 5-second
 * tools/list timeout:
 *
 * 1. CACHED TOOLS (instant): On startup, loads the tool list from disk
 *    (populated by `npm run login`). This lets tools/list respond in <1ms.
 *
 * 2. LIVE DISCOVERY (background): Runs full discovery in the background.
 *    When complete, updates the cached tools for future sessions and
 *    enables actual tool calls (which need the live forwarder).
 */
export class McpProxyServer {
  private server: Server;
  private forwarder: ToolForwarder | null;
  private resolvedServers: ResolvedServer[];

  /** Cached tool definitions loaded from disk (for instant tools/list) */
  private cachedTools: CachedTool[] | null;

  /** Background discovery state */
  private discoveryDone: Promise<void> | null = null;
  private discoveryComplete = false;
  private discoveryError: string | null = null;

  constructor(
    forwarder: ToolForwarder | null,
    resolvedServers: ResolvedServer[],
    discoveryCallback?: () => Promise<{
      forwarder: ToolForwarder;
      servers: ResolvedServer[];
    }>
  ) {
    this.forwarder = forwarder;
    this.resolvedServers = resolvedServers;

    // Load cached tools from disk (populated by `npm run login`)
    this.cachedTools = loadToolsCache();

    // If tools are already available (eager discovery succeeded), mark done
    if (forwarder && resolvedServers.length > 0) {
      this.discoveryComplete = true;
    }

    this.server = new Server(
      { name: "agent365-bridge", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    // Start discovery immediately in the background
    if (discoveryCallback && !this.discoveryComplete) {
      this.discoveryDone = this.runDiscovery(discoveryCallback);
    }

    this.registerHandlers();
  }

  /**
   * Runs discovery in the background.
   */
  private async runDiscovery(
    callback: () => Promise<{
      forwarder: ToolForwarder;
      servers: ResolvedServer[];
    }>
  ): Promise<void> {
    try {
      const result = await callback();
      this.forwarder = result.forwarder;
      this.resolvedServers = result.servers;
      this.discoveryComplete = true;

      const totalTools = this.resolvedServers.reduce(
        (sum, s) => sum + s.tools.length,
        0
      );
      log(
        `Discovery complete: ${totalTools} tools from ${this.resolvedServers.length} servers`
      );

      // Update the disk cache with fresh tool data
      const freshTools: CachedTool[] = this.resolvedServers.flatMap((server) =>
        server.tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? `Tool from ${tool.serverName}`,
          inputSchema: tool.inputSchema as Record<string, unknown>,
          serverName: server.config.mcpServerName,
        }))
      );
      saveToolsCache(freshTools);

      // Notify client (may help if starting a new conversation)
      try {
        await this.server.sendToolListChanged();
      } catch {
        // ignore — client may not support it
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.discoveryError = message;
      this.discoveryComplete = true;
      log(`Discovery failed: ${message}`);
    }
  }

  /**
   * Waits for discovery to complete, with a timeout.
   */
  private async waitForDiscovery(timeoutMs: number): Promise<boolean> {
    if (this.discoveryComplete) return true;
    if (!this.discoveryDone) return false;

    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), timeoutMs)
    );

    const result = await Promise.race([
      this.discoveryDone.then(() => "done" as const),
      timeout,
    ]);

    return result === "done";
  }

  /**
   * Registers tools/list and tools/call handlers.
   */
  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // BEST CASE: live discovery is done — return real tools
      if (this.discoveryComplete && !this.discoveryError) {
        const tools = this.resolvedServers.flatMap((server) =>
          server.tools.map((tool) => ({
            name: tool.name,
            description: tool.description ?? `Tool from ${tool.serverName}`,
            inputSchema: tool.inputSchema,
          }))
        );
        return { tools };
      }

      // CACHED CASE: return tools from disk cache (instant, <1ms)
      // Discovery is still running but we have a cached list from `npm run login`
      if (this.cachedTools && this.cachedTools.length > 0) {
        log(
          `Serving ${this.cachedTools.length} cached tools (discovery still running...)`
        );
        const tools = this.cachedTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        return { tools };
      }

      // ERROR CASE
      if (this.discoveryError) {
        return {
          tools: [
            {
              name: "agent365_connection_status",
              description: `Agent 365 Bridge failed to connect: ${this.discoveryError}. Check .env configuration and restart Claude Desktop.`,
              inputSchema: { type: "object" as const, properties: {} },
            },
          ],
        };
      }

      // NO CACHE, NO DISCOVERY YET — placeholder with sign-in instructions
      log("No cached tools — returning sign-in placeholder");
      return {
        tools: [
          {
            name: "agent365_sign_in_status",
            description:
              "Agent 365 Bridge needs initial setup. " +
              "Run 'npm run login' in the Agent365 project directory to sign in and cache tools. " +
              "Then restart Claude Desktop.",
            inputSchema: { type: "object" as const, properties: {} },
          },
        ],
      };
    });

    // tools/call — route the call to the correct A365 MCP server
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name } = request.params;

      // Handle placeholder tools
      if (
        name === "agent365_sign_in_status" ||
        name === "agent365_connection_status"
      ) {
        if (this.discoveryComplete && !this.discoveryError) {
          return {
            content: [
              {
                type: "text",
                text: "✅ Agent 365 is connected! Tools are ready to use.",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: this.discoveryError
                ? `❌ Connection failed: ${this.discoveryError}\n\nRun 'npm run login' to set up.`
                : "⏳ Agent 365 is still connecting. Please wait a moment and try again.",
            },
          ],
        };
      }

      // If live forwarder isn't ready yet, wait for discovery
      if (!this.forwarder) {
        log(`Tool call '${name}' — waiting for discovery to complete...`);
        const ready = await this.waitForDiscovery(30_000);

        if (!ready || !this.forwarder) {
          return {
            content: [
              {
                type: "text",
                text:
                  "⏳ Agent 365 Bridge is still connecting to Microsoft 365. " +
                  "Please wait a moment and try again.\n\n" +
                  "If this persists, run 'npm run login' in the Agent365 directory.",
              },
            ],
          };
        }
      }

      // Forward the actual tool call
      const { arguments: args } = request.params;
      const result = await this.forwarder.callTool(
        name,
        (args ?? {}) as Record<string, unknown>
      );
      return result;
    });

    if (this.cachedTools && this.cachedTools.length > 0) {
      log(`${this.cachedTools.length} cached tools ready for instant serving`);
    }
    if (this.discoveryComplete) {
      const totalTools = this.resolvedServers.reduce(
        (sum, s) => sum + s.tools.length,
        0
      );
      log(`${totalTools} live tools registered`);
    } else {
      log("Discovery running in background");
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log("MCP proxy server started on stdio");
  }
}

function log(message: string): void {
  process.stderr.write(`[agent365-bridge] ${message}\n`);
}
