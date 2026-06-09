# senv — Presentation Story Script

Use this document as source material for NotebookLM. It is written as a spoken narrative: clear sections, plain language, and a logical arc from problem to solution to real-world workflows.

---

## Opening — The Problem Everyone Knows

Every software team has the same awkward secret.

You need environment variables — API keys, database URLs, tokens — to run the app locally, in CI, and in production. The traditional answer is a `.env` file sitting on each developer's laptop. It works until it doesn't.

You cannot commit `.env` to git. So secrets live in Slack DMs, password managers, sticky notes, or someone's head. When a key rotates, someone has to manually tell everyone. When a new developer joins, onboarding is a scavenger hunt. When two people need the same staging credentials, you copy-paste and hope nobody pastes them into the wrong channel.

The team wants one place for project secrets — versioned, shared, auditable — but encryption and access control have always made that feel harder than just… not committing the file.

That is the gap **senv** was built to close.

---

## What senv Is

**senv** is a terminal tool: a secure, decentralized environment-variable manager.

Decentralized means there is no central secrets server. No Vault cluster to operate. No SaaS bill. Your secrets live in a file inside your repository — **`.senv.json`** — and that file is safe to commit because everything inside it is encrypted.

Each developer keeps their own private keys locally, in a keystore on their machine — never in git. When you need secrets in your shell, you run:

```bash
eval $(senv use)
```

and your terminal session gets the decrypted variables, the same way sourcing a `.env` file would — except the source of truth lived in git all along.

Under the hood, senv uses a standard hybrid encryption design: AES-256-GCM encrypts the actual key-value payload, and RSA-2048 encrypts the data-encryption key. Each **identity** in `.senv.json` is its own encrypted blob, locked to that identity's public key. Only someone holding the matching private key can read it.

Simple idea: **encrypted secrets in git, keys on your machine.**

---

## Use Case 1 — Team Secrets, Shared Once, Evolved Forever

Here is the workflow teams care about most.

### The one-time setup

Alice initializes the project:

```bash
senv init
```

This creates `.senv.json` in the repo and generates a local RSA keypair — for example, identity `alice-local`. Alice adds the team's shared secrets:

```bash
senv key add alice-local API_KEY "sk-live-..."
senv key add alice-local DB_URL "postgres://..."
```

She commits `.senv.json`. The values in git are ciphertext. Useless to anyone without the key.

Now Alice shares access with the team — **once**. She exports her identity's keypair through a secure channel:

```bash
senv identity export alice-local
```

Bob, Carol, and the rest import that keypair into their local keystore:

```bash
senv identity import "<base64-keypair>" -y
```

That is the **master key moment**: share it once, out of band, through whatever secure channel the team already trusts. After that, nobody needs to DM anyone a raw API key again.

### Day-to-day collaboration

From here, the team treats `.senv.json` like any other project file.

Bob needs to add a new integration key? He runs `senv key add`, commits, pushes. Carol rotates the staging database URL? Same thing. Everyone pulls, runs `eval $(senv use)`, and they are current.

Secrets are **centralized** in one encrypted file in the repo. They are **versioned** with git history. They ride along with branches and pull requests. When two people edit at the same time, `senv merge` resolves conflicts in the encrypted payloads — the same way you would merge any other config file, except senv understands the crypto layer.

The team shares one identity — one logical "team vault" — because they all hold the same private key. The key list evolves freely; the trust boundary was established in that single initial handoff.

---

## Use Case 2 — Personal Secrets on the Same Storage

Not every secret belongs to the whole team.

Alice also has a personal OpenAI key she uses for local experiments. Bob has his own sandbox Stripe key. They should not live in the shared team blob — but they also should not live in a stray `.env` file that never gets committed.

senv handles this with **multiple identities** in the same `.senv.json`.

Alice creates her personal identity:

```bash
senv identity add alice-personal
senv key add alice-personal OPENAI_API_KEY "sk-..."
```

Bob creates his:

```bash
senv identity add bob-personal
senv key add bob-personal STRIPE_TEST_KEY "sk_test_..."
```

Each identity is a separate encrypted blob. Alice's blob is encrypted for Alice's public key. Bob's blob is encrypted for Bob's public key. They commit the same `.senv.json` file — Alice's ciphertext and Bob's ciphertext sit side by side — but neither can decrypt the other's personal secrets.

When Alice runs `senv use`, she gets both what she can decrypt from the shared team identity *and* her personal identity. Bob gets the team secrets plus his own. The storage is unified; access is per-identity.

One file. One git workflow. Team secrets and personal secrets coexist without mixing trust boundaries.

---

## Use Case 3 — Cursor Cloud Agent and the VM Secret Problem

This is where senv stops being a nice-to-have and becomes the difference between a stuck agent and a productive one.

Cloud coding agents — like Cursor's Cloud Agent — run inside a virtual machine. That VM needs environment variables to call APIs, run tests, and talk to databases. But the VM lifecycle is awkward for secrets:

