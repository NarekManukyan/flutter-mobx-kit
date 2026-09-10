#!/usr/bin/env node
'use strict';

/**
 * flutter-mobx-kit — installs the team's Flutter + MobX agent toolkit into a
 * repo: AGENTS.md as the single instruction source, the playbooks, the ADRs,
 * the delivery commands, the Maestro scaffolding and the CI workflows.
 *
 * Zero dependencies on purpose — `npx` should not need a lockfile resolution
 * for a file copier.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PKG_ROOT = path.resolve(__dirname, '..');
const VERSION = require(path.join(PKG_ROOT, 'package.json')).version;

// ---------------------------------------------------------------- output ---

const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `[${code}m${s}[0m` : s);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const green = (s) => c('32', s);
const yellow = (s) => c('33', s);
const red = (s) => c('31', s);
const cyan = (s) => c('36', s);

const log = (...a) => console.log(...a);
const warn = (...a) => console.log(yellow('  ! '), ...a);
const fail = (msg) => {
  console.error(red('error: ') + msg);
  process.exit(1);
};

// ------------------------------------------------------------------ args ---

// Flags that take a value. Anything else is a boolean, so `--force` does not
// swallow the next argument.
const VALUE_FLAGS = new Set(['dir', 'only', 'project-name', 'app-id']);

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const name = a.slice(2);
    // Support the spaced form too: `--dir /path` as well as `--dir=/path`.
    // Without this the flag was set to `true` and the path fell through to the
    // positionals, and path.resolve(true) threw a raw TypeError at the user.
    if (VALUE_FLAGS.has(name) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out.flags[name] = argv[++i];
    } else {
      out.flags[name] = true;
    }
  }
  return out;
}

/** A value flag given without a value is a typo, not a boolean. */
function valueFlag(flags, name) {
  const v = flags[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v === '') {
    fail(`--${name} needs a value, e.g. --${name}=<value>`);
  }
  return v;
}

// ------------------------------------------------------------------- fs ----

const walk = (dir, base = dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? walk(abs, base) : [path.relative(base, abs)];
  });

const exists = (p) => fs.existsSync(p);

function readIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- detection ---

/** Reads `name:` out of pubspec.yaml without a YAML parser. */
function detectProjectName(root) {
  const spec = readIfExists(path.join(root, 'pubspec.yaml'));
  if (!spec) return null;
  const m = spec.match(/^name:\s*(\S+)/m);
  return m ? m[1] : null;
}

/** Best-effort bundle id: iOS pbxproj first, then Android gradle. */
function detectAppId(root) {
  const pbx = readIfExists(
    path.join(root, 'ios', 'Runner.xcodeproj', 'project.pbxproj')
  );
  if (pbx) {
    for (const m of pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)) {
      const id = m[1].trim().replace(/^"|"$/g, '');
      if (!id.endsWith('.RunnerTests') && !id.includes('$(')) return id;
    }
  }
  for (const g of ['app/build.gradle.kts', 'app/build.gradle']) {
    const gr = readIfExists(path.join(root, 'android', g));
    const m = gr && gr.match(/applicationId\s*=?\s*["']([^"']+)["']/);
    if (m) return m[1];
  }
  return null;
}

function isFlutterProject(root) {
  const spec = readIfExists(path.join(root, 'pubspec.yaml'));
  return !!spec && /^\s*sdk:\s*flutter\s*$/m.test(spec);
}

function detectTools(root) {
  return {
    claude: exists(path.join(root, '.claude')) || exists(path.join(root, 'CLAUDE.md')),
    cursor: exists(path.join(root, '.cursor')),
    codex: exists(path.join(root, '.codex')) || exists(path.join(root, 'AGENTS.md')),
    copilot: exists(path.join(root, '.github', 'copilot-instructions.md')),
    gemini: exists(path.join(root, 'GEMINI.md')),
  };
}

// ------------------------------------------------------------- installer ---

