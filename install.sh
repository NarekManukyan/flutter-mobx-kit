#!/usr/bin/env bash
# Standalone installer for flutter-mobx-kit. No npm required.
#
# Installs the two halves separately, because they belong in different places:
#
#   global (~/.claude)  the 15 playbooks + the delivery commands, so every
#                       project gets them without being touched
#   per repo            AGENTS.md, the ADRs, .maestro/, the test harness, the
#                       TestId helper and the CI workflows — these are files the
#                       repo owns and commits, so they are installed by running
#                       `flutter-mobx-kit init` inside the project
#
# This script does the global half and puts the CLI on your PATH. The one-click
# path is the Claude Code marketplace (see README); this is the clone/zip
# fallback, and the way to get the CLI without publishing to npm.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"

for d in skills commands payload; do
  [ -d "$SRC/$d" ] || { echo "error: $d/ not found next to install.sh" >&2; exit 1; }
done

if [ "$(id -u)" = "0" ] && [ -n "${SUDO_USER:-}" ]; then
  echo "Do not run this with sudo. It installs into your own home directory," >&2
  echo "and running as root leaves root-owned files in ~/.claude that your normal" >&2
  echo "account then cannot overwrite. Re-run it as yourself." >&2
  exit 1
fi

mkdir -p "$HOME/.claude/commands" "$HOME/.claude/skills" "$HOME/.local/bin"

# Fail before touching anything rather than half-installing. A non-writable
# ~/.claude/skills is usually the residue of an earlier sudo install, and the
# raw `cp: ...: Permission denied` mid-loop tells nobody how to fix it.
owner_of() { stat -c '%U' "$1" 2>/dev/null || stat -f '%Su' "$1" 2>/dev/null; }
mode_of()  { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null; }

blocked=""
for d in "$HOME/.claude" "$HOME/.claude/commands" "$HOME/.claude/skills" "$HOME/.local/bin"; do
  [ -w "$d" ] || blocked="$blocked $d"
done

if [ -n "$blocked" ]; then
  echo "Cannot write to:" >&2
  for d in $blocked; do
    echo "  $d  (owner $(owner_of "$d"), mode $(mode_of "$d"))" >&2
  done
  echo >&2
  echo "Nothing was installed. Fix the ones that apply, then re-run:" >&2
  echo >&2
  me="$(id -un)"
  for d in $blocked; do
    owner="$(owner_of "$d")"
    if [ "$owner" != "$me" ]; then
      # Someone else owns it, almost always root from an earlier sudo install.
      echo "  sudo chown -R \"$me\" \"$d\"" >&2
    else
      # You own it but stripped your own write bit.
      echo "  chmod -R u+w \"$d\"" >&2
    fi
  done
  echo >&2
  echo "Then re-run this installer WITHOUT sudo." >&2
  exit 1
fi

echo "Installing commands -> ~/.claude/commands/"
cp "$SRC"/commands/*.md "$HOME/.claude/commands/"
for f in "$SRC"/commands/*.md; do
  echo "  - /$(basename "$f" .md)"
done

echo "Installing playbooks -> ~/.claude/skills/"
# Back up any existing copy OUTSIDE ~/.claude/skills — an in-place "<name>.bak"
# directory still contains a SKILL.md, so Claude Code would register it as a
# duplicate skill.
BACKUP_DIR="$HOME/.claude/.flutter-mobx-kit-backups"
for s in "$SRC"/skills/*/; do
  name="$(basename "$s")"
  dest="$HOME/.claude/skills/$name"
  # -e misses a dangling symlink, and a symlinked skill must be replaced rather
  # than written through, or cp copies into whatever it points at.
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    mkdir -p "$BACKUP_DIR"
    rm -rf "${BACKUP_DIR:?}/$name"
    mv "$dest" "$BACKUP_DIR/$name"
  fi
  cp -R "$s" "$dest"
  echo "  - $name"
done

# CLI wrapper. Claude Code puts a plugin's bin/ on PATH automatically, but that
# only applies INSIDE Claude Code — a real terminal never sees it. ~/.local/bin
# is the conventional user bin dir and is already on most PATHs.
echo "Installing CLI -> ~/.local/bin/flutter-mobx-kit"
chmod +x "$SRC/bin/cli.js" 2>/dev/null || true
ln -sf "$SRC/bin/cli.js" "$HOME/.local/bin/flutter-mobx-kit"

if ! command -v node >/dev/null 2>&1; then
  echo "  note: node is not on your PATH. The playbooks and commands above work"
  echo "        without it, but \`flutter-mobx-kit init\` needs Node 18+."
fi

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "  note: ~/.local/bin is not on your PATH — add this to your shell profile:"
     echo '        export PATH="$HOME/.local/bin:$PATH"' ;;
esac

echo
echo "Done. Restart Claude Code (new session) to pick up the playbooks and commands."
echo
echo "Commands (available in every project):"
echo "  /build-feature <JIRA-KEY | description>   read the AC, plan, size, build, QA"
echo "  /qa-feature <feature>                     the happy / failure / edge gate"
echo "  /sync-agents                              regenerate the tool instruction files"
echo
echo "Then, inside each Flutter repo, install the files the repo owns:"
echo "  cd your-flutter-app"
echo "  flutter-mobx-kit init        # AGENTS.md, ADRs, .maestro/, test harness, CI"
echo "  flutter-mobx-kit doctor      # what is installed, what is still missing"
echo
echo "Update later: re-run this script after pulling."
