# flutter-mobx-kit

Agent toolkit for Flutter + MobX projects. One instruction source, playbooks that load only when they are needed, a delivery loop that reads the acceptance criteria before writing code, and a definition of done a machine can check.

Works with **Claude Code, Codex, Cursor, Copilot, Gemini, Zed, Amp** — anything that reads `AGENTS.md`.

```bash
npx flutter-mobx-kit init
```

---

## The problem it solves

Two things go wrong on a Flutter team using coding agents.

**Instructions get expensive and get ignored.** A `CLAUDE.md` grows to 400+ lines because every convention has to live somewhere. It is injected on every turn, so a session that renames a constant pays for the DTO authoring guide — and the rules that matter for the current task get no more attention than the ones that do not. Meanwhile the same rules are duplicated into `.cursor/rules`, and absent entirely for Codex and Copilot, so a developer who switches editors gets a different architecture.

**Agents build the wrong thing, then prove it works.** The expensive failures are not bad Dart — linters catch that. They are a screen that satisfies the ticket title but misses three acceptance criteria buried in the description, shipped with a green unit suite and no idea what happens when the server returns a 500.

This kit is the fix for both, extracted from a production boilerplate.

## What you get

### Three layers instead of one file

| Layer | Answers | Where | Loaded |
|---|---|---|---|
| **`AGENTS.md`** | *what* the rules are | repo root, ~200 lines | always |
| **Playbooks** | *how* to build a thing | `.claude/skills/{name}/SKILL.md` | on demand |
| **ADRs** | *why* the rule exists | `docs/adr/` | when you want to challenge a rule |

`AGENTS.md` is the single source. `CLAUDE.md` (an `@AGENTS.md` import plus Claude-only wiring), `GEMINI.md`, `.github/copilot-instructions.md` and `.cursor/rules/000-agents.mdc` are **generated** by `tool/sync_agents.sh`. `--check` fails on drift and runs in CI, so editing a generated copy is caught instead of silently overwritten. Codex, Zed, Amp and Jules read `AGENTS.md` natively — nothing to generate.

### 15 playbooks

Plain Markdown with YAML frontmatter: Claude Code registers them as invocable skills, every other agent reads them as files. One file, two consumers.

| Building… | Playbook |
|---|---|
| A whole feature module | `create-feature` |
| A page + its state | `create-page` |
| A route, guard, modal or dialog | `add-route` |
| A MobX store | `create-store` |
| A use case | `create-use-case` |
| A DTO | `create-dto` |
| A Retrofit API provider | `create-api-provider` |
| A UI string | `add-localization` |
| A colour / text style / radius / duration | `add-design-token` |
| A design-system component | `create-ds-component` |
| Unit + widget tests | `write-tests` |
| A Maestro E2E flow | `write-maestro-flow` |
| The QA pass on a finished feature | `qa-feature` |
| A plan for a Jira ticket | `plan-feature` |
| A new architectural decision | `create-adr` |

They carry the hard-won details, not just the happy path. Every one of these was found by running the thing, not by reading docs:

- A plain Flutter `Key` is **invisible to Maestro** — only `Semantics(identifier:)` sets a native accessibility id. The kit ships a `TestId` helper so one string serves both the widget test and the flow.
- `clearState: true` clears the auth token, so flows land on login rather than the screen under test.
- `hideKeyboard` on iOS presses **Done**, firing a field's `onSubmitted` and submitting the form early.
- `eraseText` with no argument clears ~50 characters, not the field — silently concatenating the leftovers onto your next input.
- `maestro test .maestro/flows` finds nothing; the directory runner does not recurse.
- `mobx` and `mocktail` both export `when`, so a test importing both will not compile.
- Mounting `EasyLocalization` per widget test leaves its async load unresolved on the second `testWidgets`, rendering an empty tree with no error.
- `pumpAndSettle` never returns on a screen with a skeleton shimmer.

### A delivery loop that starts with the ticket

`/build-feature MONE-123` runs the whole thing:

1. **Read the task in full** — description, *every* acceptance criterion, comments, attachments, linked issues. Not the summary.
2. **Restate the AC** as verifiable outcomes. Ambiguities become questions it asks you — not guesses it buries.
3. **Analyse the codebase** — what exists, what is reused, what the blast radius is.
4. **Write the plan** — file-level, each row naming its governing ADR, its playbook, and the test that will prove it.
5. **Size it.** It asks whether to split across parallel agents **only** when the work is both large (>3 independent surfaces) and separable (disjoint files, sharing only existing contracts). On a two-file change it does not ask.
6. **Build**, then **exit through the QA gate**.

### A definition of done a machine can check

