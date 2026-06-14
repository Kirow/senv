import * as crypto from "node:crypto";
import type { SenvPayload } from "./store";
import { validatePayload } from "./validation";

/**
 * Generates a new RSA-2048 keypair for a senv identity.
 *
 * @returns PEM-encoded public (SPKI) and private (PKCS#8) keys.
 */
export function generateRSAKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });
  return { publicKey, privateKey };
}

interface PackedEncryptedPayload {
  encryptedDEK: string;
  iv: string;
  authTag: string;
  encryptedPayload: string;
}

/**
 * Encrypts a key-value payload for storage in `.senv.json`.
 *
 * Uses AES-256-GCM for the payload and RSA-OAEP (SHA-256) to wrap the DEK.
 *
 * @param payload - Decrypted key-value items to encrypt.
 * @param publicKey - PEM-encoded RSA public key of the target identity.
 * @returns Base64-encoded JSON blob (ciphertext, IV, auth tag, encrypted DEK).
 */
export function encryptPayload(payload: SenvPayload, publicKey: string): string {
  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  const payloadString = JSON.stringify(payload);

  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
  let encryptedPayload = cipher.update(payloadString, "utf8", "base64");
  encryptedPayload += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");

  const encryptedDEK = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    dek
  ).toString("base64");

  const packed: PackedEncryptedPayload = {
    encryptedDEK,
    iv: iv.toString("base64"),
    authTag,
    encryptedPayload,
  };

  return Buffer.from(JSON.stringify(packed), "utf8").toString("base64");
}

/**
 * Decrypts a payload blob produced by {@link encryptPayload}.
 *
 * @param encryptedString - Base64 blob from `.senv.json`.
 * @param privateKey - PEM-encoded RSA private key for the identity.
 * @returns Decrypted key-value payload.
 * @throws When the blob is malformed, GCM authentication fails, or RSA decryption fails.
 */
export function decryptPayload(encryptedString: string, privateKey: string): SenvPayload {
  const packedJson = Buffer.from(encryptedString, "base64").toString("utf8");
  const packed: PackedEncryptedPayload = JSON.parse(packedJson);

  const dek = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(packed.encryptedDEK, "base64")
  );

  const decipher = crypto.createDecipheriv("aes-256-gcm", dek, Buffer.from(packed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(packed.authTag, "base64"));
  
  let decrypted = decipher.update(packed.encryptedPayload, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return validatePayload(JSON.parse(decrypted));
}

/**
 * Validates that a string is a parseable PEM-encoded RSA key.
 *
 * Uses `createPublicKey` / `createPrivateKey` rather than header string matching,
 * which is forgeable.
 *
 * @param key - Candidate PEM string.
 * @param type - Whether to validate as a public or private key.
 * @returns `true` when the key parses successfully.
 */
export function isValidPEM(key: string, type: "public" | "private"): boolean {
  if (typeof key !== "string" || key.length === 0) {
    return false;
  }
  try {
    if (type === "public") {
      crypto.createPublicKey(key);
    } else {
      crypto.createPrivateKey(key);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Encodes an identity name and keypair as a single Base64 string for `identity export`.
 *
 * @param idName - Identity name embedded in the bundle.
 * @param publicKey - PEM public key (may be empty for decrypt-only export).
 * @param privateKey - PEM private key (may be empty when exporting public key only).
 * @returns Base64 string suitable for `identity import`.
 */
export function encodeKeyPairBase64(idName: string, publicKey: string, privateKey: string): string {
  const data = JSON.stringify({ idName, publicKey, privateKey });
  return Buffer.from(data, "utf8").toString("base64");
}

/**
 * Decodes a Base64 keypair string from {@link encodeKeyPairBase64}.
 *
 * @param b64 - Base64 bundle from `identity export`.
 * @returns Parsed identity name and key material (either key may be empty).
 * @throws When the blob is invalid JSON or contains neither a public nor private key.
 */
export function decodeKeyPairBase64(b64: string): { idName: string; publicKey: string; privateKey: string } {
  const data = Buffer.from(b64, "base64").toString("utf8");
  const parsed = JSON.parse(data);
  const hasId = typeof parsed.idName === "string" && parsed.idName.length > 0;
  const hasPublic = typeof parsed.publicKey === "string" && parsed.publicKey.length > 0;
  const hasPrivate = typeof parsed.privateKey === "string" && parsed.privateKey.length > 0;
  if (!hasId || (!hasPublic && !hasPrivate)) {
    throw new Error("Invalid keypair string.");
  }
  return {
    idName: parsed.idName,
    publicKey: typeof parsed.publicKey === "string" ? parsed.publicKey : "",
    privateKey: typeof parsed.privateKey === "string" ? parsed.privateKey : "",
  };
}