// `from` is relative to the package root. skills/ and commands/ sit at the root
// rather than under payload/ because that is where Claude Code's plugin loader
// looks for them; everything else is repo-level scaffolding under payload/.
const PARTS = {
  agents: { label: 'AGENTS.md (single instruction source)', from: 'payload/AGENTS.md', to: '.' },
  skills: { label: 'playbooks', from: 'skills', to: '.claude/skills' },
  commands: { label: 'commands', from: 'commands', to: '.claude/commands' },
  tool: { label: 'sync_agents.sh', from: 'payload/tool', to: 'tool' },
  adr: { label: 'ADRs', from: 'payload/docs/adr', to: 'docs/adr' },
  maestro: { label: 'Maestro scaffolding', from: 'payload/.maestro', to: '.maestro' },
  test: { label: 'test harness', from: 'payload/test', to: 'test' },
  testid: { label: 'TestId helper', from: 'payload/lib', to: 'lib' },
  ci: { label: 'CI workflows', from: 'payload/.github/workflows', to: '.github/workflows' },
};

function substitute(text, vars) {
  return text
    .replace(/\{\{PROJECT_NAME\}\}/g, vars.projectName)
    .replace(/\{\{APP_ID\}\}/g, vars.appId);
}

const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ttf', '.otf', '.ico']);

