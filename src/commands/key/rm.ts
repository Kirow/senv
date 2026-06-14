import { Command } from "commander";
import * as senvCrypto from "../../core/crypto";
import * as store from "../../core/store";
import { isValidIdentityName, getCommandOptions, requirePublicKeyForEncrypt } from "../utils";

export const keyRmCmd = new Command("rm")
  .argument("[ID_NAME]", "Name of the identity (not used with --public)")
  .argument("[KEY]", "The key to remove")
  .option("--public", "Remove a project-wide public value (no identity required)")
  .description("Removes a key from a specific identity's payload, or a public value with --public")
  .action(async (idName, targetKey, options, command) => {
    const { env, keystorePath } = getCommandOptions(command);
    const isPublic = Boolean(options.public);

    try {
      const config = await store.readProjectConfig();

      if (isPublic) {
        if (idName && targetKey) {
          console.error("Identity name must not be provided with --public.");
          process.exit(1);
        }

        const actualKey = targetKey ?? idName;
        if (!actualKey) {
          console.error("Usage: senv key rm --public <KEY>");
          process.exit(1);
        }

        if (!store.removePublicItem(config, env, actualKey)) {
          console.log(`Public key '${actualKey}' not found for env '${env}'.`);
          return;
        }

        await store.writeProjectConfig(config);
        console.log(`Removed public '${actualKey}' for env '${env}'.`);
        return;
      }

      if (!idName || idName === "") {
        console.error("Identity name is required unless --public is set.");
        process.exit(1);
      }

      if (!isValidIdentityName(idName)) {
        console.error(`Invalid identity name '${idName}'. Use letters, digits, '.', '_' or '-' only.`);
        process.exit(1);
      }

      if (!targetKey) {
        console.error("Usage: senv key rm <ID_NAME> <KEY>");
        process.exit(1);
      }

      const projectKeystore = await store.getProjectKeystore(keystorePath);

      if (!config.identities[idName]) {
        console.error(`Identity '${idName}' is missing from .senv.json.`);
        process.exit(1);
      }

      if (!projectKeystore[idName]) {
        console.error(`Identity '${idName}' has no entry in local keystore.`);
        process.exit(1);
      }

      if (!projectKeystore[idName].privateKey) {
        console.error(`Identity '${idName}' is missing private key in local keystore.`);
        process.exit(1);
      }

      const payload = senvCrypto.decryptPayload(config.identities[idName], projectKeystore[idName].privateKey);
      const filtered = payload.filter((i) => !(i.key === targetKey && i.environment === env));

      if (filtered.length === payload.length) {
        console.log(`Key '${targetKey}' not found in '${idName}' for env '${env}'.`);
        return;
      }

      const publicKey = requirePublicKeyForEncrypt(projectKeystore, idName);
      const newEncrypted = senvCrypto.encryptPayload(filtered, publicKey);
      config.identities[idName] = newEncrypted;

      await store.writeProjectConfig(config);
      console.log(`Removed '${targetKey}' from '${idName}' for env '${env}'.`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
