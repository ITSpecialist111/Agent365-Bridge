/**
 * Utility to dump all MCP tool schemas to a JSON file.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
    const bridgePath = path.resolve(__dirname, "..", "dist", "index.js");
    const transport = new StdioClientTransport({
        command: "node",
        args: [bridgePath],
        cwd: path.resolve(__dirname, ".."),
    });

    const client = new Client({
        name: "schema-dumper",
        version: "1.0.0",
    });

    await client.connect(transport, { timeout: 180_000 });
    const toolsResult = await client.listTools();

    fs.writeFileSync(
        path.resolve(__dirname, "..", "tool_schemas.json"),
        JSON.stringify(toolsResult.tools, null, 2),
        "utf-8"
    );

    await client.close();
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
