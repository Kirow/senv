---
name: secure-env-tool
description: >-
  Manage encrypted environment variables with the senv CLI (.senv.json, hybrid
  RSA/AES-GCM). Use when a project has .senv.json, when the user mentions senv
  or secure environment variables, or when adding, reading, sharing, or merging
  encrypted env secrets.
---

# senv — Secure Environment Variables

Terminal CLI for decentralized, encrypted env-var management. Payloads live in `.senv.json` (safe to commit); private keys live in `~/.config/senv/identity.json` (never commit).

## When to use

- Project contains `.senv.json`
- User asks to add, update, list, remove, or load encrypted env vars
- User needs to share access or resolve a `.senv.json` git merge conflict
- User wants AI agents to manage secrets without plain `.env` files in source control

## Security rules for agents

- **Never commit** `identity.json` or any exported private key material
- **Never paste** full secret values or private keys into chat unless the user explicitly asks
- Prefer `senv key list` (masked output) over `senv key get` when inspecting state
- `.senv.json` is encrypted — safe to read and commit; do not try to decode it manually
- Do not hardcode secrets into source files; use `senv key add` and `eval $(senv use)` in shell sessions
- `identity export` output is sensitive — treat it like a private key

## Prerequisites

1. `senv` available on PATH (bundled JS needs Bun at runtime; standalone binary does not)
2. Run from the project root (or set `SENV_PROJECT_DIR`)
3. If `.senv.json` is missing, run `senv init` first

Install this skill into a project: `senv install skill` → `.agents/skills/secure-env-tool/SKILL.md`

## Global flags

| Flag | Default | Purpose |
|------|---------|---------|
| `-e, --env <name>` | `dev` | Target environment (e.g. `prod`, `staging`) |
| `-k, --keystore <path>` | `~/.config/senv/identity.json` | Custom keystore path |

## Naming constraints

- **Identity names:** `/^[A-Za-z0-9._-]+$/` (e.g. `alice-local`)
- **Env var names:** `/^[A-Za-z_][A-Za-z0-9_]*$/` (standard shell identifier)

## Common workflows

### First-time setup

```bash
senv init
```

Creates `.senv.json` and a local RSA keypair. Default identity: `<USER>-local` (sanitized).

### Add or update a secret

```bash
senv key add <identity> API_KEY "secret_value"
senv key add <identity> API_KEY "prod_value" -e prod
```

### Inspect secrets (prefer list over get)

```bash
senv key list
senv key list -e prod
senv key list -i <identity>
```

### Read a single value (only when needed)

```bash
senv key get API_KEY
senv key get API_KEY -e prod -i <identity>
```

When the same key exists in multiple identities, `key get` / `key list` use the first match and warn. Pass `-i` to disambiguate.

### Load vars into the current shell

```bash
eval $(senv use)
eval $(senv use -e prod)
```

`use` may emit conflict warnings on stderr when the same key is defined in multiple identities. These are non-fatal; the first identity's value is used. To resolve, pass `-i <identity>` to `key get` / `key list`.

### Import from a .env file

```bash
senv migrate <identity> .env
senv migrate <identity> .env -e prod
```

Imports only missing keys for the target environment. Skips keys that already exist in the identity's payload. Invalid env var names and values over 16 KB are skipped with a warning on stderr.

### Share access with a teammate

```bash
senv identity export <identity>
senv identity export <identity> --decrypt-only
```

Recipient imports (use `-y` in non-interactive contexts):

```bash
senv identity import "<BASE64_STRING>" -y
```

### Resolve git merge conflicts

```bash
senv merge
senv merge .senv.json .senv.incoming.json
```

Auto-detects conflict markers in `.senv.json`. Without markers, provide both files explicitly.

## Command reference

### `senv init`

Initialize `.senv.json` and create a local keypair if missing. If `.senv.json` already exists, reports keystore mismatches and duplicate keys.

### `senv use`

Output `export KEY=value` lines for `eval $(senv use)`. Aggregates across all decryptable identities for the target env.

### `senv merge [FILE_A] [FILE_B]`

Merge conflicting or separate `.senv.json` files. Default `FILE_A` is `.senv.json` at git root or project dir.

### `senv migrate <ID_NAME> <ENV_FILE>`

Import missing keys from a `.env` file into an identity's payload for the target env. Skips keys that already exist and invalid/oversized values.

### `senv update`

Check for a newer senv release and install it via the install script.

### `senv identity list`

List identity names in `.senv.json`.

### `senv identity add <ID_NAME>`

Generate a keypair and register a new identity.

### `senv identity rm <ID_NAME> [-y]`

Remove identity from `.senv.json` and local keystore. Prompts for confirmation unless `-y`. Aborts without TTY when `-y` is not passed.

### `senv identity export <ID_NAME> [--decrypt-only]`

Print base64-encoded keypair to stdout. `--decrypt-only` exports private key only.

### `senv identity import <BASE64_STRING> [-y]`

Import a base64 keypair into the local keystore. Prompts on overwrite unless `-y`. Aborts without TTY when overwrite would occur and `-y` is not passed.

### `senv key list [-i <identity>]`

List keys for the target env with masked values.

### `senv key get <KEY> [-i <identity>]`

Print plaintext value for a key.

### `senv key add <ID_NAME> <KEY> <VALUE>`

Add or update a key in an identity's payload. Max value size: 16 KB.

### `senv key rm <ID_NAME> <KEY>`

Remove a key from an identity for the target env.

### `senv install skill`

Install this skill file into `.agents/skills/secure-env-tool/SKILL.md` (create or replace).

## How it works (brief)

- AES-256-GCM encrypts the key-value payload
- RSA-2048 (PKCS1_OAEP, SHA-256) encrypts the AES DEK
- Each identity in `.senv.json` is its own encrypted blob for that identity's public key
- Sharing = sharing the private key (export/import), not multi-recipient encryption

## Test and automation

| Variable | Purpose |
|----------|---------|
| `SENV_CONFIG_DIR` | Override keystore directory (default `~/.config/senv`) |
| `SENV_PROJECT_DIR` | Override project root for `.senv.json` lookup |
| `USER` / `USERNAME` | Used by `init` to derive default identity name |

In scripts and CI, always pass `-y` to `identity import` and `identity rm` when stdin is not a TTY.
