---
name: secure-env-tool
description: >-
  Manage encrypted environment variables with the senv CLI (.senv.json, hybrid
  RSA/AES-GCM). Use when a project has .senv.json, when the user mentions senv
  or secure environment variables, or when adding, reading, sharing, or merging
  encrypted env secrets, or public plaintext config values in .senv.json.
---

# senv — Secure Environment Variables

Terminal CLI for decentralized, encrypted env-var management. Payloads live in `.senv.json` (safe to commit); private keys live in `~/.config/senv/identity.json` (never commit).

## When to use

- Project contains `.senv.json`
- User asks to add, update, list, remove, or load encrypted env vars
- User asks to add or list **public** (non-secret) values such as URLs, modes, or feature flags visible in `.senv.json`
- User wants named subsets of keys (`preset`) for `senv use <preset>`
- User needs to share access or resolve a `.senv.json` git merge conflict
- User wants AI agents to manage secrets without plain `.env` files in source control

## Security rules for agents

- **Never commit** `identity.json` or any exported private key material
- **Never paste** full secret values or private keys into chat unless the user explicitly asks
- Prefer `senv key list` (masked output for secrets; public values shown in plaintext) over `senv key get` when inspecting state
- `.senv.json` encrypts per-identity secrets; the optional `public` array is **plaintext** in the file — safe for URLs/modes, not for secrets
- Do not put secrets in `public`; use `senv key add --public` only for non-sensitive team config
- Do not hardcode secrets into source files; use `senv key add` and `eval $(senv use)` in shell sessions
- `identity export` output is sensitive — treat it like a private key

## Prerequisites

1. `senv` available on PATH (bundled JS needs Bun at runtime; standalone binary does not)
2. A project with `.senv.json` — run from the repo root, a subdirectory (senv walks up to the git root when cwd has no config), or set `SENV_PROJECT_DIR`
3. If `.senv.json` is missing, run `senv init` first (typically at the git repository root)

### Project directory resolution

Unless `SENV_PROJECT_DIR` is set:

1. **cwd** if `.senv.json` exists there
2. **Git repository root** if cwd has no config but the root does
3. **cwd** otherwise

If both cwd and the git root have `.senv.json`, **cwd wins** (per-package configs in monorepos).

Install this skill into a project: `senv install skill` → `.agents/skills/secure-env-tool/SKILL.md`

## Global flags

| Flag | Default | Purpose |
|------|---------|---------|
| `-e, --env <name>` | `dev` | Target environment (e.g. `prod`, `staging`) |
| `-k, --keystore <path>` | `~/.config/senv/identity.json` | Custom keystore path |

## Naming constraints

- **Identity names:** `/^[A-Za-z0-9._-]+$/` (e.g. `alice-local`). The name `public` is **reserved** (used as the label for project-wide public keys in `key list -i public`).
- **Preset names:** same rules as identity names
- **Env var names:** `/^[A-Za-z_][A-Za-z0-9_]*$/` (standard shell identifier)

## Public vs encrypted values

`.senv.json` (schema `1.1`) supports two storage modes for env vars:

| | **Encrypted** (`identities`) | **Public** (`public` array) |
|--|------------------------------|-----------------------------|
| Storage | Per-identity RSA/AES-GCM blob | Plaintext JSON array |
| Who can read | Holders of that identity's private key | Anyone with the repo (no keystore) |
| CLI write | `senv key add <identity> KEY VALUE` | `senv key add --public KEY VALUE` |
| `key list` | Masked (`a***y`) | Full plaintext |
| Use case | API keys, passwords, tokens | URLs, modes, feature flags |

Each record uses the same shape: `{ "key", "value", "environment" }`. Public items may include extra fields (e.g. future `comment`) preserved on round-trip.

**Mutual exclusivity:** For a given `environment:key`, a value lives in **either** `public` **or** an encrypted identity — not both. Enforced when you can decrypt the relevant identities locally. If a teammate's encrypted blob uses the same key and you lack their private key, `senv` cannot detect the overlap; review `.senv.json` in git before adding public values.

**Precedence in `use` / `get`:** Public values win when both exist (should not happen if exclusivity is enforced).

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

### Add or update a public (non-secret) value

No identity or keystore required. Values are stored in plaintext under `public` in `.senv.json`.

```bash
senv key add --public PUBLIC_URL "http://localhost:3000"
senv key add --public LOG_LEVEL "debug" -e prod
senv key rm --public PUBLIC_URL
```

### Inspect secrets (prefer list over get)

```bash
senv key list           # all environments; public plaintext, secrets masked
senv key list -e prod   # prod env only
senv key list -i <identity>  # single identity (or `public` for public keys only)
senv key list -e prod -i public
```

Output is grouped `Keys for environment 'ENV' [IDENTITY]:`. Entries are sorted by `(environment, key)`. Conflict warnings emitted on stderr.

### Read a single value (only when needed)

```bash
senv key get API_KEY
senv key get PUBLIC_URL          # checks public first, then encrypted identities
senv key get API_KEY -e prod -i <identity>
```

When the same key exists in multiple identities, `key get` / `key list` use the first match and warn. Pass `-i` to disambiguate. For public keys, `-i public` or omit `-i` (public is checked first).

### Load vars into the current shell

```bash
eval $(senv use)
eval $(senv use -e prod)
eval $(senv use backend)
```

`use` may emit conflict warnings on stderr when the same key is defined in multiple identities. These are non-fatal; the first identity's value is used. To resolve, pass `-i <identity>` to `key get` / `key list`.

