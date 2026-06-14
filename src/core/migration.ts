import {
  type SenvProjectConfig,
  CURRENT_PROJECT_CONFIG_VERSION,
} from "./store";

/** Result of applying project-config schema migrations up to {@link CURRENT_PROJECT_CONFIG_VERSION}. */
export interface ProjectConfigUpgradeResult {
  config: SenvProjectConfig;
  upgraded: boolean;
  fromVersion: string;
  toVersion: string;
}

/** One step in the ordered `.senv.json` schema migration chain. */
interface ProjectConfigMigration {
  from: string;
  to: string;
  migrate: (config: SenvProjectConfig) => SenvProjectConfig;
}

/** Ordered migrations from legacy versions to {@link CURRENT_PROJECT_CONFIG_VERSION}. */
const PROJECT_CONFIG_MIGRATIONS: ProjectConfigMigration[] = [
  {
    from: "1.0",
    to: "1.1",
    migrate: (config) => ({ ...config, version: "1.1" }),
  },
];

/**
 * Upgrades a parsed `.senv.json` to {@link CURRENT_PROJECT_CONFIG_VERSION} by walking
 * {@link PROJECT_CONFIG_MIGRATIONS}. Does not mutate the input config.
 *
 * @param config - Validated project config (any supported legacy version).
 * @returns Upgraded config and whether any migration step ran.
 * @throws When no migration path exists from `config.version` to the current version.
 */
export function upgradeProjectConfig(config: SenvProjectConfig): ProjectConfigUpgradeResult {
  const fromVersion = config.version;

  if (config.version === CURRENT_PROJECT_CONFIG_VERSION) {
    return {
      config,
      upgraded: false,
      fromVersion,
      toVersion: CURRENT_PROJECT_CONFIG_VERSION,
    };
  }

  let current = config;

  while (current.version !== CURRENT_PROJECT_CONFIG_VERSION) {
    const step = PROJECT_CONFIG_MIGRATIONS.find((m) => m.from === current.version);
    if (!step) {
      throw new Error(
        `No migration path from .senv.json version '${current.version}' to '${CURRENT_PROJECT_CONFIG_VERSION}'.`
      );
    }
    current = step.migrate(current);
  }

  return {
    config: current,
    upgraded: true,
    fromVersion,
    toVersion: CURRENT_PROJECT_CONFIG_VERSION,
  };
}
