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
rm -rf "$scripts_dir"
trap - 0
if [ -n "$restart" ]; then
  exec "$bin/$command" "$@"
fi
