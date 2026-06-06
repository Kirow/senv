import { Command } from "commander";
import { getAccessiblePayloads, getCommandOptions } from "../utils";

function mask(value: string): string {
  if (value.length <= 8) return "***";
  return value.slice(0, 1) + "***" + value.slice(-1);
}

export const keyListCmd = new Command("list")
  .description("Lists keys for the target environment with masked values")
  .action(async (options, command) => {
    const { env, keystorePath } = getCommandOptions(command);

    try {
      const payloads = await getAccessiblePayloads(env, keystorePath);
      const aggregated: Record<string, { value: string; identityName: string; identities: string[] }> = {};

      for (const { identityName, payload } of payloads) {
        for (const item of payload) {
          if (aggregated[item.key]) {
            if (!aggregated[item.key].identities.includes(identityName)) {
              aggregated[item.key].identities.push(identityName);
            }
          } else {
            aggregated[item.key] = { value: item.value, identityName, identities: [identityName] };
          }
        }
      }

      for (const [key, data] of Object.entries(aggregated)) {
        if (data.identities.length > 1) {
          console.warn(
            `[WARN] Conflict for key '${key}': defined in ${data.identities.length} identities (${data.identities.join(", ")}). Using value from '${data.identityName}'.`
          );
        }
      }

      if (Object.keys(aggregated).length === 0) {
        console.log(`No keys found for environment '${env}'.`);
        return;
      }

      console.log(`\nKeys for environment '${env}':`);
      for (const [key, data] of Object.entries(aggregated)) {
        console.log(`${key}=${mask(data.value)} (from: ${data.identityName})`);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
