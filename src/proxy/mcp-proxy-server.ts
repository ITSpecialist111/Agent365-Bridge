import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ResolvedServer } from "../config/types";
import { ToolForwarder } from "./tool-forwarder";

/**
 * MCP proxy server that exposes Agent 365 tools to Claude Code over stdio.
 *
 * Uses the low-level Server class (not McpServer) to directly handle
 * tools/list and tools/call requests with raw JSON Schema — avoiding
 * Zod type inference issues when proxying dynamically discovered tools.
 */
export class McpProxyServer {
  private server: Server;
  private forwarder: ToolForwarder;
  private resolvedServers: ResolvedServer[];

  constructor(forwarder: ToolForwarder, resolvedServers: ResolvedServer[]) {
    this.forwarder = forwarder;
    this.resolvedServers = resolvedServers;

    this.server = new Server(
      { name: "agent365-bridge", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    this.registerHandlers();
  }

  /**
   * Registers tools/list and tools/call handlers.
   */
  private registerHandlers(): void {
    // tools/list — return aggregated tool definitions from all A365 servers
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.resolvedServers.flatMap((server) =>
        server.tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? `Tool from ${tool.serverName}`,
          inputSchema: tool.inputSchema,
        }))
      );

      return { tools };
    });

    // tools/call — route the call to the correct A365 MCP server
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const result = await this.forwarder.callTool(
        name,
        (args ?? {}) as Record<string, unknown>
      );
      return result;
    });

    const totalTools = this.resolvedServers.reduce(
      (sum, s) => sum + s.tools.length,
      0
    );
    log(
      `Registered ${totalTools} tools from ${this.resolvedServers.length} servers`
    );
  }

  /**
   * Starts the MCP server on stdio transport, connecting to Claude Code.
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log("MCP proxy server started on stdio");
  }
}

function log(message: string): void {
  process.stderr.write(`[agent365-bridge] ${message}\n`);
}
