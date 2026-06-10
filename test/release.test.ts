import { describe, expect, it, afterEach } from "bun:test";
import { compareSemver, fetchLatestVersion } from "../src/core/release";

/** Replaces `globalThis.fetch` with a test double for the duration of a test. */
function mockFetch(impl: () => Promise<Response>): typeof globalThis.fetch {
  return impl as unknown as typeof globalThis.fetch;
}

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

  it("strips pre-release suffixes and treats as equal to base", () => {
    expect(compareSemver("1.0.0-alpha", "1.0.0")).toBe(0);
  });

  it("compares versions with different segment counts", () => {
    expect(compareSemver("1.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.0.1", "1.0")).toBe(1);
  });
});

describe("fetchLatestVersion", () => {
  let origFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("returns tag_name without v prefix", async () => {
    origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(async () =>
      new Response(JSON.stringify({ tag_name: "v1.2.3" }), { status: 200 }));
    expect(await fetchLatestVersion()).toBe("1.2.3");
  });

  it("throws when GitHub API returns non-ok status", async () => {
    origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(async () => new Response("", { status: 404 }));
    await expect(fetchLatestVersion()).rejects.toThrow("GitHub API returned 404");
  });

  it("throws when tag_name is missing", async () => {
    origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(async () => new Response(JSON.stringify({}), { status: 200 }));
    await expect(fetchLatestVersion()).rejects.toThrow("missing tag_name in release response");
  });
});
