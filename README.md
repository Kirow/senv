# senv

`senv` is a secure, decentralized environment variables manager built for the terminal. By utilizing a hybrid RSA/AES-GCM encryption architecture, `senv` allows teams to safely store encrypted environment configurations inside source control (`.senv.jsonc`), while maintaining unique local identities to restrict decryption access.

> **Disclaimer:** This project and its underlying code (including the cryptography logic) were fully AI-generated. While standard cryptography algorithms and practices were used, the codebase has not been audited by a human security professional. Use at your own risk.

## How it Works
Instead of maintaining `.env` files that cannot be safely committed, `senv` encrypts your environment payloads inside `.senv.jsonc`. 
1. **AES-256-GCM** is used to encrypt the key-value payload.
2. **RSA-2048** is used to encrypt the AES Data Encryption Key (DEK).

Each user registers an RSA public key into `.senv.jsonc`. When variables are added, the CLI encrypts the payload for all authorized public keys. Your private keys are kept secure in your local keystore (`~/.config/senv/identity.json`) and are never committed.

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
Run this in the root of your project. It will generate a local RSA keypair (if one doesn't exist) and create `.senv.jsonc`.
```bash
senv init
```

### 2. Manage Environment Variables
Add, remove, and list variables. By default, `senv` targets the `dev` environment. You can specify a different environment using the `-e` or `--env` flag.
```bash
# Add a variable
senv add my-identity API_KEY "super_secret_value"

# List masked variables
senv list
senv list -e prod

# Get a plaintext value
senv get API_KEY
```

### 3. Apply the Variables
You can easily source your decrypted environment variables into your active shell session:
```bash
eval $(senv export)

# Or for a specific environment
eval $(senv export -e prod)
```

### 4. Share Access
To allow another team member to access the variables, they must provide you with their public key, or you can import a base64-encoded keypair.

**Export your keys:**
```bash
senv key export my-identity
```

**Register someone else's public key:**
```bash
senv register new-teammate-local "<PUBLIC_KEY_PEM_STRING>"
```

### 5. Git Merge Conflicts
If multiple people edit `.senv.jsonc` simultaneously, use the migrate command to safely merge conflicting identity payloads:
```bash
senv migrate .senv.jsonc .senv.incoming.jsonc
```

## Development and Testing
To run the automated test suite covering filesystem operations, cryptography, and integration edge cases:
```bash
bun test
```
