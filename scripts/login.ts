import { loadConfig } from "../src/config/configuration";
import { TokenProvider } from "../src/auth/token-provider";
import { ServerDiscovery } from "../src/discovery/server-discovery";
import { getAuthRecordPath } from "../src/auth/auth-record-cache";
import { saveToolsCache, CachedTool } from "../src/auth/tools-cache";

/**
 * Interactive login script for Agent 365 Bridge.
 *
 * 1. Performs Device Code authentication and caches the token
 * 2. Runs full server discovery and caches the tool list
 *
 * After this, Claude Desktop can serve the full tool list instantly
 * (within the 5-second tools/list timeout).
 *
 * Usage: npm run login
 */

async function main(): Promise<void> {
    console.log("Agent 365 Bridge — Sign In & Setup\n");

    const config = loadConfig();
    const tokenProvider = new TokenProvider(config);

    if (tokenProvider.isMockMode()) {
        console.log("Running in mock mode — no authentication needed.");
        return;
    }

    if (!tokenProvider.isConfigured()) {
        console.error(
            "Error: No authentication configured.\n" +
            "Set AZURE_TENANT_ID and AZURE_CLIENT_ID in your .env file.\n" +
            "See .env.example for reference."
        );
        process.exit(1);
    }

    // Step 1: Authenticate
    console.log("Step 1: Sign in to Microsoft 365");
    console.log("Watch for the sign-in URL and code below.\n");

    try {
        await tokenProvider.authenticate();
        console.log("\n✅ Authentication successful!");
        console.log(`   Credentials cached at: ${getAuthRecordPath()}\n`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n❌ Sign-in failed: ${msg}`);
        process.exit(1);
    }

    // Step 2: Discover tools and cache them
    console.log("Step 2: Discovering Agent 365 MCP servers...\n");

    try {
        const discovery = new ServerDiscovery(config, tokenProvider);
        const servers = await discovery.discoverAll();

        const tools: CachedTool[] = servers.flatMap((server) =>
            server.tools.map((tool) => ({
                name: tool.name,
                description: tool.description ?? `Tool from ${tool.serverName}`,
                inputSchema: tool.inputSchema as Record<string, unknown>,
                serverName: server.config.mcpServerName,
            }))
        );

        saveToolsCache(tools);

        console.log(`\n✅ Discovered ${tools.length} tools across ${servers.length} servers`);

        // Show summary by server
        const byServer = new Map<string, string[]>();
        for (const tool of tools) {
            const list = byServer.get(tool.serverName) || [];
            list.push(tool.name);
            byServer.set(tool.serverName, list);
        }
        for (const [server, toolNames] of byServer) {
            if (toolNames.length > 0) {
                console.log(`   ${server}: ${toolNames.join(", ")}`);
            }
        }

        console.log("\n🎉 Setup complete!");
        console.log("   Claude Desktop will now load all tools instantly.");
        console.log("   Restart Claude Desktop if it's running.\n");
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n⚠️  Tool discovery failed: ${msg}`);
        console.error("   Authentication was successful, but tool caching failed.");
        console.error("   Try restarting Claude Desktop — tools may still work.\n");
    }
}

main();
