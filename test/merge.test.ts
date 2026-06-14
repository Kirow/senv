import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as senvCrypto from "../src/core/crypto";
import {
  extractPresetsFromConflictedContent,
  extractPublicFromConflictedContent,
  mergePresets,
  mergeProjectConfigs,
  runMerge,
} from "../src/commands/merge";
import type { SenvProjectConfig } from "../src/core/store";
import * as store from "../src/core/store";
import * as conflict from "../src/core/conflict";

describe("merge helpers", () => {
  it("mergePresets returns undefined when both inputs are empty", () => {
    expect(mergePresets(undefined, undefined)).toBeUndefined();
    expect(mergePresets({}, {})).toBeUndefined();
  });

  it("mergePresets unions and deduplicates keys", () => {
    const result = mergePresets(
      { backend: ["API_KEY", "DB_URL"] },
      { backend: ["DB_URL", "SECRET"], frontend: ["PUBLIC_URL"] }
    );
    expect(result).toEqual({
      backend: ["API_KEY", "DB_URL", "SECRET"],
      frontend: ["PUBLIC_URL"],
    });
  });

  it("mergePresets returns one side when the other is absent", () => {
    expect(mergePresets({ a: ["X"] }, undefined)).toEqual({ a: ["X"] });
    expect(mergePresets(undefined, { b: ["Y"] })).toEqual({ b: ["Y"] });
  });

  it("extractPresetsFromConflictedContent reads presets from prefix", () => {
    const content = `{
  "version": "1.0",
  "presets": { "backend": ["API_KEY"] },
  "identities": {
<<<<<<< HEAD
    "alice-local": "blob-a"
=======
    "alice-local": "blob-b"
>>>>>>> feature/other
  }
}`;
    expect(extractPresetsFromConflictedContent(content)).toEqual({ backend: ["API_KEY"] });
  });

  it("extractPresetsFromConflictedContent reads presets from postfix", () => {
    const content = `{
  "version": "1.0",
  "identities": {
<<<<<<< HEAD
    "alice-local": "blob-a"
=======
    "alice-local": "blob-b"
>>>>>>> feature/other
  },
  "presets": { "frontend": ["PUBLIC_URL"] }
}`;
    expect(extractPresetsFromConflictedContent(content)).toEqual({ frontend: ["PUBLIC_URL"] });
  });

  it("extractPresetsFromConflictedContent returns undefined when no presets", () => {
    const content = `{"version":"1.0","identities":{}}`;
    expect(extractPresetsFromConflictedContent(content)).toBeUndefined();
  });

  it("extractPresetsFromConflictedContent returns undefined on invalid JSON", () => {
    const content = `{ "presets": { broken }, "identities": {} }`;
    expect(extractPresetsFromConflictedContent(content)).toBeUndefined();
  });

  it("extractPublicFromConflictedContent reads public from prefix", () => {
    const content = `{
  "version": "1.1",
  "public": [
    { "key": "PUBLIC_URL", "value": "http://localhost", "environment": "dev" }
  ],
  "identities": {
<<<<<<< HEAD
    "alice-local": "blob-a"
=======
    "alice-local": "blob-b"
>>>>>>> feature/other
  }
}`;
    expect(extractPublicFromConflictedContent(content)).toEqual([
      { key: "PUBLIC_URL", value: "http://localhost", environment: "dev" },
    ]);
  });

  it("extractPublicFromConflictedContent reads public from postfix", () => {
    const content = `{
  "version": "1.1",
  "identities": {
<<<<<<< HEAD
    "alice-local": "blob-a"
=======
    "alice-local": "blob-b"
>>>>>>> feature/other
  },
  "public": [
    { "key": "LOG_LEVEL", "value": "debug", "environment": "dev" }
  ]
}`;
    expect(extractPublicFromConflictedContent(content)).toEqual([
      { key: "LOG_LEVEL", value: "debug", environment: "dev" },
    ]);
  });

  it("extractPublicFromConflictedContent returns undefined when no public", () => {
    const content = `{"version":"1.1","identities":{}}`;
    expect(extractPublicFromConflictedContent(content)).toBeUndefined();
  });

  it("extractPublicFromConflictedContent returns undefined on invalid JSON", () => {
    const content = `{ "public": [ invalid ], "identities": {} }`;
    expect(extractPublicFromConflictedContent(content)).toBeUndefined();
  });

  it("mergeProjectConfigs preserves configA public and ignores configB public", () => {
    const configA: SenvProjectConfig = {
      version: "1.1",
      identities: { "alice-local": "blob-a" },
      public: [{ key: "MODE", value: "dev", environment: "dev" }],
    };
    const configB: SenvProjectConfig = {
      version: "1.1",
      identities: { "bob-local": "blob-b" },
      public: [{ key: "MODE", value: "prod", environment: "dev" }],
    };
    const { config } = mergeProjectConfigs(configA, configB, {}, "incoming");
    expect(config.public).toEqual([{ key: "MODE", value: "dev", environment: "dev" }]);
    expect(config.identities["bob-local"]).toBe("blob-b");
  });

  it("mergeProjectConfigs adds new identity from incoming config", () => {
    const configA: SenvProjectConfig = { version: "1.0", identities: { "alice-local": "blob-a" } };
    const configB: SenvProjectConfig = { version: "1.0", identities: { "bob-local": "blob-b" } };
    const { config, messages } = mergeProjectConfigs(configA, configB, {}, "incoming");
    expect(config.identities).toEqual({ "alice-local": "blob-a", "bob-local": "blob-b" });
    expect(messages).toContain("Identity 'bob-local' added from incoming.");
  });

  it("mergeProjectConfigs merges decryptable payloads", () => {
    const { publicKey, privateKey } = senvCrypto.generateRSAKeyPair();
    const blobA = senvCrypto.encryptPayload(
      [{ key: "SHARED", value: "ours", environment: "dev" }],
      publicKey
    );
    const blobB = senvCrypto.encryptPayload(
      [
        { key: "SHARED", value: "theirs", environment: "dev" },
        { key: "NEW", value: "v", environment: "dev" },
      ],
      publicKey
    );
    const configA: SenvProjectConfig = { version: "1.0", identities: { "alice-local": blobA } };
    const configB: SenvProjectConfig = { version: "1.0", identities: { "alice-local": blobB } };
    const keystore = { "alice-local": { publicKey, privateKey } };

    const { config, messages } = mergeProjectConfigs(configA, configB, keystore, "incoming");
    const merged = senvCrypto.decryptPayload(config.identities["alice-local"]!, privateKey);

    expect(merged).toEqual([
      { key: "SHARED", value: "theirs", environment: "dev" },
      { key: "NEW", value: "v", environment: "dev" },
    ]);
    expect(messages).toContain("Merged payloads for identity 'alice-local'.");
  });

  it("mergeProjectConfigs uses owner heuristic when private key is missing", () => {
    const configA: SenvProjectConfig = { version: "1.0", identities: { "alice-local": "blob-a" } };
    const configB: SenvProjectConfig = { version: "1.0", identities: { "alice-local": "blob-b" } };
    const { config, messages } = mergeProjectConfigs(
      configA,
      configB,
      {},
      "incoming",
      "alice"
    );
    expect(config.identities["alice-local"]).toBe("blob-b");
    expect(messages).toContain("Identity 'alice-local' kept incoming version (no private key).");
  });

  it("mergeProjectConfigs keeps ours when branch label does not match owner", () => {
    const configA: SenvProjectConfig = { version: "1.0", identities: { "alice-local": "blob-a" } };
    const configB: SenvProjectConfig = { version: "1.0", identities: { "alice-local": "blob-b" } };
    const { config, messages } = mergeProjectConfigs(
      configA,
      configB,
      {},
      "incoming",
      "feature/bob"
    );
    expect(config.identities["alice-local"]).toBe("blob-a");
    expect(messages).toContain("Identity 'alice-local' kept ours version (no private key).");
  });
});

