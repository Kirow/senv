import { Command } from "commander";
import { PUBLIC_IDENTITY_LABEL } from "../../core/store";
import {
  getAccessiblePayloads,
  getPublicListEntries,
  getCommandOptions,
} from "../utils";

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

type FlatEntry = {
  key: string;
  value: string;
  environment: string;
  identityName: string;
  isPublic: boolean;
};

/**
 * @param a - First entry.
 * @param b - Second entry.
 * @returns Comparison for sort by `(environment, key)`.
 */
function compareByEnvironmentThenKey(a: FlatEntry, b: FlatEntry): number {
  const envCmp = a.environment.localeCompare(b.environment);
  if (envCmp !== 0) return envCmp;
  return a.key.localeCompare(b.key);
}

export const keyListCmd = new Command("list")
  .option("-i, --identity <name>", "Restrict output to a single identity (or 'public')")
  .description("Lists keys for the target environment with masked values (public values shown in plaintext)")
  .action(async (options, command) => {
    const { env, keystorePath, envExplicit } = getCommandOptions(command);
    const wantedIdentity = options.identity as string | undefined;
    const filterByEnv = envExplicit;

    try {
      const publicPayloads = await getPublicListEntries(env, filterByEnv);
      const encryptedPayloads = await getAccessiblePayloads(env, keystorePath, filterByEnv);

      const entries: FlatEntry[] = [];
      for (const { identityName, payload } of [...publicPayloads, ...encryptedPayloads]) {
        if (wantedIdentity && identityName !== wantedIdentity) continue;
        for (const item of payload) {
          entries.push({
            key: item.key,
            value: item.value,
            environment: item.environment,
            identityName,
            isPublic: identityName === PUBLIC_IDENTITY_LABEL,
          });
        }
      }

      entries.sort(compareByEnvironmentThenKey);

      if (entries.length === 0) {
        const where: string[] = [];
        if (envExplicit) where.push(`environment '${env}'`);
        if (wantedIdentity) where.push(`identity '${wantedIdentity}'`);
        console.log(`No keys found${where.length > 0 ? ` for ${where.join(" in ")}` : ""}.`);
        return;
      }

      const keyIdMap = new Map<string, Set<string>>();
      for (const e of entries) {
        const ck = `${e.environment}:${e.key}`;
        if (!keyIdMap.has(ck)) keyIdMap.set(ck, new Set());
        keyIdMap.get(ck)!.add(e.identityName);
      }

      let lastGroupKey = "";
      let firstGroup = true;

      for (const entry of entries) {
        const groupKey = `${entry.environment}\0${entry.identityName}`;
        if (groupKey !== lastGroupKey) {
          if (!wantedIdentity && entry.identityName !== PUBLIC_IDENTITY_LABEL) {
            const ck = `${entry.environment}:${entry.key}`;
            const allIds = keyIdMap.get(ck);
            if (allIds && allIds.size > 1) {
              const sortedIds = Array.from(allIds).sort((a, b) => a.localeCompare(b));
              console.warn(
                `[WARN] Conflict for key '${entry.key}': defined in ${sortedIds.length} sources (${sortedIds.join(", ")}). Showing value from '${entry.identityName}'. Pass -i/--identity to disambiguate.`
              );
            }
          }

          console.log(
            `${firstGroup ? "" : "\n"}Keys for environment '${entry.environment}' [${entry.identityName}]:`
          );
          firstGroup = false;
          lastGroupKey = groupKey;
        }

        const displayValue = entry.isPublic ? entry.value : mask(entry.value);
        console.log(`${entry.key} = ${displayValue}`);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
