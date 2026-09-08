# flutter-mobx-kit

Agent toolkit for Flutter + MobX projects. One instruction source, playbooks that load only when they are needed, a delivery loop that reads the acceptance criteria before writing code, and a definition of done a machine can check.

Works with **Claude Code, Codex, Cursor, Copilot, Gemini, Zed, Amp** — anything that reads `AGENTS.md`.

```bash
curl -fsSL https://raw.githubusercontent.com/NarekManukyan/flutter-mobx-kit/main/install-remote.sh | bash
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

The kit has two halves, and they go to different places.

The **playbooks and commands** are global. They live in `~/.claude` and work in every project without touching a repo. The **files a repo owns** (`AGENTS.md`, the ADRs, `.maestro/`, the test harness, the `TestId` helper, the CI workflows) get committed to that repo, so they are installed per project with `flutter-mobx-kit init`.

### Option A: Claude Code marketplace

A real, versioned plugin (`claude plugin update` / `list` / `enable`). Same mechanism from the terminal or from inside Claude Code:

```bash
claude plugin marketplace add NarekManukyan/flutter-mobx-kit
claude plugin install flutter-mobx-kit@flutter-mobx-kit
```

This gives you the playbooks and the `/build-feature`, `/qa-feature` and `/sync-agents` commands. For the per-repo half, use the CLI from Option B or C.

### Option B: one-liner

Clones the kit to `~/.flutter-mobx-kit`, installs the playbooks and commands into `~/.claude`, and puts the CLI on your PATH. Re-run it any time to update.

```bash
curl -fsSL https://raw.githubusercontent.com/NarekManukyan/flutter-mobx-kit/main/install-remote.sh | bash
```

### Option C: clone

```bash
git clone https://github.com/NarekManukyan/flutter-mobx-kit ~/.flutter-mobx-kit
bash ~/.flutter-mobx-kit/install.sh
```

### Then, in each Flutter repo

```bash
cd your-flutter-app
flutter-mobx-kit init
```

It detects your project name and bundle id, installs the per-repo files, generates the tool instruction files, and prints the melos scripts and dev dependencies you still need to add. It never overwrites an existing file unless you pass `--force`, and `--force` backs the original up to `.flutter-mobx-kit-backup/` first.

```bash
flutter-mobx-kit init --dry-run          # see what would land
flutter-mobx-kit init --only=skills      # just the playbooks
flutter-mobx-kit doctor                  # what is installed, what is missing
flutter-mobx-kit sync                    # regenerate the tool files
flutter-mobx-kit sync --check            # fail on drift (CI)
flutter-mobx-kit update                  # refresh playbooks to this version
```

Node 18+ is needed for the CLI. The playbooks and commands do not need it.

**Do not run the installer with `sudo`.** It writes into your own home directory, and running it as root leaves root-owned files in `~/.claude` that your normal account then cannot overwrite. The installer refuses to run as root for that reason. Note also that `sudo curl ... | bash` does not do what it looks like: `sudo` applies to `curl`, and `bash` still runs as you.

If it reports that it cannot write to `~/.claude/skills`, that directory is usually the residue of an earlier `sudo` install. It prints the exact `chown` or `chmod` to run, picks whichever matches the cause, and installs nothing until it is fixed.

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
install-remote.sh          curl one-liner: clone + install.sh
install.sh                 installs the global half into ~/.claude + ~/.local/bin
bin/cli.js                 the per-repo installer, zero dependencies

skills/                    15 playbooks       ┐ at the root because that is where
commands/                  the 3 commands     ┘ Claude Code's plugin loader looks

payload/                   the per-repo half, copied into a project by `init`
  AGENTS.md                the instruction source, with {{PROJECT_NAME}} / {{APP_ID}}
  tool/sync_agents.sh      generates the per-tool instruction files
  docs/adr/                17 ADRs + the MADR template
  .maestro/                config, launch/login/start_home subflows, flow templates
  test/helpers/            the widget-test harness
  lib/core/ui/             TestId, the Semantics identifier helper Maestro needs
  .github/workflows/       verify.yml + maestro.yml
```

## Contributing

```bash
npm test           # 26 installer tests, no framework
npm run check-drift # compare the shared files against the boilerplate
```

### Why the same files live in two repos

`flutter_boilerplate` is used as a GitHub template, so a generated app is cloned on its own by someone who does not have this kit. Every file an agent reads has to be a real file in that repo. Cross-repo symlinks do not survive: git stores the literal target path, so after a clone the link dangles silently, and Windows checkouts turn them into text files.

So both repos hold real copies, and `tool/check-drift.js` is what stops them diverging. It runs in CI against the boilerplate's `main`, normalizes the `{{APP_ID}}` and `{{PROJECT_NAME}}` placeholders, and fails on any difference in the playbooks, ADRs, `AGENTS.md`, `sync_agents.sh`, the test harness or `TestId`.

The boilerplate is the source. Its copies have to compile and pass tests, so they are the ones that get proven; the copies here are inert text. Pull changes in with `node tool/check-drift.js --boilerplate <path> --fix`, which preserves the placeholders.

Three things are deliberately different and not compared: `.maestro/**` (generic templates here, real flows there), `.github/workflows/**` (the E2E skip notice differs), and the `AGENTS.md` project overview.

Playbooks live in `payload/skills/`. The frontmatter `name` must match the directory name — a test enforces it. Any new placeholder needs a case in `substitute()` in the CLI, and the placeholder test will fail until it has one.

## Licence

MIT
