import { describe, expect, it } from "bun:test";
import {
  isValidEnvName,
  isValidIdentityName,
  MAX_VALUE_BYTES,
  PUBLIC_IDENTITY_LABEL,
  sortPublicItems,
  validatePayload,
  validatePayloadItemCore,
  validatePublicItems,
} from "../src/core/validation";
import type { SenvPublicItem } from "../src/core/store";

describe("validation helpers", () => {
  it("isValidIdentityName accepts alphanumeric names with . _ -", () => {
    expect(isValidIdentityName("alice-local")).toBe(true);
    expect(isValidIdentityName("team.dev_1")).toBe(true);
  });

  it("isValidIdentityName rejects reserved public label", () => {
    expect(isValidIdentityName(PUBLIC_IDENTITY_LABEL)).toBe(false);
  });

  it("isValidIdentityName rejects invalid names", () => {
    expect(isValidIdentityName("")).toBe(false);
    expect(isValidIdentityName("bad name")).toBe(false);
    expect(isValidIdentityName("id/slash")).toBe(false);
  });

  it("isValidIdentityName rejects non-string input", () => {
    expect(isValidIdentityName(null as unknown as string)).toBe(false);
  });

  it("validatePayloadItemCore rejects non-object items", () => {
    expect(() => validatePayloadItemCore(null, 0, "public")).toThrow(
      /item at index 0 must be an object/
    );
  });

  it("validatePayloadItemCore rejects non-string values", () => {
    expect(() =>
      validatePayloadItemCore({ key: "FOO", value: 123, environment: "dev" }, 0, "payload")
    ).toThrow(/must have a string value/);
  });

  it("isValidEnvName validates shell variable names", () => {
    expect(isValidEnvName("API_KEY")).toBe(true);
    expect(isValidEnvName("1BAD")).toBe(false);
  });

  it("validatePayloadItemCore rejects invalid keys and environments", () => {
    expect(() =>
      validatePayloadItemCore({ key: "1BAD", value: "v", environment: "dev" }, 0, "payload")
    ).toThrow(/invalid key/);
    expect(() =>
      validatePayloadItemCore({ key: "OK", value: "v", environment: "" }, 0, "payload")
    ).toThrow(/non-empty environment/);
  });

  it("validatePayloadItemCore rejects oversized values", () => {
    const huge = "x".repeat(MAX_VALUE_BYTES + 1);
    expect(() =>
      validatePayloadItemCore({ key: "BIG", value: huge, environment: "dev" }, 0, "payload")
    ).toThrow(/exceeds maximum size/);
  });

  it("validatePayload rejects non-array input", () => {
    expect(() => validatePayload({})).toThrow(/expected an array/);
  });

  it("validatePublicItems rejects duplicate environment:key pairs", () => {
    expect(() =>
      validatePublicItems([
        { key: "MODE", value: "a", environment: "dev" },
        { key: "MODE", value: "b", environment: "dev" },
      ])
    ).toThrow(/duplicate public entry/);
  });

  it("sortPublicItems orders by environment then key", () => {
    const items: SenvPublicItem[] = [
      { key: "Z", value: "z", environment: "prod" },
      { key: "B", value: "b", environment: "dev" },
      { key: "A", value: "a", environment: "dev" },
    ];
    expect(sortPublicItems(items).map((i) => `${i.environment}:${i.key}`)).toEqual([
      "dev:A",
      "dev:B",
      "prod:Z",
    ]);
  });
});
