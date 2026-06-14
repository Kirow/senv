import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { clearGitRootCache, getGitRoot } from "../src/core/git";
import { requireGitRepo } from "./helpers/git";

describe("git root resolution", () => {
  let tempDir: string;

  beforeEach(async () => {
    clearGitRootCache();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "senv-git-test-"));
  });

  afterEach(async () => {
    clearGitRootCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("getGitRoot returns null outside a repository", () => {
    expect(getGitRoot(tempDir)).toBeNull();
  });

  it("getGitRoot returns repository root and caches the result", async () => {
    await requireGitRepo(tempDir);
    const root = await fs.realpath(tempDir);
    expect(getGitRoot(tempDir)).toBe(root);
    expect(getGitRoot(tempDir)).toBe(root);
  });

  it("clearGitRootCache forces a fresh lookup", async () => {
    await requireGitRepo(tempDir);
    const root = await fs.realpath(tempDir);
    expect(getGitRoot(tempDir)).toBe(root);
    clearGitRootCache();
    expect(getGitRoot(tempDir)).toBe(root);
  });
});

describe("requireGitRepo", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "senv-git-helper-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("throws when git init fails", async () => {
    const readonlyDir = path.join(tempDir, "readonly");
    await fs.mkdir(readonlyDir);
    await fs.chmod(readonlyDir, 0o555);
    try {
      await expect(requireGitRepo(readonlyDir)).rejects.toThrow(/git init failed/);
    } finally {
      await fs.chmod(readonlyDir, 0o755);
    }
  });
});
