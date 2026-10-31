#!/usr/bin/env bash
# Sets up the local opencode build on this machine: the official opencode in ~/.opencode/bin, a checkout of
# anomalyco/opencode with the feature branches from the axeluhl/opencode fork, the local-build branch built on the
# installed release, the scripts in ~/.local/bin and the daily update timer. Safe to run again to update the scripts.
#
#   curl -fsSL https://raw.githubusercontent.com/axeluhl/opencode/local-setup/local/install.sh | bash
#
# Set OPENCODE_SRC to use another checkout location than /usr/local/src/opencode.
set -euo pipefail
repo=${OPENCODE_SRC:-/usr/local/src/opencode}
upstream=https://github.com/anomalyco/opencode.git
fork=https://github.com/axeluhl/opencode.git
bin="$HOME/.local/bin"
die() {
  echo "$1" >&2
  exit 1
}
for tool in git curl unzip; do
  command -v "$tool" >/dev/null || die "Please install $tool first."
done
# Official opencode, which owns the shared background service and the update checks
if [ ! -x "$HOME/.opencode/bin/opencode" ]; then
  curl -fsSL https://opencode.ai/v2/install | bash -s -- --no-modify-path
fi
official=$("$HOME/.opencode/bin/opencode" --version | sed 's/^opencode //')
# Checkout with both remotes and the feature branches
if [ ! -d "$repo/.git" ]; then
  parent=$(dirname "$repo")
  [ -w "$parent" ] || die "Cannot write $parent. Run: sudo mkdir -p $repo && sudo chown $USER $repo"
  git clone --filter=blob:none --single-branch --branch dev --no-tags "$upstream" "$repo"
fi
cd "$repo"
git remote get-url fork >/dev/null 2>&1 || git remote add fork "$fork"
# The fork carries copies of all upstream branches; fetch only ours, and no tags
git config remote.fork.tagOpt --no-tags
git fetch fork "+refs/heads/local-setup:refs/remotes/fork/local-setup"
git config --unset-all remote.fork.fetch || true
for branch in $(git show fork/local-setup:local/features); do
  git config --add remote.fork.fetch "+refs/heads/$branch:refs/remotes/fork/$branch"
done
git fetch fork
git rev-parse -q --verify refs/heads/local-setup >/dev/null || git branch --track local-setup fork/local-setup
for feature in $(git show local-setup:local/features); do
  git rev-parse -q --verify "refs/heads/$feature" >/dev/null || git branch --track "$feature" "fork/$feature"
done
grep -qx "packages/cli/dist-local*/" .git/info/exclude 2>/dev/null || echo "packages/cli/dist-local*/" >>.git/info/exclude
# Bun in the version the repository expects
bun_version=$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' package.json)
if [ "$("$HOME/.bun/bin/bun" --version 2>/dev/null)" != "$bun_version" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v$bun_version"
fi
# Scripts, taken from the local-setup branch and pointed at this checkout
setup=$(git show local-setup:local/install-scripts.sh)
eval "$setup"
# ~/.local/bin/opencode must come before the official ~/.opencode/bin/opencode, which stays reachable after it
if ! grep -q "# opencode local build" "$HOME/.bashrc" 2>/dev/null; then
  sed -i '/^export PATH=.*\.opencode\/bin:\$PATH$/d' "$HOME/.bashrc" 2>/dev/null || true
  printf '\n# opencode local build (see %s/local/README.md)\nexport PATH="$HOME/.local/bin:$PATH:$HOME/.opencode/bin"\n' \
    "$repo" >>"$HOME/.bashrc"
fi
# First build of local-build on the installed release
if ! git rev-parse -q --verify refs/heads/local-build >/dev/null; then
  git fetch origin "refs/tags/$official:refs/tags/$official"
  git branch --no-track local-build "$official"
fi
if [ ! -x packages/cli/dist-local/cli-linux-x64/bin/opencode ]; then
  [ -z "$(git status --porcelain)" ] || die "Commit or stash the changes in $repo, then run this again."
  git switch local-build
  "$bin/opencode-rebuild"
fi
# Daily update check
if systemctl --user show-environment >/dev/null 2>&1; then
  units="$HOME/.config/systemd/user"
  mkdir -p "$units"
  for unit in opencode-update.service opencode-update.timer; do
    git show "local-setup:local/systemd/$unit" >"$units/$unit"
  done
  systemctl --user daemon-reload
  systemctl --user enable --now opencode-update.timer
fi
echo "Done. Open a new terminal; 'opencode --version' should show a local-build version."
