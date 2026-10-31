# Local opencode build

This branch (`local-setup`) holds the setup for running a local build of opencode with my own changes, until (or if)
they get merged upstream. It is not meant for a PR.

## Set up a machine

```bash
curl -fsSL https://raw.githubusercontent.com/axeluhl/opencode/local-setup/local/install.sh | bash
```

Run `local/install.sh` again after changing anything in `local/` on this branch, to install the new versions.

## Layout

- `origin` is anomalyco/opencode, `fork` is axeluhl/opencode.
- Feature branches, listed in `local/features`, start from the `dev` commit of a release, so they can become PRs
  against `dev` and merge into a release without unreleased `dev` changes. `middle-click-paste` merges the original
  commits of PR #32370; `prompt-pointer-selection` builds on `middle-click-paste`.
- `local-build` is the release tag of the installed official version with all feature branches merged in. It is
  recreated on each release and never pushed.
- The official opencode stays in `~/.opencode/bin` and owns the shared background service. Both versions share
  `~/.local/share/opencode/opencode.db`.

## Scripts in ~/.local/bin

- `opencode` starts the local build's TUI (with `--standalone`); subcommands go to the official version.
- `opencode-rebuild` takes over feature commits pushed from other machines, recreates `local-build` from the installed
  release with all feature branches merged when anything changed, and builds `packages/cli/dist-local`. Conflict
  resolutions are recorded (git rerere), so a conflict resolved once is resolved automatically in later rebuilds.
- `opencode-update` runs daily from a systemd user timer: official `opencode upgrade`, background service restart
  after an update, and `opencode-rebuild` when `local-build` is not on the installed release.

## Changing a feature

Commit on the feature branch (amending or rebasing is fine), push it to `fork`, then run `opencode-rebuild` (also on
the other machines).

### Updating the upstream base

Use the `dev` source commit of the release, not the release tag itself. For example, for v2.2.4:

```bash
git fetch origin refs/tags/v2.2.4:refs/tags/v2.2.4
git switch prompt-pointer-selection
git merge 'v2.2.4^'
```

The release tag adds package version bumps, lockfile changes, and changelog entries. Upstream brings those changes
back into `dev` through a separate squash commit, so successive release tags are not necessarily ancestors of one
another. Merging a tag into a feature branch can therefore create dozens of release-metadata conflicts on the next
upgrade. Only `local-build` should start from the tag. When choosing a newer `dev` source commit, the feature branch
then requires a release containing that source commit.

### Taking over a rewritten feature branch

`opencode-rebuild` fetches the fork but only advances local feature branches when they can fast-forward. After an
intentional rewrite has been pushed, synchronize each other machine explicitly. From a clean `local-build` checkout:

```bash
git fetch --no-tags fork +refs/heads/prompt-pointer-selection:refs/remotes/fork/prompt-pointer-selection
git branch pointer-before-sync prompt-pointer-selection
git branch -f prompt-pointer-selection fork/prompt-pointer-selection
opencode-rebuild
```

The backup branch preserves any previous local commits for review. If a rebuild is currently stopped in a merge,
save any manual conflict-resolution edits before using `git merge --abort` to return to a clean checkout. Git's
rerere cache is local to each repository; pushing a branch does not transfer that cache to other machines.
