import * as crypto from "node:crypto";
import type { SenvPayload } from "./store";

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

  return JSON.parse(decrypted) as SenvPayload;
}

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

export function encodeKeyPairBase64(idName: string, publicKey: string, privateKey: string): string {
  const data = JSON.stringify({ idName, publicKey, privateKey });
  return Buffer.from(data, "utf8").toString("base64");
}

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
