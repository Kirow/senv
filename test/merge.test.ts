import { describe, expect, it } from "bun:test";
import * as senvCrypto from "../src/core/crypto";
import {
  extractPresetsFromConflictedContent,
  mergePresets,
  mergeProjectConfigs,
} from "../src/commands/merge";
import type { SenvProjectConfig } from "../src/core/store";
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
});

describe("merge CLI validation", () => {
  it("pickConflictBlobWithoutPrivateKey keeps ours when label does not match owner", () => {
    expect(
      conflict.pickConflictBlobWithoutPrivateKey("alice-local", "ours", "theirs", "feature/bob")
    ).toBe("ours");
  });
});
