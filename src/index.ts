import { loadConfig } from "./config/configuration";
import { TokenProvider } from "./auth/token-provider";
import { ServerDiscovery } from "./discovery/server-discovery";
import { ToolForwarder } from "./proxy/tool-forwarder";
import { McpProxyServer } from "./proxy/mcp-proxy-server";

function log(message: string): void {
  process.stderr.write(`[agent365-bridge] ${message}\n`);
}

async function main(): Promise<void> {
  log("Starting Agent 365 Bridge for Claude Code...");

  // Step 1: Load configuration
  const config = loadConfig();
  log(`Environment: ${config.nodeEnv}`);
  log(`Platform endpoint: ${config.mcpPlatformEndpoint}`);
  log(`Manifest servers: ${config.manifest.mcpServers.length}`);

  // Step 2: Initialize token provider
  const tokenProvider = new TokenProvider(config);
  if (tokenProvider.isMockMode()) {
    log("Running in mock mode (no authentication required)");
  } else if (tokenProvider.isConfigured()) {
    log("Authentication configured");
  } else {
    log(
      "Warning: No authentication configured. Set BEARER_TOKEN or Azure credentials in .env"
    );
    log("Continuing anyway — tool discovery may fail against production servers");
  }

  // Step 3: Discover MCP servers and their tools
  log("Discovering Agent 365 MCP servers...");
  const discovery = new ServerDiscovery(config, tokenProvider);

  let resolvedServers;
  try {
    resolvedServers = await discovery.discoverAll();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Server discovery failed: ${message}`);
    log(
      "Hint: If using the mock server, ensure it is running (a365 develop start-mock-tooling-server)"
    );
    log(
      "Hint: If using production, verify your .env credentials and Frontier preview access"
    );
    process.exit(1);
  }

  if (resolvedServers.length === 0) {
    log("No MCP servers discovered. Check ToolingManifest.json or gateway access.");
    log("Starting with empty tool set — Claude Code will have no Agent 365 tools.");
  }

  const totalTools = resolvedServers.reduce(
    (sum, s) => sum + s.tools.length,
    0
  );
  log(
    `Discovered ${totalTools} tools across ${resolvedServers.length} servers:`
  );
  for (const server of resolvedServers) {
    log(
      `  ${server.config.mcpServerName}: ${server.tools.map((t) => t.name).join(", ")}`
    );
  }

  // Step 4: Create tool forwarder
  const forwarder = new ToolForwarder(config, tokenProvider, resolvedServers);

  // Step 5: Start MCP proxy server on stdio
  const proxy = new McpProxyServer(forwarder, resolvedServers);
  await proxy.start();

  // Handle graceful shutdown
  const cleanup = async () => {
    log("Shutting down...");
    await forwarder.closeAll();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});
