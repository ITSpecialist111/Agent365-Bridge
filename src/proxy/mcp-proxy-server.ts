import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { ResolvedServer } from "../config/types";
import { ToolForwarder } from "./tool-forwarder";
import { CachedTool, loadToolsCache, saveToolsCache } from "../auth/tools-cache";

interface ToolRegistryEntry {
  uniqueName: string;
  originalName: string;
  serverName: string;
  toolDef: Tool;
}

/**
 * MCP proxy server that exposes Agent 365 tools to Claude Code over stdio.
 *
 * Implements:
 * 1. Two-layer caching (disk cache for instant startup + live discovery)
 * 2. Schema sanitization (strips oneOf/allOf/anyOf for Anthropic API)
 * 3. *NEW* Tool name deduplication (renames collisions to ToolName_ServerName)
 */
export class McpProxyServer {
  private server: Server;
  private forwarder: ToolForwarder | null;
  private resolvedServers: ResolvedServer[];

  /** Registry of available tools (deduplicated) */
  private toolRegistry = new Map<string, ToolRegistryEntry>();

  /** Cached tool definitions loaded from disk */
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

    // Load cached tools from disk
    this.cachedTools = loadToolsCache();

    // If we have cached tools, build the registry immediately
    if (this.cachedTools && this.cachedTools.length > 0) {
      this.rebuildRegistryFromCache(this.cachedTools);
    }

    // If tools are already available (eager discovery), mark done & rebuild registry
    if (forwarder && resolvedServers.length > 0) {
      this.discoveryComplete = true;
      this.rebuildRegistryFromLive(resolvedServers);
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
   * Rebuilds the tool registry from cached tools.
   * Handles deduplication by appending _ServerName on collision.
   */
  private rebuildRegistryFromCache(tools: CachedTool[]) {
    this.toolRegistry.clear();
    const nameCounts = new Map<string, number>();

    // Pass 1: Count frequencies
    for (const tool of tools) {
      nameCounts.set(tool.name, (nameCounts.get(tool.name) || 0) + 1);
    }

    // Pass 2: Build registry
    for (const tool of tools) {
      let uniqueName = tool.name;
      if ((nameCounts.get(tool.name) || 0) > 1) {
        uniqueName = `${tool.name}_${tool.serverName}`;
      }

      this.toolRegistry.set(uniqueName, {
        uniqueName,
        originalName: tool.name,
        serverName: tool.serverName,
        toolDef: {
          name: uniqueName,
          description: tool.description,
          inputSchema: sanitizeSchema(tool.inputSchema) as Tool["inputSchema"],
        },
      });
    }
  }

  /**
   * Rebuilds the tool registry from live resolved servers.
   * Handles deduplication by appending _ServerName on collision.
   */
  private rebuildRegistryFromLive(servers: ResolvedServer[]) {
    this.toolRegistry.clear();
    const nameCounts = new Map<string, number>();

    // Pass 1: Count frequencies
    for (const server of servers) {
      for (const tool of server.tools) {
        nameCounts.set(tool.name, (nameCounts.get(tool.name) || 0) + 1);
      }
    }

    // Pass 2: Build registry
    for (const server of servers) {
      for (const tool of server.tools) {
        let uniqueName = tool.name;
        if ((nameCounts.get(tool.name) || 0) > 1) {
          uniqueName = `${tool.name}_${server.config.mcpServerName}`;
        }

        this.toolRegistry.set(uniqueName, {
          uniqueName,
          originalName: tool.name,
          serverName: server.config.mcpServerName,
          toolDef: {
            name: uniqueName,
            description: tool.description,
            inputSchema: sanitizeSchema(tool.inputSchema as Record<string, unknown>) as Tool["inputSchema"],
          },
        });
      }
    }
  }

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

      // Rebuild registry with fresh live tools
      this.rebuildRegistryFromLive(this.resolvedServers);

      const totalTools = this.toolRegistry.size;
      log(`Discovery complete: ${totalTools} tools available`);

      // Update disk cache
      const freshTools: CachedTool[] = Array.from(this.toolRegistry.values()).map(
        (entry) => ({
          name: entry.originalName,
          description: entry.toolDef.description!,
          inputSchema: entry.toolDef.inputSchema as Record<string, unknown>,
          serverName: entry.serverName,
        })
      );
      saveToolsCache(freshTools);

      // Notify client
      try {
        await this.server.sendToolListChanged();
      } catch {
        // ignore
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.discoveryError = message;
      this.discoveryComplete = true;
      log(`Discovery failed: ${message}`);
    }
  }

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

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // 1. Return registry contents (whether from cache or live)
      if (this.toolRegistry.size > 0) {
        if (!this.discoveryComplete) {
          log(`Serving ${this.toolRegistry.size} cached tools (discovery running...)`);
        }
        return {
          tools: Array.from(this.toolRegistry.values()).map((e) => e.toolDef),
        };
      }

