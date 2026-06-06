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
        USER: "testuser"
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
    const configPath = path.join(tempProjectDir, ".senv.jsonc");
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
    expect(listRes.stdout.toString()).toContain("API_KEY=se***23");
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
    expect(getRes.exitCode).toBe(1); // Fails
  });

  it("exports keypairs and imports them", async () => {
    await runCLI("init");
    
    const exportRes = await runCLI("key", "export", "testuser-local");
    expect(exportRes.exitCode).toBe(0);
    const b64 = exportRes.stdout.toString().trim();

    // Now let's try to import it into a fresh keystore
    const tempConfigDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-config2-"));
    const importRes = await $`bun run ./src/index.ts key import ${b64}`
      .env({
        ...process.env,
        SENV_CONFIG_DIR: tempConfigDir2,
      })
      .nothrow()
      .quiet();

    expect(importRes.exitCode).toBe(0);
    expect(importRes.stdout.toString()).toContain("Successfully imported keys");

    await fs.rm(tempConfigDir2, { recursive: true, force: true });
  });

  it("handles migration between two files", async () => {
    await runCLI("init");
    await runCLI("key", "add", "testuser-local", "KEY_A", "VAL_A");

    // Copy to file B
    const fileA = path.join(tempProjectDir, ".senv.jsonc");
    const fileB = path.join(tempProjectDir, ".senv.b.jsonc");
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
    
    // Init with custom keystore
    const initRes = await $`bun run ./src/index.ts init --keystore ${customKeystore}`
      .env({ ...process.env, SENV_PROJECT_DIR: tempProjectDir, USER: "testuser" })
      .nothrow().quiet();
    expect(initRes.exitCode).toBe(0);

    // Verify the custom keystore exists and the default one DOES NOT
    expect(await fs.exists(customKeystore)).toBe(true);
    expect(await fs.exists(path.join(tempConfigDir, "identity.json"))).toBe(false);

    // Add a key
    await $`bun run ./src/index.ts key add testuser-local CUSTOM_FLAG "WORKS" --keystore ${customKeystore}`
      .env({ ...process.env, SENV_PROJECT_DIR: tempProjectDir, USER: "testuser" })
      .nothrow().quiet();
      
    // Retrieve the key with custom keystore
    const getRes = await $`bun run ./src/index.ts key get CUSTOM_FLAG --keystore ${customKeystore}`
      .env({ ...process.env, SENV_PROJECT_DIR: tempProjectDir, USER: "testuser" })
      .nothrow().quiet();
    
    expect(getRes.exitCode).toBe(0);
    expect(getRes.stdout.toString().trim()).toBe("WORKS");

    // Clean up
    await fs.rm(customKeystore, { force: true });
  });
});
