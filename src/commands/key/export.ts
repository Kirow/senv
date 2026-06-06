import { Command } from "commander";
import * as senvCrypto from "../../core/crypto";
import * as store from "../../core/store";
import { getCommandOptions, isValidIdentityName } from "../utils";

export const keyExportCmd = new Command("export")
  .argument("<ID_NAME>", "Name of the identity")
  .option("--decrypt-only", "Export only the private key for decrypt-only access")
  .description("Exports an identity's keys as a Base64 string")
  .action(async (idName, options, command) => {
    const { keystorePath } = getCommandOptions(command);

    try {
      if (!isValidIdentityName(idName)) {
        console.error(`Invalid identity name '${idName}'. Use letters, digits, '.', '_' or '-' only.`);
        process.exit(1);
      }

      const projectKeystore = await store.getProjectKeystore(keystorePath);
      if (!projectKeystore[idName]) {
        console.error(`Identity '${idName}' not found in local project keystore.`);
        process.exit(1);
      }

      const { publicKey, privateKey } = projectKeystore[idName];

      const expPub = options.decryptOnly ? "" : publicKey;
      const expPriv = privateKey;

      const b64 = senvCrypto.encodeKeyPairBase64(idName, expPub, expPriv);
      console.log(b64);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
