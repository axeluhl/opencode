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
