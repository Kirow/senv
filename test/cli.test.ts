import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { $ } from "bun";

describe("CLI operations", () => {
  let tempConfigDir: string;
  let tempProjectDir: string;

  beforeEach(async () => {
    tempConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-config-"));
    tempProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-proj-"));
  });

  afterEach(async () => {
    await fs.rm(tempConfigDir, { recursive: true, force: true });
    await fs.rm(tempProjectDir, { recursive: true, force: true });
  });

  async function runCLI(...args: string[]) {
    return await $`bun run ./src/index.ts ${args}`
      .env({
        ...process.env,
        SENV_CONFIG_DIR: tempConfigDir,
        SENV_PROJECT_DIR: tempProjectDir,
        USER: "testuser",
      })
      .nothrow()
      .quiet();
  }

  it("initializes a new project successfully", async () => {
    const { exitCode, stdout } = await runCLI("init");
    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("Initialized successfully");
    expect(stdout.toString()).toContain("testuser-local");

    // Check files
    const configPath = path.join(tempProjectDir, ".senv.json");
    const keystorePath = path.join(tempConfigDir, "identity.json");

    expect(await fs.exists(configPath)).toBe(true);
    expect(await fs.exists(keystorePath)).toBe(true);
  });

  it("handles adding and retrieving keys", async () => {
    await runCLI("init");

    const addRes = await runCLI("key", "add", "testuser-local", "API_KEY", "secret_123");
    expect(addRes.exitCode).toBe(0);
    expect(addRes.stdout.toString()).toContain("Added 'API_KEY'");

    const getRes = await runCLI("key", "get", "API_KEY");
    expect(getRes.exitCode).toBe(0);
    expect(getRes.stdout.toString().trim()).toBe("secret_123");

    const listRes = await runCLI("key", "list");
    expect(listRes.exitCode).toBe(0);
    expect(listRes.stdout.toString()).toContain("API_KEY=s***3 (from: testuser-local)");
  });

  it("handles environment flags correctly", async () => {
    await runCLI("init");

    await runCLI("key", "add", "testuser-local", "API_KEY", "dev_secret");
    await runCLI("key", "add", "testuser-local", "API_KEY", "prod_secret", "-e", "prod");

    const getDev = await runCLI("key", "get", "API_KEY");
    expect(getDev.stdout.toString().trim()).toBe("dev_secret");

    const getProd = await runCLI("key", "get", "API_KEY", "-e", "prod");
    expect(getProd.stdout.toString().trim()).toBe("prod_secret");
  });

  it("removes a key successfully", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "TO_REMOVE", "123");

    const rmRes = await runCLI("key", "rm", "testuser-local", "TO_REMOVE");
    expect(rmRes.exitCode).toBe(0);

    const getRes = await runCLI("key", "get", "TO_REMOVE");
    expect(getRes.exitCode).toBe(1);
  });

  it("exports keypairs and imports them", async () => {
    await runCLI("init");

    const exportRes = await runCLI("key", "export", "testuser-local");
    expect(exportRes.exitCode).toBe(0);
    const b64 = exportRes.stdout.toString().trim();

    const tempConfigDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-config2-"));
    try {
      const importRes = await runCLI("key", "import", b64, "-y", "--keystore", path.join(tempConfigDir2, "identity.json"));
      expect(importRes.exitCode).toBe(0);
      expect(importRes.stdout.toString()).toContain("Successfully imported keys");
    } finally {
      await fs.rm(tempConfigDir2, { recursive: true, force: true });
    }
  });

  it("exports decrypt-only key bundle and imports for decrypt", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "READ_ONLY_KEY", "read_secret");

    const exportRes = await runCLI("key", "export", "testuser-local", "--decrypt-only");
    expect(exportRes.exitCode).toBe(0);
    const b64 = exportRes.stdout.toString().trim();

    const tempConfigDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-config-ro-"));
    try {
      const importRes = await runCLI("key", "import", b64, "-y", "--keystore", path.join(tempConfigDir2, "identity.json"));
      expect(importRes.exitCode).toBe(0);

      const getRes = await runCLI("key", "get", "READ_ONLY_KEY", "--keystore", path.join(tempConfigDir2, "identity.json"));
      expect(getRes.exitCode).toBe(0);
      expect(getRes.stdout.toString().trim()).toBe("read_secret");
    } finally {
      await fs.rm(tempConfigDir2, { recursive: true, force: true });
    }
  });

  it("decrypt-only bundle import requires existing public key in keystore to re-encrypt", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "NEEDS_PUB", "v");

    const exportRes = await runCLI("key", "export", "testuser-local", "--decrypt-only");
    const b64 = exportRes.stdout.toString().trim();

    // Fresh keystore with no prior publicKey
    const fresh = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-fresh-"));
    try {
      const importRes = await runCLI("key", "import", b64, "-y", "--keystore", path.join(fresh, "identity.json"));
      expect(importRes.exitCode).toBe(0);

      // Decrypt still works
      const getRes = await runCLI("key", "get", "NEEDS_PUB", "--keystore", path.join(fresh, "identity.json"));
      expect(getRes.exitCode).toBe(0);
      expect(getRes.stdout.toString().trim()).toBe("v");

      // But adding a new key fails because there is no public key in this keystore
      const addRes = await runCLI("key", "add", "testuser-local", "NEW_KEY", "x", "--keystore", path.join(fresh, "identity.json"));
      expect(addRes.exitCode).toBe(1);
    } finally {
      await fs.rm(fresh, { recursive: true, force: true });
    }
  });

  it("escapes shell export values safely and rejects invalid env names", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "SAFE_KEY", "quo'te $(uname) `id` \"x\"");

    const exportRes = await runCLI("export");
    expect(exportRes.exitCode).toBe(0);
    expect(exportRes.stdout.toString()).toContain("export SAFE_KEY='quo'\\''te $(uname) `id` \"x\"'");

    const badAddRes = await runCLI("key", "add", "testuser-local", "BAD-KEY", "oops");
    expect(badAddRes.exitCode).toBe(1);
    expect(badAddRes.stderr.toString()).toContain("Invalid environment variable name 'BAD-KEY'");
  });

  it("rejects adding keys with invalid env name at add-time", async () => {
    await runCLI("init");
    const res = await runCLI("key", "add", "testuser-local", "1BAD", "v");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("Invalid environment variable name");
  });

  it("enforces 16KB limit on key values", async () => {
    await runCLI("init");
    const huge = "x".repeat(17 * 1024);
    const res = await runCLI("key", "add", "testuser-local", "BIG_KEY", huge);
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("16");
  });

  it("rejects invalid identity name on add", async () => {
    await runCLI("init");
    const res = await runCLI("identity", "add", "bad name!");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("Invalid identity name");
  });

  it("rejects importing bundle with invalid PEM", async () => {
    const badBundle = Buffer.from(
      JSON.stringify({ idName: "bad", publicKey: "NOT_A_PEM_KEY" }),
      "utf8"
    ).toString("base64");

    const res = await runCLI("key", "import", badBundle, "-y");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("not a valid PEM");
  });

  it("prompts before overwriting an existing identity on import", async () => {
    await runCLI("init");
    const exportRes = await runCLI("key", "export", "testuser-local");
    const b64 = exportRes.stdout.toString().trim();

    // No -y flag, stdin is closed -> readline returns empty, should abort
    const res = await $`bun run ./src/index.ts key import ${b64}`
      .env({
        ...process.env,
        SENV_CONFIG_DIR: tempConfigDir,
        SENV_PROJECT_DIR: tempProjectDir,
        USER: "testuser",
      })
      .nothrow();

    expect(res.exitCode).toBe(0);
    const combined = res.stdout.toString() + res.stderr.toString();
    expect(combined).toContain("Aborted");
  });

  it("emits a duplicate-key warning at init time when keys overlap across identities", async () => {
    await runCLI("init");
    // Add a key with the local user
    await runCLI("key", "add", "testuser-local", "DUP_KEY", "v1");
    // Add a second identity and a conflicting key
    await runCLI("identity", "add", "teammate");
    await runCLI("key", "add", "teammate", "DUP_KEY", "v2");

    // Now re-run init, expect warning
    const reinit = await runCLI("init");
    expect(reinit.exitCode).toBe(0);
    const combined = reinit.stdout.toString() + reinit.stderr.toString();
    expect(combined).toContain("Duplicate keys detected");
    expect(combined).toContain("DUP_KEY");
  });

  it("emits all-duplicate warning in key get when 3 identities share a key", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "TRIPLE", "first");
    await runCLI("identity", "add", "alt-1");
    await runCLI("key", "add", "alt-1", "TRIPLE", "second");
    await runCLI("identity", "add", "alt-2");
    await runCLI("key", "add", "alt-2", "TRIPLE", "third");

    const res = await runCLI("key", "get", "TRIPLE");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString().trim()).toBe("first");
    expect(res.stderr.toString()).toContain("3 identities");
    expect(res.stderr.toString()).toContain("testuser-local");
    expect(res.stderr.toString()).toContain("alt-1");
    expect(res.stderr.toString()).toContain("alt-2");
  });

  it("output: -V prints version string with CLI name", async () => {
    const res = await runCLI("-V");
    expect(res.exitCode).toBe(0);
    const out = res.stdout.toString().trim();
    expect(out).toContain("Secure ENV (senv)");
    expect(out).toContain("1.0.0");
  });

  it("handles migration between two files", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "KEY_A", "VAL_A");

    // Copy to file B
    const fileA = path.join(tempProjectDir, ".senv.json");
    const fileB = path.join(tempProjectDir, ".senv.b.json");
    await fs.copyFile(fileA, fileB);

    // Mutate file A
    await runCLI("key", "rm", "testuser-local", "KEY_A");
    await runCLI("key", "add", "testuser-local", "KEY_B", "VAL_B");

    // Migrate fileB (has KEY_A) into fileA (has KEY_B)
    const migrateRes = await runCLI("migrate", fileA, fileB);
    expect(migrateRes.exitCode).toBe(0);

    // Now get KEY_A and KEY_B from file A
    const getB = await runCLI("key", "get", "KEY_B");
    expect(getB.exitCode).toBe(0);
    expect(getB.stdout.toString().trim()).toBe("VAL_B");

    const getA = await runCLI("key", "get", "KEY_A");
    expect(getA.exitCode).toBe(0);
    expect(getA.stdout.toString().trim()).toBe("VAL_A");
  });

  it("supports the --keystore flag to override default location", async () => {
    const customKeystore = path.join(os.tmpdir(), `custom-keys-${Date.now()}.json`);

    try {
      // Init with custom keystore
      const initRes = await $`bun run ./src/index.ts init --keystore ${customKeystore}`
        .env({ ...process.env, SENV_PROJECT_DIR: tempProjectDir, USER: "testuser" })
        .nothrow().quiet();
      expect(initRes.exitCode).toBe(0);

      // Verify the custom keystore exists and the default one DOES NOT
      expect(await fs.exists(customKeystore)).toBe(true);
      expect(await fs.exists(path.join(tempConfigDir, "identity.json"))).toBe(false);

      // Add a key
      const addRes = await $`bun run ./src/index.ts key add testuser-local CUSTOM_FLAG "WORKS" --keystore ${customKeystore}`
        .env({ ...process.env, SENV_PROJECT_DIR: tempProjectDir, USER: "testuser" })
        .nothrow().quiet();
      expect(addRes.exitCode).toBe(0);

      // Retrieve the key with custom keystore
      const getRes = await $`bun run ./src/index.ts key get CUSTOM_FLAG --keystore ${customKeystore}`
        .env({ ...process.env, SENV_PROJECT_DIR: tempProjectDir, USER: "testuser" })
        .nothrow().quiet();

      expect(getRes.exitCode).toBe(0);
      expect(getRes.stdout.toString().trim()).toBe("WORKS");
    } finally {
      await fs.rm(customKeystore, { force: true });
    }
  });

  it("sanitizes init identity names from user env", async () => {
    const initRes = await $`bun run ./src/index.ts init`
      .env({
        ...process.env,
        SENV_CONFIG_DIR: tempConfigDir,
        SENV_PROJECT_DIR: tempProjectDir,
        USER: "John Doe+ops@acme",
      })
      .nothrow()
      .quiet();

    expect(initRes.exitCode).toBe(0);
    expect(initRes.stdout.toString()).toContain("Identity 'John-Doe-ops-acme-local' added.");
  });

  it.todo("export safely handles multiline secret values");
});
