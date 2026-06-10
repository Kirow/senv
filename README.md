# senv

[![coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Kirow/senv/main/badges/coverage.json)](https://github.com/Kirow/senv/actions/workflows/ci.yml)

`senv` is a secure, decentralized environment variables manager built for the terminal. By utilizing a hybrid RSA/AES-GCM encryption architecture, `senv` allows teams to safely store encrypted environment configurations inside source control (`.senv.json`), while maintaining unique local identities to restrict decryption access.

> **Disclaimer:** This project and its underlying code (including the cryptography logic) were fully AI-generated. While standard cryptography algorithms and practices were used, the codebase has not been audited by a human security professional. Use at your own risk.

## How it Works
Instead of maintaining `.env` files that cannot be safely committed, `senv` encrypts your environment payloads inside `.senv.json`. 
1. **AES-256-GCM** is used to encrypt the key-value payload.
2. **RSA-2048** is used to encrypt the AES Data Encryption Key (DEK).

`.senv.json` stores one encrypted blob **per identity** (e.g., `alice-local`, `bob-local`). Each identity's blob is encrypted with that identity's RSA public key, so only holders of the corresponding private key can decrypt it. Your private keys are kept secure in your local keystore (`~/.config/senv/identity.json`, created with `0600` permissions) and are never committed.

### File structures

**`.senv.json`** (safe to commit):

```json
{
  "version": "1.0",
  "presets": {
    "backend": ["API_KEY", "DB_URL"],
    "frontend": ["PUBLIC_URL"]
  },
  "identities": {
    "alice-local": "<base64 RSA-encrypted AES-GCM payload>",
    "bob-local": "<base64 RSA-encrypted AES-GCM payload>"
  }
}
```

- `identities` — one encrypted blob per identity; values are opaque base64 strings.
- `presets` — optional plaintext lists of env-var **names** (not values); used by `senv use <preset>` and `senv preset`.

**`~/.config/senv/identity.json`** (never commit):

```json
{
  "version": "1.0",
  "projects": {
    "/absolute/path/to/your/project": {
      "alice-local": {
        "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
        "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
      }
    }
  }
}
```

- `projects` — keys are absolute project directory paths; values are identity name → RSA keypair (PEM).
- Override the keystore path with `-k/--keystore` or `SENV_CONFIG_DIR`.

### Project directory resolution

Unless `SENV_PROJECT_DIR` is set, senv resolves the project directory (for `.senv.json` and keystore `projects` keys) in this order:

1. **`SENV_PROJECT_DIR`** — always wins when set.
2. **Current working directory** — when `.senv.json` exists in cwd.
3. **Git repository root** — when cwd has no `.senv.json`, you are inside a git repo, and the repo root has `.senv.json`. Lets you run `senv key add`, `senv use`, etc. from a subdirectory without `cd` to the root.
4. **Current working directory** — fallback when none of the above apply (commands that need an existing file will error).

**Nested configs in one repo:** If both cwd and the git root contain `.senv.json`, **cwd wins**. Use this for monorepos where individual packages keep their own `.senv.json`; keep a single root config when the whole repo shares one file.

## Sharing Access
To allow another team member to access a given identity's secrets, share that identity's private key with them out-of-band (e.g., via a secure channel). They import the base64-encoded keypair into their local keystore with `senv identity import`. There is no automatic key distribution or multi-recipient encryption; each identity is a single-recipient envelope.

> Note: there is currently no command to add a *teammate's public key* to an existing identity. If you want both Alice and Bob to share the same set of secrets under one name, treat it as a shared identity: have one person generate the keypair, distribute the private key (or its decrypt-only export) to the other, and both keep a copy locally.

## Installation

### Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/Kirow/senv/refs/heads/main/scripts/install.sh | sh
```

Downloads the latest release from GitHub, verifies SHA256 checksums, and installs to `~/.local/bin/senv`. If [Bun](https://bun.sh/) is on your `PATH`, the small bundled JS build is used (~60 KB); otherwise a standalone binary is downloaded for your OS/arch (~60 MB, no Bun required). Requires `curl`.

Pin a version: `SENV_VERSION=0.1.0 curl -fsSL ... | sh`

Custom install dir: `SENV_INSTALL_DIR=/usr/local/bin curl -fsSL ... | sh`

*(Make sure `~/.local/bin` is in your `$PATH`!)*

### Prerequisites (build from source)
- [Bun](https://bun.sh/) is required to build from source. The bundled JS install also requires Bun at runtime; the standalone binary does not.

### Build from Source
Clone the repository and pick an install variant:

```bash
git clone https://github.com/your-username/senv.git
cd senv
bun install
```

**Bundled JS (~60 KB, requires Bun at runtime):**
```bash
make install          # or: make install-js
```

**Standalone binary (~60 MB, no Bun required at runtime):**
```bash
make install-standalone
```

Build artifacts only (without installing):
```bash
make build              # bundled JS → dist/senv
make build-standalone   # standalone binary → dist/senv-standalone
make build-all          # both
```
*(Make sure `~/.local/bin` is in your `$PATH`!)*

### Releasing (maintainers)

1. Bump `VERSION` in `src/version.ts`
2. Commit and tag: `git tag v0.1.0 && git push origin v0.1.0`
3. GitHub Actions builds all platform binaries, generates `checksums.sha256`, and publishes the release

## Usage

### 1. Initialize the Project
Run this in the root of your project. It will generate a local RSA keypair (if one doesn't exist) and create `.senv.json`. The default identity name is derived from `$USER` (with non-alphanumeric characters sanitized to `-`).
```bash
senv init
```

### 2. Manage Environment Variables
Add, remove, and list variables. By default, `senv` targets the `dev` environment. You can specify a different environment using the `-e` or `--env` flag.
```bash
# Add a variable
senv key add my-identity API_KEY "super_secret_value"

# List masked variables (by default: all environments, grouped by identity)
senv key list
senv key list -e prod
senv key list -i my-identity

# Get a plaintext value
senv key get API_KEY
```

> When the same key exists in multiple identities, `key get` / `key list` show a conflict warning on stderr and use the first-encountered identity's value. Pass `-i <name>` (or `--identity <name>`) to disambiguate. `key list` without `-e` shows all environments grouped by identity; with `-e` restricts to that environment.

### 3. Apply the Variables
You can easily source your decrypted environment variables into your active shell session:
```bash
eval $(senv use)

# Or for a specific environment
eval $(senv use -e prod)

# Or only keys from a named preset
eval $(senv use backend)
```

### 4. Presets
Named subsets of keys stored in plaintext inside `.senv.json`:
```bash
# List all presets
senv preset list

# Define a preset (incremental; dedupes keys)
senv preset add backend API_KEY DB_URL

# Remove specific keys or the whole preset
senv preset rm backend DB_URL
senv preset rm backend

# Verify all preset keys are decryptable for the current env
senv preset check
senv preset check --strict
```

`preset check` and `senv use <preset>` print a `[WARN]` for each key in the preset that is missing or not decryptable for the target environment. `preset check --strict` exits with code 1 if any keys are missing.

### 5. Share Access
To allow another team member to access a given identity, export that identity's keys and have the recipient import them.

**Export your keys:**
```bash
senv identity export my-identity

# Export decrypt-only access (private key only)
senv identity export my-identity --decrypt-only
```

**Import a keypair (yours or a teammate's):**
```bash
senv identity import "<BASE64_STRING>"
```

### 6. Git Merge Conflicts
If multiple people edit `.senv.json` simultaneously, use the merge command to safely merge conflicting identity payloads:
```bash
senv merge .senv.json .senv.incoming.json
```

### 7. Agent Skill
Install the senv agent skill so AI tools know how to use the CLI in this project:
```bash
senv install skill
```
This creates or replaces `.agents/skills/secure-env-tool/SKILL.md`.

## Development and Testing
To run the automated test suite covering filesystem operations, cryptography, and integration edge cases:
```bash
bun test
```

## AI Models Used

- Google Gemini 3.1 Pro
- OpenAI Codex 5.3
- MiniMax M3
- Composer 2.5
- DeepSeek V4 Pro
