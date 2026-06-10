import { Command } from "commander";
import { execSync } from "node:child_process";
import { compareSemver, fetchLatestVersion } from "../core/release";
import { VERSION, INSTALL_SCRIPT_URL } from "../version";

/**
 * Checks GitHub for a newer release and runs the install script when an update is available.
 *
 * Exits with code 1 when the version check fails. Delegates install failure exit codes to `execSync`.
 */
export async function runUpdate(): Promise<void> {
  let latest: string;
  try {
    latest = await fetchLatestVersion();
  } catch (e: any) {
    console.error(`Failed to check for updates: ${e.message}`);
    process.exit(1);
  }
  if (compareSemver(VERSION, latest) >= 0) {
    console.log(`senv ${VERSION} is already up to date.`);
    return;
  }
  console.log(`Updating senv ${VERSION} -> ${latest}...`);
  try {
    execSync(`curl -fsSL ${INSTALL_SCRIPT_URL} | sh`, { stdio: "inherit" });
  } catch (e: any) {
    process.exit(typeof e.status === "number" ? e.status : 1);
  }
}

export const updateCmd = new Command("update")
  .description("Check for a newer senv release and install it")
  .action(runUpdate);
