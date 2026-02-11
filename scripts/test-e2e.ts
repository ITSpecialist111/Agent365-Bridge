/**
 * End-to-end test script for the Agent 365 MCP Bridge.
 * 
 * Connects to the bridge via stdio MCP protocol (same as Claude Code would),
 * lists available tools, and tests Word document creation.
 * 
 * Usage: npx ts-node scripts/test-e2e.ts
 * 
 * You'll be prompted to sign in via device code on first run.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";

function log(msg: string): void {
    process.stderr.write(`[test] ${msg}\n`);
}

async function main(): Promise<void> {
    log("Starting end-to-end MCP Bridge test...");
    log("This will connect to the bridge, list tools, and test Word document creation.\n");

    // Spawn the bridge as a child process (same way Claude Code connects)
    const bridgePath = path.resolve(__dirname, "..", "dist", "index.js");

    const transport = new StdioClientTransport({
        command: "node",
        args: [bridgePath],
        cwd: path.resolve(__dirname, ".."),
    });

    const client = new Client({
        name: "agent365-e2e-test",
        version: "1.0.0",
    });

    log("Connecting to bridge (you may need to sign in via device code)...");
    log("Watch stderr for sign-in instructions.\n");

    // 3-minute timeout to allow for device code sign-in
    await client.connect(transport, { timeout: 180_000 });
    log("✅ Connected to MCP Bridge!\n");

    // Step 1: List all available tools
    log("═══════════════════════════════════════");
    log("STEP 1: Listing all available tools");
    log("═══════════════════════════════════════\n");

    const toolsResult = await client.listTools();
    const tools = toolsResult.tools;

    log(`Found ${tools.length} total tools:\n`);

    // Group tools by server prefix
    const toolsByServer = new Map<string, string[]>();
    for (const tool of tools) {
        // Server name is typically part of the tool name or we can just list them
        const name = tool.name;
        const desc = tool.description || "(no description)";
        log(`  • ${name}: ${desc}`);
    }

    log(`\n📊 Total: ${tools.length} tools discovered\n`);

    // Step 2: Try creating a Word document
    log("═══════════════════════════════════════");
    log("STEP 2: Creating a Word document (WRITE test)");
    log("═══════════════════════════════════════\n");

    // Find Word-related tools
    const wordTools = tools.filter(
        (t) =>
            t.name.toLowerCase().includes("word") ||
            t.name.toLowerCase().includes("document") ||
            t.name.toLowerCase().includes("createdocument") ||
            t.name.toLowerCase().includes("create_document")
    );

    if (wordTools.length === 0) {
        log("⚠️  No Word/document tools found. Listing all tool names for reference:");
        for (const t of tools) {
            log(`    ${t.name}`);
        }
    } else {
        log(`Found ${wordTools.length} Word-related tool(s):`);
        for (const t of wordTools) {
            log(`  • ${t.name}: ${t.description}`);
            log(`    Input schema: ${JSON.stringify(t.inputSchema, null, 2)}`);
        }

        // Try the first Word tool
        const createTool = wordTools[0];
        log(`\nCalling tool: ${createTool.name}...`);

        try {
            const result = await client.callTool({
                name: createTool.name,
                arguments: {
                    title: "Agent365 Bridge Test Document",
                    content:
                        "This document was created by the Agent 365 MCP Bridge test suite on " +
                        new Date().toISOString() +
                        ".\n\nThis proves that Claude Code can create Word documents via the Agent 365 MCP servers.",
                },
            });

            log(`\n✅ Word document created!`);
            log(`Response: ${JSON.stringify(result, null, 2)}`);
        } catch (err: any) {
            log(`\n❌ Word tool call failed: ${err.message}`);
            log(`This might mean the tool expects different parameters.`);
            log(`Tool schema: ${JSON.stringify(createTool.inputSchema, null, 2)}`);
        }
    }

    // Step 3: Try to search/read
    log("\n═══════════════════════════════════════");
    log("STEP 3: Searching M365 data (READ/SEARCH test)");
    log("═══════════════════════════════════════\n");

    // Look for search, copilot, mail, or list tools
    const searchTools = tools.filter(
        (t) =>
            t.name.toLowerCase().includes("search") ||
            t.name.toLowerCase().includes("list") ||
            t.name.toLowerCase().includes("get") ||
            t.name.toLowerCase().includes("read") ||
            t.name.toLowerCase().includes("retrieve")
    );

    if (searchTools.length > 0) {
        log(`Found ${searchTools.length} search/read tool(s):`);
        for (const t of searchTools.slice(0, 5)) {
            log(`  • ${t.name}: ${t.description || "(no description)"}`);
        }
        if (searchTools.length > 5) {
            log(`  ... and ${searchTools.length - 5} more`);
        }

        // Try a simple mail search or profile retrieval
        const profileTool = tools.find(
            (t) =>
                t.name.toLowerCase().includes("getprofile") ||
                t.name.toLowerCase().includes("get_profile") ||
                t.name.toLowerCase().includes("me") ||
                t.name.toLowerCase().includes("whoami")
        );

        const mailTool = tools.find(
            (t) =>
                t.name.toLowerCase().includes("searchmessage") ||
                t.name.toLowerCase().includes("search_message") ||
                t.name.toLowerCase().includes("listmessage") ||
                t.name.toLowerCase().includes("list_message") ||
                t.name.toLowerCase().includes("getmessage")
        );

        const readTool = profileTool || mailTool || searchTools[0];

        if (readTool) {
            log(`\nCalling tool: ${readTool.name}...`);
            log(`Schema: ${JSON.stringify(readTool.inputSchema, null, 2)}`);

            try {
                const result = await client.callTool({
                    name: readTool.name,
                    arguments: {},
                });
                log(`\n✅ Read/search succeeded!`);
                log(
                    `Response (first 500 chars): ${JSON.stringify(result).substring(0, 500)}`
                );
            } catch (err: any) {
                log(`\n❌ Read tool call failed: ${err.message}`);
            }
        }
    } else {
        log("No search/read tools found.");
    }

    // Summary
    log("\n═══════════════════════════════════════");
    log("TEST SUMMARY");
    log("═══════════════════════════════════════\n");
    log(`✅ MCP Connection: SUCCESS`);
    log(`✅ Tool Discovery: ${tools.length} tools found`);
    log(`📝 Word Tools: ${wordTools.length} found`);
    log(`🔍 Search/Read Tools: ${searchTools.length} found`);

    // Clean up
    await client.close();
    log("\nTest complete. Bridge connection closed.");
}

main().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
