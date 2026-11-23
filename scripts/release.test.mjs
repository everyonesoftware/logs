import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

const tooling = await import('./release.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});

test('real Git detects pending Android work after a docs push and both sides of a rename', t => {
  assert.equal(typeof tooling.affected, 'function', 'release selection is not implemented');
  const cwd = mkdtempSync(join(tmpdir(), 'logs-release-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'ci@example.invalid');
  git('config', 'user.name', 'CI Fixture');
  const commit = message => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  mkdirSync(join(cwd, 'apps/android'), { recursive: true });
  mkdirSync(join(cwd, 'apps/windows'), { recursive: true });
  writeFileSync(join(cwd, 'apps/windows/keep'), 'initial');
  writeFileSync(join(cwd, 'README.md'), 'initial');
  const baseline = commit('First release');
  writeFileSync(join(cwd, 'apps/android/new'), 'Android change');
  const failed = commit('Unpublished Android change');
  writeFileSync(join(cwd, 'README.md'), 'only docs');
  const docs = commit('Docs push');
  assert.equal(tooling.affected(cwd, 'android', baseline, docs), true);
  assert.equal(tooling.affected(cwd, 'windows', baseline, docs), false);
  assert.equal(tooling.affected(cwd, 'android', failed, docs), false);
  assert.equal(tooling.affected(cwd, 'android', docs, baseline), false);
  git('mv', 'apps/android/new', 'apps/windows/new');
  const rename = commit('Move across platforms');
  for (const platform of ['android', 'windows']) assert.equal(tooling.affected(cwd, platform, docs, rename), true);
  assert.equal(tooling.affected(cwd, 'web', docs, rename), false);
});

test('staging binds a package and checksum to the exact source/version; modified bytes fail validation', t => {
  assert.equal(typeof tooling.stage, 'function', 'artifact staging is not implemented');
  const cwd = mkdtempSync(join(tmpdir(), 'logs-release-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const version = '0.1.5', source = 'a'.repeat(40);
  const apk = join(cwd, `LogsAndroid-${version}.apk`);
  writeFileSync(apk, 'package');
  const manifest = tooling.stage(cwd, 'android', version, source);
  assert.equal(manifest.source, source);
  assert.equal(manifest.files.length, 2);
  assert.deepEqual(tooling.inspect(cwd, 'android', version, source), manifest);
  writeFileSync(apk, 'PACKAGE');
  assert.throws(() => tooling.inspect(cwd, 'android', version, source), /bytes/);
});

test('current downloads keeps unchanged packages at their verified original tag', () => {
  assert.equal(typeof tooling.downloads, 'function', 'download table is not implemented');
  const table = tooling.downloads('everyonesoftware/logs', { android: 'v0.1.9', windows: 'v0.1.12' });
  assert.match(table, /releases\/download\/v0\.1\.9\/LogsAndroid-0\.1\.9\.apk/);
  assert.match(table, /releases\/download\/v0\.1\.12\/LogsWindows-win-x64-Setup\.exe/);
  assert.doesNotMatch(table, /releases\/download\/v0\.1\.12\/LogsAndroid/);
});
