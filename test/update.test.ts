import { describe, expect, it, afterEach, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { runUpdate } from "../src/commands/update";

/** Replaces `globalThis.fetch` with a test double for the duration of a test. */
function mockFetch(impl: () => Promise<Response>): typeof globalThis.fetch {
  return impl as unknown as typeof globalThis.fetch;
}

describe("runUpdate", () => {
  let origFetch: typeof globalThis.fetch;
  let exitSpy: ReturnType<typeof spyOn<typeof process, "exit">> | undefined;

  afterEach(() => {
    globalThis.fetch = origFetch;
    exitSpy?.mockRestore();
    exitSpy = undefined;
  });

  function stubExit() {
    exitSpy = spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${code}`);
    });
  }

  it("reports fetch failure and exits 1", async () => {
    origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(async () => new Response("", { status: 500 }));
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (msg: string) => errors.push(msg);
    stubExit();
    try {
      await expect(runUpdate()).rejects.toThrow("exit:1");
      expect(errors.join("")).toContain("Failed to check for updates");
    } finally {
      console.error = origErr;
    }
  });

  it("runs install script when a newer version is available", async () => {
    origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(async () =>
      new Response(JSON.stringify({ tag_name: "v99.0.0" }), { status: 200 }));
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    const execSpy = spyOn(childProcess, "execSync").mockImplementation((() => Buffer.from("")) as unknown as typeof childProcess.execSync);
    try {
      await runUpdate();
      expect(logs.join("\n")).toContain("Updating senv");
      expect(execSpy).toHaveBeenCalled();
    } finally {
      console.log = origLog;
      execSpy.mockRestore();
    }
  });

  it("exits with execSync status on install failure", async () => {
    origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(async () =>
      new Response(JSON.stringify({ tag_name: "v99.0.0" }), { status: 200 }));
    const origLog = console.log;
    console.log = () => {};
    const execSpy = spyOn(childProcess, "execSync").mockImplementation((() => {
      const err = new Error("install failed") as Error & { status: number };
      err.status = 2;
      throw err;
    }) as unknown as typeof childProcess.execSync);
    stubExit();
    try {
      await expect(runUpdate()).rejects.toThrow("exit:2");
    } finally {
      console.log = origLog;
      execSpy.mockRestore();
    }
  });

  it("exits 1 when execSync fails without status", async () => {
    origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(async () =>
      new Response(JSON.stringify({ tag_name: "v99.0.0" }), { status: 200 }));
    const origLog = console.log;
    console.log = () => {};
    const execSpy = spyOn(childProcess, "execSync").mockImplementation((() => {
      throw new Error("install failed");
    }) as unknown as typeof childProcess.execSync);
    stubExit();
    try {
      await expect(runUpdate()).rejects.toThrow("exit:1");
    } finally {
      console.log = origLog;
      execSpy.mockRestore();
    }
  });
});
