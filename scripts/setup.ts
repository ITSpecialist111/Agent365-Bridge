import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

/**
 * Interactive setup wizard for the Agent 365 MCP Bridge.
 *
 * Steps:
 * 1. Check if A365 CLI is installed
 * 2. Discover available MCP servers
 * 3. Configure MCP servers via CLI
 * 4. Create .env file from user input
 * 5. Build the project
 *
 * Usage: npm run setup
 */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main(): Promise<void> {
  console.log("=== Agent 365 MCP Bridge Setup ===\n");

  // Step 1: Check A365 CLI
  console.log("Step 1: Checking for Agent 365 CLI...");
  try {
    const version = execSync("a365 --version", { encoding: "utf-8" }).trim();
    console.log(`  Found A365 CLI: ${version}\n`);
  } catch {
    console.log("  A365 CLI not found.");
    console.log("  Install it with: npm install -g @microsoft/agent365-cli");
    console.log("  Then re-run: npm run setup\n");

    const proceed = await ask("Continue without A365 CLI? (y/n): ");
    if (proceed.toLowerCase() !== "y") {
      rl.close();
      return;
    }
    console.log();
  }

  // Step 2: Try to discover available servers
  console.log("Step 2: Discovering available MCP servers...");
  try {
    const servers = execSync("a365 develop list-available", {
      encoding: "utf-8",
    });
    console.log(servers);
  } catch {
    console.log("  Could not discover servers (A365 CLI may not be configured).");
    console.log("  Using default ToolingManifest.json with all 8 servers.\n");
  }

  // Step 3: Configure .env
  console.log("Step 3: Environment configuration\n");

  const envPath = path.resolve(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const overwrite = await ask(".env already exists. Overwrite? (y/n): ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("  Keeping existing .env\n");
      await buildProject();
      rl.close();
      return;
    }
  }

  console.log("Choose authentication mode:");
  console.log("  1. Azure Entra ID (recommended for production)");
  console.log("  2. Bearer token (for testing)");
  console.log("  3. Mock server (no auth, for development)");
  const authMode = await ask("\nAuth mode (1/2/3): ");

  let envContent = "";

  switch (authMode) {
    case "1": {
      const tenantId = await ask("Azure Tenant ID: ");
      const clientId = await ask("Azure Client ID: ");
      const clientSecret = await ask("Azure Client Secret: ");
      const agenticAppId = await ask("Agentic App ID (from A365 CLI): ");

      envContent = [
        "# Azure Entra ID Authentication",
        `AZURE_TENANT_ID=${tenantId}`,
        `AZURE_CLIENT_ID=${clientId}`,
        `AZURE_CLIENT_SECRET=${clientSecret}`,
        "",
        "# Agent 365 Configuration",
        "MCP_PLATFORM_ENDPOINT=https://agent365.svc.cloud.microsoft",
        "MCP_PLATFORM_AUTHENTICATION_SCOPE=ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/.default",
        `AGENTIC_APP_ID=${agenticAppId}`,
        "",
        "NODE_ENV=production",
      ].join("\n");
      break;
    }
    case "2": {
      const token = await ask("Bearer token: ");
      envContent = [
        "# Bearer Token Authentication",
        `BEARER_TOKEN=${token}`,
        "",
        "# Agent 365 Configuration",
        "MCP_PLATFORM_ENDPOINT=https://agent365.svc.cloud.microsoft",
        "MCP_PLATFORM_AUTHENTICATION_SCOPE=ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/.default",
        "",
        "NODE_ENV=development",
      ].join("\n");
      break;
    }
    case "3":
    default: {
      envContent = [
        "# Mock Server (no authentication required)",
        "MCP_PLATFORM_ENDPOINT=http://localhost:5309",
        "",
        "NODE_ENV=development",
      ].join("\n");
      break;
    }
  }

  fs.writeFileSync(envPath, envContent + "\n", "utf-8");
  console.log(`\n  .env written to ${envPath}\n`);

  // Step 4: Build
  await buildProject();

  console.log("\n=== Setup complete ===");
  console.log("Next steps:");
  console.log("  1. Build:     npm run build");
  console.log("  2. Register:  npm run register");
  console.log("  3. Use Claude Code in this project — Agent 365 tools will be available");
  console.log(
    "  4. For mock testing: npm run mock (starts mock server + registers)\n"
  );

  rl.close();
}

async function buildProject(): Promise<void> {
  console.log("Step 4: Building project...");
  try {
    execSync("npm run build", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
    });
    console.log("  Build successful.\n");
  } catch {
    console.log("  Build failed. Run 'npm install' first, then 'npm run build'.\n");
  }
}

main().catch((err) => {
  console.error("Setup failed:", err);
  rl.close();
  process.exit(1);
});
