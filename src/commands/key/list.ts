import { Command } from "commander";
import { getAccessiblePayloads, getCommandOptions } from "../utils";

function mask(value: string): string {
  if (value.length <= 8) return "***";
  return value.slice(0, 1) + "***" + value.slice(-1);
}

export const keyListCmd = new Command("list")
  .option("-i, --identity <name>", "Restrict output to a single identity")
  .description("Lists keys for the target environment with masked values")
  .action(async (options, command) => {
    const { env, keystorePath, envExplicit } = getCommandOptions(command);
    const wantedIdentity = options.identity as string | undefined;
    const allEnvironments = Boolean(wantedIdentity && !envExplicit);

    try {
      const payloads = await getAccessiblePayloads(env, keystorePath, !allEnvironments);

      if (allEnvironments) {
        const byEnv = new Map<string, { key: string; value: string }[]>();
        for (const { identityName, payload } of payloads) {
          if (identityName !== wantedIdentity) continue;
          for (const item of payload) {
            if (!byEnv.has(item.environment)) byEnv.set(item.environment, []);
            byEnv.get(item.environment)!.push({ key: item.key, value: item.value });
          }
        }

        if (byEnv.size === 0) {
          console.log(`No keys found for identity '${wantedIdentity}'.`);
          return;
        }

        const envNames = Array.from(byEnv.keys()).sort((a, b) => a.localeCompare(b));
        for (const envName of envNames) {
          const keys = byEnv.get(envName)!;
          keys.sort((a, b) => a.key.localeCompare(b.key));
          console.log(`\nKeys for environment '${envName}' [${wantedIdentity}]:`);
          for (const entry of keys) {
            console.log(`${entry.key} = ${mask(entry.value)}`);
          }
        }
        return;
      }

      const aggregated: Record<string, { value: string; identityName: string; identities: string[] }> = {};

      for (const { identityName, payload } of payloads) {
        if (wantedIdentity && identityName !== wantedIdentity) continue;
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

      if (!wantedIdentity) {
        for (const [key, data] of Object.entries(aggregated)) {
          if (data.identities.length > 1) {
            console.warn(
              `[WARN] Conflict for key '${key}': defined in ${data.identities.length} identities (${data.identities.join(", ")}). Showing value from '${data.identityName}'. Pass -i/--identity to disambiguate.`
            );
          }
        }
      }

      if (Object.keys(aggregated).length === 0) {
        if (wantedIdentity) {
          console.log(`No keys found for environment '${env}' in identity '${wantedIdentity}'.`);
        } else {
          console.log(`No keys found for environment '${env}'.`);
        }
        return;
      }

      console.log(`\nKeys for environment '${env}':`);
      for (const [key, data] of Object.entries(aggregated)) {
        console.log(`${key} = ${mask(data.value)} (from: ${data.identityName})`);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
