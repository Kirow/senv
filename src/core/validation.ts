import type { SenvPayload } from "./store";

/** Maximum UTF-8 byte length for a single secret value (`key add`, `migrate`, payload read). */
export const MAX_VALUE_BYTES = 16 * 1024;

/**
 * @param name - Candidate identity or preset name.
 * @returns `true` when `name` matches `/^[A-Za-z0-9._-]+$/`.
 */
export function isValidIdentityName(name: string): boolean {
  return typeof name === "string" && /^[A-Za-z0-9._-]+$/.test(name);
}

/**
 * @param name - Candidate shell environment variable name.
 * @returns `true` when `name` matches `/^[A-Za-z_][A-Za-z0-9_]*$/`.
 */
export function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Validates decrypted payload shape after AES-GCM decryption.
 *
 * @param parsed - Raw JSON value from inside an encrypted identity blob.
 * @returns Typed {@link SenvPayload} when every item has valid fields and value size.
 * @throws When the shape is invalid or a value exceeds {@link MAX_VALUE_BYTES}.
 */
export function validatePayload(parsed: unknown): SenvPayload {
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid payload: expected an array of key-value items.");
  }

  const result: SenvPayload = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item || typeof item !== "object") {
      throw new Error(`Invalid payload: item at index ${i} must be an object.`);
    }

    const { key, value, environment } = item as Record<string, unknown>;

    if (typeof key !== "string" || !isValidEnvName(key)) {
      throw new Error(`Invalid payload: item at index ${i} has invalid key '${String(key)}'.`);
    }
    if (typeof value !== "string") {
      throw new Error(`Invalid payload: item at index ${i} ('${key}') must have a string value.`);
    }
    if (typeof environment !== "string" || environment.length === 0) {
      throw new Error(`Invalid payload: item at index ${i} ('${key}') must have a non-empty environment.`);
    }
    if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) {
      throw new Error(
        `Invalid payload: value for '${key}' exceeds maximum size of ${MAX_VALUE_BYTES} bytes.`
      );
    }

    result.push({ key, value, environment });
  }

  return result;
}
