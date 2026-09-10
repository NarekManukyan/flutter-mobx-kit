#!/usr/bin/env node
'use strict';

/**
 * Smoke tests for the installer. No framework — this is a file copier, and the
 * things worth asserting are "did the files land, did the placeholders get
 * substituted, is it safe to run twice".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmk-'));
  try {
    fn(dir);
    console.log(`  ok   ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${e.message.split('\n')[0]}`);
    failed++;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(args, opts = {}) {
  return execFileSync('node', [CLI, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    ...opts,
  });
}

function runAllowFail(args) {
  try {
    return { out: run(args), status: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), status: e.status };
  }
}

/** Minimal Flutter project fixture. */
function fixture(dir, { appId = 'com.acme.acmeApp' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'pubspec.yaml'),
    'name: acme_app\nenvironment:\n  sdk: \'>=3.8.0-0 <4.0.0\'\ndependencies:\n  flutter:\n    sdk: flutter\n'
  );
  const proj = path.join(dir, 'ios', 'Runner.xcodeproj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(
    path.join(proj, 'project.pbxproj'),
    `\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${appId}.RunnerTests;\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${appId};\n`
  );
  return dir;
}

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const has = (...p) => fs.existsSync(path.join(...p));

// --------------------------------------------------------------------------

console.log('\nflutter-mobx-kit — installer tests\n');

test('refuses a non-Flutter directory', (dir) => {
  const { status, out } = runAllowFail(['init', `--dir=${dir}`]);
  assert.notStrictEqual(status, 0, 'should exit non-zero');
  assert.match(out, /does not look like a Flutter project/);
});

test('--yes overrides the Flutter guard', (dir) => {
  const out = run(['init', `--dir=${dir}`, '--yes']);
  assert.match(out, /installing anyway/);
  assert.ok(has(dir, 'AGENTS.md'));
});

test('dry run writes nothing', (dir) => {
  fixture(dir);
  const out = run(['init', `--dir=${dir}`, '--dry-run']);
  assert.match(out, /dry run/);
  assert.ok(!has(dir, 'AGENTS.md'), 'AGENTS.md must not exist after a dry run');
});

test('init installs every part', (dir) => {
  fixture(dir);
  run(['init', `--dir=${dir}`]);
  assert.ok(has(dir, 'AGENTS.md'), 'AGENTS.md');
  assert.ok(has(dir, 'tool', 'sync_agents.sh'), 'sync script');
  assert.ok(has(dir, '.claude', 'skills', 'create-dto', 'SKILL.md'), 'a playbook');
  assert.ok(has(dir, '.claude', 'commands', 'build-feature.md'), 'a command');
  assert.ok(has(dir, 'docs', 'adr', '0015-mandatory-test-coverage-and-qa-gate.md'), 'an ADR');
  assert.ok(has(dir, '.maestro', 'config.yaml'), 'maestro config');
  assert.ok(has(dir, '.maestro', 'flows', 'example', 'example_failure.yaml'), 'flow template');
  assert.ok(has(dir, 'test', 'helpers', 'pump_app.dart'), 'test harness');
  assert.ok(has(dir, 'lib', 'core', 'ui', 'test_id.dart'), 'TestId helper');
  assert.ok(has(dir, '.github', 'workflows', 'verify.yml'), 'CI');
});

