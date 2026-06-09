import { Command } from "commander";
import * as store from "../../core/store";
import { isValidEnvName, isValidPresetName } from "../utils";

export const presetAddCmd = new Command("add")
  .argument("<PRESET_NAME>", "Name of the preset")
  .argument("[keys...]", "Keys to include in the preset")
  .description("Adds keys to a preset (incremental; existing keys are preserved)")
  .action(async (presetName: string, keys: string[]) => {
    try {
      if (!isValidPresetName(presetName)) {
        console.error(`Invalid preset name '${presetName}'. Use letters, digits, '.', '_' or '-' only.`);
        process.exit(1);
      }

      if (keys.length === 0) {
        console.error("At least one key is required.");
        process.exit(1);
      }

      for (const key of keys) {
        if (!isValidEnvName(key)) {
          console.error(`Invalid environment variable name '${key}'. Must match /^[A-Za-z_][A-Za-z0-9_]*$/.`);
          process.exit(1);
        }
      }

      const config = await store.readProjectConfig();
      if (!config.presets) {
        config.presets = {};
      }

      const existing = config.presets[presetName] || [];
      const existingSet = new Set(existing);
      const added: string[] = [];

      for (const key of keys) {
        if (!existingSet.has(key)) {
          existing.push(key);
          existingSet.add(key);
          added.push(key);
        }
      }

      config.presets[presetName] = existing;
      await store.writeProjectConfig(config);

      if (added.length === 0) {
        console.log(`Preset '${presetName}' already contains all specified keys.`);
      } else {
        console.log(`Added ${added.length} key(s) to preset '${presetName}': ${added.join(", ")}.`);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
