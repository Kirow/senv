import { Command } from "commander";
import * as crypto from "../core/crypto";
import * as store from "../core/store";
import { type SenvProjectConfig } from "../core/store";
import * as fs from "node:fs";

export const initCmd = new Command("init")
  .description("Initializes a new .senv.jsonc and creates a local keypair if missing")
  .action(async (options, command) => {
    const keystorePath = command.optsWithGlobals().keystore;
    const projectKeystore = await store.getProjectKeystore(keystorePath);
    const configPath = store.getProjectConfigPath();

    if (fs.existsSync(configPath)) {
      console.log(".senv.jsonc already exists.");
      try {
        const config = await store.readProjectConfig();
        const configIdentities = Object.keys(config.identities);
        const missingKeys = configIdentities.filter(id => !projectKeystore[id]);
        
        if (missingKeys.length > 0) {
          console.warn("\n[WARNING] The following identities are in .senv.jsonc but are missing from your local keystore:");
          missingKeys.forEach(id => console.warn(`- ${id}`));
          console.warn("You will not be able to decrypt payloads or add new keys to these identities.");
        } else {
          console.log("All identities have matching keys in your local keystore.");
        }
      } catch (err: any) {
        console.error("Failed to read existing project config:", err.message);
      }
      return;
    }

    let userEmail = process.env.USER || "user";
    const idName = `${userEmail}-local`;

    if (!projectKeystore[idName]) {
      console.log(`Generating new RSA keypair for identity: ${idName}...`);
      const keypair = crypto.generateRSAKeyPair();
      projectKeystore[idName] = keypair;
      await store.writeProjectKeystore(projectKeystore, keystorePath);
    }

    console.log("Creating .senv.jsonc...");
    const config: SenvProjectConfig = {
      version: "1.0",
      identities: {},
    };
    
    const emptyEncrypted = crypto.encryptPayload([], projectKeystore[idName].publicKey);
    config.identities[idName] = emptyEncrypted;
    await store.writeProjectConfig(config);
    console.log(`Initialized successfully. Identity '${idName}' added.`);
  });
