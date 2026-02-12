import {
  DeviceCodeCredential,
  ClientSecretCredential,
  TokenCredential,
  AuthenticationRecord,
  useIdentityPlugin,
} from "@azure/identity";
import { cachePersistencePlugin } from "@azure/identity-cache-persistence";
import { TokenCache } from "./token-cache";
import { loadAuthRecord, saveAuthRecord } from "./auth-record-cache";
import { AppConfig } from "../config/types";

// Enable the persistent token cache plugin.
// This stores MSAL tokens in the OS credential store (encrypted on Windows/macOS).
useIdentityPlugin(cachePersistencePlugin);

function log(message: string): void {
  process.stderr.write(`[agent365-bridge] ${message}\n`);
}

/**
 * Provides authentication tokens for Agent 365 MCP server requests.
 *
 * Supports persistent token caching:
 * 1. On first run, user signs in via `npm run login` (device code flow)
 * 2. AuthenticationRecord is saved to disk (~/.agent365-bridge/auth-record.json)
 * 3. On subsequent runs (e.g., launched by Claude Desktop), tokens are acquired
 *    silently using the cached record — no interactive sign-in needed
 *
 * Four auth modes:
 * - Device Code (default): interactive user sign-in via browser
 * - Client Secret: for Application-type permissions
 * - Static Bearer Token: for testing with a pre-acquired token
 * - Mock: no auth needed (localhost endpoint)
 */
export class TokenProvider {
  private cache = new TokenCache();
  private credential: TokenCredential | null = null;
  private config: AppConfig;
  private scopes: string[];

  /** The underlying DeviceCodeCredential (if using device code mode) */
  private deviceCodeCredential: DeviceCodeCredential | null = null;

  constructor(config: AppConfig) {
    this.config = config;

    // Use /.default scope — this requests ALL consented permissions for the app.
    this.scopes = [config.mcpPlatformAuthScope];

    if (config.tenantId && config.clientId) {
      if (config.clientSecret) {
        if (config.authMode === "client_credentials") {
          // Client Secret flow for Application permissions
          log("Using Client Secret credential (Application permissions)");
          this.credential = new ClientSecretCredential(
            config.tenantId,
            config.clientId,
            config.clientSecret
          );
          this.scopes = [config.mcpPlatformAuthScope];
        } else {
          // Default: Device Code flow with persistent caching
          this.initDeviceCode(config);
        }
      } else {
        // No secret — device code only
        this.initDeviceCode(config);
      }
    }
  }

  /**
   * Initializes the DeviceCodeCredential with persistent token cache.
   * If a cached AuthenticationRecord exists, the credential will attempt
   * silent token acquisition (no interactive prompt).
   */
  private initDeviceCode(config: AppConfig): void {
    const cachedRecord = loadAuthRecord();

    if (cachedRecord) {
      log("Using Device Code credential with cached auth (silent mode)");
    } else {
      log("Using Device Code credential (Delegated permissions)");
      log("Run 'npm run login' to sign in, or the device code prompt will appear on first use.");
    }

    this.deviceCodeCredential = new DeviceCodeCredential({
      tenantId: config.tenantId,
      clientId: config.clientId,
      // If we have a cached record, pass it for silent auth
      ...(cachedRecord ? { authenticationRecord: cachedRecord } : {}),
      // Enable persistent token cache (uses OS credential store)
      tokenCachePersistenceOptions: {
        enabled: true,
        name: "agent365-bridge",
      },
      // Device code callback (only triggered if silent auth fails)
      userPromptCallback: (info) => {
        log("========================================");
        log("SIGN IN REQUIRED");
        log(`Go to: ${info.verificationUri}`);
        log(`Enter code: ${info.userCode}`);
        log("========================================");
      },
    });

    this.credential = this.deviceCodeCredential;
  }

  /**
   * Performs an interactive authentication and saves the AuthenticationRecord
   * to disk. This is called by `npm run login` for one-time setup.
   *
   * After this, subsequent launches can authenticate silently.
   */
  async authenticate(): Promise<void> {
    if (!this.deviceCodeCredential) {
      throw new Error(
        "Cannot authenticate: no DeviceCodeCredential configured. " +
        "Set AZURE_TENANT_ID and AZURE_CLIENT_ID in .env"
      );
    }

    log("Starting interactive authentication...");
    const record = await this.deviceCodeCredential.authenticate(this.scopes);

    if (record) {
      saveAuthRecord(record);
      log("✅ Authentication successful! Token cached for future sessions.");
    } else {
      log("Warning: Authentication completed but no record was returned.");
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
