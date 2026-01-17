/**
 * TokenManager - OAuth token management for Claude subscription authentication.
 *
 * Reads and refreshes tokens from Claude Code's credentials file.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { homedir } from 'node:os';
import type { Credentials, ClaudeOAuth, SubscriptionInfo } from './types.js';

// Constants
const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const TOKEN_REFRESH_URL = 'https://console.anthropic.com/v1/oauth/token';
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export interface TokenManagerOptions {
  credentialsPath?: string;
}

export class TokenManager {
  private credentialsPath: string;
  private cachedCredentials: Credentials | null = null;
  private lastReadTime = 0;
  private readonly CACHE_TTL_MS = 10_000; // Re-read file every 10 seconds max

  constructor(options: TokenManagerOptions = {}) {
    this.credentialsPath = options.credentialsPath ?? this.findCredentialsPath();
  }

  private findCredentialsPath(): string {
    const home = homedir();
    // Try both .credentials.json and credentials.json
    const paths = [
      path.join(home, '.claude', '.credentials.json'),
      path.join(home, '.claude', 'credentials.json'),
    ];

    // We'll check existence when actually loading, just return primary path
    return paths[0];
  }

  private async loadCredentials(forceReload = false): Promise<Credentials> {
    const now = Date.now();

    // Return cached if fresh enough
    if (!forceReload && this.cachedCredentials && now - this.lastReadTime < this.CACHE_TTL_MS) {
      return this.cachedCredentials;
    }

    // Try both credential file locations
    const home = homedir();
    const paths = [
      this.credentialsPath,
      path.join(home, '.claude', 'credentials.json'),
    ];

    for (const credPath of paths) {
      try {
        const content = await fs.readFile(credPath, 'utf-8');
        this.cachedCredentials = JSON.parse(content);
        this.credentialsPath = credPath; // Remember which one worked
        this.lastReadTime = now;
        return this.cachedCredentials!;
      } catch {
        // Try next path
      }
    }

    throw new Error(
      `Claude Code credentials not found. Please run 'claude login' first.\n` +
        `Looked in: ${paths.join(', ')}`
    );
  }

  private async saveCredentials(credentials: Credentials): Promise<void> {
    await fs.writeFile(this.credentialsPath, JSON.stringify(credentials, null, 2));
    this.cachedCredentials = credentials;
    this.lastReadTime = Date.now();
  }

  private getOAuthData(credentials: Credentials): ClaudeOAuth {
    if (!credentials.claudeAiOauth) {
      throw new Error("No OAuth credentials found in credentials file. Please run 'claude login'.");
    }
    return credentials.claudeAiOauth;
  }

  /**
   * Check if the current access token is expired (with buffer).
   */
  isTokenExpired(oauthData?: ClaudeOAuth): boolean {
    const oauth = oauthData ?? this.cachedCredentials?.claudeAiOauth;
    if (!oauth) return true;

    const expiresAt = oauth.expiresAt ?? 0;
    const now = Date.now();

    return now >= expiresAt - TOKEN_EXPIRY_BUFFER_MS;
  }

  /**
   * Refresh the access token using the refresh token.
   */
  async refreshToken(): Promise<string> {
    const credentials = await this.loadCredentials(true);
    const oauthData = this.getOAuthData(credentials);

    if (!oauthData.refreshToken) {
      throw new Error("No refresh token available. Please run 'claude login'.");
    }

    const response = await fetch(TOKEN_REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: oauthData.refreshToken,
        client_id: CLAUDE_CODE_CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${text}`);
    }

    const newTokens = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    // Update credentials
    oauthData.accessToken = newTokens.access_token;
    if (newTokens.refresh_token) {
      oauthData.refreshToken = newTokens.refresh_token;
    }
    // Access tokens last 8 hours (28800 seconds)
    oauthData.expiresAt = Date.now() + (newTokens.expires_in ?? 28800) * 1000;

    await this.saveCredentials(credentials);

    return newTokens.access_token;
  }

  /**
   * Get a valid access token, refreshing if necessary.
   */
  async getAccessToken(forceRefresh = false): Promise<string> {
    const credentials = await this.loadCredentials();
    const oauthData = this.getOAuthData(credentials);

    if (forceRefresh || this.isTokenExpired(oauthData)) {
      return this.refreshToken();
    }

    return oauthData.accessToken;
  }

  /**
   * Get subscription information.
   */
  async getSubscriptionInfo(): Promise<SubscriptionInfo> {
    const credentials = await this.loadCredentials();
    const oauthData = this.getOAuthData(credentials);

    return {
      type: oauthData.subscriptionType ?? 'unknown',
      tier: oauthData.rateLimitTier ?? 'unknown',
      scopes: oauthData.scopes ?? [],
    };
  }

  /**
   * Get the credentials file path being used.
   */
  getCredentialsPath(): string {
    return this.credentialsPath;
  }
}