test('the E2E scaffolding reflects what actually works on a device', (dir) => {
  fixture(dir);
  const out = run(['init', `--dir=${dir}`]);

  // `maestro test .maestro/flows` finds nothing — the runner does not recurse.
  assert.ok(!out.includes('maestro test .maestro/flows'), 'melos snippet must target .maestro');
  assert.match(out, /maestro test \.maestro\b/);

  // Flows start signed in, not merely from a clean state.
  assert.ok(has(dir, '.maestro', 'common', 'start_home.yaml'), 'start_home subflow');
  assert.ok(has(dir, '.maestro', 'common', 'login.yaml'), 'login subflow');
  assert.match(
    read(dir, '.maestro', 'flows', 'example', 'example_happy.yaml'),
    /runFlow: \.\.\/\.\.\/common\/start_home\.yaml/
  );

  // TestId is the mechanism the playbooks teach; a bare Key is not.
  const testId = read(dir, 'lib', 'core', 'ui', 'test_id.dart');
  assert.match(testId, /Semantics\(/);
  assert.match(testId, /identifier: id/);
});

test('the maestro playbook teaches the device-verified rules', () => {
  const body = read(ROOT, 'skills', 'write-maestro-flow', 'SKILL.md');
  for (const rule of [
    /plain Flutter `Key` is invisible to Maestro/i,
    /clearState/,
    /hideKeyboard/,
    /eraseText/,
    /does not recurse/,
  ]) {
    assert.match(body, rule, `write-maestro-flow must cover ${rule}`);
  }
});

test('the sync script is executable', (dir) => {
  fixture(dir);
  run(['init', `--dir=${dir}`]);
  const mode = fs.statSync(path.join(dir, 'tool', 'sync_agents.sh')).mode;
  assert.ok(mode & 0o100, 'owner execute bit must be set');
});

test('substitutes the project name and bundle id', (dir) => {
  fixture(dir, { appId: 'com.acme.acmeApp' });
  run(['init', `--dir=${dir}`]);
  assert.match(read(dir, 'AGENTS.md'), /\*\*acme_app\*\*/);
  assert.match(read(dir, '.maestro', 'common', 'launch.yaml'), /appId: com\.acme\.acmeApp/);
  const all = [
    read(dir, 'AGENTS.md'),
    read(dir, '.maestro', 'common', 'launch.yaml'),
    read(dir, '.claude', 'skills', 'write-maestro-flow', 'SKILL.md'),
  ].join('\n');
  assert.ok(!all.includes('{{'), 'no unsubstituted placeholders may survive');
});

test('overrides win over detection', (dir) => {
  fixture(dir);
  run(['init', `--dir=${dir}`, '--project-name=Zeta', '--app-id=io.zeta.app']);
  assert.match(read(dir, 'AGENTS.md'), /\*\*Zeta\*\*/);
  assert.match(read(dir, '.maestro', 'common', 'launch.yaml'), /appId: io\.zeta\.app/);
});

test('generates the per-tool instruction files', (dir) => {
  fixture(dir);
  run(['init', `--dir=${dir}`]);
  assert.ok(has(dir, 'CLAUDE.md'), 'CLAUDE.md');
  assert.ok(has(dir, 'GEMINI.md'), 'GEMINI.md');
  assert.ok(has(dir, '.github', 'copilot-instructions.md'), 'copilot');
  assert.ok(has(dir, '.cursor', 'rules', '000-agents.mdc'), 'cursor rule');
  assert.match(read(dir, 'CLAUDE.md'), /@AGENTS\.md/);
  assert.match(read(dir, 'CLAUDE.md'), /DO NOT EDIT/);
});

test('copilot instructions rewrite root-relative links', (dir) => {
  fixture(dir);
  run(['init', `--dir=${dir}`]);
  const copilot = read(dir, '.github', 'copilot-instructions.md');
  assert.match(copilot, /\]\(\.\.\/docs\/adr\//, 'links must climb one level');
});

test('second run leaves existing files alone', (dir) => {
  fixture(dir);
  run(['init', `--dir=${dir}`]);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# my own rules\n');
  const out = run(['init', `--dir=${dir}`]);
  assert.match(out, /already present, left untouched/);
  assert.strictEqual(read(dir, 'AGENTS.md'), '# my own rules\n');
});

test('--force backs up before overwriting', (dir) => {
  fixture(dir);
  run(['init', `--dir=${dir}`]);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# my own rules\n');
  run(['init', `--dir=${dir}`, '--force', '--only=agents']);
  assert.notStrictEqual(read(dir, 'AGENTS.md'), '# my own rules\n', 'file replaced');
  assert.strictEqual(
    read(dir, '.flutter-mobx-kit-backup', 'AGENTS.md'),
    '# my own rules\n',
    'original preserved'
  );
});

test('--only installs just that part', (dir) => {
  fixture(dir);
  run(['init', `--dir=${dir}`, '--only=skills']);
  assert.ok(has(dir, '.claude', 'skills', 'create-dto', 'SKILL.md'));
  assert.ok(!has(dir, 'docs', 'adr'), 'ADRs must not be installed');
});

test('accepts both --flag=value and --flag value', (dir) => {
  // `--dir <path>` used to set the flag to `true`, so path.resolve(true) threw a
  // raw TypeError at the user instead of doing the obvious thing.
  const a = fixture(path.join(dir, 'a'));
  const b = fixture(path.join(dir, 'b'));

  run(['init', '--dir', a]);
  run(['init', `--dir=${b}`]);

  assert.ok(has(a, 'AGENTS.md'), 'spaced form must work');
  assert.ok(has(b, 'AGENTS.md'), 'equals form must work');

  // A boolean flag must not swallow the next argument.
  const c = fixture(path.join(dir, 'c'));
  run(['init', '--force', '--dir', c]);
  assert.ok(has(c, 'AGENTS.md'));
});

test('a value flag with no value is an error, not a crash', (dir) => {
  const { status, out } = runAllowFail(['init', '--dir']);
  assert.notStrictEqual(status, 0);
  assert.match(out, /--dir needs a value/);
  assert.ok(!/TypeError|ERR_INVALID_ARG_TYPE/.test(out), 'must not surface a raw node error');
});

test('rejects an unknown --only part', (dir) => {
  fixture(dir);
  const { status, out } = runAllowFail(['init', `--dir=${dir}`, '--only=nope']);
  assert.notStrictEqual(status, 0);
  assert.match(out, /unknown part "nope"/);
});

test('sync --check passes right after init and fails on drift', (dir) => {
  fixture(dir);
  run(['init', `--dir=${dir}`]);
  assert.strictEqual(runAllowFail(['sync', `--dir=${dir}`, '--check']).status, 0);

  fs.appendFileSync(path.join(dir, 'GEMINI.md'), '\nhand edit\n');
  const drift = runAllowFail(['sync', `--dir=${dir}`, '--check']);
  assert.notStrictEqual(drift.status, 0, 'drift must fail');
  assert.match(drift.out, /stale: GEMINI\.md/);

  run(['sync', `--dir=${dir}`]);
  assert.strictEqual(runAllowFail(['sync', `--dir=${dir}`, '--check']).status, 0, 'sync repairs it');
});

test('doctor reports missing prerequisites, then a clean install', (dir) => {
  fixture(dir);
  const before = runAllowFail(['doctor', `--dir=${dir}`]);
  assert.notStrictEqual(before.status, 0);
  assert.match(before.out, /miss\s+AGENTS\.md/);

  run(['init', `--dir=${dir}`]);
  const after = runAllowFail(['doctor', `--dir=${dir}`]);
  assert.match(after.out, /ok\s+playbooks\s+15\/15/);
  // melos scripts and dev deps are still the user's job, so doctor still warns.
  assert.match(after.out, /miss\s+melos scripts/);
});

test('install.sh installs the global half without npm', (dir) => {
  // The kit must be installable by clone + shell, not only via npm. The global
  // half is the playbooks, the commands, and the CLI on PATH.
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  execFileSync('bash', [path.join(ROOT, 'install.sh')], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, HOME: home },
  });

  const shipped = fs.readdirSync(path.join(ROOT, 'skills'));
  for (const name of shipped) {
    assert.ok(
      has(home, '.claude', 'skills', name, 'SKILL.md'),
      `playbook ${name} must be installed`
    );
  }
  assert.ok(has(home, '.claude', 'commands', 'build-feature.md'), 'commands');
  assert.ok(has(home, '.local', 'bin', 'flutter-mobx-kit'), 'CLI on PATH');
});