function installPart(root, key, vars, opts, report) {
  const part = PARTS[key];
  const srcRoot = path.join(PKG_ROOT, part.from);
  if (!exists(srcRoot)) return;

  const isFile = fs.statSync(srcRoot).isFile();
  const files = isFile ? [path.basename(srcRoot)] : walk(srcRoot);
  const destRoot = isFile ? path.join(root, part.to) : path.join(root, part.to);

  for (const rel of files) {
    const src = isFile ? srcRoot : path.join(srcRoot, rel);
    const dest = isFile ? path.join(destRoot, rel) : path.join(destRoot, rel);

    if (exists(dest) && !opts.force) {
      report.skipped.push(path.relative(root, dest));
      continue;
    }

    if (opts.dryRun) {
      report.written.push(path.relative(root, dest));
      continue;
    }

    if (exists(dest) && opts.force) {
      const backup = path.join(root, '.flutter-mobx-kit-backup', path.relative(root, dest));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(dest, backup);
      report.backedUp.push(path.relative(root, dest));
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (BINARY_EXT.has(path.extname(src))) {
      fs.copyFileSync(src, dest);
    } else {
      fs.writeFileSync(dest, substitute(fs.readFileSync(src, 'utf8'), vars));
    }
    if (src.endsWith('.sh')) fs.chmodSync(dest, 0o755);
    report.written.push(path.relative(root, dest));
  }
}

// ------------------------------------------------------- melos + gitignore --

const MELOS_SNIPPET = `    # --- flutter-mobx-kit ---------------------------------------------------
    # NOTE: \`melos exec\` only reaches packages/ — the root app is usually not a
    # melos package (check \`melos list\`). Each script runs the root explicitly.
    analyze:
      description: Analyze the app and every package
      run: |
        flutter analyze lib test && \\
        melos exec -c 1 -- "dart analyze ."

    test:
      description: Unit + widget tests — ADR-0015
      run: |
        flutter test && \\
        melos exec -c 1 --dir-exists=test -- "dart test"

    test:coverage:
      description: Tests with lcov output
      run: flutter test --coverage

    maestro:
      description: Every Maestro E2E flow — needs a booted device with the app installed
      # \`.maestro\`, not \`.maestro/flows\` — the directory runner does not
      # recurse; config.yaml at the workspace root declares the flow patterns.
      run: maestro test .maestro

    maestro:happy:
      description: Happy-path flows only — the PR gate
      run: maestro test .maestro --include-tags happy --exclude-tags quarantine

    # Generated sources are gitignored, so a clean checkout has none of them.
    # Codegen has to include the localization keys or nothing referencing
    # LocaleKeys will analyze, and the generator's output needs formatting or
    # format:check fails on a file nobody edited.
    build:
      description: Codegen for the app and every package
      run: |
        melos run translations && \\
        dart run build_runner build -d && \\
        melos exec -c 1 -- "dart run build_runner build -d"

    translations:
      description: Generate localization keys
      run: |
        dart run easy_localization:generate -f keys -O lib/gen -o locale_keys.g.dart -S assets/translations -s en-US.json -u true && \\
        dart format lib/gen/locale_keys.g.dart

    format:
      description: Format everything
      run: dart format lib test packages tool

    format:check:
      description: Fail if anything is unformatted (CI)
      run: dart format --output none --set-exit-if-changed lib test packages

    verify:
      description: Everything CI runs except E2E — run before every PR
      run: |
        melos run lint && \\
        melos run analyze && \\
        melos run format:check && \\
        melos run test && \\
        ./tool/sync_agents.sh --check

    sync-agents:
      description: Regenerate the tool instruction files from AGENTS.md — ADR-0017
      run: ./tool/sync_agents.sh
`;

function melosStatus(root) {
  const spec = readIfExists(path.join(root, 'pubspec.yaml'));
  if (!spec) return 'no-pubspec';
  if (!/^melos:/m.test(spec)) return 'no-melos';
  return /sync-agents:/.test(spec) ? 'installed' : 'missing-scripts';
}

// --------------------------------------------------------------- commands --

function cmdInit(args) {
  const root = path.resolve(valueFlag(args.flags, 'dir') || process.cwd());
  const opts = { force: !!args.flags.force, dryRun: !!args.flags['dry-run'] };

  log('');
  log(bold(`flutter-mobx-kit ${VERSION}`));
  log(dim(`  target: ${root}`));
  log('');

  if (!isFlutterProject(root)) {
    if (!args.flags.yes) {
      fail(
        `${root} does not look like a Flutter project (no pubspec.yaml with the flutter sdk).\n` +
          `       Run this from the project root, or pass --yes to install anyway.`
      );
    }
    warn('no Flutter pubspec found — installing anyway because --yes was passed');
  }

  const vars = {
    projectName:
      valueFlag(args.flags, 'project-name') || detectProjectName(root) || 'This app',
    appId: valueFlag(args.flags, 'app-id') || detectAppId(root) || 'com.example.app',
  };
  log(`  project  ${cyan(vars.projectName)}`);
  log(`  app id   ${cyan(vars.appId)}`);
  if (!valueFlag(args.flags, 'app-id') && !detectAppId(root)) {
    warn('bundle id not detected — Maestro flows ship with a placeholder appId');
  }

  const tools = detectTools(root);
  const found = Object.entries(tools).filter(([, v]) => v).map(([k]) => k);
  log(`  tools    ${found.length ? cyan(found.join(', ')) : dim('none detected')}`);
  log('');

  const onlyRaw = valueFlag(args.flags, 'only');
  const only = onlyRaw ? onlyRaw.split(',') : Object.keys(PARTS);
  const report = { written: [], skipped: [], backedUp: [] };

  for (const key of only) {
    if (!PARTS[key]) fail(`unknown part "${key}". Valid: ${Object.keys(PARTS).join(', ')}`);
    installPart(root, key, vars, opts, report);
  }

  for (const f of report.written) log(`  ${green('+')} ${f}`);
  if (report.skipped.length) {
    log('');
    log(dim(`  ${report.skipped.length} file(s) already present, left untouched:`));
    for (const f of report.skipped.slice(0, 12)) log(dim(`    · ${f}`));
    if (report.skipped.length > 12) log(dim(`    · … and ${report.skipped.length - 12} more`));
    log(dim('  Re-run with --force to overwrite (originals go to .flutter-mobx-kit-backup/).'));
  }

  if (opts.dryRun) {
    log('');
    log(yellow('  dry run — nothing was written'));
    return;
  }

  // Generate the per-tool instruction files from AGENTS.md.
  const sync = path.join(root, 'tool', 'sync_agents.sh');
  if (exists(sync)) {
    log('');
    log(bold('  Generating tool instruction files'));
    try {
      const out = execFileSync('bash', [sync], { cwd: root, encoding: 'utf8' });
      for (const line of out.trim().split('\n')) log(dim(`  ${line.trim()}`));
    } catch (e) {
      warn(`sync_agents.sh failed: ${e.message}`);
    }
  }

  log('');
  log(bold('  Next steps'));

  const melos = melosStatus(root);
  if (melos === 'missing-scripts' || melos === 'no-melos') {
    const where = melos === 'no-melos' ? 'a new `melos:` block' : 'the `melos: scripts:` block';
    log(`  1. Add the scripts below to ${where} in pubspec.yaml:`);
    log('');
    log(dim(MELOS_SNIPPET));
  } else if (melos === 'installed') {
    log(`  1. ${green('melos scripts already present')}`);
  }

  log('  2. Add the test dependencies to dev_dependencies:');
  log(dim('       flutter_test:\n         sdk: flutter\n       mocktail: ^1.0.4'));
  log('  3. Replace the placeholder ids in `.maestro/common/launch.yaml` and `login.yaml`');
  log('     with real ones from your screens, applied with `TestId` (lib/core/ui/test_id.dart).');
  log(dim('     A bare Flutter Key is invisible to Maestro — only Semantics(identifier:) sets'));
  log(dim('     the native accessibility id that `id:` matches.'));
  log('  4. Fill in the one-paragraph project overview at the top of AGENTS.md.');
  log('  5. Run: ' + cyan('melos run verify'));
  log('');
  log(dim('  Reviews: this kit does not bundle a review engine. For the panel review'));
  log(dim('  and Slack delivery, install pr-review-loop separately — see the README.'));
  log('');
}

function cmdSync(args) {
  const root = path.resolve(valueFlag(args.flags, 'dir') || process.cwd());
  const sync = path.join(root, 'tool', 'sync_agents.sh');
  if (!exists(sync)) fail('tool/sync_agents.sh not found. Run `npx flutter-mobx-kit init` first.');
  const argv = args.flags.check ? [sync, '--check'] : [sync];
  try {
    process.stdout.write(execFileSync('bash', argv, { cwd: root, encoding: 'utf8' }));
  } catch (e) {
    if (e.stdout) process.stdout.write(e.stdout);
    process.exit(e.status || 1);
  }
}

function cmdDoctor(args) {
  const root = path.resolve(valueFlag(args.flags, 'dir') || process.cwd());
  log('');
  log(bold(`flutter-mobx-kit ${VERSION} — doctor`));
  log(dim(`  ${root}`));
  log('');

  const rows = [];
  const check = (label, ok, detail) => rows.push({ label, ok, detail });

  check('Flutter project', isFlutterProject(root), detectProjectName(root) || 'no pubspec.yaml');
  check('AGENTS.md', exists(path.join(root, 'AGENTS.md')), 'single instruction source');
  check('tool/sync_agents.sh', exists(path.join(root, 'tool', 'sync_agents.sh')), '');

  const skillsDir = path.join(root, '.claude', 'skills');
  const skillCount = exists(skillsDir)
    ? fs.readdirSync(skillsDir).filter((d) => exists(path.join(skillsDir, d, 'SKILL.md'))).length
    : 0;
  const shippedSkills = fs.readdirSync(path.join(PKG_ROOT, 'skills')).length;
  check('playbooks', skillCount >= shippedSkills, `${skillCount}/${shippedSkills} installed`);

  const adrDir = path.join(root, 'docs', 'adr');
  const adrCount = exists(adrDir) ? fs.readdirSync(adrDir).filter((f) => /^\d{4}-/.test(f)).length : 0;
  check('ADRs', adrCount > 0, `${adrCount} present`);

  check('.maestro/', exists(path.join(root, '.maestro')), '');
  check('test/helpers/pump_app.dart', exists(path.join(root, 'test', 'helpers', 'pump_app.dart')), '');

  const melos = melosStatus(root);
  check('melos scripts', melos === 'installed', melos);

  const spec = readIfExists(path.join(root, 'pubspec.yaml')) || '';
  check('mocktail dev dependency', /^\s*mocktail:/m.test(spec), '');
  check('flutter_test dev dependency', /^\s*flutter_test:/m.test(spec), '');

  // Generated files in sync?
  const sync = path.join(root, 'tool', 'sync_agents.sh');
  let inSync = null;
  if (exists(sync)) {
    try {
      execFileSync('bash', [sync, '--check'], { cwd: root, stdio: 'pipe' });
      inSync = true;
    } catch {
      inSync = false;
    }
    check('generated tool files in sync', inSync, inSync ? '' : 'run `npx flutter-mobx-kit sync`');
  }

  const maestroCli = (() => {
    try {
      execFileSync('which', ['maestro'], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  })();
  check('maestro CLI', maestroCli, maestroCli ? '' : 'https://docs.maestro.dev — needed for the E2E tier');

  const width = Math.max(...rows.map((r) => r.label.length));
  for (const r of rows) {
    const mark = r.ok ? green('ok  ') : yellow('miss');
    log(`  ${mark} ${r.label.padEnd(width)}  ${dim(r.detail || '')}`);
  }

  const missing = rows.filter((r) => !r.ok).length;
  log('');
  log(missing === 0 ? green('  All checks passed.') : yellow(`  ${missing} item(s) need attention.`));
  log('');
  process.exit(missing === 0 ? 0 : 1);
}

function cmdUpdate(args) {
  log(dim('  Refreshing playbooks, commands and the sync script (AGENTS.md is left alone).'));
  cmdInit({ ...args, flags: { ...args.flags, force: true, only: 'skills,commands,tool' } });
}

function cmdHelp() {
  log(`
${bold(`flutter-mobx-kit ${VERSION}`)}
Agent toolkit for Flutter + MobX projects: AGENTS.md as the single instruction
source, on-demand playbooks, ADRs, a plan-first delivery loop and a three-tier
testing contract — for Claude Code, Codex, Cursor, Copilot, Gemini and anything
else that reads AGENTS.md.

${bold('Usage')}
  npx flutter-mobx-kit <command> [options]

${bold('Commands')}
  init        Install the toolkit into this repo
  update      Refresh the playbooks, commands and sync script from this version
  sync        Regenerate CLAUDE.md / GEMINI.md / copilot / cursor from AGENTS.md
  doctor      Report what is installed and what is missing
  help        This text

${bold('Options')}
  --dir=<path>          Target directory (default: cwd)
  --force               Overwrite existing files (originals -> .flutter-mobx-kit-backup/)
  --dry-run             Print what would be written, write nothing
  --only=a,b            Install only these parts: ${Object.keys(PARTS).join(', ')}
  --project-name=<s>    Override the detected project name
  --app-id=<s>          Override the detected bundle id
  --yes                 Skip the "is this a Flutter project?" guard
  --check               (sync only) Fail if the generated files have drifted

${bold('Examples')}
  npx flutter-mobx-kit init
  npx flutter-mobx-kit init --dry-run
  npx flutter-mobx-kit init --only=skills,commands --force
  npx flutter-mobx-kit doctor
`);
}

// ------------------------------------------------------------------ main ---

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  const table = { init: cmdInit, update: cmdUpdate, sync: cmdSync, doctor: cmdDoctor, help: cmdHelp };
  const fn = table[cmd];
  if (!fn) {
    console.error(red(`unknown command "${cmd}"`));
    cmdHelp();
    process.exit(1);
  }
  fn(args);
}

main();
