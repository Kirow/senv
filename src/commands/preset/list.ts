import { Command } from "commander";
import * as store from "../../core/store";

export const presetListCmd = new Command("list")
  .description("Lists all defined presets and their keys")
  .action(async () => {
    try {
      const config = await store.readProjectConfig();
      const presets = config.presets;

      if (!presets || Object.keys(presets).length === 0) {
        console.log("No presets defined.");
        return;
      }

      for (const [presetName, keys] of Object.entries(presets).sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`${presetName}: ${keys.join(", ")}`);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
