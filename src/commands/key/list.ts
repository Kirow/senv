import { Command } from "commander";
import { getAccessiblePayloads } from "../utils";

export const keyListCmd = new Command("list")
  .description("Lists keys for the target environment with masked values")
  .action(async (options, command) => {
    // commander passes options correctly, but we need the global env flag
    // In commander nested commands, we can access globals by going up
    const parentOpts = command.parent?.optsWithGlobals() || {};
    const globalOpts = command.optsWithGlobals();
    const env = globalOpts.env || parentOpts.env || "dev";
    const keystorePath = globalOpts.keystore || parentOpts.keystore;

    try {
      const payloads = await getAccessiblePayloads(env, keystorePath);
      const aggregated: Record<string, { value: string; identityName: string; count: number }> = {};

      for (const { identityName, payload } of payloads) {
        for (const item of payload) {
          if (aggregated[item.key]) {
            aggregated[item.key].count++;
            console.warn(
              `[WARN] Conflict for key '${item.key}': defined in '${aggregated[item.key].identityName}' and '${identityName}'. Using value from '${aggregated[item.key].identityName}'.`
            );
          } else {
            aggregated[item.key] = { value: item.value, identityName, count: 1 };
          }
        }
      }

      if (Object.keys(aggregated).length === 0) {
        console.log(`No keys found for environment '${env}'.`);
        return;
      }

      console.log(`\nKeys for environment '${env}':`);
      for (const [key, data] of Object.entries(aggregated)) {
        const masked = data.value.length > 4 ? data.value.slice(0, 2) + "***" + data.value.slice(-2) : "***";
        console.log(`${key}=${masked} (from: ${data.identityName})`);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
