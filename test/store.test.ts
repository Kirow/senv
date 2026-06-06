import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as store from "../src/core/store";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("store operations", () => {
  let tempConfigDir: string;
  let tempProjectDir: string;

  beforeEach(async () => {
    tempConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-config-"));
    tempProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "senv-test-proj-"));
    process.env.SENV_CONFIG_DIR = tempConfigDir;
    process.env.SENV_PROJECT_DIR = tempProjectDir;
  });

  afterEach(async () => {
    await fs.rm(tempConfigDir, { recursive: true, force: true });
    await fs.rm(tempProjectDir, { recursive: true, force: true });
    delete process.env.SENV_CONFIG_DIR;
    delete process.env.SENV_PROJECT_DIR;
  });

  it("handles missing keystore file gracefully", async () => {
    const keystore = await store.readKeystore();
    expect(keystore).toEqual({ version: "1.0", projects: {} });
  });

  it("writes and reads keystore", async () => {
    const data: store.Keystore = {
      version: "1.0",
      projects: {
        "proj1": {
          "test-id": { publicKey: "PUB", privateKey: "PRIV" },
        }
      }
    };
    await store.writeKeystore(data);
    const readData = await store.readKeystore();
    expect(readData).toEqual(data);
  });

  it("handles missing .senv.json by throwing specific error", async () => {
    expect(store.readProjectConfig()).rejects.toThrow(".senv.json not found");
  });

  it("writes and reads project config as strict JSON", async () => {
    const config: store.SenvProjectConfig = {
      version: "1.0",
      identities: { "id1": "encrypted" },
    };
    await store.writeProjectConfig(config);

    const readConfig = await store.readProjectConfig();
    expect(readConfig).toEqual(config);
  });
});
