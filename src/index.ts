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

  // Step 2: Initialize token provider (loads cached auth record if available)
  const tokenProvider = new TokenProvider(config);
  if (tokenProvider.isMockMode()) {
    log("Running in mock mode (no authentication required)");
  } else if (tokenProvider.isConfigured()) {
    log("Authentication configured");
  } else {
    log(
      "Warning: No authentication configured. Set BEARER_TOKEN or Azure credentials in .env"
    );
  }

  // Step 3: Start the MCP server with a discovery callback.
  //
  // The server starts immediately (responds to `initialize` right away).
  // Discovery runs in the background and `tools/list` blocks until it
  // completes (up to 30 seconds). With cached auth tokens, discovery
  // finishes in ~10 seconds and Claude gets the full 56 tools.
  const proxy = new McpProxyServer(null, [], async () => {
    log("Discovering Agent 365 MCP servers...");
    const discovery = new ServerDiscovery(config, tokenProvider);
    const servers = await discovery.discoverAll();

    if (servers.length === 0) {
      log(
        "No MCP servers discovered. Check ToolingManifest.json or gateway access."
      );
    }

    const totalTools = servers.reduce(
      (sum, s) => sum + s.tools.length,
      0
    );
    log(`Discovered ${totalTools} tools across ${servers.length} servers:`);
    for (const server of servers) {
      log(
        `  ${server.config.mcpServerName}: ${server.tools.map((t) => t.name).join(", ")}`
      );
    }

    const forwarder = new ToolForwarder(config, tokenProvider, servers);
    return { forwarder, servers };
  });

  await proxy.start();

  // Handle graceful shutdown
  const cleanup = async () => {
    log("Shutting down...");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});
