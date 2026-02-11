import * as jwt from "jsonwebtoken";

/** Seconds before expiry at which to refresh the token. */
const REFRESH_BUFFER_SECONDS = 300; // 5 minutes

/**
 * In-memory token cache with automatic expiry tracking.
 * Uses a single-promise pattern to avoid concurrent refresh race conditions.
 */
export class TokenCache {
  private token: string | null = null;
  private expiresAt: number = 0; // Unix timestamp in seconds
  private pendingRefresh: Promise<string> | null = null;

  /**
   * Returns a valid cached token, or acquires a new one using the provided
   * refresh function. Concurrent calls share the same refresh promise.
   */
  async getToken(refreshFn: () => Promise<string>): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    if (this.token && now < this.expiresAt - REFRESH_BUFFER_SECONDS) {
      return this.token;
    }

    // If a refresh is already in flight, wait for it
    if (this.pendingRefresh) {
      return this.pendingRefresh;
    }

    this.pendingRefresh = this.refresh(refreshFn);
    try {
      const token = await this.pendingRefresh;
      return token;
    } finally {
      this.pendingRefresh = null;
    }
  }

  private async refresh(refreshFn: () => Promise<string>): Promise<string> {
    const token = await refreshFn();
    this.token = token;
    this.expiresAt = this.extractExpiry(token);
    return token;
  }

  /**
   * Decodes the JWT to extract the `exp` claim.
   * Falls back to 1 hour from now if decoding fails.
   */
  private extractExpiry(token: string): number {
    try {
      const decoded = jwt.decode(token) as { exp?: number } | null;
      if (decoded?.exp) {
        return decoded.exp;
      }
    } catch {
      // Ignore decode errors
    }
    // Default: 1 hour from now
    return Math.floor(Date.now() / 1000) + 3600;
  }
}
