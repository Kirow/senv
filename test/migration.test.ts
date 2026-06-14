import { describe, expect, it } from "bun:test";
import { upgradeProjectConfig } from "../src/core/migration";
import { CURRENT_PROJECT_CONFIG_VERSION } from "../src/core/store";
import type { SenvProjectConfig } from "../src/core/store";

describe("upgradeProjectConfig", () => {
  it("upgrades version 1.0 to current", () => {
    const config: SenvProjectConfig = {
      version: "1.0",
      identities: { "alice-local": "encrypted-blob" },
      presets: { backend: ["API_KEY"] },
    };

    const result = upgradeProjectConfig(config);

    expect(result.upgraded).toBe(true);
    expect(result.fromVersion).toBe("1.0");
    expect(result.toVersion).toBe(CURRENT_PROJECT_CONFIG_VERSION);
    expect(result.config.version).toBe("1.1");
    expect(result.config.identities).toEqual({ "alice-local": "encrypted-blob" });
    expect(result.config.presets).toEqual({ backend: ["API_KEY"] });
    expect(config.version).toBe("1.0");
  });

  it("returns upgraded false when already at current version", () => {
    const config: SenvProjectConfig = {
      version: CURRENT_PROJECT_CONFIG_VERSION,
      identities: {},
    };

    const result = upgradeProjectConfig(config);

    expect(result.upgraded).toBe(false);
    expect(result.fromVersion).toBe(CURRENT_PROJECT_CONFIG_VERSION);
    expect(result.toVersion).toBe(CURRENT_PROJECT_CONFIG_VERSION);
    expect(result.config).toBe(config);
  });

  it("preserves public array and extra item fields on upgrade", () => {
    const config: SenvProjectConfig = {
      version: "1.0",
      identities: {},
      public: [
        {
          key: "PUBLIC_URL",
          value: "http://localhost",
          environment: "dev",
          comment: "keep me",
        },
      ],
    };

    const result = upgradeProjectConfig(config);

    expect(result.upgraded).toBe(true);
    expect(result.config.public).toEqual([
      {
        key: "PUBLIC_URL",
        value: "http://localhost",
        environment: "dev",
        comment: "keep me",
      },
    ]);
  });

  it("throws when no migration path exists", () => {
    const config: SenvProjectConfig = {
      version: "9.9",
      identities: {},
    };

    expect(() => upgradeProjectConfig(config)).toThrow(
      "No migration path from .senv.json version '9.9'"
    );
  });
});
