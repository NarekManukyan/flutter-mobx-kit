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
PAYLOAD="$SRC/payload"

[ -d "$PAYLOAD" ] || { echo "error: payload/ not found next to install.sh" >&2; exit 1; }

mkdir -p "$HOME/.claude/commands" "$HOME/.claude/skills"

echo "Installing commands -> ~/.claude/commands/"
cp "$PAYLOAD"/commands/*.md "$HOME/.claude/commands/"
for f in "$PAYLOAD"/commands/*.md; do
  echo "  - /$(basename "$f" .md)"
done

echo "Installing playbooks -> ~/.claude/skills/"
# Back up any existing copy OUTSIDE ~/.claude/skills — an in-place "<name>.bak"
# directory still contains a SKILL.md, so Claude Code would register it as a
# duplicate skill.
BACKUP_DIR="$HOME/.claude/.flutter-mobx-kit-backups"
for s in "$PAYLOAD"/skills/*/; do
  name="$(basename "$s")"
  if [ -d "$HOME/.claude/skills/$name" ]; then
    mkdir -p "$BACKUP_DIR"
    rm -rf "${BACKUP_DIR:?}/$name"
    mv "$HOME/.claude/skills/$name" "$BACKUP_DIR/$name"
  fi
  cp -R "$s" "$HOME/.claude/skills/$name"
  echo "  - $name"
done

# CLI wrapper. Claude Code puts a plugin's bin/ on PATH automatically, but that
# only applies INSIDE Claude Code — a real terminal never sees it. ~/.local/bin
# is the conventional user bin dir and is already on most PATHs.
echo "Installing CLI -> ~/.local/bin/flutter-mobx-kit"
mkdir -p "$HOME/.local/bin"
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
