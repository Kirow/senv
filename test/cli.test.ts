import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { $, spawn } from "bun";
import { VERSION, GITHUB_URL } from "../src/version";
import { runUpdate } from "../src/commands/update";

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

  async function runCLIWithKeystore(user: string, keystorePath: string, ...args: string[]) {
    return await $`bun run ./src/index.ts ${[...args, "--keystore", keystorePath]}`
      .env({
        ...process.env,
        SENV_CONFIG_DIR: tempConfigDir,
        SENV_PROJECT_DIR: tempProjectDir,
        USER: user,
      })
      .nothrow()
      .quiet();
  }

  async function runCLINoStdin(...args: string[]) {
    const proc = spawn({
      cmd: ["bun", "run", "./src/index.ts", ...args],
      env: {
        ...process.env,
        SENV_CONFIG_DIR: tempConfigDir,
        SENV_PROJECT_DIR: tempProjectDir,
        USER: "testuser",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
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
    expect(listRes.stdout.toString()).toContain("API_KEY = s***3");
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

  it("migrate adds missing keys from a .env file", async () => {
    await runCLI("init");

    const envPath = path.join(tempProjectDir, ".env");
    await fs.writeFile(envPath, "FOO=1\nBAR=2\n");

    const migrateRes = await runCLI("migrate", "testuser-local", envPath);
    expect(migrateRes.exitCode).toBe(0);
    expect(migrateRes.stdout.toString()).toContain("- FOO");
    expect(migrateRes.stdout.toString()).toContain("- BAR");

    const getFoo = await runCLI("key", "get", "FOO");
    expect(getFoo.stdout.toString().trim()).toBe("1");

    const getBar = await runCLI("key", "get", "BAR");
    expect(getBar.stdout.toString().trim()).toBe("2");
  });

  it("migrate skips existing keys", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "FOO", "existing");

    const envPath = path.join(tempProjectDir, ".env");
    await fs.writeFile(envPath, "FOO=new\nBAR=2\n");

    const migrateRes = await runCLI("migrate", "testuser-local", envPath);
    expect(migrateRes.exitCode).toBe(0);
    expect(migrateRes.stdout.toString()).toContain("- BAR");
    expect(migrateRes.stdout.toString()).not.toContain("Added:\n- FOO");
    expect(migrateRes.stdout.toString()).toContain("- FOO");

    const getFoo = await runCLI("key", "get", "FOO");
    expect(getFoo.stdout.toString().trim()).toBe("existing");
  });

  it("migrate respects the -e flag", async () => {
    await runCLI("init");

    const envPath = path.join(tempProjectDir, ".env");
    await fs.writeFile(envPath, "BAZ=1\n");

    const migrateRes = await runCLI("migrate", "testuser-local", envPath, "-e", "prod");
    expect(migrateRes.exitCode).toBe(0);

    const getProd = await runCLI("key", "get", "BAZ", "-e", "prod");
    expect(getProd.stdout.toString().trim()).toBe("1");

    const getDev = await runCLI("key", "get", "BAZ");
    expect(getDev.exitCode).toBe(1);
  });

  it("migrate skips invalid env var names with a warning", async () => {
    await runCLI("init");

    const envPath = path.join(tempProjectDir, ".env");
    await fs.writeFile(envPath, "bad-name=1\nGOOD=2\n");

    const migrateRes = await runCLI("migrate", "testuser-local", envPath);
    expect(migrateRes.exitCode).toBe(0);
    expect(migrateRes.stderr.toString()).toContain("Skipping invalid environment variable name 'bad-name'");
    expect(migrateRes.stdout.toString()).toContain("- GOOD");
    expect(migrateRes.stdout.toString()).not.toContain("- bad-name");

    const getGood = await runCLI("key", "get", "GOOD");
    expect(getGood.stdout.toString().trim()).toBe("2");
  });

  it("migrate fails when the .env file is missing", async () => {
    await runCLI("init");

    const migrateRes = await runCLI("migrate", "testuser-local", "missing.env");
    expect(migrateRes.exitCode).toBe(1);
  });

  it("exports keypairs and imports them", async () => {
    await runCLI("init");

    const exportRes = await runCLI("identity", "export", "testuser-local");
    expect(exportRes.exitCode).toBe(0);
    const b64 = exportRes.stdout.toString().trim();

    const tempConfigDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-config2-"));
    try {
      const importRes = await runCLI("identity", "import", b64, "-y", "--keystore", path.join(tempConfigDir2, "identity.json"));
      expect(importRes.exitCode).toBe(0);
      expect(importRes.stdout.toString()).toContain("Successfully imported keys");
    } finally {
      await fs.rm(tempConfigDir2, { recursive: true, force: true });
    }
  });

  it("exports decrypt-only key bundle and imports for decrypt", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "READ_ONLY_KEY", "read_secret");

    const exportRes = await runCLI("identity", "export", "testuser-local", "--decrypt-only");
    expect(exportRes.exitCode).toBe(0);
    const b64 = exportRes.stdout.toString().trim();

    const tempConfigDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-config-ro-"));
    try {
      const importRes = await runCLI("identity", "import", b64, "-y", "--keystore", path.join(tempConfigDir2, "identity.json"));
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

    const exportRes = await runCLI("identity", "export", "testuser-local", "--decrypt-only");
    const b64 = exportRes.stdout.toString().trim();

    // Fresh keystore with no prior publicKey
    const fresh = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-fresh-"));
    try {
      const importRes = await runCLI("identity", "import", b64, "-y", "--keystore", path.join(fresh, "identity.json"));
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

    const exportRes = await runCLI("use");
    expect(exportRes.exitCode).toBe(0);
    expect(exportRes.stdout.toString()).toContain('export SAFE_KEY=$\'quo\\\'te $(uname) `id` "x"\'');

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

    const res = await runCLI("identity", "import", badBundle, "-y");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("not a valid PEM");
  });

  it("prompts before overwriting an existing identity on import", async () => {
    await runCLI("init");
    const exportRes = await runCLI("identity", "export", "testuser-local");
    const b64 = exportRes.stdout.toString().trim();

    const res = await runCLINoStdin("identity", "import", b64);

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

  it("output: -V prints version string with CLI name and GitHub link", async () => {
    const res = await runCLI("-V");
    expect(res.exitCode).toBe(0);
    const out = res.stdout.toString().trim();
    expect(out).toContain("Secure ENV (senv)");
    expect(out).toContain(VERSION);
    expect(out).toContain(GITHUB_URL);
  });

  it("update: reports up to date when latest matches VERSION", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ tag_name: `v${VERSION}` }), { status: 200 });
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      await runUpdate();
      expect(logs.join("\n")).toContain("already up to date");
    } finally {
      globalThis.fetch = origFetch;
      console.log = origLog;
    }
  });

  it("handles merge between two files", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "KEY_A", "VAL_A");

    const fileA = path.join(tempProjectDir, ".senv.json");
    const fileB = path.join(tempProjectDir, ".senv.b.json");
    await fs.copyFile(fileA, fileB);

    await runCLI("key", "rm", "testuser-local", "KEY_A");
    await runCLI("key", "add", "testuser-local", "KEY_B", "VAL_B");

    const mergeRes = await runCLI("merge", fileA, fileB);
    expect(mergeRes.exitCode).toBe(0);

    const getB = await runCLI("key", "get", "KEY_B");
    expect(getB.exitCode).toBe(0);
    expect(getB.stdout.toString().trim()).toBe("VAL_B");

    const getA = await runCLI("key", "get", "KEY_A");
    expect(getA.exitCode).toBe(0);
    expect(getA.stdout.toString().trim()).toBe("VAL_A");
  });

  it("resolves conflict markers via senv merge with no args", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "KEY_THEIRS", "val_theirs");

    const configPath = path.join(tempProjectDir, ".senv.json");
    const baseConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    const theirsBlob = baseConfig.identities["testuser-local"];

    await runCLI("key", "add", "testuser-local", "KEY_OURS", "val_ours");
    const headConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    const oursBlob = headConfig.identities["testuser-local"];

    const conflicted = `{
  "version": "1.0",
  "identities": {
<<<<<<< HEAD
    "testuser-local": "${oursBlob}"
=======
    "testuser-local": "${theirsBlob}"
>>>>>>> branch
  }
}`;
    await fs.writeFile(configPath, conflicted);

    const mergeRes = await runCLI("merge");
    expect(mergeRes.exitCode).toBe(0);

    const resolved = await fs.readFile(configPath, "utf-8");
    expect(resolved).not.toContain("<<<<<<<");

    const getOurs = await runCLI("key", "get", "KEY_OURS");
    expect(getOurs.stdout.toString().trim()).toBe("val_ours");

    const getTheirs = await runCLI("key", "get", "KEY_THEIRS");
    expect(getTheirs.stdout.toString().trim()).toBe("val_theirs");
  });

  it("resolves conflict markers from git root via senv merge", async () => {
    const emptyTemplate = path.join(import.meta.dir, "fixtures", "empty-git-template");
    const gitInit = await $`git init -b main --template=${emptyTemplate}`
      .cwd(tempProjectDir)
      .nothrow()
      .quiet();
    if (gitInit.exitCode !== 0) {
      return;
    }

    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "KEY_THEIRS", "val_theirs");

    const configPath = path.join(tempProjectDir, ".senv.json");
    const baseConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    const theirsBlob = baseConfig.identities["testuser-local"];

    await runCLI("key", "add", "testuser-local", "KEY_OURS", "val_ours");
    const headConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    const oursBlob = headConfig.identities["testuser-local"];

    const conflicted = `{
  "version": "1.0",
  "identities": {
<<<<<<< HEAD
    "testuser-local": "${oursBlob}"
=======
    "testuser-local": "${theirsBlob}"
>>>>>>> branch
  }
}`;
    await fs.writeFile(configPath, conflicted);

    const mergeRes = await runCLI("merge");
    expect(mergeRes.exitCode).toBe(0);
    expect((await fs.readFile(configPath, "utf-8"))).not.toContain("<<<<<<<");
  });

  it("resolves two-user shared identity merge conflict", async () => {
    const keystoreA = path.join(tempProjectDir, "user-A.json");
    const keystoreB = path.join(tempProjectDir, "user-B.json");
    const configPath = path.join(tempProjectDir, ".senv.json");
    const sharedId = "team-shared";

    await runCLIWithKeystore("user-A", keystoreA, "init");
    await runCLIWithKeystore("user-A", keystoreA, "key", "add", "user-A-local", "USER_A_SECRET", "alpha");
    await runCLIWithKeystore("user-A", keystoreA, "identity", "add", sharedId);
    await runCLIWithKeystore("user-A", keystoreA, "key", "add", sharedId, "SHARED_BASE", "shared-initial");
    await runCLIWithKeystore("user-A", keystoreA, "key", "add", sharedId, "API_URL", "shared-url-v0");

    await runCLIWithKeystore("user-B", keystoreB, "identity", "add", "user-B-local");
    await runCLIWithKeystore("user-B", keystoreB, "key", "add", "user-B-local", "USER_B_SECRET", "bravo");

    const exportRes = await runCLIWithKeystore("user-A", keystoreA, "identity", "export", sharedId);
    const b64 = exportRes.stdout.toString().trim();
    await runCLIWithKeystore("user-B", keystoreB, "identity", "import", b64, "-y");

    const baselineContent = await fs.readFile(configPath, "utf-8");

    await runCLIWithKeystore("user-B", keystoreB, "key", "add", "user-B-local", "USER_B_BRANCH", "from-B");
    await runCLIWithKeystore("user-B", keystoreB, "key", "add", sharedId, "API_URL", "url-from-B-branch");
    const headConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));

    await fs.writeFile(configPath, baselineContent);
    await runCLIWithKeystore("user-A", keystoreA, "key", "add", "user-A-local", "USER_A_BRANCH", "from-A");
    await runCLIWithKeystore("user-A", keystoreA, "key", "add", sharedId, "API_URL", "url-from-A-branch");
    const theirConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));

    const conflicted = `{
  "version": "1.0",
  "identities": {
<<<<<<< HEAD
    "user-A-local": "${headConfig.identities["user-A-local"]}",
    "${sharedId}": "${headConfig.identities[sharedId]}",
    "user-B-local": "${headConfig.identities["user-B-local"]}"
=======
    "user-A-local": "${theirConfig.identities["user-A-local"]}",
    "${sharedId}": "${theirConfig.identities[sharedId]}",
    "user-B-local": "${theirConfig.identities["user-B-local"]}"
>>>>>>> user-A
  }
}`;
    await fs.writeFile(configPath, conflicted);

    const mergeRes = await runCLIWithKeystore("user-B", keystoreB, "merge");
    expect(mergeRes.exitCode).toBe(0);
    expect((await fs.readFile(configPath, "utf-8"))).not.toContain("<<<<<<<");

    const aSecret = await runCLIWithKeystore("user-A", keystoreA, "key", "get", "USER_A_SECRET");
    expect(aSecret.stdout.toString().trim()).toBe("alpha");

    const aBranch = await runCLIWithKeystore("user-A", keystoreA, "key", "get", "USER_A_BRANCH");
    expect(aBranch.stdout.toString().trim()).toBe("from-A");

    const aShared = await runCLIWithKeystore("user-A", keystoreA, "key", "get", "SHARED_BASE");
    expect(aShared.stdout.toString().trim()).toBe("shared-initial");

    const aUrl = await runCLIWithKeystore("user-A", keystoreA, "key", "get", "API_URL");
    expect(aUrl.stdout.toString().trim()).toBe("url-from-A-branch");

    const bSecret = await runCLIWithKeystore("user-B", keystoreB, "key", "get", "USER_B_SECRET");
    expect(bSecret.stdout.toString().trim()).toBe("bravo");

    const bBranch = await runCLIWithKeystore("user-B", keystoreB, "key", "get", "USER_B_BRANCH");
    expect(bBranch.stdout.toString().trim()).toBe("from-B");

    const bShared = await runCLIWithKeystore("user-B", keystoreB, "key", "get", "SHARED_BASE");
    expect(bShared.stdout.toString().trim()).toBe("shared-initial");

    const bUrl = await runCLIWithKeystore("user-B", keystoreB, "key", "get", "API_URL");
    expect(bUrl.stdout.toString().trim()).toBe("url-from-A-branch");

    const crossAB = await runCLIWithKeystore("user-A", keystoreA, "key", "get", "USER_B_SECRET");
    expect(crossAB.exitCode).toBe(1);

    const crossBA = await runCLIWithKeystore("user-B", keystoreB, "key", "get", "USER_A_SECRET");
    expect(crossBA.exitCode).toBe(1);
  }, 30000);

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

  it("use safely handles multiline secret values", async () => {
    await runCLI("init");
    const multiline = "line1\nline2\nquo'te";
    await runCLI("key", "add", "testuser-local", "MULTI_KEY", multiline);

    const useRes = await runCLI("use");
    expect(useRes.exitCode).toBe(0);
    expect(useRes.stdout.toString()).toBe("export MULTI_KEY=$'line1\\nline2\\nquo\\'te'\n");

    const evalRes = await $`bash -c ${`eval $(bun run ./src/index.ts use); printf %s "$MULTI_KEY"`}`
      .env({
        ...process.env,
        SENV_CONFIG_DIR: tempConfigDir,
        SENV_PROJECT_DIR: tempProjectDir,
        USER: "testuser",
      })
      .nothrow()
      .quiet();

    expect(evalRes.exitCode).toBe(0);
    expect(evalRes.stdout.toString()).toBe(multiline);
  });

  it("identity rm -y removes identity from both keystore and config", async () => {
    await runCLI("init");
    await runCLI("identity", "add", "victim");
    const configPath = path.join(tempProjectDir, ".senv.json");
    const keystorePath = path.join(tempConfigDir, "identity.json");

    const configBefore = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(configBefore.identities["victim"]).toBeDefined();
    const ksBefore = JSON.parse(await fs.readFile(keystorePath, "utf-8"));
    const projectKey = Object.keys(ksBefore.projects)[0]!;
    expect(ksBefore.projects[projectKey]["victim"]).toBeDefined();

    const rmRes = await runCLI("identity", "rm", "victim", "-y");
    expect(rmRes.exitCode).toBe(0);

    const configAfter = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(configAfter.identities["victim"]).toBeUndefined();
    const ksAfter = JSON.parse(await fs.readFile(keystorePath, "utf-8"));
    expect(ksAfter.projects[projectKey]["victim"]).toBeUndefined();
  });

  it("identity rm without -y aborts on non-TTY stdin", async () => {
    await runCLI("init");
    await runCLI("identity", "add", "victim");

    const res = await runCLINoStdin("identity", "rm", "victim");

    expect(res.exitCode).toBe(0);
    const combined = res.stdout.toString() + res.stderr.toString();
    expect(combined).toContain("Aborted");

    const configPath = path.join(tempProjectDir, ".senv.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(config.identities["victim"]).toBeDefined();
  });

  it("identity rm of non-existent identity exits 1", async () => {
    await runCLI("init");
    const res = await runCLI("identity", "rm", "ghost", "-y");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("not found");
  });

  it("init re-init reports missing keys when keystore is incomplete", async () => {
    await runCLI("init");
    await runCLI("identity", "add", "external");

    const fresh = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-freshks-"));
    try {
      const reinit = await $`bun run ./src/index.ts init --keystore ${path.join(fresh, "identity.json")}`
        .env({ ...process.env, SENV_PROJECT_DIR: tempProjectDir, USER: "testuser" })
        .nothrow().quiet();
      expect(reinit.exitCode).toBe(0);
      const combined = reinit.stdout.toString() + reinit.stderr.toString();
      expect(combined).toContain("missing from your local keystore");
      expect(combined).toContain("external");
    } finally {
      await fs.rm(fresh, { recursive: true, force: true });
    }
  });

  it("key get --identity disambiguates between conflicting identities", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "AMBIG", "from-local");
    await runCLI("identity", "add", "alt");
    await runCLI("key", "add", "alt", "AMBIG", "from-alt");

    const defaultRes = await runCLI("key", "get", "AMBIG");
    expect(defaultRes.exitCode).toBe(0);
    expect(defaultRes.stdout.toString().trim()).toBe("from-local");
    expect(defaultRes.stderr.toString()).toContain("alt");

    const pickedRes = await runCLI("key", "get", "AMBIG", "-i", "alt");
    expect(pickedRes.exitCode).toBe(0);
    expect(pickedRes.stdout.toString().trim()).toBe("from-alt");
    expect(pickedRes.stderr.toString()).not.toContain("Conflict");

    const badRes = await runCLI("key", "get", "AMBIG", "-i", "ghost");
    expect(badRes.exitCode).toBe(1);
    expect(badRes.stderr.toString()).toContain("ghost");
  });

  it("key list --identity restricts output and skips conflict warning", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "SHARED", "alpha");
    await runCLI("key", "add", "testuser-local", "ONLY_LOCAL", "lo");
    await runCLI("identity", "add", "alt");
    await runCLI("key", "add", "alt", "SHARED", "beta");

    const fullRes = await runCLI("key", "list");
    expect(fullRes.stderr.toString()).toContain("Conflict");

    const restrictedRes = await runCLI("key", "list", "-i", "alt");
    expect(restrictedRes.exitCode).toBe(0);
    expect(restrictedRes.stderr.toString()).not.toContain("Conflict");
    expect(restrictedRes.stdout.toString()).toContain("SHARED");
    expect(restrictedRes.stdout.toString()).not.toContain("ONLY_LOCAL");
  });

  it("key list --identity without -e lists keys from all environments", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "DEV_ONLY", "dev-val");
    await runCLI("key", "add", "testuser-local", "PROD_ONLY", "prod-val", "-e", "prod");
    await runCLI("key", "add", "testuser-local", "BOTH", "dev");
    await runCLI("key", "add", "testuser-local", "BOTH", "prod", "-e", "prod");

    const allRes = await runCLI("key", "list", "-i", "testuser-local");
    expect(allRes.exitCode).toBe(0);
    const out = allRes.stdout.toString();
    expect(out).toContain("Keys for environment 'dev' [testuser-local]:");
    expect(out).toContain("Keys for environment 'prod' [testuser-local]:");
    expect(out).toContain("DEV_ONLY = ***");
    expect(out).toContain("PROD_ONLY = ***");
    expect(out).toMatch(/Keys for environment 'dev' \[testuser-local\]:\n.*BOTH = \*\*\*/s);
    expect(out).toMatch(/Keys for environment 'prod' \[testuser-local\]:\n.*BOTH = \*\*\*/s);

    const devOnlyRes = await runCLI("key", "list", "-i", "testuser-local", "-e", "dev");
    expect(devOnlyRes.exitCode).toBe(0);
    const devOut = devOnlyRes.stdout.toString();
    expect(devOut).toContain("Keys for environment 'dev'");
    expect(devOut).toContain("DEV_ONLY");
    expect(devOut).toContain("BOTH");
    expect(devOut).not.toContain("PROD_ONLY");
  });

  it("importing bundle with no publicKey and no existing publicKey errors", async () => {
    await runCLI("init");
    const bundle = Buffer.from(
      JSON.stringify({ idName: "blank", publicKey: "", privateKey: "" }),
      "utf8"
    ).toString("base64");

    const res = await runCLI("identity", "import", bundle, "-y");
    expect(res.exitCode).toBe(1);
    const stderr = res.stderr.toString();
    expect(stderr.includes("Invalid keypair string") || stderr.includes("no public or private key")).toBe(true);
  });

  it("key add -> rm -> add round-trips correctly", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "CYCLE", "v1");
    const rmRes = await runCLI("key", "rm", "testuser-local", "CYCLE");
    expect(rmRes.exitCode).toBe(0);
    const after = await runCLI("key", "get", "CYCLE");
    expect(after.exitCode).toBe(1);
    const re = await runCLI("key", "add", "testuser-local", "CYCLE", "v2");
    expect(re.exitCode).toBe(0);
    const get = await runCLI("key", "get", "CYCLE");
    expect(get.stdout.toString().trim()).toBe("v2");
  });

  it("use with no keys for env produces empty stdout and exit 0", async () => {
    await runCLI("init");
    const res = await runCLI("use", "-e", "ghost-env");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toBe("");
  });

  it("use handles purely numeric value", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "NUM", "12345");
    const res = await runCLI("use");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toContain("export NUM=$'12345'");

    const evalRes = await $`bash -c ${`eval $(bun run ./src/index.ts use); printf %s "$NUM"`}`
      .env({
        ...process.env,
        SENV_CONFIG_DIR: tempConfigDir,
        SENV_PROJECT_DIR: tempProjectDir,
        USER: "testuser",
      })
      .nothrow()
      .quiet();
    expect(evalRes.exitCode).toBe(0);
    expect(evalRes.stdout.toString()).toBe("12345");
  });

  it("key add with --env nonexistent then get with that env works", async () => {
    await runCLI("init");
    const add = await runCLI("key", "add", "testuser-local", "EXOTIC", "v", "-e", "staging-eu");
    expect(add.exitCode).toBe(0);
    const get = await runCLI("key", "get", "EXOTIC", "-e", "staging-eu");
    expect(get.exitCode).toBe(0);
    expect(get.stdout.toString().trim()).toBe("v");
  });

  it("installs the agent skill into .agents/skills/secure-env-tool/SKILL.md", async () => {
    const res = await runCLI("install", "skill");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toContain("Installed skill to");

    const dest = path.join(tempProjectDir, ".agents", "skills", "secure-env-tool", "SKILL.md");
    expect(await fs.exists(dest)).toBe(true);

    const installed = await fs.readFile(dest, "utf-8");
    const source = await fs.readFile(path.join(import.meta.dir, "..", "skill", "SKILL.md"), "utf-8");
    expect(installed).toBe(source);
    expect(installed).toContain("name: secure-env-tool");

    const res2 = await runCLI("install", "skill");
    expect(res2.exitCode).toBe(0);
  });

  it("key rm removes key from one env but not another", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "ENV_KEY", "dev_val");
    await runCLI("key", "add", "testuser-local", "ENV_KEY", "prod_val", "-e", "prod");

    await runCLI("key", "rm", "testuser-local", "ENV_KEY");

    const getDev = await runCLI("key", "get", "ENV_KEY");
    expect(getDev.exitCode).toBe(1);

    const getProd = await runCLI("key", "get", "ENV_KEY", "-e", "prod");
    expect(getProd.exitCode).toBe(0);
    expect(getProd.stdout.toString().trim()).toBe("prod_val");
  });

  it("identity export fails for non-existent identity", async () => {
    await runCLI("init");
    const res = await runCLI("identity", "export", "ghost");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("not found");
  });

  it("identity import rejects bundle with invalid identity name", async () => {
    const bundle = Buffer.from(
      JSON.stringify({ idName: "bad name!", publicKey: "KEY", privateKey: "KEY" }),
      "utf8"
    ).toString("base64");

    const res = await runCLI("identity", "import", bundle, "-y");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("Invalid identity name");
  });

  it("identity add fails when identity already exists in config", async () => {
    await runCLI("init");
    const addRes = await runCLI("identity", "add", "testuser-local");
    expect(addRes.exitCode).toBe(1);
    expect(addRes.stderr.toString()).toContain("already exists");
  });

  it("key rm for identity missing public key errors on re-encrypt", async () => {
    await runCLI("init");
    await runCLI("identity", "add", "pkless");
    await runCLI("key", "add", "pkless", "TO_DEL", "v");

    const freshKs = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-pkless-"));
    try {
      const b64 = (await runCLI("identity", "export", "pkless", "--decrypt-only")).stdout.toString().trim();
      await runCLI("identity", "import", b64, "-y", "--keystore", path.join(freshKs, "identity.json"));
      const rmRes = await runCLI("key", "rm", "pkless", "TO_DEL", "--keystore", path.join(freshKs, "identity.json"));
      expect(rmRes.exitCode).toBe(1);
    } finally {
      await fs.rm(freshKs, { recursive: true, force: true });
    }
  });

  it("init defaults to 'user' identity when USER and USERNAME are unset", async () => {
    const stripped = { ...process.env };
    delete stripped.USER;
    delete stripped.USERNAME;
    const initRes = await $`bun run ./src/index.ts init`
      .env({
        ...stripped,
        SENV_CONFIG_DIR: tempConfigDir,
        SENV_PROJECT_DIR: tempProjectDir,
      })
      .nothrow()
      .quiet();
    expect(initRes.exitCode).toBe(0);
    const out = initRes.stdout.toString();
    expect(out).toContain("user-local");
  });

  it("init accepts a custom identity name", async () => {
    const { exitCode, stdout } = await runCLI("init", "my-custom-id");
    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("Identity 'my-custom-id' added.");

    const config = JSON.parse(await fs.readFile(path.join(tempProjectDir, ".senv.json"), "utf-8"));
    expect(Object.keys(config.identities)).toEqual(["my-custom-id"]);
  });

  it("init rejects an invalid custom identity name", async () => {
    const res = await runCLI("init", "bad id!");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("Invalid identity name");
  });

  it("identity add creates .senv.json when missing", async () => {
    const addRes = await runCLI("identity", "add", "standalone-id");
    expect(addRes.exitCode).toBe(0);
    expect(addRes.stdout.toString()).toContain("Successfully added identity 'standalone-id'.");

    const configPath = path.join(tempProjectDir, ".senv.json");
    expect(await fs.exists(configPath)).toBe(true);
    const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(Object.keys(config.identities)).toEqual(["standalone-id"]);
  });

  it("migrate skips oversized value exceeding 16KB", async () => {
    await runCLI("init");
    const huge = "x".repeat(17 * 1024);
    const envPath = path.join(tempProjectDir, ".env");
    await fs.writeFile(envPath, `SMALL=1\nHUGE=${huge}\n`);

    const migrateRes = await runCLI("migrate", "testuser-local", envPath);
    expect(migrateRes.exitCode).toBe(0);
    expect(migrateRes.stderr.toString()).toContain("16");
    expect(migrateRes.stdout.toString()).toContain("- SMALL");
  });

  it("key rm for missing identity returns specific error", async () => {
    await runCLI("init");
    const res = await runCLI("key", "rm", "ghost-id", "KEY");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("missing from .senv.json");
  });

  it("use warns on stderr when keys conflict across identities", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "AMBIG", "v1");
    await runCLI("identity", "add", "other");
    await runCLI("key", "add", "other", "AMBIG", "v2");

    const res = await runCLI("use");
    expect(res.exitCode).toBe(0);
    expect(res.stderr.toString()).toContain("[WARN] Conflict for key 'AMBIG'");
    expect(res.stderr.toString()).toContain("other");
    expect(res.stdout.toString()).toContain("AMBIG");
  });

  it("merge with no args and no conflict markers errors", async () => {
    await runCLI("init");

    const res = await runCLI("merge");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("no git conflict markers");
  });

  it("merge with missing FILE_B errors", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "K", "V");

    const res = await runCLI("merge", path.join(tempProjectDir, ".senv.json"), "nonexistent.json");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("file not found");
  });

  it("merge resolves conflict block with multiple identities", async () => {
    await runCLI("init");
    await runCLI("identity", "add", "other");
    await runCLI("key", "add", "testuser-local", "LOCAL_KEY", "lv");
    await runCLI("key", "add", "other", "OTHER_KEY", "ov");

    const configPath = path.join(tempProjectDir, ".senv.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    const localBlob = config.identities["testuser-local"];
    const otherBlob = config.identities["other"];

    const conflicted = `{
  "version": "1.0",
  "identities": {
<<<<<<< HEAD
    "testuser-local": "${localBlob}",
    "other": "${otherBlob}"
=======
    "testuser-local": "${localBlob}",
    "other": "${otherBlob}"
>>>>>>> branch
  }
}`;
    await fs.writeFile(configPath, conflicted);

    const mergeRes = await runCLI("merge");
    expect(mergeRes.exitCode).toBe(0);
    expect((await fs.readFile(configPath, "utf-8"))).not.toContain("<<<<<<<");

    const getLocal = await runCLI("key", "get", "LOCAL_KEY");
    expect(getLocal.stdout.toString().trim()).toBe("lv");

    const getOther = await runCLI("key", "get", "OTHER_KEY");
    expect(getOther.stdout.toString().trim()).toBe("ov");
  });

  it("merge with custom --keystore flag", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "K", "V");

    const customKs = path.join(tempConfigDir, "custom-merge.json");
    const exportRes = await runCLI("identity", "export", "testuser-local");
    const b64 = exportRes.stdout.toString().trim();
    await runCLI("identity", "import", b64, "-y", "--keystore", customKs);

    const configPath = path.join(tempProjectDir, ".senv.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    const blob = config.identities["testuser-local"];

    const conflicted = `{
  "version": "1.0",
  "identities": {
<<<<<<< HEAD
    "testuser-local": "${blob}"
=======
    "testuser-local": "${blob}"
>>>>>>> branch
  }
}`;
    await fs.writeFile(configPath, conflicted);

    const mergeRes = await $`bun run ./src/index.ts merge --keystore ${customKs}`
      .env({
        ...process.env,
        SENV_CONFIG_DIR: tempConfigDir,
        SENV_PROJECT_DIR: tempProjectDir,
        USER: "testuser",
      })
      .nothrow()
      .quiet();
    expect(mergeRes.exitCode).toBe(0);
  });

  it("preset add creates and extends presets incrementally", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "API_KEY", "secret");
    await runCLI("key", "add", "testuser-local", "DB_URL", "postgres://localhost");

    const addRes = await runCLI("preset", "add", "backend", "API_KEY", "DB_URL");
    expect(addRes.exitCode).toBe(0);
    expect(addRes.stdout.toString()).toContain("Added 2 key(s)");

    const config = JSON.parse(await fs.readFile(path.join(tempProjectDir, ".senv.json"), "utf-8"));
    expect(config.presets.backend).toEqual(["API_KEY", "DB_URL"]);

    const extendRes = await runCLI("preset", "add", "backend", "DB_URL", "REDIS_URL");
    expect(extendRes.exitCode).toBe(0);
    expect(extendRes.stdout.toString()).toContain("REDIS_URL");

    const config2 = JSON.parse(await fs.readFile(path.join(tempProjectDir, ".senv.json"), "utf-8"));
    expect(config2.presets.backend).toEqual(["API_KEY", "DB_URL", "REDIS_URL"]);
  });

  it("preset add rejects invalid preset and key names", async () => {
    await runCLI("init");

    const badPreset = await runCLI("preset", "add", "bad name", "API_KEY");
    expect(badPreset.exitCode).toBe(1);
    expect(badPreset.stderr.toString()).toContain("Invalid preset name");

    const badKey = await runCLI("preset", "add", "backend", "bad-key");
    expect(badKey.exitCode).toBe(1);
    expect(badKey.stderr.toString()).toContain("Invalid environment variable name");

    const noKeys = await runCLI("preset", "add", "backend");
    expect(noKeys.exitCode).toBe(1);
    expect(noKeys.stderr.toString()).toContain("At least one key");
  });

  it("preset rm deletes entire preset or specific keys", async () => {
    await runCLI("init");
    await runCLI("preset", "add", "backend", "API_KEY", "DB_URL", "REDIS_URL");

    const rmKeyRes = await runCLI("preset", "rm", "backend", "DB_URL");
    expect(rmKeyRes.exitCode).toBe(0);

    const config = JSON.parse(await fs.readFile(path.join(tempProjectDir, ".senv.json"), "utf-8"));
    expect(config.presets.backend).toEqual(["API_KEY", "REDIS_URL"]);

    const rmAllRes = await runCLI("preset", "rm", "backend");
    expect(rmAllRes.exitCode).toBe(0);

    const config2 = JSON.parse(await fs.readFile(path.join(tempProjectDir, ".senv.json"), "utf-8"));
    expect(config2.presets).toBeUndefined();
  });

  it("preset rm errors when preset not found", async () => {
    await runCLI("init");
    const res = await runCLI("preset", "rm", "ghost");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("not found");
  });

  it("use with preset exports only preset keys", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "API_KEY", "secret");
    await runCLI("key", "add", "testuser-local", "DB_URL", "postgres");
    await runCLI("key", "add", "testuser-local", "EXTRA", "ignored");
    await runCLI("preset", "add", "backend", "API_KEY", "DB_URL");

    const useAll = await runCLI("use");
    expect(useAll.stdout.toString()).toContain("EXTRA");

    const usePreset = await runCLI("use", "backend");
    expect(usePreset.exitCode).toBe(0);
    const out = usePreset.stdout.toString();
    expect(out).toContain("export API_KEY=");
    expect(out).toContain("export DB_URL=");
    expect(out).not.toContain("EXTRA");
  });

  it("use with preset warns on missing keys but exports available ones", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "API_KEY", "secret");
    await runCLI("preset", "add", "backend", "API_KEY", "MISSING_KEY");

    const res = await runCLI("use", "backend");
    expect(res.exitCode).toBe(0);
    expect(res.stderr.toString()).toContain("[WARN] Preset 'backend': key 'MISSING_KEY'");
    expect(res.stdout.toString()).toContain("export API_KEY=");
    expect(res.stdout.toString()).not.toContain("MISSING_KEY");
  });

  it("use with unknown preset exits 1", async () => {
    await runCLI("init");
    const res = await runCLI("use", "ghost");
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toString()).toContain("not found");
  });

  it("preset check warns for missing keys across all presets", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "API_KEY", "secret");
    await runCLI("preset", "add", "backend", "API_KEY", "MISSING_A");
    await runCLI("preset", "add", "frontend", "MISSING_B");

    const res = await runCLI("preset", "check");
    expect(res.exitCode).toBe(0);
    const stderr = res.stderr.toString();
    expect(stderr).toContain("MISSING_A");
    expect(stderr).toContain("MISSING_B");
    expect(stderr).not.toContain("API_KEY");
  });

  it("merge unions presets from two config files", async () => {
    await runCLI("init");
    await runCLI("preset", "add", "backend", "API_KEY", "DB_URL");

    const configPath = path.join(tempProjectDir, ".senv.json");
    const configA = JSON.parse(await fs.readFile(configPath, "utf-8"));

    const configB = {
      version: "1.0",
      identities: {},
      presets: {
        backend: ["DB_URL", "REDIS_URL"],
        frontend: ["PUBLIC_URL"],
      },
    };
    const fileB = path.join(tempProjectDir, "other.senv.json");
    await fs.writeFile(fileB, JSON.stringify(configB, null, 2));

    const mergeRes = await runCLI("merge", configPath, fileB);
    expect(mergeRes.exitCode).toBe(0);

    const merged = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(merged.presets.backend).toEqual(["API_KEY", "DB_URL", "REDIS_URL"]);
    expect(merged.presets.frontend).toEqual(["PUBLIC_URL"]);
    expect(merged.identities).toEqual(configA.identities);
  });

  it("merge preserves presets from conflicted file prefix", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "KEY_OURS", "val_ours");

    const configPath = path.join(tempProjectDir, ".senv.json");
    const headConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    const oursBlob = headConfig.identities["testuser-local"];

    const conflicted = `{
  "version": "1.0",
  "presets": {
    "backend": ["API_KEY", "DB_URL"]
  },
  "identities": {
<<<<<<< HEAD
    "testuser-local": "${oursBlob}"
=======
    "testuser-local": "${oursBlob}"
>>>>>>> branch
  }
}`;
    await fs.writeFile(configPath, conflicted);

    const mergeRes = await runCLI("merge");
    expect(mergeRes.exitCode).toBe(0);

    const merged = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(merged.presets.backend).toEqual(["API_KEY", "DB_URL"]);
    expect(merged.identities["testuser-local"]).toBeTruthy();
  });

  it("merge preserves presets when they are the last field (no trailing comma)", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "KEY_OURS", "val_ours");

    const configPath = path.join(tempProjectDir, ".senv.json");
    const headConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    const oursBlob = headConfig.identities["testuser-local"];

    const conflicted = `{
  "version": "1.0",
  "presets": {
    "backend": ["API_KEY", "DB_URL"]
  },
  "identities": {
<<<<<<< HEAD
    "testuser-local": "${oursBlob}"
=======
    "testuser-local": "${oursBlob}"
>>>>>>> branch
  }
}`;
    await fs.writeFile(configPath, conflicted);

    const mergeRes = await runCLI("merge");
    expect(mergeRes.exitCode).toBe(0);

    const merged = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(merged.presets.backend).toEqual(["API_KEY", "DB_URL"]);
  });

  it("preset list shows all defined presets", async () => {
    await runCLI("init");
    await runCLI("preset", "add", "backend", "API_KEY", "DB_URL");
    await runCLI("preset", "add", "frontend", "PUBLIC_URL");

    const res = await runCLI("preset", "list");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toContain("backend: API_KEY, DB_URL");
    expect(res.stdout.toString()).toContain("frontend: PUBLIC_URL");
  });

  it("preset list shows message when no presets defined", async () => {
    await runCLI("init");
    const res = await runCLI("preset", "list");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toContain("No presets defined");
  });

  it("preset check --strict exits 1 on missing keys", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "API_KEY", "secret");
    await runCLI("preset", "add", "backend", "API_KEY", "MISSING_KEY");

    const looseRes = await runCLI("preset", "check");
    expect(looseRes.exitCode).toBe(0);
    expect(looseRes.stderr.toString()).toContain("MISSING_KEY");

    const strictRes = await runCLI("preset", "check", "--strict");
    expect(strictRes.exitCode).toBe(1);
    expect(strictRes.stderr.toString()).toContain("MISSING_KEY");
  });
});
