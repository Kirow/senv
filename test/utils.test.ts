import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { Command } from "commander";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as senvCrypto from "../src/core/crypto";
import * as store from "../src/core/store";
import {
  assertKeyNotInEncrypted,
  assertKeyNotInPublic,
  getAccessibleKeyMap,
  getAccessiblePayloads,
  getCommandOptions,
  getPublicListEntries,
  isValidPresetName,
  requirePublicKeyForEncrypt,
  warnMissingPresetKeys,
} from "../src/commands/utils";

describe("command utils", () => {
  let tempConfigDir: string;
  let tempProjectDir: string;

  beforeEach(async () => {
    tempConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "senv-utils-config-"));
    tempProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "senv-utils-proj-"));
    process.env.SENV_CONFIG_DIR = tempConfigDir;
    process.env.SENV_PROJECT_DIR = tempProjectDir;
  });

  afterEach(async () => {
    await fs.rm(tempConfigDir, { recursive: true, force: true });
    await fs.rm(tempProjectDir, { recursive: true, force: true });
    delete process.env.SENV_CONFIG_DIR;
    delete process.env.SENV_PROJECT_DIR;
  });

  it("isValidPresetName mirrors identity name rules", () => {
    expect(isValidPresetName("backend")).toBe(true);
    expect(isValidPresetName("public")).toBe(false);
  });

  it("assertKeyNotInPublic throws when key exists in public section", () => {
    const config: store.SenvProjectConfig = {
      version: "1.1",
      identities: {},
      public: [{ key: "MODE", value: "dev", environment: "dev" }],
    };
    expect(() => assertKeyNotInPublic(config, "dev", "MODE")).toThrow(/already exists as a public value/);
  });

  it("assertKeyNotInEncrypted throws when key exists in decryptable identity", async () => {
    const { publicKey, privateKey } = senvCrypto.generateRSAKeyPair();
    const blob = senvCrypto.encryptPayload(
      [{ key: "SECRET", value: "v", environment: "dev" }],
      publicKey
    );
    const config: store.SenvProjectConfig = {
      version: "1.1",
      identities: { "alice-local": blob },
    };
    await store.writeKeystore({
      version: "1.0",
      projects: { [tempProjectDir]: { "alice-local": { publicKey, privateKey } } },
    });
    await expect(assertKeyNotInEncrypted(config, "dev", "SECRET")).rejects.toThrow(
      /already exists in encrypted identity/
    );
  });

  it("assertKeyNotInEncrypted swallows unrelated decrypt errors", async () => {
    const { publicKey, privateKey } = senvCrypto.generateRSAKeyPair();
    await store.writeKeystore({
      version: "1.0",
      projects: { [tempProjectDir]: { "alice-local": { publicKey, privateKey } } },
    });
    const config: store.SenvProjectConfig = {
      version: "1.1",
      identities: { "alice-local": "corrupt-ciphertext" },
    };
    await expect(assertKeyNotInEncrypted(config, "dev", "NEW_KEY")).resolves.toBeUndefined();
  });

  it("assertKeyNotInEncrypted ignores identities without a local private key", async () => {
    const config: store.SenvProjectConfig = {
      version: "1.1",
      identities: { "remote-only": "opaque-blob" },
    };
    await store.writeKeystore({ version: "1.0", projects: {} });
    await expect(assertKeyNotInEncrypted(config, "dev", "ANY_KEY")).resolves.toBeUndefined();
  });

  it("getAccessibleKeyMap prefers public values and aggregates identities", async () => {
    const { publicKey, privateKey } = senvCrypto.generateRSAKeyPair();
    const blob = senvCrypto.encryptPayload(
      [
        { key: "SHARED", value: "encrypted", environment: "dev" },
        { key: "ONLY_ENC", value: "secret", environment: "dev" },
      ],
      publicKey
    );
    await store.writeProjectConfig({
      version: "1.1",
      identities: { "alice-local": blob },
      public: [{ key: "SHARED", value: "public", environment: "dev" }],
    });
    await store.writeKeystore({
      version: "1.0",
      projects: { [tempProjectDir]: { "alice-local": { publicKey, privateKey } } },
    });

    const map = await getAccessibleKeyMap("dev");
    expect(map.get("SHARED")).toEqual({
      value: "public",
      identityName: store.PUBLIC_IDENTITY_LABEL,
      identities: [store.PUBLIC_IDENTITY_LABEL],
    });
    expect(map.get("ONLY_ENC")?.value).toBe("secret");
  });

  it("getAccessibleKeyMap tracks multiple identities for the same key", async () => {
    const { publicKey, privateKey } = senvCrypto.generateRSAKeyPair();
    const blobA = senvCrypto.encryptPayload(
      [{ key: "SHARED", value: "from-a", environment: "dev" }],
      publicKey
    );
    const blobB = senvCrypto.encryptPayload(
      [{ key: "SHARED", value: "from-b", environment: "dev" }],
      publicKey
    );
    await store.writeProjectConfig({
      version: "1.1",
      identities: { "alice-local": blobA, "bob-local": blobB },
    });
    await store.writeKeystore({
      version: "1.0",
      projects: {
        [tempProjectDir]: {
          "alice-local": { publicKey, privateKey },
          "bob-local": { publicKey, privateKey },
        },
      },
    });

    const entry = (await getAccessibleKeyMap("dev")).get("SHARED");
    expect(entry?.value).toBe("from-a");
    expect(entry?.identities.sort()).toEqual(["alice-local", "bob-local"]);
  });

  it("warnMissingPresetKeys logs warnings and returns missing count", () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      const missing = warnMissingPresetKeys(
        "backend",
        ["API_KEY", "MISSING"],
        new Map([["API_KEY", "x"]]),
        "dev"
      );
      expect(missing).toBe(1);
      expect(warnings.join("\n")).toContain("MISSING");
    } finally {
      console.warn = origWarn;
    }
  });

  it("requirePublicKeyForEncrypt exits when public key is missing", () => {
    const exitSpy = spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${code}`);
    });
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (msg: string) => errors.push(msg);
    try {
      expect(() => requirePublicKeyForEncrypt({}, "alice-local")).toThrow("exit:1");
      expect(errors.join("")).toContain("Cannot re-encrypt");
    } finally {
      console.error = origErr;
      exitSpy.mockRestore();
    }
  });

  it("requirePublicKeyForEncrypt returns a valid public key", () => {
    const { publicKey, privateKey } = senvCrypto.generateRSAKeyPair();
    expect(
      requirePublicKeyForEncrypt({ "alice-local": { publicKey, privateKey } }, "alice-local")
    ).toBe(publicKey);
  });

  it("getCommandOptions reads global env and keystore flags", () => {
    const program = new Command();
    program.option("-e, --env <name>", "environment", "dev");
    program.option("-k, --keystore <path>", "keystore path");
    const sub = program.command("key").command("add");
    program.parse(["node", "senv", "-e", "staging", "-k", "/tmp/ks.json", "key", "add"]);
    const opts = getCommandOptions(sub);
    expect(opts.env).toBe("staging");
    expect(opts.keystorePath).toBe("/tmp/ks.json");
    expect(opts.envExplicit).toBe(true);
  });

  it("getCommandOptions treats default env as not explicit", () => {
    const program = new Command();
    program.option("-e, --env <name>", "environment", "dev");
    const sub = program.command("key").command("list");
    program.parse(["node", "senv", "key", "list"]);
    const opts = getCommandOptions(sub);
    expect(opts.env).toBe("dev");
    expect(opts.envExplicit).toBe(false);
  });

  it("getAccessiblePayloads filters by environment by default", async () => {
    const { publicKey, privateKey } = senvCrypto.generateRSAKeyPair();
    const blob = senvCrypto.encryptPayload(
      [
        { key: "DEV_ONLY", value: "dev", environment: "dev" },
        { key: "PROD_ONLY", value: "prod", environment: "prod" },
      ],
      publicKey
    );
    await store.writeProjectConfig({ version: "1.1", identities: { "alice-local": blob } });
    await store.writeKeystore({
      version: "1.0",
      projects: { [tempProjectDir]: { "alice-local": { publicKey, privateKey } } },
    });

    const payloads = await getAccessiblePayloads("dev");
    expect(payloads).toEqual([
      { identityName: "alice-local", payload: [{ key: "DEV_ONLY", value: "dev", environment: "dev" }] },
    ]);
  });

  it("getAccessiblePayloads can return all environments and warn on decrypt failure", async () => {
    const { publicKey, privateKey } = senvCrypto.generateRSAKeyPair();
    const goodBlob = senvCrypto.encryptPayload(
      [{ key: "OK", value: "v", environment: "dev" }],
      publicKey
    );
    await store.writeProjectConfig({
      version: "1.1",
      identities: { "good": goodBlob, "bad": "not-valid-ciphertext" },
    });
    await store.writeKeystore({
      version: "1.0",
      projects: {
        [tempProjectDir]: {
          good: { publicKey, privateKey },
          bad: { publicKey, privateKey },
        },
      },
    });

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      const payloads = await getAccessiblePayloads("dev", undefined, false);
      expect(payloads).toHaveLength(1);
      expect(warnings.join("\n")).toContain("Failed to decrypt identity 'bad'");
    } finally {
      console.warn = origWarn;
    }
  });

  it("getPublicListEntries returns public items for one environment", async () => {
    await store.writeProjectConfig({
      version: "1.1",
      identities: {},
      public: [
        { key: "DEV_KEY", value: "dev", environment: "dev" },
        { key: "PROD_KEY", value: "prod", environment: "prod" },
      ],
    });

    const entries = await getPublicListEntries("dev");
    expect(entries).toEqual([
      {
        identityName: store.PUBLIC_IDENTITY_LABEL,
        payload: [{ key: "DEV_KEY", value: "dev", environment: "dev" }],
      },
    ]);
  });

  it("getPublicListEntries returns all public items when not filtering", async () => {
    await store.writeProjectConfig({
      version: "1.1",
      identities: {},
      public: [{ key: "ONLY", value: "v", environment: "dev" }],
    });

    const entries = await getPublicListEntries("prod", false);
    expect(entries[0]?.payload).toEqual([{ key: "ONLY", value: "v", environment: "dev" }]);
  });

  it("getPublicListEntries returns empty array when no public items match", async () => {
    await store.writeProjectConfig({ version: "1.1", identities: {} });
    expect(await getPublicListEntries("dev")).toEqual([]);
  });
});
