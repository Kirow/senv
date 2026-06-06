import { describe, expect, it } from "bun:test";
import * as crypto from "../src/core/crypto";
import type { SenvPayload } from "../src/core/store";

describe("crypto operations", () => {
  it("generates an RSA key pair in PEM format", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    expect(publicKey).toContain("BEGIN PUBLIC KEY");
    expect(privateKey).toContain("BEGIN PRIVATE KEY");
  });

  it("encrypts and decrypts a payload successfully", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    const payload: SenvPayload = [
      { key: "TEST_KEY", value: "TEST_VALUE", environment: "dev" },
      { key: "ANOTHER", value: "VALUE", environment: "prod" }
    ];

    const encrypted = crypto.encryptPayload(payload, publicKey);
    expect(typeof encrypted).toBe("string");

    const decrypted = crypto.decryptPayload(encrypted, privateKey);
    expect(decrypted).toEqual(payload);
  });

  it("handles empty payloads", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    const payload: SenvPayload = [];
    const encrypted = crypto.encryptPayload(payload, publicKey);
    const decrypted = crypto.decryptPayload(encrypted, privateKey);
    expect(decrypted).toEqual(payload);
  });

  it("fails to decrypt with the wrong private key", () => {
    const { publicKey } = crypto.generateRSAKeyPair();
    const { privateKey: wrongPrivateKey } = crypto.generateRSAKeyPair();
    
    const payload: SenvPayload = [{ key: "A", value: "B", environment: "dev" }];
    const encrypted = crypto.encryptPayload(payload, publicKey);

    expect(() => {
      crypto.decryptPayload(encrypted, wrongPrivateKey);
    }).toThrow();
  });

  it("detects modification of the encrypted base64 payload (auth tag failure)", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    const payload: SenvPayload = [{ key: "A", value: "B", environment: "dev" }];
    const encrypted = crypto.encryptPayload(payload, publicKey);

    const json = JSON.parse(Buffer.from(encrypted, "base64").toString("utf8"));
    // Tamper with the encryptedPayload
    json.encryptedPayload = "A" + json.encryptedPayload.slice(1);
    const tamperedEncrypted = Buffer.from(JSON.stringify(json)).toString("base64");

    expect(() => {
      crypto.decryptPayload(tamperedEncrypted, privateKey);
    }).toThrow(/Unsupported state or unable to authenticate data/);
  });

  it("encodes and decodes base64 keypairs", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    const idName = "test-id";
    const encoded = crypto.encodeKeyPairBase64(idName, publicKey, privateKey);
    const decoded = crypto.decodeKeyPairBase64(encoded);

    expect(decoded.idName).toBe(idName);
    expect(decoded.publicKey).toBe(publicKey);
    expect(decoded.privateKey).toBe(privateKey);
  });

  it("decodes partial keypair payloads with at least one key", () => {
    const readOnly = Buffer.from(
      JSON.stringify({ idName: "read-only", privateKey: "PRIV_ONLY" }),
      "utf8"
    ).toString("base64");

    const pubOnly = Buffer.from(
      JSON.stringify({ idName: "pub-only", publicKey: "PUB_ONLY" }),
      "utf8"
    ).toString("base64");

    const decodedReadOnly = crypto.decodeKeyPairBase64(readOnly);
    expect(decodedReadOnly.idName).toBe("read-only");
    expect(decodedReadOnly.privateKey).toBe("PRIV_ONLY");
    expect(decodedReadOnly.publicKey).toBe("");

    const decodedPubOnly = crypto.decodeKeyPairBase64(pubOnly);
    expect(decodedPubOnly.idName).toBe("pub-only");
    expect(decodedPubOnly.publicKey).toBe("PUB_ONLY");
    expect(decodedPubOnly.privateKey).toBe("");
  });

  it("throws error when decoding invalid base64 keypair", () => {
    expect(() => {
      crypto.decodeKeyPairBase64("invalid_base_64!!!")
    }).toThrow();

    const badJson = Buffer.from(JSON.stringify({ bad: "data" })).toString("base64");
    expect(() => {
      crypto.decodeKeyPairBase64(badJson);
    }).toThrow("Invalid keypair string.");

    const noKeysJson = Buffer.from(JSON.stringify({ idName: "id-only" })).toString("base64");
    expect(() => {
      crypto.decodeKeyPairBase64(noKeysJson);
    }).toThrow("Invalid keypair string.");
  });
});
