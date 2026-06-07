# AGENTS.md

Guidance for AI agents (and humans) working on the `senv` codebase.

## What is senv?

A terminal-based, decentralized encrypted environment-variable manager. Each user keeps a local RSA keypair in `~/.config/senv/identity.json` (created with `0600` perms). Encrypted payloads are stored per-identity in a project file `.senv.json` that can be safely committed to source control.

**Encryption scheme (hybrid):**
- AES-256-GCM encrypts the key-value payload
- RSA-2048 (PKCS1_OAEP, SHA-256) encrypts the AES DEK
- Each identity in `.senv.json` is its own encrypted blob, encrypted for that identity's public key
- Sharing = sharing the private key (decrypt-only export or full export), not multi-recipient encryption

**Security model caveats (READ BEFORE CHANGING CRYPTO):**
- The code is AI-generated and unaudited. The README says so explicitly.
- Keystore is plaintext JSON; private keys are protected only by filesystem permissions (`0600`).
- No passphrase wrapping on private keys.
- No file locking; concurrent edits to `.senv.json` can clobber each other (known limitation, intentionally accepted).
- `merge` re-encrypts merged payloads with the local user's public key only — recipients from other users lose access. Intentional for now, will be revisited.

## Tech stack

- **Runtime:** [Bun](https://bun.sh/) `1.3.x` (uses `bun:test`, `bun build --target=bun` / `--compile`, `bun $`). Two install artifacts: bundled JS (`dist/senv`, ~60 KB, `#!/usr/bin/env bun` shebang, Bun required at runtime) and standalone binary (`dist/senv-standalone`, ~60 MB, no Bun at runtime).
- **Language:** TypeScript with `module: "Preserve"`, `moduleResolution: "bundler"`, `verbatimModuleSyntax: true`, strict mode. `tsconfig.json` is bun-shaped.
- **CLI framework:** `commander` v15.
- **Crypto:** Node's built-in `node:crypto` (RSA, AES-GCM). No third-party crypto libs.
- **Test runner:** `bun test` (uses `bun:test`'s `describe/it/expect`).
- **No package manager other than bun.** No `npm`, no `pnpm`. `bun.lock` is committed; `node_modules` is gitignored.

## Project structure

```
src/
  index.ts                 # Commander program, top-level --env / --keystore flags
  version.ts               # VERSION constant; single source of truth for -V output
  core/
    crypto.ts              # RSA keygen, encryptPayload, decryptPayload, isValidPEM, base64 keypair codec
    store.ts               # Keystore + .senv.json I/O, atomicWriteFile (with fsync), version validation
    conflict.ts            # Git conflict marker detection + multi-block parser
  commands/
    utils.ts               # isValidIdentityName, isValidEnvName, getCommandOptions, getAccessiblePayloads
    init.ts                # First-run setup, duplicate-key warning, missing-key warning
    use.ts                 # `eval $(senv use)` — buffered output
    merge.ts               # Git merge conflict resolution (uses atomicWriteFile)
    identity/
      add.ts, list.ts, rm.ts, export.ts, import.ts
    key/
      add.ts, get.ts, list.ts, rm.ts
test/
  crypto.test.ts           # Crypto primitives + base64 codec
  store.test.ts            # Keystore I/O, atomic writes, mode 0600, version validation
  conflict.test.ts         # Conflict marker parsing, single + multi-block, owner matching
  cli.test.ts              # End-to-end via `bun $` spawning `bun run ./src/index.ts`
Makefile                   # build-js / build-standalone / install-js / install-standalone
README.md                  # User-facing docs
```

## Conventions

- **Imports:** Always use `import * as senvCrypto from "../core/crypto"` (NOT `crypto`) in command files. The local module shadows Node's `crypto`; the `senvCrypto` rename is deliberate. Only `core/crypto.ts` and `core/store.ts` may import `node:crypto`.
- **Error handling:** Commands wrap their work in `try/catch` and call `console.error(e.message); process.exit(1)`. Don't `throw` uncaught from an action — commander will print a stack trace.
- **CLI options:** Use `getCommandOptions(command)` from `commands/utils.ts` to read the global `-e/--env` and `-k/--keystore` flags. Don't re-implement the parent/global opts fallback. Don't read `command.optsWithGlobals()` directly in command actions.
- **Identity names:** Must match `/^[A-Za-z0-9._-]+$/`. Enforce via `isValidIdentityName`.
- **Env var names:** Must match `/^[A-Za-z_][A-Za-z0-9_]*$/`. Enforce via `isValidEnvName` at write-time, not just at export-time.
- **PEM validation:** Use `isValidPEM(key, "public" | "private")` from `core/crypto.ts` rather than string-matching the `BEGIN ... KEY` header. The latter is forgeable.
- **Atomic writes:** All file writes go through `atomicWriteFile(filePath, data, mode)` (exported from `core/store.ts`). It does tmp-file + fsync + rename. Direct `fs.writeFile` outside that helper is a bug.
- **File permissions:** Keystore and `.senv.json` must be created with `mode: 0o600`. The config dir with `0o700`. Tests assert this.
- **Versioning:** `CURRENT_KEYSTORE_VERSION` and `CURRENT_PROJECT_CONFIG_VERSION` are in `core/store.ts`. Bumping requires adding a case in `validateKeystoreVersion` and reading from the constant (not hardcoding `"1.0"`).
- **Version string:** `VERSION` lives in `src/version.ts`. `index.ts` uses it for `program.version(...)`. The Makefile's install collision check is version-agnostic (greps for the CLI name `Secure ENV (senv)`).
- **Conflict resolution:** `core/conflict.ts` exports `parseGitConflictSenv` (handles multiple blocks via `matchAll`) and `pickConflictBlobWithoutPrivateKey` (owner-matching fallback).
- **Buffer `use` output:** `use.ts` builds the full output as a string array and writes once at the end, so `eval $(senv use)` doesn't partially evaluate on error.
- **No emojis, no comments unless asked.** The existing code has zero comments; match that.
- **Bun-specific:** Use `bun:test` imports, `bun $` for shellouts in tests, `process.stderr` for warnings, `process.stdout` only for actual command output. `console.log` in import is acceptable since it goes to stdout.

## Common commands

```bash
# Run all tests (crypto, store, conflict, CLI integration)
bun test

# Bundle CLI to dist/senv (~60 KB); default `bun run build` / `make build`
bun run build:js

# Standalone binary to dist/senv-standalone (~60 MB)
bun run build:standalone

# Install bundled JS or standalone binary to ~/.local/bin/senv
make install          # JS (needs Bun at runtime)
make install-standalone

# Type-check (bun handles this at build time; use `bun build` to verify)
bun build ./src/index.ts --target=bun --outfile /tmp/senv-check
```

## Environment variables (consumed by the CLI)

- `SENV_CONFIG_DIR` — overrides the keystore directory (default `~/.config/senv`).
- `SENV_PROJECT_DIR` — overrides the project root (default `process.cwd()`); used to locate `.senv.json`.
- `USER` / `USERNAME` — used by `init` to derive the default identity name (`<user>-local`).

These are read in `core/store.ts` (`getKeystorePath`, `getProjectDir`, `getProjectConfigPath`). Tests set them in `beforeEach` to point at `mkdtemp` directories.

## Testing

- Tests in `test/cli.test.ts` spawn a fresh bun process per call via the `runCLI(...args)` helper, which sets `SENV_CONFIG_DIR` / `SENV_PROJECT_DIR` to `mkdtemp` paths and `USER: "testuser"`. For tests that need a non-default `USER` (e.g., the two-user merge test) or a custom keystore, use `runCLIWithKeystore(user, keystorePath, ...args)`.
- Always pair `mkdtemp` with `rm(..., { recursive: true, force: true })` in `afterEach` (and `finally` blocks for ad-hoc temp dirs).
- For tests that need to spawn a bun process with custom env (e.g. tests that intentionally don't use the helper), drop `.quiet()` so stdout/stderr are visible to the test.
- `it.todo(...)` is used for known-broken behaviors that will be fixed later (e.g. multiline shell-escape).
- For long-running tests (the two-user merge test spawns many subprocesses), pass a timeout as the 3rd arg: `it("name", async () => { ... }, 30000)`.
- Gotcha: `readline.createInterface({ input: process.stdin, output: process.stdout }).question(...)` **hangs silently** when stdin is not a TTY (no error, no return). Always check `process.stdin.isTTY` first and short-circuit (e.g. print "Aborted." and `return`) when running in a non-interactive context. This applies to `identity rm` and `identity import` overwrite prompts.

## Adding a new command

1. Create `src/commands/<group>/<verb>.ts` exporting a `Command` (e.g. `export const fooBarCmd = new Command("bar")...`).
2. If nested under a subcommand group, register it in `src/index.ts` on the appropriate `identityGroup` / `keyGroup`.
3. Use `getCommandOptions(command)` for env/keystore flags.
4. Validate identity / env-var names up front; fail fast with `process.exit(1)`.
5. Use `senvCrypto` (not `crypto`) for crypto, `store` for I/O.
6. Add a CLI test in `test/cli.test.ts` using the `runCLI` helper.

## Don't

- Don't import `node:crypto` from anywhere except `src/core/crypto.ts` and `src/core/store.ts` (the latter only for the `mkdir`/`writeFile`/`readFile`/`rename`/`open`).
- Don't add comments to source code. The repo has none.
- Don't use `import crypto` — it shadows Node's crypto and was renamed to `senvCrypto` project-wide.
- Don't `process.exit(0)` from inside a try block — let the action return naturally.
- Don't write to `.senv.json` or the keystore without going through `atomicWriteFile`.
- Don't read `command.optsWithGlobals()` directly in command actions — use `getCommandOptions`.
- Don't hardcode version strings — read from `src/version.ts` and the `CURRENT_*_VERSION` constants in `core/store.ts`.
- Don't change crypto defaults (RSA-2048, AES-256-GCM, OAEP/SHA-256) without a security review.
- Don't add `npm`/`pnpm`/`yarn` artifacts; this is a bun-only project.
- Don't commit `dist/`; `.gitignore` excludes it.
