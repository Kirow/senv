#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXP="$ROOT/experiment"
SENV="$ROOT/senv"
SHARED_ID="team-shared"

senv_a() {
  USER=user-A SENV_PROJECT_DIR="$EXP" "$SENV" --keystore "$EXP/user-A.json" "$@"
}

senv_b() {
  USER=user-B SENV_PROJECT_DIR="$EXP" "$SENV" --keystore "$EXP/user-B.json" "$@"
}

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label (expected '$expected', got '$actual')" >&2
    exit 1
  fi
}

assert_exit() {
  local label="$1"
  local expected_rc="$2"
  shift 2
  set +e
  "$@"
  local rc=$?
  set -e
  if [[ "$rc" -ne "$expected_rc" ]]; then
    echo "FAIL: $label (expected exit $expected_rc, got $rc)" >&2
    exit 1
  fi
}

assert_identity_count() {
  local label="$1"
  local count
  count="$(senv_a identity list | grep -c '^- ' || true)"
  if [[ "$count" -ne 3 ]]; then
    echo "FAIL: $label (expected 3 identities, got $count)" >&2
    exit 1
  fi
}

echo "==> Building senv..."
cd "$ROOT"
make build

echo "==> Creating experiment sandbox..."
rm -rf "$EXP"
mkdir -p "$EXP"
cd "$EXP"
git init -b main

cat > .gitignore <<'EOF'
user-A.json
user-B.json
EOF

echo "==> Phase 1: User A init and keys..."
senv_a init
senv_a key add user-A-local USER_A_SECRET "alpha"
senv_a key add user-A-local USER_A_EXTRA "a-extra"

echo "==> Phase 1: User A shared identity..."
senv_a identity add "$SHARED_ID"
senv_a key add "$SHARED_ID" SHARED_BASE "shared-initial"
senv_a key add "$SHARED_ID" API_URL "shared-url-v0"

echo "==> Phase 1: User B private identity..."
senv_b identity add user-B-local
senv_b key add user-B-local USER_B_SECRET "bravo"
senv_b key add user-B-local USER_B_EXTRA "b-extra"

echo "==> Phase 1: Share identity A -> B..."
B64="$(senv_a identity export "$SHARED_ID")"
senv_b identity import "$B64" -y

echo "==> Phase 1: Verify visibility..."
assert_eq "user-A reads own key" "alpha" "$(senv_a key get USER_A_SECRET)"
assert_eq "user-B reads own key" "bravo" "$(senv_b key get USER_B_SECRET)"
assert_eq "user-A reads shared key" "shared-initial" "$(senv_a key get SHARED_BASE)"
assert_eq "user-B reads shared key" "shared-initial" "$(senv_b key get SHARED_BASE)"
assert_exit "user-A cannot read user-B private key" 1 senv_a key get USER_B_SECRET
assert_exit "user-B cannot read user-A private key" 1 senv_b key get USER_A_SECRET
assert_identity_count "identity count in .senv.json"

echo ""
echo "--- User A key list ---"
senv_a key list
echo ""
echo "--- User B key list ---"
senv_b key list
echo ""

echo "==> Phase 1: Baseline commit..."
git add .senv.json .gitignore
git commit -m "Initial two-user setup with shared identity"

echo "==> Phase 2: user-A branch..."
git checkout -b user-A
senv_a key add user-A-local USER_A_BRANCH "from-A"
senv_a key add "$SHARED_ID" API_URL "url-from-A-branch"
git add .senv.json
git commit -m "user-A: branch changes"

echo "==> Phase 2: user-B branch..."
git checkout main
git checkout -b user-B
senv_b key add user-B-local USER_B_BRANCH "from-B"
senv_b key add "$SHARED_ID" API_URL "url-from-B-branch"
git add .senv.json
git commit -m "user-B: branch changes"

echo "==> Phase 2: Merge user-A into user-B..."
git checkout user-B
set +e
git merge user-A
MERGE_RC=$?
set -e

if [[ "$MERGE_RC" -eq 0 ]]; then
  echo "FAIL: merge succeeded but a conflict was expected" >&2
  exit 1
fi

if ! grep -q '<<<<<<<' .senv.json; then
  echo "FAIL: no conflict markers found in .senv.json" >&2
  exit 1
fi

if ! grep -q "$SHARED_ID" .senv.json; then
  echo "FAIL: shared identity not present in conflicted .senv.json" >&2
  exit 1
fi

echo ""
git status
echo ""

echo "==> Phase 3: Resolve conflict with senv merge (user B, on user-B branch)..."
senv_b merge

assert_eq "user-A reads baseline key after merge" "alpha" "$(senv_a key get USER_A_SECRET)"
assert_eq "user-A reads branch key after merge" "from-A" "$(senv_a key get USER_A_BRANCH)"
assert_eq "user-A reads shared baseline after merge" "shared-initial" "$(senv_a key get SHARED_BASE)"
assert_eq "user-A reads shared API_URL after merge" "url-from-A-branch" "$(senv_a key get API_URL)"
assert_eq "user-B reads baseline key after merge" "bravo" "$(senv_b key get USER_B_SECRET)"
assert_eq "user-B reads branch key after merge" "from-B" "$(senv_b key get USER_B_BRANCH)"
assert_eq "user-B reads shared baseline after merge" "shared-initial" "$(senv_b key get SHARED_BASE)"
assert_eq "user-B reads shared API_URL after merge" "url-from-A-branch" "$(senv_b key get API_URL)"
assert_exit "user-A cannot read user-B private key after merge" 1 senv_a key get USER_B_SECRET
assert_exit "user-B cannot read user-A private key after merge" 1 senv_b key get USER_A_SECRET

if grep -q '<<<<<<<' .senv.json; then
  echo "FAIL: conflict markers still present after senv merge" >&2
  exit 1
fi

git add .senv.json
git commit -m "Resolved .senv.json merge conflict with senv merge"

echo ""
git status
echo ""
echo "Experiment complete: merge conflict resolved via senv merge"
echo "Inspect: $EXP"
