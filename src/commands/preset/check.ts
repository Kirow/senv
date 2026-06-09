import { Command } from "commander";
import * as store from "../../core/store";
import { getAccessibleKeyMap, getCommandOptions, warnMissingPresetKeys } from "../utils";

export const presetCheckCmd = new Command("check")
  .description("Verifies that preset keys are available for the current environment")
  .option("--strict", "Exit with code 1 if any preset keys are missing")
  .action(async (options, command) => {
    const { env, keystorePath } = getCommandOptions(command);
    try {
      const config = await store.readProjectConfig();
      const presets = config.presets;

      if (!presets || Object.keys(presets).length === 0) {
        console.log("No presets defined.");
        return;
      }

      const accessible = await getAccessibleKeyMap(env, keystorePath);
      let totalMissing = 0;

      for (const [presetName, keys] of Object.entries(presets)) {
        totalMissing += warnMissingPresetKeys(presetName, keys, accessible, env);
      }

      if (totalMissing > 0 && options.strict) {
        process.exit(1);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
