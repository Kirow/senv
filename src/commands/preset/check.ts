import { Command } from "commander";
import * as store from "../../core/store";
import { getAccessibleKeyMap, getCommandOptions, warnMissingPresetKeys } from "../utils";

export const presetCheckCmd = new Command("check")
  .description("Verifies that preset keys are available for the current environment")
  .action(async (_options, command) => {
    const { env, keystorePath } = getCommandOptions(command);
    try {
      const config = await store.readProjectConfig();
      const presets = config.presets;

      if (!presets || Object.keys(presets).length === 0) {
        console.log("No presets defined.");
        return;
      }

      const accessible = await getAccessibleKeyMap(env, keystorePath);

      for (const [presetName, keys] of Object.entries(presets)) {
        warnMissingPresetKeys(presetName, keys, accessible, env);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
