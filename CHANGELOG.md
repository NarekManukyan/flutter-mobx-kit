# Changelog

## 0.1.0

First release. Extracted from the team's Flutter boilerplate, and verified by
running it — the E2E scaffolding was executed against a booted iPhone simulator
before shipping, which is where most of the sharp edges below came from.

### Instruction model

- `AGENTS.md` as the single instruction source, with `tool/sync_agents.sh`
  generating `CLAUDE.md` (an `@AGENTS.md` import), `GEMINI.md`,
  `.github/copilot-instructions.md` and `.cursor/rules/000-agents.mdc`.
  `--check` fails on drift and runs in CI, so editing a generated copy is
  caught rather than silently overwritten. Codex, Zed, Amp and Jules read
  `AGENTS.md` natively.
- 15 playbooks under `.claude/skills/` — plain Markdown with frontmatter, so
  Claude Code registers them as skills and every other agent reads them as
  files. Only what applies to *every* change stays in always-loaded context;
  procedure lives in the playbook for the thing being built.
- 17 ADRs: the full architecture (layers, state vs store, use-case taxonomy,
  flat feature tree, feature-owned singletons, DI scopes, `AppNavigator`,
  Provider access, `HookWidget`, Retrofit + freezed, localization, design
  tokens, Melos split) plus testing, plan-first delivery and instruction
  sourcing.

### Delivery and QA

- `/build-feature` — read the Jira AC, plan, size, build, QA. Asks about
  parallel agents only when the work is both large and separable.
- `/qa-feature` — AC traceability plus the happy / failure / edge matrix.
- Maestro scaffolding: workspace config, `launch` / `login` / `start_home`
  subflows, and a happy/failure/edge flow trio to copy.
- CI: `verify.yml` and `maestro.yml`.

### Things that only surface by running it

Each of these is baked into the payload so no project repeats them:

- **`TestId`** (`lib/core/ui/test_id.dart`). A plain Flutter `Key` is not
  exported to the native accessibility tree — the widget shows an empty
  `resource-id` and Maestro's `id:` never matches. Only
  `Semantics(identifier:)` sets the native id. `TestId` applies both from one
  string, so a single constant serves the widget test and the flow.
- `clearState: true` clears the auth token, so flows land on login rather than
  the screen under test. Hence the `login` / `start_home` subflows.
- `hideKeyboard` on iOS presses **Done**, firing a field's `onSubmitted` and
  submitting the form before the next command runs.
- `eraseText` with no argument erases ~50 characters, not the field — silently
  concatenating the leftovers onto the next input.
- `maestro test .maestro/flows` finds nothing; the directory runner does not
  recurse. It has to be `maestro test .maestro`.
- `mobx` and `mocktail` both export `when`, so a test importing both will not
  compile.
- Mounting `EasyLocalization` per widget test leaves its async load unresolved
  on the second `testWidgets`, rendering an empty tree with no error.
- `pumpAndSettle` never returns on a screen with a skeleton shimmer.
- `melos exec` only reaches `packages/`; the root app is usually not a melos
  package, so `analyze`, `test`, `format` and `build` silently skip `lib/`
  unless each script runs the root explicitly.

### CLI

- `init` / `update` / `sync` / `doctor`, with `--dry-run`, `--force` (backs up
  to `.flutter-mobx-kit-backup/` first), `--only`, and placeholder substitution
  from `pubspec.yaml` and the iOS or Android bundle id.
- 19 installer tests, plus a CI job that packs the tarball, installs it
  globally and runs `init` from it — because `files` in `package.json` decides
  what actually ships.
