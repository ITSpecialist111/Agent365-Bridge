import { execSync } from "child_process";
import * as path from "path";

/**
 * Registers the Agent 365 MCP proxy with Claude Code as a user-scope MCP server.
 * This makes the proxy available across all projects.
 *
 * Usage: npm run register
 */

const distEntry = path.resolve(__dirname, "..", "dist", "index.js");

console.log("Registering Agent 365 Bridge with Claude Code...");
console.log(`Entry point: ${distEntry}`);

try {
  // Remove existing registration if present (ignore errors)
  try {
    execSync("claude mcp remove agent365-bridge", { stdio: "ignore" });
  } catch {
    // Not previously registered — that's fine
  }

  // Register as user-scope stdio MCP server
  const cmd = `claude mcp add --transport stdio --scope user agent365-bridge -- node "${distEntry}"`;
  console.log(`Running: ${cmd}`);
  execSync(cmd, { stdio: "inherit" });

  console.log("\nAgent 365 Bridge registered with Claude Code.");
  console.log("Restart Claude Code or open a new session to start using Agent 365 tools.");
} catch (err) {
  console.error("Failed to register with Claude Code:", err);
  console.error(
    "\nMake sure Claude Code CLI is installed and accessible from the command line."
  );
  console.error("You can install it with: npm install -g @anthropic-ai/claude-code");
  process.exit(1);
}
