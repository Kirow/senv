import { $ } from "bun";
import * as path from "node:path";

const emptyGitTemplate = path.join(import.meta.dir, "..", "fixtures", "empty-git-template");

/**
 * Initializes a git repo in `dir` for tests that depend on git resolution.
 *
 * @param dir - Temporary directory to run `git init` in.
 * @throws When `git init` fails (instead of silently skipping).
 */
export async function requireGitRepo(dir: string): Promise<void> {
  const res = await $`git init -b main --template=${emptyGitTemplate}`.cwd(dir).nothrow().quiet();
  if (res.exitCode !== 0) {
    const detail = res.stderr.toString().trim() || res.stdout.toString().trim() || "unknown error";
    throw new Error(`git init failed (exit ${res.exitCode}): ${detail}`);
  }
}
