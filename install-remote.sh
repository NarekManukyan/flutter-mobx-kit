#!/usr/bin/env bash
# One-line installer for flutter-mobx-kit. Clones (or updates) the kit into a
# cache dir and installs the playbooks, commands and CLI into ~/.claude and
# ~/.local/bin for the current user, so they are available in every project.
# Re-run any time to update.
#
#   curl -fsSL https://raw.githubusercontent.com/NarekManukyan/flutter-mobx-kit/main/install-remote.sh | bash
#
# Override the checkout location with FLUTTER_MOBX_KIT_DIR=/path.
set -euo pipefail

REPO="https://github.com/NarekManukyan/flutter-mobx-kit"
DIR="${FLUTTER_MOBX_KIT_DIR:-$HOME/.flutter-mobx-kit}"

command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }

if [ -d "$DIR/.git" ]; then
  echo "Updating flutter-mobx-kit in $DIR …"
  git -C "$DIR" pull --ff-only --depth 1 origin main >/dev/null 2>&1 || git -C "$DIR" pull --ff-only
else
  echo "Cloning flutter-mobx-kit -> $DIR …"
  git clone --depth 1 "$REPO" "$DIR"
fi

bash "$DIR/install.sh"

echo
echo "Update later: re-run this same one-liner, or  git -C \"$DIR\" pull && bash \"$DIR/install.sh\""
