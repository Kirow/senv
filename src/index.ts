#!/usr/bin/env bun
import { Command } from "commander";

import { initCmd } from "./commands/init";
import { exportCmd } from "./commands/export";
import { migrateCmd } from "./commands/migrate";

import { identityListCmd } from "./commands/identity/list";
import { identityAddCmd } from "./commands/identity/add";
import { identityRmCmd } from "./commands/identity/rm";

import { keyListCmd } from "./commands/key/list";
import { keyGetCmd } from "./commands/key/get";
import { keyAddCmd } from "./commands/key/add";
import { keyRmCmd } from "./commands/key/rm";
import { keyExportCmd } from "./commands/key/export";
import { keyImportCmd } from "./commands/key/import";

const program = new Command();

program
  .name("senv")
  .description("Secure environment variables manager using hybrid RSA/AES-GCM encryption")
  .version("1.0.0");

program.option("-e, --env <env>", "Target environment", "dev");
program.option("-k, --keystore <path>", "Custom path to identity.json keystore");

program.addCommand(initCmd);
program.addCommand(exportCmd);
program.addCommand(migrateCmd);

const identityGroup = new Command("identity").description("Manage identities");
identityGroup.addCommand(identityListCmd);
identityGroup.addCommand(identityAddCmd);
identityGroup.addCommand(identityRmCmd);
program.addCommand(identityGroup);

const keyGroup = new Command("key").description("Manage keys");
keyGroup.addCommand(keyListCmd);
keyGroup.addCommand(keyGetCmd);
keyGroup.addCommand(keyAddCmd);
keyGroup.addCommand(keyRmCmd);
keyGroup.addCommand(keyExportCmd);
keyGroup.addCommand(keyImportCmd);
program.addCommand(keyGroup);

program.parse(process.argv);
