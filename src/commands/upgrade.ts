import { Command } from "commander";
import { upgradeProjectConfig } from "../core/migration";
import * as store from "../core/store";
import { CURRENT_PROJECT_CONFIG_VERSION } from "../core/store";

/**
 * Reads `.senv.json`, applies schema migrations, and writes back when the version changes.
 *
 * Idempotent when the file is already at {@link CURRENT_PROJECT_CONFIG_VERSION}.
 */
export async function runUpgrade(): Promise<void> {
  const config = await store.readProjectConfig();
  const result = upgradeProjectConfig(config);

  if (result.upgraded) {
    await store.writeProjectConfig(result.config);
    console.log(`Upgraded .senv.json: ${result.fromVersion} -> ${result.toVersion}.`);
    return;
  }

  console.log(`.senv.json is already at version ${CURRENT_PROJECT_CONFIG_VERSION}.`);
}

export const upgradeCmd = new Command("upgrade")
  .description("Upgrade .senv.json to the current schema version")
  .action(async () => {
    try {
      await runUpgrade();
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