test('the shell-installed CLI can init a project', (dir) => {
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  execFileSync('bash', [path.join(ROOT, 'install.sh')], {
    stdio: 'pipe',
    env: { ...process.env, HOME: home },
  });

  const proj = fixture(path.join(dir, 'proj'), {});
  execFileSync(path.join(home, '.local', 'bin', 'flutter-mobx-kit'), ['init'], {
    cwd: proj,
    stdio: 'pipe',
  });
  assert.ok(has(proj, 'AGENTS.md'), 'AGENTS.md');
  assert.ok(has(proj, 'CLAUDE.md'), 'generated CLAUDE.md');
  assert.ok(has(proj, 'lib', 'core', 'ui', 'test_id.dart'), 'TestId helper');
});

test('install.sh refuses a non-writable ~/.claude/skills instead of half-installing', (dir) => {
  // What Karen hit: `cp: ~/.claude/skills/add-design-token: Permission denied`
  // partway through, after the commands had already been written.
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
  fs.chmodSync(path.join(home, '.claude', 'skills'), 0o555);

  let status = 0;
  let out = '';
  try {
    out = execFileSync('bash', [path.join(ROOT, 'install.sh')], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: home },
    });
  } catch (e) {
    status = e.status;
    out = (e.stdout || '') + (e.stderr || '');
  }

  fs.chmodSync(path.join(home, '.claude', 'skills'), 0o755);

  assert.notStrictEqual(status, 0, 'must fail, not continue');
  assert.match(out, /Cannot write to/);
  assert.match(out, /Nothing was installed/);
  // The remedy has to match the cause: this dir is owned by the user, so the
  // fix is chmod. Telling them to chown their own directory does nothing.
  assert.match(out, /chmod -R u\+w/);
  assert.ok(
    !fs.existsSync(path.join(home, '.claude', 'commands', 'build-feature.md')),
    'must not leave a half install behind'
  );
});

