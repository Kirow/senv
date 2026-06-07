import { describe, expect, it } from "bun:test";
import { compareSemver } from "../src/core/release";

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
  });

  it("returns -1 when first is older", () => {
    expect(compareSemver("0.1.0", "0.2.0")).toBe(-1);
  });

  it("returns 1 when first is newer", () => {
    expect(compareSemver("0.2.0", "0.1.0")).toBe(1);
  });

  it("strips v prefix before comparing", () => {
    expect(compareSemver("v0.1.0", "0.1.0")).toBe(0);
  });
});