Without a preset name, `use` exports public values plus decrypted secrets for the target env. Works for public keys even without a keystore. With a preset name, `use` exports only keys listed in that preset (stored in plaintext under `presets` in `.senv.json`). Missing or undecryptable keys emit `[WARN]` on stderr; export continues for available keys.

### Manage presets

Presets are plaintext key-name lists in `.senv.json` (safe to commit). They do not need to exist as secrets yet when added.

```bash
senv preset add backend API_KEY DB_URL
senv preset add backend REDIS_URL
senv preset rm backend DB_URL
senv preset rm backend
senv preset list
senv preset check
senv preset check --strict
```

- `preset add` is incremental (dedupes; does not remove existing keys)
- `preset rm <name>` deletes the whole preset; `preset rm <name> KEY ...` removes specific keys
- `preset list` shows all defined presets and their keys
- `preset check` warns for each missing key across all presets for the target env (exit 0). `--strict` exits 1 if any keys are missing.

### Import from a .env file

```bash
# Into an encrypted identity
senv migrate <identity> .env
senv migrate <identity> .env -e prod

# Into the public section (no identity)
senv migrate --public .env
senv migrate --public .env -e prod
```

Imports only missing keys for the target environment. Skips keys that already exist. Invalid env var names and values over 16 KB are skipped with a warning on stderr. Respects public/encrypted mutual exclusivity for locally decryptable identities.

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

**Identities only:** `senv merge` decrypts, unions, and re-encrypts `identities` blobs. It does **not** merge `public` or `presets`.

- Resolve conflicts in `public`, `presets`, and other plaintext sections with normal git merge tools (before or after `senv merge`).
- When identity conflict markers are present, `senv merge` **preserves** an intact `public` array from outside the conflict block (same as `presets`). It does not wipe plaintext sections.
- Incoming `public` from `FILE_B` is ignored; use git to reconcile plaintext.

Auto-detects conflict markers in `.senv.json`. Without markers, provide both files explicitly.

## Command reference

### `senv init`

Initialize `.senv.json` and create a local keypair if missing. If `.senv.json` already exists, reports keystore mismatches and duplicate keys.

### `senv use [PRESET_NAME]`

Output `export KEY=value` lines for `eval $(senv use)`. Without a preset, aggregates **public** values plus decrypted identity secrets for the target env. With a preset name, exports only keys in that preset (in list order). Warns on stderr for missing preset keys.

### `senv merge [FILE_A] [FILE_B]`

Merge conflicting or separate `.senv.json` **identity** blobs. Preserves intact `public` / `presets` from outside conflict markers; does not auto-merge plaintext sections. Default `FILE_A` is `.senv.json` in the resolved project directory.

### `senv migrate [ID_NAME] <ENV_FILE> [--public]`

Import missing keys from a `.env` file. With `--public`, imports into the `public` array (no identity). Otherwise requires `ID_NAME`. Skips existing keys and invalid/oversized values.

### `senv upgrade`

Upgrade `.senv.json` to the current schema version (e.g. `1.0` → `1.1`). Idempotent when already current. Not `.env` import (`migrate`) or CLI self-update (`update`).

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

List keys grouped by environment and identity (`[public]` or `[<identity>]`). Public values in plaintext; secrets masked. Sorted by `(environment, key)`. Without `-e`, shows all environments. Conflict warnings on stderr.

### `senv key get <KEY> [-i <identity>]`

Print plaintext value. Checks `public` for the target env first, then decrypted identities.

### `senv key add [ID_NAME] <KEY> <VALUE> [--public]`

Add or update a key. With `--public`, writes to the project-wide `public` array (no identity/keystore). Otherwise requires `ID_NAME` and encrypts into that identity. Max value size: 16 KB. Public and encrypted keys are mutually exclusive per `environment:key`.

### `senv key rm [ID_NAME] <KEY> [--public]`

Remove a key. With `--public`, removes from the `public` array. Otherwise requires `ID_NAME` and re-encrypts the identity payload.

### `senv preset add <PRESET_NAME> <KEY...>`

Add keys to a preset (incremental, deduped). Does not require keys to exist in the payload yet.

### `senv preset list`

List all defined presets and their keys.

### `senv preset rm <PRESET_NAME> [KEY...]`

Remove an entire preset, or specific keys from it. Deletes the preset entry when the key list becomes empty.

### `senv preset check`

Warn on stderr for each preset key that is missing or not decryptable for the target env. With `--strict`, exits 1 if any keys are missing.

### `senv install skill`

Install this skill file into `.agents/skills/secure-env-tool/SKILL.md` (create or replace).

## How it works (brief)

- AES-256-GCM encrypts each identity's key-value payload; RSA-2048 (PKCS1_OAEP, SHA-256) encrypts the AES DEK
- Each identity in `.senv.json` is its own encrypted blob for that identity's public key
- `public` (optional, schema `1.1`) holds project-wide plaintext env vars as an array of `{ key, value, environment }` objects — readable without a keystore
- `presets` (optional) hold plaintext env-var **name** lists for partial `senv use`
- Sharing = sharing the private key (export/import), not multi-recipient encryption
- `senv merge` only merges `identities`; `public` / `presets` conflicts use git merge tools

## Test and automation

| Variable | Purpose |
|----------|---------|
| `SENV_CONFIG_DIR` | Override keystore directory (default `~/.config/senv`) |
| `SENV_PROJECT_DIR` | Override project root; when unset, senv uses cwd or git root per resolution rules above |
| `USER` / `USERNAME` | Used by `init` to derive default identity name |

In scripts and CI, always pass `-y` to `identity import` and `identity rm` when stdin is not a TTY.