test('install.sh replaces a symlinked skill rather than writing through it', (dir) => {
  const home = path.join(dir, 'home');
  const outside = path.join(dir, 'outside', 'add-design-token');
  fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'SKILL.md'), 'OLD\n');
  fs.symlinkSync(outside, path.join(home, '.claude', 'skills', 'add-design-token'));

  execFileSync('bash', [path.join(ROOT, 'install.sh')], {
    stdio: 'pipe',
    env: { ...process.env, HOME: home },
  });

  const dest = path.join(home, '.claude', 'skills', 'add-design-token');
  assert.ok(!fs.lstatSync(dest).isSymbolicLink(), 'must become a real directory');
  assert.strictEqual(read(outside, 'SKILL.md'), 'OLD\n', 'must not write through the link');
  assert.ok(
    has(home, '.claude', '.flutter-mobx-kit-backups', 'add-design-token'),
    'the replaced link should be backed up'
  );
});

test('install.sh survives a dangling symlink', (dir) => {
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync('/nonexistent/path', path.join(home, '.claude', 'skills', 'add-design-token'));

  execFileSync('bash', [path.join(ROOT, 'install.sh')], {
    stdio: 'pipe',
    env: { ...process.env, HOME: home },
  });

  const shipped = fs.readdirSync(path.join(ROOT, 'skills')).length;
  assert.strictEqual(
    fs.readdirSync(path.join(home, '.claude', 'skills')).length,
    shipped,
    'every playbook should still land'
  );
});

test('install scripts are executable and parse', () => {
  for (const name of ['install.sh', 'install-remote.sh']) {
    const f = path.join(ROOT, name);
    assert.ok(fs.statSync(f).mode & 0o100, `${name} must be executable`);
    execFileSync('bash', ['-n', f], { stdio: 'pipe' });
  }
  // The one-liner people paste has to point at the real repo and branch.
  const remote = read(ROOT, 'install-remote.sh');
  assert.match(remote, /NarekManukyan\/flutter-mobx-kit/);
  assert.match(remote, /origin main/);
});