Three tiers, all required:

| Tier | Where | Covers |
|---|---|---|
| Unit | `test/features/{feature}/` | stores, states, use cases |
| Widget | `test/features/{feature}/view/` | each branch renders, callbacks fire |
| E2E (Maestro) | `.maestro/flows/{feature}/` | **happy, failure, edge** |

`/qa-feature` maps every AC line to a specific passing file and walks the matrix: 5xx, expired auth, dropped network, timeout, empty, one item, max-length input, double-tap, offline start, backgrounding — plus dark mode, WCAG AA, 44 pt targets and 200% text scaling.

"Manually verified" is not a proof. The gate says so.

### 17 ADRs

The full architecture, not just the process: layered access, state vs store, use-case taxonomy and colocation, flat feature tree, feature-owned singletons, DI scopes, the `AppNavigator` abstraction, Provider-based state access, `HookWidget` default, Retrofit + freezed, mandatory localization, design-tokens-only, the Melos split — plus the three this kit adds for testing, delivery and instruction sourcing.

Each one lists real alternatives with honest trade-offs, including the downsides of the option that won.

## Install

### Into a project (recommended)

```bash
cd your-flutter-app
npx flutter-mobx-kit init
```

Detects your project name and bundle id, installs everything, generates the per-tool instruction files, and prints the melos scripts and dev dependencies to add. It never overwrites an existing file unless you pass `--force`, and `--force` backs the original up to `.flutter-mobx-kit-backup/` first.

```bash
npx flutter-mobx-kit init --dry-run          # see what would land
npx flutter-mobx-kit init --only=skills      # just the playbooks
npx flutter-mobx-kit doctor                  # what is installed, what is missing
npx flutter-mobx-kit sync                    # regenerate the tool files
npx flutter-mobx-kit sync --check            # fail on drift (CI)
npx flutter-mobx-kit update                  # refresh playbooks to this version
```

### As a Claude Code plugin

Gives you the playbooks and the `/build-feature` · `/qa-feature` · `/sync-agents` commands globally, without touching a repo:

```
/plugin marketplace add NarekManukyan/flutter-mobx-kit
/plugin install flutter-mobx-kit@flutter-mobx-kit
```

Still run `npx flutter-mobx-kit init` in each repo for the file-level parts — `AGENTS.md`, ADRs, Maestro scaffolding, the test harness and CI.

## After `init`

The installer prints these; they are the parts it will not do to your `pubspec.yaml` unasked.

1. **Melos scripts** — the block the CLI prints. `melos exec` only reaches `packages/`; the root app is usually not a melos package, so `analyze`, `test`, `format` and `build` silently skip `lib/` unless each script runs the root explicitly. The printed block does.
2. **Dev dependencies** — `flutter_test` (sdk) and `mocktail`.
3. **A real anchor** in `.maestro/common/launch.yaml`, replacing the placeholder key.
4. **The project overview paragraph** at the top of `AGENTS.md`. Everything below it is the team standard.

Then:

```bash
melos run verify      # lint · analyze · format · test · agent-file drift
melos run maestro     # E2E, needs a booted device
```

## What it does not include

**A review engine.** For panel PR review with inline comments, Slack delivery and per-repo review memory, install [`pr-review-loop`](https://github.com/NarekManukyan/pr-review-loop) separately:

```
/plugin marketplace add NarekManukyan/pr-review-loop
/plugin install pr-review-loop@pr-review-loop
```

The two are designed to sit side by side: this kit governs how a feature is built and proved, `pr-review-loop` governs how the resulting diff is reviewed. Duplicating a 36 KB review engine into a second plugin would only guarantee the copies drift.

## Layout

```
bin/cli.js                 the installer — zero dependencies
payload/
  AGENTS.md                the instruction source, with {{PROJECT_NAME}} / {{APP_ID}}
  skills/                  15 playbooks
  commands/                build-feature, qa-feature, sync-agents
  tool/sync_agents.sh      generates the per-tool instruction files
  docs/adr/                17 ADRs + the MADR template
  .maestro/                config, launch/set-mock subflows, happy-failure-edge templates
  test/helpers/            the widget-test harness
  lib/core/ui/             TestId — the Semantics identifier helper Maestro needs
  .github/workflows/       verify.yml + maestro.yml
skills/ commands/          symlinks, for the Claude Code marketplace path
```

## Contributing

```bash
npm test        # 19 installer tests, no framework
```

Playbooks live in `payload/skills/`. The frontmatter `name` must match the directory name — a test enforces it. Any new placeholder needs a case in `substitute()` in the CLI, and the placeholder test will fail until it has one.

## Licence

MIT
