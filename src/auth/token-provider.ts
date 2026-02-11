import { DeviceCodeCredential, ClientSecretCredential, TokenCredential } from "@azure/identity";
import { TokenCache } from "./token-cache";
import { AppConfig } from "../config/types";

function log(message: string): void {
  process.stderr.write(`[agent365-bridge] ${message}\n`);
}

/**
 * Provides authentication tokens for Agent 365 MCP server requests.
 *
 * Three modes:
 * 1. Static token mode: uses BEARER_TOKEN env var directly (for testing)
 * 2. Device Code mode (default): interactive user sign-in via browser
 *    — required because Agent 365 uses Delegated permissions
 * 3. Client Secret mode: uses ClientSecretCredential for Application permissions
 *    — only works if Application-type permissions are configured
 */
export class TokenProvider {
  private cache = new TokenCache();
  private credential: TokenCredential | null = null;
  private config: AppConfig;
  private scopes: string[];

  constructor(config: AppConfig) {
    this.config = config;

    // Use /.default scope — this requests ALL consented permissions for the app.
    // This avoids scope name mismatches between the manifest and the Azure API.
    this.scopes = [config.mcpPlatformAuthScope];

    if (config.tenantId && config.clientId) {
      if (config.clientSecret) {
        // If AUTH_MODE=client_credentials, use client secret flow
        if (config.authMode === "client_credentials") {
          log("Using Client Secret credential (Application permissions)");
          this.credential = new ClientSecretCredential(
            config.tenantId,
            config.clientId,
            config.clientSecret
          );
          this.scopes = [config.mcpPlatformAuthScope]; // .default for app perms
        } else {
          // Default: Device Code flow for Delegated permissions
          log("Using Device Code credential (Delegated permissions)");
          log("You will be prompted to sign in via your browser on first run.");
          this.credential = new DeviceCodeCredential({
            tenantId: config.tenantId,
            clientId: config.clientId,
            userPromptCallback: (info) => {
              log("========================================");
              log("SIGN IN REQUIRED");
              log(`Go to: ${info.verificationUri}`);
              log(`Enter code: ${info.userCode}`);
              log("========================================");
            },
          });
        }
      } else {
        // No secret — device code only
        log("Using Device Code credential (no client secret)");
        this.credential = new DeviceCodeCredential({
          tenantId: config.tenantId,
          clientId: config.clientId,
          userPromptCallback: (info) => {
            log("========================================");
            log("SIGN IN REQUIRED");
            log(`Go to: ${info.verificationUri}`);
            log(`Enter code: ${info.userCode}`);
            log("========================================");
          },
        });
      }
    }
  }

  /**
   * Returns true if authentication is configured (either static token or Entra ID).
   */
  isConfigured(): boolean {
    return !!this.config.bearerToken || !!this.credential;
  }

  /**
   * Returns true if using the mock server endpoint (no auth required).
   */
  isMockMode(): boolean {
    return this.config.mcpPlatformEndpoint.includes("localhost");
  }

  /**
   * Gets a valid bearer token. Handles caching and refresh automatically.
   * Returns null if in mock mode (no auth needed).
   */
  async getToken(): Promise<string | null> {
    if (this.isMockMode()) {
      return null;
    }

    // Static token mode
    if (this.config.bearerToken) {
      return this.config.bearerToken;
    }

    // Entra ID mode
    if (!this.credential) {
      throw new Error(
        "No authentication configured. Set BEARER_TOKEN or AZURE_TENANT_ID + AZURE_CLIENT_ID in .env"
      );
    }

    return this.cache.getToken(async () => {
      const result = await this.credential!.getToken(this.scopes);
      if (!result) throw new Error("Failed to acquire token");
      return result.token;
    });
  }
}