test('the drift check detects a divergent playbook', (dir) => {
  // A check that cannot fail is worse than no check, so prove it fires.
  // `--fix` writes into the kit it is run from, so run a COPY of this repo,
  // never the working tree.
  const kit = path.join(dir, 'kit');
  fs.mkdirSync(kit, { recursive: true });
  for (const d of ['tool', 'skills', 'commands', 'payload']) {
    fs.cpSync(path.join(ROOT, d), path.join(kit, d), { recursive: true });
  }

  // A minimal boilerplate holding the same content, laid out the way it is there.
  const bp = path.join(dir, 'boilerplate');
  fs.mkdirSync(path.join(bp, '.claude'), { recursive: true });
  fs.cpSync(path.join(kit, 'skills'), path.join(bp, '.claude', 'skills'), { recursive: true });
  fs.cpSync(path.join(kit, 'commands'), path.join(bp, '.claude', 'commands'), { recursive: true });
  fs.cpSync(path.join(kit, 'payload', 'docs'), path.join(bp, 'docs'), { recursive: true });
  for (const [from, to] of [
    ['payload/tool/sync_agents.sh', 'tool/sync_agents.sh'],
    ['payload/test/helpers/pump_app.dart', 'test/helpers/pump_app.dart'],
    ['payload/lib/core/ui/test_id.dart', 'lib/core/ui/test_id.dart'],
  ]) {
    const dest = path.join(bp, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(kit, from), dest);
  }
  fs.writeFileSync(
    path.join(bp, 'AGENTS.md'),
    read(kit, 'payload', 'AGENTS.md')
      .replace(/\*\*\{\{PROJECT_NAME\}\}\*\* — Flutter app on the team's standard stack:/, 'Flutter mobile boilerplate:')
      .replace(/\{\{APP_ID\}\}/g, 'com.example.flutterBoilerplate')
  );

  const check = (args = []) => {
    try {
      const out = execFileSync(
        'node',
        [path.join(kit, 'tool', 'check-drift.js'), '--boilerplate', bp, ...args],
        { encoding: 'utf8', stdio: 'pipe' }
      );
      return { out, status: 0 };
    } catch (e) {
      return { out: (e.stdout || '') + (e.stderr || ''), status: e.status };
    }
  };

  assert.strictEqual(check().status, 0, 'identical trees must pass');

  fs.appendFileSync(path.join(bp, '.claude', 'skills', 'create-dto', 'SKILL.md'), '\nnew rule\n');
  const red = check();
  assert.notStrictEqual(red.status, 0, 'drift must fail the check');
  assert.match(red.out, /create-dto/);

  check(['--fix']);
  assert.strictEqual(check().status, 0, '--fix must bring them back in sync');
  assert.match(read(kit, 'skills', 'create-dto', 'SKILL.md'), /new rule/);

  // and the working tree is untouched
  assert.ok(
    !read(ROOT, 'skills', 'create-dto', 'SKILL.md').includes('new rule'),
    'the test must not write into the real repo'
  );
});

test('every playbook has usable frontmatter', () => {
  const skills = path.join(ROOT, 'skills');
  const names = fs.readdirSync(skills);
  assert.ok(names.length >= 15, `expected 15+ playbooks, found ${names.length}`);
  for (const name of names) {
    const body = read(skills, name, 'SKILL.md');
    assert.ok(body.startsWith('---\n'), `${name}: missing frontmatter`);
    const fm = body.slice(4, body.indexOf('\n---', 4));
    assert.match(fm, new RegExp(`^name:\\s*${name}\\s*$`, 'm'), `${name}: name must match the directory`);
    assert.match(fm, /^description:\s*\S/m, `${name}: needs a description`);
  }
});

test('no payload file still carries a placeholder for a shipped value', () => {
  const payload = path.join(ROOT, 'payload');
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]
    );
  const allowed = /\{\{(PROJECT_NAME|APP_ID)\}\}/g;
  for (const f of walk(payload)) {
    const body = fs.readFileSync(f, 'utf8');
    const leftovers = body.replace(allowed, '').match(/\{\{[A-Z_]+\}\}/g);
    assert.strictEqual(
      leftovers,
      null,
      `${path.relative(ROOT, f)} has unknown placeholders: ${leftovers}`
    );
  }
});

// --------------------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
