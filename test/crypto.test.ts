import { describe, expect, it } from "bun:test";
import * as nodeCrypto from "node:crypto";
import * as crypto from "../src/core/crypto";
import type { SenvPayload } from "../src/core/store";
import { MAX_VALUE_BYTES } from "../src/core/validation";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Replaces the first Base64 character with a different valid character (corrupts ciphertext for tests). */
function flipFirstBase64Char(s: string): string {
  if (s.length === 0) return s;
  const first = s[0]!;
  const idx = BASE64_ALPHABET.indexOf(first);
  const replacement = idx === 0 ? BASE64_ALPHABET[1]! : BASE64_ALPHABET[0]!;
  return replacement + s.slice(1);
}

/** Encrypts arbitrary plaintext as the inner AES-GCM payload (for validation tests). */
function encryptCustomPlaintext(plaintext: string, publicKey: string): string {
  const dek = nodeCrypto.randomBytes(32);
  const iv = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv("aes-256-gcm", dek, iv);
  let encryptedPayload = cipher.update(plaintext, "utf8", "base64");
  encryptedPayload += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");
  const encryptedDEK = nodeCrypto.publicEncrypt(
    {
      key: publicKey,
      padding: nodeCrypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    dek
  ).toString("base64");
  const packed = { encryptedDEK, iv: iv.toString("base64"), authTag, encryptedPayload };
  return Buffer.from(JSON.stringify(packed), "utf8").toString("base64");
}

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
    json.encryptedPayload = flipFirstBase64Char(json.encryptedPayload);
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

  it("roundtrips non-ASCII values through encrypt/decrypt", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    const payload: SenvPayload = [
      { key: "GREETING", value: "héllo wörld 你好 🚀", environment: "dev" },
    ];
    const enc = crypto.encryptPayload(payload, publicKey);
    const dec = crypto.decryptPayload(enc, privateKey);
    expect(dec).toEqual(payload);
  });

  it("roundtrips a value at the 16KB boundary", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    const big = "x".repeat(16 * 1024);
    const payload: SenvPayload = [{ key: "BIG", value: big, environment: "dev" }];
    const enc = crypto.encryptPayload(payload, publicKey);
    const dec = crypto.decryptPayload(enc, privateKey);
    expect(dec[0]!.value.length).toBe(16 * 1024);
  });

  it("isValidPEM rejects empty string", () => {
    expect(crypto.isValidPEM("", "public")).toBe(false);
    expect(crypto.isValidPEM("", "private")).toBe(false);
  });

  it("isValidPEM rejects forgeable BEGIN header with garbage body", () => {
    const forged = "-----BEGIN PUBLIC KEY-----\nNOT_A_REAL_KEY\n-----END PUBLIC KEY-----\n";
    expect(crypto.isValidPEM(forged, "public")).toBe(false);
  });

  it("isValidPEM accepts a generated private key", () => {
    const { privateKey } = crypto.generateRSAKeyPair();
    expect(crypto.isValidPEM(privateKey, "private")).toBe(true);
  });

  it("isValidPEM rejects forgeable private key header", () => {
    const forged = "-----BEGIN PRIVATE KEY-----\nNOT_A_REAL_KEY\n-----END PRIVATE KEY-----\n";
    expect(crypto.isValidPEM(forged, "private")).toBe(false);
  });

  it("detects tampering with encryptedDEK field", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    const payload: SenvPayload = [{ key: "A", value: "B", environment: "dev" }];
    const encrypted = crypto.encryptPayload(payload, publicKey);

    const json = JSON.parse(Buffer.from(encrypted, "base64").toString("utf8"));
    json.encryptedDEK = flipFirstBase64Char(json.encryptedDEK);
    const tamperedEncrypted = Buffer.from(JSON.stringify(json)).toString("base64");

    expect(() => {
      crypto.decryptPayload(tamperedEncrypted, privateKey);
    }).toThrow();
  });

  it("detects tampering with IV field", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    const payload: SenvPayload = [{ key: "A", value: "B", environment: "dev" }];
    const encrypted = crypto.encryptPayload(payload, publicKey);

    const json = JSON.parse(Buffer.from(encrypted, "base64").toString("utf8"));
    json.iv = flipFirstBase64Char(json.iv);
    const tamperedEncrypted = Buffer.from(JSON.stringify(json)).toString("base64");

    expect(() => {
      crypto.decryptPayload(tamperedEncrypted, privateKey);
    }).toThrow();
  });

  it("fails to decrypt when a public key is passed as private key", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    const payload: SenvPayload = [{ key: "A", value: "B", environment: "dev" }];
    const encrypted = crypto.encryptPayload(payload, publicKey);

    expect(() => {
      crypto.decryptPayload(encrypted, publicKey);
    }).toThrow();
  });

  it("rejects decrypted payload that is not an array", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    const encrypted = encryptCustomPlaintext(JSON.stringify({ not: "array" }), publicKey);
    expect(() => crypto.decryptPayload(encrypted, privateKey)).toThrow(/Invalid payload/);
  });

  it("rejects decrypted payload with invalid item shape", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    const encrypted = encryptCustomPlaintext(JSON.stringify([{ key: 1 }]), publicKey);
    expect(() => crypto.decryptPayload(encrypted, privateKey)).toThrow(/Invalid payload/);
  });

  it("rejects decrypted payload with oversized value", () => {
    const { publicKey, privateKey } = crypto.generateRSAKeyPair();
    const huge = "x".repeat(MAX_VALUE_BYTES + 1);
    const payload: SenvPayload = [{ key: "BIG", value: huge, environment: "dev" }];
    const encrypted = crypto.encryptPayload(payload, publicKey);
    expect(() => crypto.decryptPayload(encrypted, privateKey)).toThrow(/exceeds maximum size/);
  });
});
