import { Command } from "commander";
import * as store from "../../core/store";
import { isValidEnvName, isValidPresetName } from "../utils";

export const presetRmCmd = new Command("rm")
  .argument("<PRESET_NAME>", "Name of the preset")
  .argument("[keys...]", "Keys to remove (omit to delete the entire preset)")
  .description("Removes a preset or specific keys from a preset")
  .action(async (presetName: string, keys: string[]) => {
    try {
      if (!isValidPresetName(presetName)) {
        console.error(`Invalid preset name '${presetName}'. Use letters, digits, '.', '_' or '-' only.`);
        process.exit(1);
      }

      const config = await store.readProjectConfig();
      const preset = config.presets?.[presetName];

      if (!preset) {
        console.error(`Preset '${presetName}' not found.`);
        process.exit(1);
      }

      if (keys.length === 0) {
        delete config.presets![presetName];
        if (Object.keys(config.presets!).length === 0) {
          delete config.presets;
        }
        await store.writeProjectConfig(config);
        console.log(`Removed preset '${presetName}'.`);
        return;
      }

      const keySet = new Set(preset);
      let removed = 0;

      for (const key of keys) {
        if (!isValidEnvName(key)) {
          console.error(`Invalid environment variable name '${key}'. Must match /^[A-Za-z_][A-Za-z0-9_]*$/.`);
          process.exit(1);
        }
        if (keySet.has(key)) {
          keySet.delete(key);
          removed++;
        } else {
          console.log(`Key '${key}' not found in preset '${presetName}'.`);
        }
      }

      if (removed === 0) {
        return;
      }

      const remaining = preset.filter((k) => keySet.has(k));

      if (remaining.length === 0) {
        delete config.presets![presetName];
        if (Object.keys(config.presets!).length === 0) {
          delete config.presets;
        }
      } else {
        config.presets![presetName] = remaining;
      }

      await store.writeProjectConfig(config);
      console.log(`Removed ${removed} key(s) from preset '${presetName}'.`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
