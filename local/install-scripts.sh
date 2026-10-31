# Evaluated by install.sh, opencode-rebuild and opencode-update with repo set to the checkout path.
# Stage and rename the scripts: overwriting a running shell script in place can corrupt its remaining input.
bin="$HOME/.local/bin"
mkdir -p "$bin" || exit 1
scripts_dir=$(mktemp -d "$bin/.opencode-scripts.XXXXXX") || exit 1
trap 'rm -rf "$scripts_dir"' 0
for script in opencode opencode-rebuild opencode-update; do
  contents=$(git -C "$repo" show "local-setup:local/bin/$script") || exit 1
  printf '%s\n' "$contents" | sed "s#/usr/local/src/opencode#$repo#g" >"$scripts_dir/$script" || exit 1
  chmod +x "$scripts_dir/$script" || exit 1
done

# Run the refreshed command immediately, preserving arguments, even when invoked from the checkout.
restart=
command=$(basename "$0")
case "$command" in
  opencode-rebuild | opencode-update)
    cmp -s "$0" "$scripts_dir/$command" || restart=yes
    ;;
esac
for script in opencode opencode-rebuild opencode-update; do
  mv -f "$scripts_dir/$script" "$bin/$script" || exit 1
done
# Keep the opt-in discovery plugin available to both official and local servers.
# Stage beside the target so replacing a loaded plugin is atomic, even across filesystems.
plugin_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/local-plugins/anthropic-discovery"
mkdir -p "$plugin_dir" || exit 1
plugin_file=$(mktemp "$plugin_dir/.index.XXXXXX") || exit 1
if ! git -C "$repo" show local-setup:local/plugins/anthropic-discovery/index.ts >"$plugin_file"; then
  rm -f "$plugin_file"
  exit 1
fi
if cmp -s "$plugin_file" "$plugin_dir/index.ts"; then
  rm -f "$plugin_file"
else
  mv -f "$plugin_file" "$plugin_dir/index.ts" || exit 1
fi
rm -rf "$scripts_dir"
trap - 0
if [ -n "$restart" ]; then
  exec "$bin/$command" "$@"
fi