      // 2. Error case
      if (this.discoveryError) {
        return {
          tools: [
            {
              name: "agent365_connection_status",
              description: `Agent 365 Bridge connection failed: ${this.discoveryError}`,
              inputSchema: { type: "object" as const, properties: {} },
            },
          ],
        };
      }

      // 3. No cache, no discovery yet
      log("No cached tools — returning sign-in placeholder");
      return {
        tools: [
          {
            name: "agent365_sign_in_status",
            description: "Agent 365 Bridge setup required. Run 'npm run login' to set up.",
            inputSchema: { type: "object" as const, properties: {} },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name } = request.params;

      // Handle placeholders
      if (name === "agent365_sign_in_status") {
        return {
          content: [{ type: "text", text: "Please run 'npm run login' in the terminal to set up Agent 365." }],
        };
      }

      // 1. Look up tool in registry
      const entry = this.toolRegistry.get(name);
      if (!entry) {
        return {
          content: [{ type: "text", text: `Error: Tool '${name}' not found.` }],
        };
      }

      // 2. Wait for live forwarder/discovery if needed
      if (!this.forwarder) {
        log(`Tool call '${name}' — waiting for discovery...`);
        const ready = await this.waitForDiscovery(30_000);
        if (!ready || !this.forwarder) {
          return {
            content: [{ type: "text", text: "Timeout waiting for Agent 365 connection." }],
          };
        }
      }

      // 3. Find target server
      const targetServer = this.resolvedServers.find(
        (s) => s.config.mcpServerName === entry.serverName
      );

      if (!targetServer) {
        return {
          content: [{ type: "text", text: `Error: Server '${entry.serverName}' not found.` }],
        };
      }

      // 4. Forward execution
      const { arguments: args } = request.params;
      return await this.forwarder.callTool(
        entry.originalName,
        (args ?? {}) as Record<string, unknown>,
        targetServer
      );
    });

    if (this.toolRegistry.size > 0) {
      log(`${this.toolRegistry.size} tools registered`);
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

/**
 * Sanitizes a JSON Schema to be compatible with the Anthropic API.
 */
function sanitizeSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...schema };

  // Handle allOf — merge all sub-schemas
  if (Array.isArray(result.allOf)) {
    const subSchemas = result.allOf as Record<string, unknown>[];
    for (const sub of subSchemas) {
      if (sub.properties) {
        result.properties = {
          ...(result.properties as Record<string, unknown> ?? {}),
          ...(sub.properties as Record<string, unknown>),
        };
      }
      if (Array.isArray(sub.required)) {
        const existing = Array.isArray(result.required) ? result.required as string[] : [];
        result.required = [...new Set([...existing, ...(sub.required as string[])])];
      }
    }
    delete result.allOf;
    if (!result.type) result.type = "object";
  }

  // Handle oneOf / anyOf — take the first variant
  for (const keyword of ["oneOf", "anyOf"] as const) {
    if (Array.isArray(result[keyword])) {
      const variants = result[keyword] as Record<string, unknown>[];
      if (variants.length > 0) {
        const first = variants[0];
        if (first.properties) {
          result.properties = {
            ...(result.properties as Record<string, unknown> ?? {}),
            ...(first.properties as Record<string, unknown>),
          };
        }
        if (Array.isArray(first.required)) {
          const existing = Array.isArray(result.required) ? result.required as string[] : [];
          result.required = [...new Set([...existing, ...(first.required as string[])])];
        }
      }
      delete result[keyword];
      if (!result.type) result.type = "object";
    }
  }

  // Recursively sanitize nested property schemas
  if (result.properties && typeof result.properties === "object") {
    const props = result.properties as Record<string, Record<string, unknown>>;
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props)) {
      cleaned[key] = typeof val === "object" && val !== null ? sanitizeSchema(val) : val;
    }
    result.properties = cleaned;
  }

  return result;
}
