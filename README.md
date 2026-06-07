# senv

`senv` is a secure, decentralized environment variables manager built for the terminal. By utilizing a hybrid RSA/AES-GCM encryption architecture, `senv` allows teams to safely store encrypted environment configurations inside source control (`.senv.json`), while maintaining unique local identities to restrict decryption access.

> **Disclaimer:** This project and its underlying code (including the cryptography logic) were fully AI-generated using Google Gemini 3.1 Pro, OpenAI Codex 5.3, and MiniMax M3. While standard cryptography algorithms and practices were used, the codebase has not been audited by a human security professional. Use at your own risk.

## How it Works
Instead of maintaining `.env` files that cannot be safely committed, `senv` encrypts your environment payloads inside `.senv.json`. 
1. **AES-256-GCM** is used to encrypt the key-value payload.
2. **RSA-2048** is used to encrypt the AES Data Encryption Key (DEK).

`.senv.json` stores one encrypted blob **per identity** (e.g., `alice-local`, `bob-local`). Each identity's blob is encrypted with that identity's RSA public key, so only holders of the corresponding private key can decrypt it. Your private keys are kept secure in your local keystore (`~/.config/senv/identity.json`, created with `0600` permissions) and are never committed.

## Sharing Access
To allow another team member to access a given identity's secrets, share that identity's private key with them out-of-band (e.g., via a secure channel). They import the base64-encoded keypair into their local keystore with `senv identity import`. There is no automatic key distribution or multi-recipient encryption; each identity is a single-recipient envelope.

> Note: there is currently no command to add a *teammate's public key* to an existing identity. If you want both Alice and Bob to share the same set of secrets under one name, treat it as a shared identity: have one person generate the keypair, distribute the private key (or its decrypt-only export) to the other, and both keep a copy locally.

## Installation

### Prerequisites
- [Bun](https://bun.sh/) must be installed on your machine.

### Build from Source
Clone the repository and build/install the standalone binary using the included Makefile:

```bash
git clone https://github.com/your-username/senv.git
cd senv
bun install

# Compile and safely install into ~/.local/bin/senv
make install
```
*(Make sure `~/.local/bin` is in your `$PATH`!)*

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

# List masked variables
senv key list
senv key list -e prod

# Get a plaintext value
senv key get API_KEY
```

> When the same key exists in multiple identities, `key get` / `key list` return the first-encountered identity's value. Use `-i <name>` (or `--identity <name>`) to disambiguate.

### 3. Apply the Variables
You can easily source your decrypted environment variables into your active shell session:
```bash
eval $(senv use)

# Or for a specific environment
eval $(senv use -e prod)
```

### 4. Share Access
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

### 5. Git Merge Conflicts
If multiple people edit `.senv.json` simultaneously, use the merge command to safely merge conflicting identity payloads:
```bash
senv merge .senv.json .senv.incoming.json
```

## Development and Testing
To run the automated test suite covering filesystem operations, cryptography, and integration edge cases:
```bash
bun test
```
