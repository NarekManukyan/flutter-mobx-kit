#!/usr/bin/env node
'use strict';

/**
 * Compares the files this kit shares with the boilerplate it was extracted from.
 *
 * Both repos have to hold real copies: `flutter_boilerplate` is used as a GitHub
 * template, so a generated app is cloned alone by someone who does not have this
 * plugin, and every file an agent reads must be a real file in that repo.
 * Cross-repo symlinks do not survive a clone (git stores the literal target, so
 * the link dangles silently), which rules out the obvious deduplication.
 *
 * So the copies are deliberate, and this is what stops them diverging.
 *
 *   node tool/check-drift.js --boilerplate ../flutter_boilerplate
 *   node tool/check-drift.js --boilerplate ../flutter_boilerplate --fix
 *
 * `--fix` copies the boilerplate's version over this repo's. The boilerplate is
 * the source: its copies have to compile and pass CI, so they are the ones that
 * get proven. The copies here are inert text.
 */

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.resolve(__dirname, '..');

const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `[${code}m${s}[0m` : s);
const red = (s) => c('31', s);
const green = (s) => c('32', s);
const yellow = (s) => c('33', s);
const dim = (s) => c('2', s);

/**
 * Pairs that must stay identical once placeholders are normalized.
 * `dir: true` compares every file in the directory, both ways.
 */
const TRACKED = [
  { here: 'skills', there: '.claude/skills', dir: true },
  // Only the three this kit ships. The boilerplate also has review-pr,
  // context-prime and sync-openapi, which belong to it and to pr-review-loop.
  { here: 'commands/build-feature.md', there: '.claude/commands/build-feature.md' },
  { here: 'commands/qa-feature.md', there: '.claude/commands/qa-feature.md' },
  { here: 'commands/sync-agents.md', there: '.claude/commands/sync-agents.md' },
  { here: 'payload/docs/adr', there: 'docs/adr', dir: true },
  { here: 'payload/tool/sync_agents.sh', there: 'tool/sync_agents.sh' },
  { here: 'payload/test/helpers/pump_app.dart', there: 'test/helpers/pump_app.dart' },
  { here: 'payload/lib/core/ui/test_id.dart', there: 'lib/core/ui/test_id.dart' },
  { here: 'payload/AGENTS.md', there: 'AGENTS.md' },
];

/**
 * Deliberately different, with the reason. Listed so the next person does not
 * "fix" them back into sync.
 */
const INTENTIONAL = [
  ['.maestro/**', 'the kit ships generic templates with SETUP comments; the boilerplate ships real, running flows'],
  ['.github/workflows/**', 'the E2E skip notice differs: the boilerplate never commits ios/ by design, a generated app should'],
  ['AGENTS.md "Project Overview"', 'templatized to {{PROJECT_NAME}} here, real prose there'],
];

/** Placeholder substitutions, plus the one section that is templatized wholesale. */
function normalize(text, relPath) {
  let out = text.replace(/\{\{APP_ID\}\}/g, 'com.example.flutterBoilerplate');

  if (path.basename(relPath) === 'AGENTS.md') {
    // The overview paragraph is the templatized part; everything after it is
    // the shared contract and must match.
    out = out.replace(/## Project Overview[\s\S]*?(?=\n## )/, '## Project Overview\n\n<templatized>\n\n');
  }
  return out;
}

const listFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(abs).map((f) => path.join(e.name, f)) : [e.name];
  });

function compare(boilerplate, fix) {
  const drifted = [];
  const missing = [];

  for (const entry of TRACKED) {
    const hereRoot = path.join(PKG_ROOT, entry.here);
    const thereRoot = path.join(boilerplate, entry.there);

    if (!fs.existsSync(thereRoot)) {
      missing.push(`${entry.there} (not in the boilerplate)`);
      continue;
    }
    if (!fs.existsSync(hereRoot)) {
      missing.push(`${entry.here} (not in this repo)`);
      continue;
    }

    const rels = entry.dir
      ? [...new Set([...listFiles(hereRoot), ...listFiles(thereRoot)])]
      : [''];

    for (const rel of rels) {
      const a = rel ? path.join(hereRoot, rel) : hereRoot;
      const b = rel ? path.join(thereRoot, rel) : thereRoot;
      const label = rel ? path.join(entry.here, rel) : entry.here;

      if (!fs.existsSync(a)) {
        missing.push(`${label} (only in the boilerplate)`);
        if (fix) {
          fs.mkdirSync(path.dirname(a), { recursive: true });
          fs.copyFileSync(b, a);
        }
        continue;
      }
      if (!fs.existsSync(b)) {
        missing.push(`${label} (only in this repo)`);
        continue;
      }

      const left = normalize(fs.readFileSync(a, 'utf8'), a);
      const right = normalize(fs.readFileSync(b, 'utf8'), b);

      if (left !== right) {
        drifted.push(label);
        if (fix) {
          // Re-templatize on the way in, so --fix does not undo the placeholders.
          const appId = /appId:|com\.example\.flutterBoilerplate/.test(
            fs.readFileSync(a, 'utf8')
          );
          let incoming = fs.readFileSync(b, 'utf8');
          if (appId) {
            incoming = incoming.replace(/com\.example\.flutterBoilerplate/g, '{{APP_ID}}');
          }
          if (path.basename(a) === 'AGENTS.md') {
            const keep = fs.readFileSync(a, 'utf8').match(/## Project Overview[\s\S]*?(?=\n## )/);
            if (keep) {
              incoming = incoming.replace(/## Project Overview[\s\S]*?(?=\n## )/, keep[0]);
            }
          }
          fs.writeFileSync(a, incoming);
        }
      }
    }
  }

  return { drifted, missing };
}

function main() {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');
  const i = args.indexOf('--boilerplate');
  if (i === -1 || !args[i + 1]) {
    console.error('usage: check-drift.js --boilerplate <path-to-flutter_boilerplate> [--fix]');
    process.exit(2);
  }
  const boilerplate = path.resolve(args[i + 1]);

  if (!fs.existsSync(path.join(boilerplate, 'AGENTS.md'))) {
    console.error(red(`error: ${boilerplate} does not look like the boilerplate (no AGENTS.md)`));
    process.exit(2);
  }

  console.log(`\nComparing against ${dim(boilerplate)}\n`);

  const { drifted, missing } = compare(boilerplate, fix);

  if (drifted.length === 0 && missing.length === 0) {
    console.log(green('  In sync.') + dim(` ${TRACKED.length} tracked paths, placeholders normalized.`));
    console.log(dim('\n  Deliberately different, not checked:'));
    for (const [p, why] of INTENTIONAL) console.log(dim(`    ${p} — ${why}`));
    console.log('');
    return;
  }

  if (fix) {
    console.log(green(`  Updated ${drifted.length + missing.length} file(s) from the boilerplate.`));
    for (const f of [...drifted, ...missing]) console.log(`    ${f}`);
    console.log(dim('\n  Review the diff before committing; placeholders were preserved.\n'));
    return;
  }

  if (drifted.length) {
    console.log(red(`  ${drifted.length} file(s) drifted:`));
    for (const f of drifted) console.log(`    ${f}`);
  }
  if (missing.length) {
    console.log(yellow(`\n  ${missing.length} file(s) present on only one side:`));
    for (const f of missing) console.log(`    ${f}`);
  }
  console.log(dim('\n  The boilerplate is the source: its copies compile and are covered by tests.'));
  console.log(dim('  Pull them in with:  node tool/check-drift.js --boilerplate <path> --fix\n'));
  process.exit(1);
}

main();
