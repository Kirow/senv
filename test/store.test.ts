import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as store from "../src/core/store";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { requireGitRepo } from "./helpers/git";

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
    await expect(store.readProjectConfig()).rejects.toThrow(".senv.json not found");
  });

  it("throws on unsupported keystore version", async () => {
    const badPath = path.join(tempConfigDir, "identity.json");
    await fs.writeFile(badPath, JSON.stringify({ version: "99.0", projects: {} }), "utf-8");
    await expect(store.readKeystore()).rejects.toThrow(/Unsupported keystore version/);
  });

  it("writes keystore atomically with 0600 permissions", async () => {
    const data: store.Keystore = {
      version: "1.0",
      projects: { "p1": { "id1": { publicKey: "P", privateKey: "X" } } },
    };
    await store.writeKeystore(data);
    const stats = await fs.stat(path.join(tempConfigDir, "identity.json"));
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
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

  it("readKeystore with invalid JSON throws a clear error", async () => {
    const badPath = path.join(tempConfigDir, "identity.json");
    await fs.writeFile(badPath, "{ this is not valid JSON", "utf-8");
    await expect(store.readKeystore()).rejects.toThrow(/Failed to parse keystore JSON/);
  });

  it("writeKeystore with custom path creates parent dir with 0700", async () => {
    const nested = path.join(tempConfigDir, "nested", "deep", "keys.json");
    const data: store.Keystore = { version: "1.0", projects: {} };
    await store.writeKeystore(data, nested);
    expect(await fs.exists(nested)).toBe(true);
    const dirStat = await fs.stat(path.dirname(nested));
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it("readKeystore with custom path works", async () => {
    const custom = path.join(tempConfigDir, "custom.json");
    const data: store.Keystore = {
      version: "1.0",
      projects: { "/proj": { "id1": { publicKey: "P", privateKey: "X" } } },
    };
    await store.writeKeystore(data, custom);
    const read = await store.readKeystore(custom);
    expect(read).toEqual(data);
  });

  it("validateKeystoreVersion rejects missing version field", () => {
    expect(() => store.validateKeystoreVersion({ projects: {} })).toThrow(
      /Unsupported keystore version/
    );
  });

  it("getProjectKeystore returns identities for the current project", async () => {
    const pks: store.KeystoreProjectStore = {
      "test-id": { publicKey: "PUB", privateKey: "PRIV" },
    };
    await store.writeKeystore({
      version: "1.0",
      projects: { [tempProjectDir]: pks },
    });
    expect(await store.getProjectKeystore()).toEqual(pks);
  });

  it("getProjectKeystore returns empty object for unknown project", async () => {
    await store.writeKeystore({ version: "1.0", projects: {} });
    expect(await store.getProjectKeystore()).toEqual({});
  });

  it("writeProjectKeystore persists project-scoped identities", async () => {
    const pks: store.KeystoreProjectStore = {
      "my-id": { publicKey: "P", privateKey: "K" },
    };
    await store.writeProjectKeystore(pks);
    expect(await store.getProjectKeystore()).toEqual(pks);
    const ks = await store.readKeystore();
    expect(ks.projects[await fs.realpath(tempProjectDir)]).toEqual(pks);
  });

  it("getProjectKeystore uses cwd when SENV_PROJECT_DIR is unset", async () => {
    delete process.env.SENV_PROJECT_DIR;
    const prevCwd = process.cwd();
    try {
      process.chdir(tempProjectDir);
      const pks: store.KeystoreProjectStore = {
        "cwd-id": { publicKey: "P", privateKey: "K" },
      };
      await store.writeProjectKeystore(pks);
      expect(await store.getProjectKeystore()).toEqual(pks);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("readProjectConfig uses cwd when SENV_PROJECT_DIR is unset", async () => {
    delete process.env.SENV_PROJECT_DIR;
    const prevCwd = process.cwd();
    try {
      process.chdir(tempProjectDir);
      const config: store.SenvProjectConfig = {
        version: "1.0",
        identities: { "id1": "encrypted" },
      };
      await store.writeProjectConfig(config);
      expect(await store.readProjectConfig()).toEqual(config);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("readKeystore wraps non-ENOENT read errors", async () => {
    const keystorePath = path.join(tempConfigDir, "identity.json");
    await fs.mkdir(keystorePath, { recursive: true });
    await expect(store.readKeystore()).rejects.toThrow(/Failed to read keystore/);
  });

  it("readProjectConfig wraps non-ENOENT read errors", async () => {
    const configPath = path.join(tempProjectDir, ".senv.json");
    await fs.mkdir(configPath, { recursive: true });
    await expect(store.readProjectConfig()).rejects.toThrow(/Failed to read \.senv\.json/);
  });

  it("readProjectConfig with invalid JSON throws a clear error", async () => {
    const configPath = path.join(tempProjectDir, ".senv.json");
    await fs.writeFile(configPath, "{ this is not valid JSON", "utf-8");
    await expect(store.readProjectConfig()).rejects.toThrow(/Failed to parse \.senv\.json JSON/);
  });

  it("readProjectConfig throws on unsupported version", async () => {
    const configPath = path.join(tempProjectDir, ".senv.json");
    await fs.writeFile(configPath, JSON.stringify({ version: "99.0", identities: {} }), "utf-8");
    await expect(store.readProjectConfig()).rejects.toThrow(/Unsupported \.senv\.json version/);
  });

  it("readProjectConfig rejects malformed identities", async () => {
    await fs.writeFile(
      path.join(tempProjectDir, ".senv.json"),
      JSON.stringify({ version: "1.0", identities: { foo: 123 } }),
      "utf-8"
    );
    await expect(store.readProjectConfig()).rejects.toThrow(/identities\['foo'\]/);
  });

  it("readProjectConfig rejects malformed presets", async () => {
    await fs.writeFile(
      path.join(tempProjectDir, ".senv.json"),
      JSON.stringify({ version: "1.0", identities: {}, presets: { backend: "not-array" } }),
      "utf-8"
    );
    await expect(store.readProjectConfig()).rejects.toThrow(/presets\['backend'\]/);
  });

  it("writeProjectConfig creates file with 0600 permissions", async () => {
    const config: store.SenvProjectConfig = {
      version: "1.0",
      identities: { "id1": "encrypted" },
    };
    await store.writeProjectConfig(config);
    const stats = await fs.stat(path.join(tempProjectDir, ".senv.json"));
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("atomicWriteFile removes tmp file and rethrows on write failure", async () => {
    const target = path.join(tempProjectDir, "atomic-fail.json");
    const tmpPath = target + ".tmp";
    const realOpen = fs.open.bind(fs);
    const openSpy = spyOn(fs, "open").mockImplementation(async (filePath, flags, mode) => {
      const fh = await realOpen(filePath as string, flags as string, mode as number);
      spyOn(fh, "writeFile").mockRejectedValue(new Error("simulated write failure"));
      return fh;
    });

    await expect(store.atomicWriteFile(target, "data", 0o600)).rejects.toThrow("simulated write failure");
    expect(await fs.exists(tmpPath)).toBe(false);
    expect(await fs.exists(target)).toBe(false);
    openSpy.mockRestore();
  });

  it("writes and reads project config with presets", async () => {
    const config: store.SenvProjectConfig = {
      version: "1.0",
      presets: { backend: ["API_KEY", "DB_URL"] },
      identities: { "id1": "encrypted" },
    };
    await store.writeProjectConfig(config);
    expect(await store.readProjectConfig()).toEqual(config);
  });

  it("readProjectConfig falls back to git root when .senv.json is missing in cwd", async () => {
    await requireGitRepo(tempProjectDir);

    const config: store.SenvProjectConfig = {
      version: "1.0",
      identities: { "id1": "encrypted" },
    };
    await fs.writeFile(path.join(tempProjectDir, ".senv.json"), JSON.stringify(config));

    const subdir = path.join(tempProjectDir, "deep", "nested");
    await fs.mkdir(subdir, { recursive: true });

    delete process.env.SENV_PROJECT_DIR;
    const prevCwd = process.cwd();
    try {
      process.chdir(subdir);
      const result = await store.readProjectConfig();
      expect(result).toEqual(config);
    } finally {
      process.chdir(prevCwd);
      process.env.SENV_PROJECT_DIR = tempProjectDir;
    }
  });

  it("readProjectConfig skips git root fallback when SENV_PROJECT_DIR is set", async () => {
    await requireGitRepo(tempProjectDir);

    const config: store.SenvProjectConfig = {
      version: "1.0",
      identities: { "id1": "encrypted" },
    };
    await fs.writeFile(path.join(tempProjectDir, ".senv.json"), JSON.stringify(config));

    const subdir = path.join(tempProjectDir, "nested");
    await fs.mkdir(subdir, { recursive: true });

    process.env.SENV_PROJECT_DIR = subdir;

    const prevCwd = process.cwd();
    try {
      process.chdir(subdir);
      await expect(store.readProjectConfig()).rejects.toThrow(".senv.json not found");
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("resolveProjectDir returns git root when config exists only at repository root", async () => {
    await requireGitRepo(tempProjectDir);

    await fs.writeFile(path.join(tempProjectDir, ".senv.json"), JSON.stringify({ version: "1.0", identities: {} }));

    const subdir = path.join(tempProjectDir, "pkg");
    await fs.mkdir(subdir);

    delete process.env.SENV_PROJECT_DIR;
    const prevCwd = process.cwd();
    try {
      process.chdir(subdir);
      expect(await store.resolveProjectDir()).toBe(await fs.realpath(tempProjectDir));
    } finally {
      process.chdir(prevCwd);
      process.env.SENV_PROJECT_DIR = tempProjectDir;
    }
  });

  it("writeProjectConfig from subdirectory writes to git root config", async () => {
    await requireGitRepo(tempProjectDir);

    const initial: store.SenvProjectConfig = {
      version: "1.0",
      identities: { "id1": "encrypted" },
    };
    await fs.writeFile(path.join(tempProjectDir, ".senv.json"), JSON.stringify(initial));

    const subdir = path.join(tempProjectDir, "pkg");
    await fs.mkdir(subdir);

    const updated: store.SenvProjectConfig = {
      version: "1.0",
      identities: { "id1": "updated" },
      presets: { backend: ["API_KEY"] },
    };

    delete process.env.SENV_PROJECT_DIR;
    const prevCwd = process.cwd();
    try {
      process.chdir(subdir);
      await store.writeProjectConfig(updated);
      expect(await fs.exists(path.join(subdir, ".senv.json"))).toBe(false);
      const rootConfig = JSON.parse(await fs.readFile(path.join(tempProjectDir, ".senv.json"), "utf-8"));
      expect(rootConfig).toEqual(updated);
    } finally {
      process.chdir(prevCwd);
      process.env.SENV_PROJECT_DIR = tempProjectDir;
    }
  });

  it("getProjectKeystore from subdirectory uses git root project path", async () => {
    await requireGitRepo(tempProjectDir);

    await fs.writeFile(path.join(tempProjectDir, ".senv.json"), JSON.stringify({ version: "1.0", identities: {} }));

    const pks: store.KeystoreProjectStore = {
      "root-id": { publicKey: "PUB", privateKey: "PRIV" },
    };
    await store.writeKeystore({
      version: "1.0",
      projects: { [tempProjectDir]: pks },
    });

    const subdir = path.join(tempProjectDir, "pkg");
    await fs.mkdir(subdir);

    delete process.env.SENV_PROJECT_DIR;
    const prevCwd = process.cwd();
    try {
      process.chdir(subdir);
      expect(await store.getProjectKeystore()).toEqual(pks);
    } finally {
      process.chdir(prevCwd);
      process.env.SENV_PROJECT_DIR = tempProjectDir;
    }
  });

  it("writeProjectKeystore from subdirectory persists under git root path", async () => {
    await requireGitRepo(tempProjectDir);

    await fs.writeFile(path.join(tempProjectDir, ".senv.json"), JSON.stringify({ version: "1.0", identities: {} }));

    const subdir = path.join(tempProjectDir, "pkg");
    await fs.mkdir(subdir);

    const pks: store.KeystoreProjectStore = {
      "sub-id": { publicKey: "P", privateKey: "K" },
    };

    delete process.env.SENV_PROJECT_DIR;
    const prevCwd = process.cwd();
    try {
      process.chdir(subdir);
      await store.writeProjectKeystore(pks);
      const ks = await store.readKeystore();
      expect(ks.projects[await fs.realpath(tempProjectDir)]).toEqual(pks);
      expect(ks.projects[await fs.realpath(subdir)]).toBeUndefined();
    } finally {
      process.chdir(prevCwd);
      process.env.SENV_PROJECT_DIR = tempProjectDir;
    }
  });
});
