import { Command } from "commander";
import * as senvCrypto from "../core/crypto";
import * as store from "../core/store";
import { type KeystoreProjectStore, type SenvProjectConfig } from "../core/store";
import * as conflict from "../core/conflict";
import { getCommandOptions } from "./utils";
import * as fs from "node:fs/promises";

/**
 * Union-merges two preset maps, deduplicating keys within each preset name.
 *
 * @param a - Base preset map (may be undefined).
 * @param b - Incoming preset map to merge in (may be undefined).
 * @returns Merged map, or `undefined` when both inputs are empty/absent.
 */
export function mergePresets(
  a?: Record<string, string[]>,
  b?: Record<string, string[]>
): Record<string, string[]> | undefined {
  if (!a && !b) return undefined;
  const merged: Record<string, string[]> = { ...(a || {}) };
  if (b) {
    for (const [name, keysB] of Object.entries(b)) {
      if (!merged[name]) {
        merged[name] = [...keysB];
      } else {
        const seen = new Set(merged[name]);
        for (const k of keysB) {
          if (!seen.has(k)) {
            merged[name]!.push(k);
            seen.add(k);
          }
        }
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Extracts the `presets` object from the non-conflict prefix or postfix of a conflicted file.
 *
 * Git conflict markers split the `identities` block; `presets` often survive intact outside the markers.
 *
 * @param content - Full conflicted `.senv.json` contents.
 * @returns Parsed presets object, or `undefined` when not found or invalid JSON.
 */
export function extractPresetsFromConflictedContent(content: string): Record<string, string[]> | undefined {
  const firstMarker = content.indexOf("<<<<<<<");
  const lastMarker = content.lastIndexOf(">>>>>>>");
  const prefix = firstMarker >= 0 ? content.slice(0, firstMarker) : content;
  const postfix = lastMarker >= 0
    ? content.slice(content.indexOf("\n", lastMarker) + 1)
    : "";

  const presetsRegex = /"presets"\s*:\s*(\{[\s\S]*?\})\s*,?/;
  const match = prefix.match(presetsRegex) ?? postfix.match(presetsRegex);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]!) as Record<string, string[]>;
  } catch {
    return undefined;
  }
}

/**
 * Merges two project configs at the identity and preset level.
 *
 * Decryptable identities are merged at the payload level; others use the owner-name heuristic
 * via {@link conflict.pickConflictBlobWithoutPrivateKey}. Re-encrypted payloads use the local
 * public key only — other recipients lose access (see AGENTS.md).
 *
 * @param configA - Ours / base config.
 * @param configB - Theirs / incoming config.
 * @param projectKeystore - Local keystore for decrypt/re-encrypt.
 * @param sourceLabel - Human-readable label for log messages (e.g. `"incoming"` or a file path).
 * @param theirsLabel - Git branch name from conflict markers, when applicable.
 * @returns Merged config and human-readable merge summary lines.
 */
export function mergeProjectConfigs(
  configA: SenvProjectConfig,
  configB: SenvProjectConfig,
  projectKeystore: KeystoreProjectStore,
  sourceLabel: string,
  theirsLabel?: string
): { config: SenvProjectConfig; messages: string[] } {
  const merged: SenvProjectConfig = {
    ...configA,
    identities: { ...configA.identities },
    presets: mergePresets(configA.presets, configB.presets),
  };
  const messages: string[] = [];

  for (const [idName, encryptedB] of Object.entries(configB.identities)) {
    if (!merged.identities[idName]) {
      merged.identities[idName] = encryptedB;
      messages.push(`Identity '${idName}' added from ${sourceLabel}.`);
    } else if (merged.identities[idName] !== encryptedB) {
      if (projectKeystore[idName] && projectKeystore[idName].privateKey) {
        const payloadA = senvCrypto.decryptPayload(merged.identities[idName], projectKeystore[idName].privateKey);
        const payloadB = senvCrypto.decryptPayload(encryptedB, projectKeystore[idName].privateKey);

        const mapA = new Map(payloadA.map((i) => [`${i.environment}:${i.key}`, i]));
        for (const itemB of payloadB) {
          mapA.set(`${itemB.environment}:${itemB.key}`, itemB);
        }

        const mergedPayload = Array.from(mapA.values());
        merged.identities[idName] = senvCrypto.encryptPayload(mergedPayload, projectKeystore[idName].publicKey);
        messages.push(`Merged payloads for identity '${idName}'.`);
      } else {
        const encryptedOurs = merged.identities[idName];
        const picked = conflict.pickConflictBlobWithoutPrivateKey(
          idName,
          encryptedOurs,
          encryptedB,
          theirsLabel
        );
        merged.identities[idName] = picked;
        if (picked === encryptedB) {
          messages.push(`Identity '${idName}' kept incoming version (no private key).`);
        } else {
          messages.push(`Identity '${idName}' kept ours version (no private key).`);
        }
      }
    }
  }

  return { config: merged, messages };
}

/** Atomically writes a merged `.senv.json` to `filePath`. */
async function writeMergedConfig(filePath: string, config: SenvProjectConfig): Promise<void> {
  await store.atomicWriteFile(filePath, JSON.stringify(config, null, 2), 0o600);
}

export const mergeCmd = new Command("merge")
  .argument("[FILE_A]", "Primary file (default: .senv.json at git root or project dir)")
  .argument("[FILE_B]", "File to merge from (required when FILE_A has no conflict markers)")
  .description("Resolve git merge conflicts in .senv.json or merge FILE_B identities into FILE_A")
  .action(async (fileA, fileB, _options, command) => {
    const { keystorePath } = getCommandOptions(command);
    const targetPath = fileA ?? await store.getProjectConfigPath();

    try {
      const contentA = await fs.readFile(targetPath, "utf-8");
      const projectKeystore = await store.getProjectKeystore(keystorePath);

      let configA: SenvProjectConfig;
      let configB: SenvProjectConfig;
      let sourceLabel: string;
      let theirsLabel: string | undefined;

      if (conflict.hasGitConflictMarkers(contentA)) {
        const parsed = conflict.parseGitConflictSenv(contentA);
        configA = parsed.ours;
        configB = parsed.theirs;
        sourceLabel = "incoming";
        theirsLabel = parsed.theirsLabel;
      } else if (fileB) {
        const contentB = await fs.readFile(fileB, "utf-8");
        configA = store.validateProjectConfigVersion(JSON.parse(contentA));
        configB = store.validateProjectConfigVersion(JSON.parse(contentB));
        sourceLabel = fileB;
      } else {
        console.error("Merge failed: no git conflict markers in file and FILE_B was not provided.");
        process.exit(1);
      }

      const { config: merged, messages } = mergeProjectConfigs(configA, configB, projectKeystore, sourceLabel, theirsLabel);

      if (conflict.hasGitConflictMarkers(contentA)) {
        const extractedPresets = extractPresetsFromConflictedContent(contentA);
        if (extractedPresets) {
          merged.presets = mergePresets(extractedPresets, merged.presets);
        }
      }

      for (const msg of messages) console.log(msg);
      await writeMergedConfig(targetPath, merged);
      console.log(`Merge complete. Merged into ${targetPath}.`);
    } catch (e: any) {
      if (e.code === "ENOENT") {
        console.error(`Merge failed: file not found: ${targetPath}`);
      } else {
        console.error("Merge failed:", e.message);
      }
      process.exit(1);
    }
  });