describe("merge CLI validation", () => {
  it("pickConflictBlobWithoutPrivateKey keeps ours when label does not match owner", () => {
    expect(
      conflict.pickConflictBlobWithoutPrivateKey("alice-local", "ours", "theirs", "feature/bob")
    ).toBe("ours");
  });
});

describe("runMerge", () => {
  let tempConfigDir: string;
  let tempProjectDir: string;
  let exitSpy: ReturnType<typeof spyOn<typeof process, "exit">> | undefined;

  beforeEach(async () => {
    tempConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "senv-merge-config-"));
    tempProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "senv-merge-proj-"));
    process.env.SENV_CONFIG_DIR = tempConfigDir;
    process.env.SENV_PROJECT_DIR = tempProjectDir;
  });

  afterEach(async () => {
    exitSpy?.mockRestore();
    exitSpy = undefined;
    await fs.rm(tempConfigDir, { recursive: true, force: true });
    await fs.rm(tempProjectDir, { recursive: true, force: true });
    delete process.env.SENV_CONFIG_DIR;
    delete process.env.SENV_PROJECT_DIR;
  });

  function stubExit() {
    exitSpy = spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${code}`);
    });
  }

  it("merges FILE_B identities into FILE_A", async () => {
    const fileA = path.join(tempProjectDir, "a.json");
    const fileB = path.join(tempProjectDir, "b.json");
    const configA: SenvProjectConfig = { version: "1.1", identities: { "alice-local": "blob-a" } };
    const configB: SenvProjectConfig = { version: "1.1", identities: { "bob-local": "blob-b" } };
    await fs.writeFile(fileA, JSON.stringify(configA), "utf-8");
    await fs.writeFile(fileB, JSON.stringify(configB), "utf-8");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      await runMerge(fileA, fileB);
      const merged = JSON.parse(await fs.readFile(fileA, "utf-8"));
      expect(merged.identities).toEqual({ "alice-local": "blob-a", "bob-local": "blob-b" });
      expect(logs.join("\n")).toContain("Merge complete");
    } finally {
      console.log = origLog;
    }
  });

  it("resolves conflict markers and preserves presets and public sections", async () => {
    const configPath = path.join(tempProjectDir, ".senv.json");
    const { publicKey, privateKey } = senvCrypto.generateRSAKeyPair();
    await store.writeKeystore({
      version: "1.0",
      projects: { [tempProjectDir]: { "testuser-local": { publicKey, privateKey } } },
    });
    const blobA = senvCrypto.encryptPayload(
      [{ key: "API_KEY", value: "ours", environment: "dev" }],
      publicKey
    );
    const blobB = senvCrypto.encryptPayload(
      [{ key: "API_KEY", value: "theirs", environment: "dev" }],
      publicKey
    );
    const conflicted = `{
  "version": "1.1",
  "presets": { "backend": ["API_KEY"] },
  "public": [
    { "key": "PUBLIC_URL", "value": "http://localhost", "environment": "dev" }
  ],
  "identities": {
<<<<<<< HEAD
    "testuser-local": ${JSON.stringify(blobA)}
=======
    "testuser-local": ${JSON.stringify(blobB)}
>>>>>>> testuser
  }
}`;
    await fs.writeFile(configPath, conflicted, "utf-8");

    await runMerge(undefined, undefined);
    const merged = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(merged.presets).toEqual({ backend: ["API_KEY"] });
    expect(merged.public).toEqual([
      { key: "PUBLIC_URL", value: "http://localhost", environment: "dev" },
    ]);
    expect(merged.identities["testuser-local"]).toBeTruthy();
  });

  it("errors when no conflict markers and FILE_B is missing", async () => {
    const configPath = path.join(tempProjectDir, ".senv.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({ version: "1.1", identities: {} }),
      "utf-8"
    );
    stubExit();
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (msg: string) => errors.push(msg);
    try {
      await expect(runMerge(undefined, undefined)).rejects.toThrow("exit:1");
      expect(errors.join("")).toContain("FILE_B was not provided");
    } finally {
      console.error = origErr;
    }
  });

  it("reports missing file on ENOENT", async () => {
    stubExit();
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (msg: string) => errors.push(msg);
    try {
      await expect(runMerge(path.join(tempProjectDir, "missing.json"), undefined)).rejects.toThrow("exit:1");
      expect(errors.join("")).toContain("file not found");
    } finally {
      console.error = origErr;
    }
  });

  it("reports merge failure for unsupported config version", async () => {
    const fileA = path.join(tempProjectDir, "a.json");
    const fileB = path.join(tempProjectDir, "b.json");
    await fs.writeFile(fileA, JSON.stringify({ version: "1.1", identities: {} }), "utf-8");
    await fs.writeFile(fileB, JSON.stringify({ version: "99.0", identities: {} }), "utf-8");
    stubExit();
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
    try {
      await expect(runMerge(fileA, fileB)).rejects.toThrow("exit:1");
      expect(errors.join(" ")).toContain("Unsupported .senv.json version");
    } finally {
      console.error = origErr;
    }
  });

  it("mergeCmd action delegates to runMerge", async () => {
    const { Command } = await import("commander");
    const { mergeCmd } = await import("../src/commands/merge");
    const fileA = path.join(tempProjectDir, "a.json");
    const fileB = path.join(tempProjectDir, "b.json");
    await fs.writeFile(fileA, JSON.stringify({ version: "1.1", identities: { "a": "blob-a" } }), "utf-8");
    await fs.writeFile(fileB, JSON.stringify({ version: "1.1", identities: { "b": "blob-b" } }), "utf-8");

    const program = new Command();
    program.addCommand(mergeCmd);
    await program.parseAsync(["node", "senv", "merge", fileA, fileB]);
    const merged = JSON.parse(await fs.readFile(fileA, "utf-8"));
    expect(merged.identities).toEqual({ a: "blob-a", b: "blob-b" });
  });
});
