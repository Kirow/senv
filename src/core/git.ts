import { execSync } from "node:child_process";
import * as path from "node:path";

// Per-process cache: resolveProjectDir may call getGitRoot on every store operation.
const gitRootCache = new Map<string, string | null>();

/** Clears the per-process git-root cache. Called by tests that mutate git state between assertions. */
export function clearGitRootCache(): void {
  gitRootCache.clear();
}

/**
 * Returns the git repository root for a starting directory.
 *
 * Results are cached per resolved `startDir` for the lifetime of the process.
 *
 * @param startDir - Directory to resolve from (typically `process.cwd()`).
 * @returns Absolute repository root, or `null` when not inside a git repo.
 */
export function getGitRoot(startDir: string): string | null {
  const key = path.resolve(startDir);
  const cached = gitRootCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const root = execSync("git rev-parse --show-toplevel", { cwd: startDir, encoding: "utf-8" }).trim();
    gitRootCache.set(key, root);
    return root;
  } catch {
    gitRootCache.set(key, null);
    return null;
  }
}
