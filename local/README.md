# Local opencode build

This branch (`local-setup`) holds the setup for running a local build of opencode with my own changes, until (or if)
they get merged upstream. It is not meant for a PR.

## Set up a machine

See [the main README](../README.md#install-this-fork-local-build) for prerequisites and choosing a checkout directory.

```bash
# curl
curl -fsSL https://raw.githubusercontent.com/axeluhl/opencode/local-setup/local/install.sh | bash

# wget (curl is still required by the installer)
wget -qO- https://raw.githubusercontent.com/axeluhl/opencode/local-setup/local/install.sh | bash
```

`opencode-rebuild` and `opencode-update` refresh the scripts in `~/.local/bin` and the local discovery plugin from
`local-setup` automatically.
Run `local/install.sh` again after changing the systemd units or other installation settings.

## Discover models from an Anthropic-compatible proxy

The local setup installs `local/plugins/anthropic-discovery/index.ts` into
`~/.config/opencode/local-plugins/anthropic-discovery/index.ts` (respecting `XDG_CONFIG_HOME`). Enable it explicitly
in your global `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "claude-proxy/claude-opus-4-8",
  "plugins": [
    {
      "package": "./local-plugins/anthropic-discovery",
      "options": {
        "refreshIntervalMs": 60000,
        "providers": {
          "claude-proxy": {
            "name": "Local Proxy",
            "baseURL": "http://localhost:6655/anthropic",
            "authToken": "{file:secrets/anthropic-token}",
          },
        },
      },
    },
  ],
}
```

Merge the plugin entry with your existing plugins. Remove the old `providers.claude-proxy` definition: the plugin
now supplies its connection and complete model inventory. Other provider configuration remains independent. The
IDs advertised by the proxy become the OpenCode model IDs, so update defaults and reselect a model in existing
sessions that used a different alias. The provider ID (`claude-proxy` here) is configurable; add more endpoints to
the plugin's `providers` map when needed.

The plugin requests `<baseURL>/v1/models` at startup and every minute by default, follows Anthropic's `after_id`
pagination, and updates the picker when the inventory changes. Use a base URL without `/v1`; the plugin adds `/v1`
for both discovery and Messages requests (`<baseURL>/v1/messages`). A failed or incomplete
request keeps the last successful inventory and logs a warning; a successful empty inventory clears the list.
Unloading or reconfiguring the plugin stops its refresh tasks and in-flight requests. At a cold start, an unreachable
proxy has no models until discovery succeeds.

`authToken` uses Bearer authentication. Alternatively, set `apiKey` to send `x-api-key`; additional `headers` are
supported. Keep credentials in environment or file substitutions, never in the fork. The endpoint must implement
Anthropic's model-list response (`data`, `display_name`, `has_more`, and `last_id`); this plugin is for the Anthropic
Messages protocol, not an OpenAI `/models` endpoint.

Known models inherit capabilities, limits, and reasoning variants from OpenCode's Anthropic catalog. Unknown models
are still offered, with text/image/PDF input, tools enabled, and a conservative 200,000-token context and 32,000-token
output limit. The proxy's `[1m]` model IDs keep that suffix when sent upstream and receive a 1,000,000-token context.
Discovery does not infer the proxy's billing rates. Explicit per-model overrides may still be supplied in
`providers.<id>.models` for metadata the endpoint does not advertise.

For development, run `bun run test` and `bun typecheck` from `local`, then `bun run check` from the repository root.

## Layout

- `origin` is anomalyco/opencode, `fork` is axeluhl/opencode.
- Feature branches, listed in `local/features`, start from the `dev` commit of a release, so they can become PRs
  against `dev` and merge into a release without unreleased `dev` changes. `middle-click-paste` merges the original
  commits of PR #32370; `prompt-pointer-selection` builds on `middle-click-paste`.
- `local-build` is the release tag of the installed official version with all feature branches merged in. It is
  recreated on each release. The fork publishes a snapshot of `local-build` as its default branch.
- The official opencode stays in `~/.opencode/bin` and owns the shared background service. Both versions share
  `~/.local/share/opencode/opencode.db`.

## Scripts in ~/.local/bin

- `opencode` starts the local build's TUI (with `--standalone`); subcommands go to the official version.
- `opencode-rebuild` takes over feature commits pushed from other machines, recreates `local-build` from the installed
  release with all feature branches merged when anything changed, and builds `packages/cli/dist-local`. Conflict
  resolutions are recorded (git rerere), so a conflict resolved once is resolved automatically in later rebuilds.
- `opencode-update` runs daily from a systemd user timer: official `opencode upgrade`, background service restart
  after an update, and `opencode-rebuild` when `local-build` is not on the installed release.

Both commands install all three scripts from the local `local-setup` branch before continuing, and re-execute
themselves if their script changed. `opencode-rebuild` fetches `local-setup` first; `opencode-update` refreshes the
scripts even when the official release is unchanged. Scripts retain the checkout path selected during installation.

### Build version

The local binary embeds the release version with build metadata, for example `2.2.5+local.a73c5c6b56`, and keeps the
`local-build` channel. Providers receive this version in the User-Agent. The `+local` metadata identifies our build
without lowering its SemVer precedence below the release. Leaving the build version unset produces
`0.0.0-local-build-...`, which fails providers' minimum-version checks even when the source is current.

Run `opencode-rebuild` to apply build changes to the executable. The version is compiled in, so setting
`OPENCODE_VERSION` only when launching an existing binary does not change it. To bootstrap an older installed script
that does not refresh itself yet, run `sh local/bin/opencode-rebuild` from a clean `local-build` checkout once.

### Native terminal mouse selection

Run `opencode --no-mouse` to let the terminal handle drag selection and middle-click paste, including over SSH.
The flag overrides the `mouse` setting in `~/.config/opencode/cli.json` for that invocation, including config reloads.
Use `--mouse` to force capture on; omitting either flag uses the configured setting.

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
