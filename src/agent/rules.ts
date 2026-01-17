/**
 * Rules file loader - Load system prompt rules from a directory.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SystemBlock } from '../client/types.js';

export interface RulesLoaderOptions {
  /** Directory containing rules files */
  rulesDir: string;
  /** File extension to look for (default: '.md') */
  extension?: string;
  /** Whether to cache the rules (default: true) */
  cache?: boolean;
}

export interface LoadedRules {
  /** Combined rules content */
  content: string;
  /** Individual rule files loaded */
  files: { name: string; content: string }[];
  /** Total character count */
  totalChars: number;
}

// Cache for loaded rules
const rulesCache = new Map<string, { rules: LoadedRules; mtime: number }>();

/**
 * Load rules from a directory.
 * Files are sorted alphabetically by name (so 00-identity.md comes before 10-system.md).
 */
export async function loadRules(options: RulesLoaderOptions): Promise<LoadedRules> {
  const { rulesDir, extension = '.md', cache = true } = options;

  // Check cache
  if (cache) {
    const cached = rulesCache.get(rulesDir);
    if (cached) {
      // Check if any file has changed
      const currentMtime = await getDirectoryMtime(rulesDir);
      if (currentMtime === cached.mtime) {
        return cached.rules;
      }
    }
  }

  // Find all rule files
  const entries = await fs.readdir(rulesDir, { withFileTypes: true });
  const ruleFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(extension))
    .map((e) => e.name)
    .sort();

  // Load each file
  const files: { name: string; content: string }[] = [];

  for (const fileName of ruleFiles) {
    const filePath = path.join(rulesDir, fileName);
    const content = await fs.readFile(filePath, 'utf-8');
    files.push({ name: fileName, content: content.trim() });
  }

  // Combine into single content
  const content = files
    .map((f) => `# ${f.name}\n\n${f.content}`)
    .join('\n\n---\n\n');

  const rules: LoadedRules = {
    content,
    files,
    totalChars: content.length,
  };

  // Update cache
  if (cache) {
    const mtime = await getDirectoryMtime(rulesDir);
    rulesCache.set(rulesDir, { rules, mtime });
  }

  return rules;
}

/**
 * Convert loaded rules to system blocks for the API.
 */
export function rulesToSystemBlocks(rules: LoadedRules): SystemBlock[] {
  return [
    {
      type: 'text',
      text: rules.content,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

/**
 * Load a single rules file.
 */
export async function loadSingleRulesFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(`Rules file not found: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Clear the rules cache.
 */
export function clearRulesCache(): void {
  rulesCache.clear();
}

/**
 * Get the latest modification time of any file in a directory.
 */
async function getDirectoryMtime(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    let maxMtime = 0;

    for (const entry of entries) {
      if (entry.isFile()) {
        const stat = await fs.stat(path.join(dirPath, entry.name));
        maxMtime = Math.max(maxMtime, stat.mtimeMs);
      }
    }

    return maxMtime;
  } catch {
    return 0;
  }
}
