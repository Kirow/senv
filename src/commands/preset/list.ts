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

      const entries = Object.entries(presets).sort(([a], [b]) => a.localeCompare(b));

      for (let i = 0; i < entries.length; i++) {
        const [presetName, keys] = entries[i]!;
        if (i > 0) console.log("");
        console.log(`${presetName}:`);
        for (const key of keys) {
          console.log(` - ${key}`);
        }
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
