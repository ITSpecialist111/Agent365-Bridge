import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { AppConfig, ToolingManifest } from "./types";

const DEFAULT_ENDPOINT = "https://agent365.svc.cloud.microsoft";
const DEFAULT_AUTH_SCOPE = "ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/.default";

/**
 * Loads the ToolingManifest.json from the project root.
 * Returns an empty manifest if the file does not exist.
 */
function loadManifest(): ToolingManifest {
  const manifestPath = path.resolve(
    __dirname,
    "..",
    "..",
    "ToolingManifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return { mcpServers: [] };
  }
  const raw = fs.readFileSync(manifestPath, "utf-8");
  return JSON.parse(raw) as ToolingManifest;
}

/**
 * Loads configuration from .env and ToolingManifest.json.
 */
export function loadConfig(): AppConfig {
  dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

  const manifest = loadManifest();

  return {
    // Authentication
    tenantId: process.env.AZURE_TENANT_ID || undefined,
    clientId: process.env.AZURE_CLIENT_ID || undefined,
    clientSecret: process.env.AZURE_CLIENT_SECRET || undefined,
    bearerToken: process.env.BEARER_TOKEN || undefined,
    authMode: process.env.AUTH_MODE || undefined,

    // Agent 365 platform
    mcpPlatformEndpoint:
      process.env.MCP_PLATFORM_ENDPOINT || DEFAULT_ENDPOINT,
    mcpPlatformAuthScope:
      process.env.MCP_PLATFORM_AUTHENTICATION_SCOPE || DEFAULT_AUTH_SCOPE,
    agenticAppId: process.env.AGENTIC_APP_ID || undefined,

    // Runtime
    nodeEnv: process.env.NODE_ENV || "development",

    // Manifest
    manifest,
  };
}
