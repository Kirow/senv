import { Command } from "commander";
import { getAccessiblePayloads, getCommandOptions } from "../utils";

/**
 * Masks a secret value for terminal display.
 *
 * @param value - Plaintext secret.
 * @returns `***` for short values, or `x***y` showing first and last character.
 */
function mask(value: string): string {
  if (value.length <= 8) return "***";
  return value.slice(0, 1) + "***" + value.slice(-1);
}

type FlatEntry = { key: string; value: string; environment: string; identityName: string };

export const keyListCmd = new Command("list")
  .option("-i, --identity <name>", "Restrict output to a single identity")
  .description("Lists keys for the target environment with masked values")
  .action(async (options, command) => {
    const { env, keystorePath, envExplicit } = getCommandOptions(command);
    const wantedIdentity = options.identity as string | undefined;

    try {
      const payloads = await getAccessiblePayloads(env, keystorePath, envExplicit);

      const entries: FlatEntry[] = [];
      for (const { identityName, payload } of payloads) {
        if (wantedIdentity && identityName !== wantedIdentity) continue;
        for (const item of payload) {
          entries.push({ key: item.key, value: item.value, environment: item.environment, identityName });
        }
      }

      if (entries.length === 0) {
        const where: string[] = [];
        if (envExplicit) where.push(`environment '${env}'`);
        if (wantedIdentity) where.push(`identity '${wantedIdentity}'`);
        console.log(`No keys found${where.length > 0 ? ` for ${where.join(" in ")}` : ""}.`);
        return;
      }

      const tree = new Map<string, Map<string, FlatEntry[]>>();
      const keyIdMap = new Map<string, Set<string>>();
      for (const e of entries) {
        if (!tree.has(e.environment)) tree.set(e.environment, new Map());
        const envMap = tree.get(e.environment)!;
        if (!envMap.has(e.identityName)) envMap.set(e.identityName, []);
        envMap.get(e.identityName)!.push(e);
        const ck = `${e.environment}:${e.key}`;
        if (!keyIdMap.has(ck)) keyIdMap.set(ck, new Set());
        keyIdMap.get(ck)!.add(e.identityName);
      }

      const envNames = envExplicit
        ? [env]
        : Array.from(tree.keys()).sort((a, b) => a.localeCompare(b));

      let firstGroup = true;
      for (const envName of envNames) {
        const envMap = tree.get(envName);
        if (!envMap) continue;

        const idNames = wantedIdentity
          ? [wantedIdentity]
          : Array.from(envMap.keys()).sort((a, b) => a.localeCompare(b));

        for (const idName of idNames) {
          const keys = envMap.get(idName);
          if (!keys || keys.length === 0) continue;

          keys.sort((a, b) => a.key.localeCompare(b.key));

          if (!wantedIdentity && idNames.length > 1) {
            for (const entry of keys) {
              const ck = `${envName}:${entry.key}`;
              const allIds = keyIdMap.get(ck);
              if (allIds && allIds.size > 1) {
                const sortedIds = [idName, ...Array.from(allIds).filter(id => id !== idName).sort()];
                console.warn(
                  `[WARN] Conflict for key '${entry.key}': defined in ${sortedIds.length} identities (${sortedIds.join(", ")}). Showing value from '${idName}'. Pass -i/--identity to disambiguate.`
                );
              }
            }
          }

          console.log(`${firstGroup ? "" : "\n"}Keys for environment '${envName}' [${idName}]:`);
          firstGroup = false;
          for (const entry of keys) {
            console.log(`${entry.key} = ${mask(entry.value)}`);
          }
        }
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
