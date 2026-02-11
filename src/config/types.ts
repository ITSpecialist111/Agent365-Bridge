/**
 * Configuration for a single Agent 365 MCP server entry from ToolingManifest.json.
 */
export interface MCPServerConfig {
  mcpServerName: string;
  mcpServerUniqueName?: string;
  url?: string;
  scope?: string;
  audience?: string;
}

/**
 * Structure of ToolingManifest.json — declares which MCP servers to connect to.
 */
export interface ToolingManifest {
  mcpServers: MCPServerConfig[];
}

/**
 * Resolved application configuration from environment variables.
 */
export interface AppConfig {
  // Authentication
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  bearerToken?: string;
  authMode?: string; // "device_code" (default) or "client_credentials"

  // Agent 365 platform
  mcpPlatformEndpoint: string;
  mcpPlatformAuthScope: string;
  agenticAppId?: string;

  // Runtime
  nodeEnv: string;

  // Manifest
  manifest: ToolingManifest;
}

/**
 * A discovered MCP tool from a remote server.
 */
export interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

/**
 * A fully resolved MCP server with its endpoint URL and discovered tools.
 */
export interface ResolvedServer {
  config: MCPServerConfig;
  url: string;
  tools: DiscoveredTool[];
}