- You cannot easily **restart** a VM mid-conversation to pick up new environment variables.
- You cannot inject secrets into an **already running** session the way you would on your laptop.
- Putting raw keys in the chat is a security anti-pattern.
- Putting `.env` in the repo defeats the purpose.

So the agent starts a task, discovers it needs a key that was not provisioned, and the whole session stalls — or the human has to abort, reconfigure, and start over.

### The senv pattern for agents

senv gives you a workflow that fits how agents actually work: **git as the delivery channel, encryption as the safety net.**

**Step 1 — One-time agent setup**

When the Cloud Agent VM is first configured for the project, you set up senv once:

```bash
senv init
senv identity import "<team-shared-keypair>" -y
```

The private key lives only in the VM's local keystore. The encrypted `.senv.json` is already in the cloned repo.

**Step 2 — Agent uses secrets normally**

Inside the VM, the agent (or a setup script) runs:

```bash
eval $(senv use)
```

Now the shell has the team's API keys. The agent can run integration tests, call external services, deploy to staging — whatever the secrets unlock.

**Step 3 — New secret needed mid-project**

This is the breakthrough moment.

Say the agent hits an error: it needs a `SENDGRID_API_KEY` that nobody added yet. In the old world, you would stop the session, update VM secrets somewhere, restart, and lose context.

With senv, the human stays on their **local machine**:

```bash
senv key add alice-local SENDGRID_API_KEY "SG...."
git add .senv.json
git commit -m "Add SendGrid key"
git push
```

Then, in the **same chat session**, the human tells the agent: pull the latest changes and reload secrets.

The agent runs:

```bash
git pull
eval $(senv use)
```

No VM restart. No new chat. No secrets pasted into the conversation. The encrypted blob traveled through git; the key was already on the VM from day one.

**Step 4 — Agent skill**

Projects can install the senv agent skill:

```bash
senv install skill
```

This teaches the AI how to list keys safely (masked output), add secrets via the CLI, merge conflicts, and never commit private key material. The agent becomes a first-class participant in the encrypted-secrets workflow instead of guessing at `.env` conventions.

### Why this matters

Cloud agents are long-running collaborators. They need secrets that evolve during a session. senv decouples **secret delivery** from **VM lifecycle**: git push is the update mechanism; the keystore is the trust anchor. Setup once, update forever, same conversation.

---

## How the Pieces Fit Together

| Piece | Where it lives | Committed to git? |
|-------|----------------|-------------------|
| Encrypted secret payloads | `.senv.json` | Yes — safe, ciphertext only |
| Preset name lists (key subsets) | `.senv.json` | Yes — names only, no values |
| RSA private keys | `~/.config/senv/identity.json` | **Never** |
| Exported keypairs (sharing) | Secure channel only | **Never** |

**Sharing model:** one identity = one encrypted envelope = one private key holder (or multiple people who imported the same key). There is no multi-recipient magic — you share the key once, deliberately, and everyone with that key can read and write that identity's secrets.

**Environments:** senv supports multiple named environments (`dev`, `staging`, `prod`) inside the same identities. `senv use -e prod` loads the right slice.

**Presets:** named subsets of keys — `senv use backend` exports only `API_KEY` and `DB_URL` if those are in the `backend` preset. Useful for agents and scripts that should not see every secret.

---

## Closing — What Changes for a Team

Before senv:

- Secrets scattered across machines and chat logs
- `.env` files that cannot be committed
- Onboarding = manual key handoff, every time
- Cloud agents stuck when a new secret appears mid-session

After senv:

- One encrypted file in the repo, versioned with the code
- Team vault shared with a single key handoff
- Personal secrets in the same file, invisible to teammates
- Agents that `git pull` and `eval $(senv use)` instead of restarting VMs

senv is a small CLI. The idea is not complicated: **put encrypted secrets where your code already lives, keep keys where they already belong — on people's machines.**

That is why this project exists.

---

## Suggested NotebookLM Slide Beats

If NotebookLM generates slides or a video, these beats map cleanly to visual sections:

1. **Hook** — The `.env` problem (cannot commit, cannot share, cannot rotate easily)
2. **Solution** — senv in one sentence: encrypted secrets in git, keys local
3. **Architecture** — Diagram: `.senv.json` (encrypted) + local keystore (private keys) + `eval $(senv use)`
4. **Team workflow** — Share key once → everyone commits secret updates
5. **Personal workflow** — Multiple identities, same file, separate encryption
6. **Agent workflow** — VM setup once → human adds secret locally → agent pulls → no restart
7. **Close** — Git-native, decentralized, no secrets server

---

## Optional Demo Commands (for live or B-roll)

```bash
# First time in a repo
senv init

# Add a team secret
senv key add alice-local API_KEY "secret"

# Load into shell
eval $(senv use)

# List keys (masked — safe to show on screen)
senv key list

# Share with teammate (do not show output on screen)
senv identity export alice-local

# Agent reload after human pushed new secrets
git pull && eval $(senv use)
```
