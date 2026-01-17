/**
 * TokenManager unit tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { homedir } from 'node:os';

// Mock the fs module
vi.mock('node:fs/promises');

// Import after mocking
import { TokenManager } from '../../src/client/token-manager.js';

const mockCredentials = {
  claudeAiOauth: {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600000, // 1 hour from now
    subscriptionType: 'max',
    rateLimitTier: 'tier_1',
    scopes: ['read', 'write'],
  },
};

describe('TokenManager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reads credentials from the default path', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockCredentials));

    const tm = new TokenManager();
    const token = await tm.getAccessToken();

    expect(token).toBe('test-access-token');
    expect(fs.readFile).toHaveBeenCalled();
  });

  it('returns cached token if not expired', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockCredentials));

    const tm = new TokenManager();

    // First call
    await tm.getAccessToken();
    // Second call should use cache
    await tm.getAccessToken();

    // Should only read once due to caching
    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('identifies token as expired when past buffer time', () => {
    const tm = new TokenManager();

    // Token that expired 10 minutes ago
    const expired = {
      accessToken: 'old-token',
      refreshToken: 'refresh',
      expiresAt: Date.now() - 600000,
    };

    expect(tm.isTokenExpired(expired)).toBe(true);

    // Token that expires in 10 minutes (within 5 minute buffer)
    const soonExpired = {
      accessToken: 'old-token',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 180000, // 3 minutes
    };

    expect(tm.isTokenExpired(soonExpired)).toBe(true);

    // Token that expires in 10 minutes (outside buffer)
    const valid = {
      accessToken: 'old-token',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 600000, // 10 minutes
    };

    expect(tm.isTokenExpired(valid)).toBe(false);
  });

  it('throws error when credentials file is missing', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

    const tm = new TokenManager();

    await expect(tm.getAccessToken()).rejects.toThrow(
      /Claude Code credentials not found/
    );
  });

  it('throws error when OAuth data is missing', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));

    const tm = new TokenManager();

    await expect(tm.getAccessToken()).rejects.toThrow(/No OAuth credentials found/);
  });

  it('returns subscription info', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockCredentials));

    const tm = new TokenManager();
    const info = await tm.getSubscriptionInfo();

    expect(info.type).toBe('max');
    expect(info.tier).toBe('tier_1');
    expect(info.scopes).toContain('read');
  });

  it('uses custom credentials path when provided', async () => {
    const customPath = '/custom/path/creds.json';
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockCredentials));

    const tm = new TokenManager({ credentialsPath: customPath });
    await tm.getAccessToken();

    expect(fs.readFile).toHaveBeenCalledWith(customPath, 'utf-8');
  });
});
