import type { SenvPayload, SenvPublicItem } from "./store";

/** Maximum UTF-8 byte length for a single secret value (`key add`, `migrate`, payload read). */
export const MAX_VALUE_BYTES = 16 * 1024;

/** CLI label for project-wide public keys in `key list` / `getAccessibleKeyMap`. Not a valid identity name. */
export const PUBLIC_IDENTITY_LABEL = "public";

/**
 * @param name - Candidate identity or preset name.
 * @returns `true` when `name` matches `/^[A-Za-z0-9._-]+$/` and is not {@link PUBLIC_IDENTITY_LABEL}.
 */
export function isValidIdentityName(name: string): boolean {
  return (
    typeof name === "string" &&
    /^[A-Za-z0-9._-]+$/.test(name) &&
    name !== PUBLIC_IDENTITY_LABEL
  );
}

/**
 * @param name - Candidate shell environment variable name.
 * @returns `true` when `name` matches `/^[A-Za-z_][A-Za-z0-9_]*$/`.
 */
export function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** Core fields shared by encrypted payload items and public items. */
export interface PayloadItemCore {
  key: string;
  value: string;
  environment: string;
}

/**
 * Validates the required fields of one env-var record.
 *
 * @param item - Raw object from JSON.
 * @param index - Array index for error messages.
 * @param context - Label for error messages (e.g. `payload[0]` or `public[1]`).
 * @returns Validated `key`, `value`, and `environment`.
 * @throws When required fields are missing or invalid.
 */
export function validatePayloadItemCore(
  item: unknown,
  index: number,
  context: string
): PayloadItemCore {
  if (!item || typeof item !== "object") {
    throw new Error(`Invalid ${context}: item at index ${index} must be an object.`);
  }

  const { key, value, environment } = item as Record<string, unknown>;

  if (typeof key !== "string" || !isValidEnvName(key)) {
    throw new Error(`Invalid ${context}: item at index ${index} has invalid key '${String(key)}'.`);
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid ${context}: item at index ${index} ('${key}') must have a string value.`);
  }
  if (typeof environment !== "string" || environment.length === 0) {
    throw new Error(`Invalid ${context}: item at index ${index} ('${key}') must have a non-empty environment.`);
  }
  if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) {
    throw new Error(
      `Invalid ${context}: value for '${key}' exceeds maximum size of ${MAX_VALUE_BYTES} bytes.`
    );
  }

  return { key, value, environment };
}

/**
 * Sorts public items by `(environment, key)` for stable on-disk ordering.
 *
 * @param items - Public items to sort (not mutated).
 * @returns New array sorted by `environment` then `key` (`localeCompare`).
 */
export function sortPublicItems(items: SenvPublicItem[]): SenvPublicItem[] {
  return [...items].sort((a, b) => {
    const envCmp = a.environment.localeCompare(b.environment);
    if (envCmp !== 0) return envCmp;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Validates decrypted payload shape after AES-GCM decryption.
 *
 * @param parsed - Raw JSON value from inside an encrypted identity blob.
 * @returns Typed payload when every item has valid fields and value size.
 * @throws When the shape is invalid or a value exceeds {@link MAX_VALUE_BYTES}.
 */
export function validatePayload(parsed: unknown): SenvPayload {
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid payload: expected an array of key-value items.");
  }

  const result: SenvPayload = [];

  for (let i = 0; i < parsed.length; i++) {
    const core = validatePayloadItemCore(parsed[i], i, "payload");
    result.push(core);
  }

  return result;
}

/**
 * Validates the `public` array in `.senv.json`, preserving unknown extra fields per item.
 *
 * @param parsed - Raw `public` value from project config JSON.
 * @returns Sorted, validated public items.
 * @throws When `public` is not an array or any item fails validation.
 */
export function validatePublicItems(parsed: unknown): SenvPublicItem[] {
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid .senv.json: 'public' must be an array.");
  }

  const result: SenvPublicItem[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i];
    const core = validatePayloadItemCore(raw, i, "public");
    const slot = `${core.environment}:${core.key}`;
    if (seen.has(slot)) {
      throw new Error(
        `Invalid .senv.json: duplicate public entry for environment '${core.environment}' and key '${core.key}'.`
      );
    }
    seen.add(slot);
    result.push({ ...(raw as Record<string, unknown>), ...core } as SenvPublicItem);
  }

  return sortPublicItems(result);
}
