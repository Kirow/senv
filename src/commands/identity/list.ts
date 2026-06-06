import { Command } from "commander";
import * as store from "../../core/store";

export const identityListCmd = new Command("list")
  .description("Lists all identities present in .senv.json")
  .action(async () => {
    try {
      const config = await store.readProjectConfig();
      const ids = Object.keys(config.identities);
      if (ids.length === 0) {
        console.log("No identities found in .senv.json");
        return;
      }
      ids.forEach((id) => console.log(`- ${id}`));
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
