import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { downloads, publish, stage } from './release.mjs';

function fixture(t, tamper = false) {
  const cwd = mkdtempSync(join(tmpdir(), 'logs-publisher-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('-c', 'user.name=Fixture', '-c', 'user.email=ci@example.invalid', 'commit', '--allow-empty', '-qm', 'First source');
  const source = git('rev-parse', 'HEAD');
  const version = '0.1.1';
  const tag = `v${version}`;
  const directory = join(cwd, 'dist/android');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `LogsAndroid-${version}.apk`), 'fixture apk');
  stage(directory, 'android', version, source);
  const repo = 'everyonesoftware/logs';
  const events = [];
  const files = [];
  let tagSha, release;
  let readme = { sha: 'b'.repeat(40), encoding: 'base64', content: Buffer.from(`Before\n${downloads(repo, {})}\nAfter\n`).toString('base64') };
  const remote = {
    repo,
    pages(path) {
      if (path.startsWith('releases?')) return release ? [release] : [];
      if (path.startsWith('git/matching-refs/')) return tagSha ? [{ ref: `refs/tags/${tag}` }] : [];
      if (path === 'releases/11/assets?per_page=100') return files.map(({ bytes, ...metadata }) => metadata);
      throw new Error(`Unexpected pagination: ${path}`);
    },
    tagSource(actual) { assert.equal(actual, tag); return tagSha; },
    bytes(id) {
      const file = files.find(file => file.id === id);
      return tamper && file.name.endsWith('.apk') ? Buffer.from('changed APK') : file.bytes;
    },
    gh(action, upload, actual, ...args) {
      assert.deepEqual([action, upload, actual, ...args.slice(-2)], ['release', 'upload', tag, '--repo', repo]);
      for (const path of args.slice(0, -2)) {
        const bytes = readFileSync(path);
        files.push({ id: files.length + 1, name: basename(path), state: 'uploaded', bytes,
          size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` });
      }
      events.push('upload');
    },
    api(path, ...args) {
      const field = name => args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
      if (path === 'git/refs') { tagSha = field('sha'); events.push('tag'); return {}; }
      if (path === 'releases') {
        assert.equal(tagSha, source);
        release = { id: 11, tag_name: field('tag_name'), name: field('name'), prerelease: false, draft: true, body: field('body') };
        events.push('draft');
        return release;
      }
      if (path === 'releases/11' && field('draft') === 'false') {
        assert.equal(field('make_latest'), 'true');
        events.push('promote');
        release = { ...release, draft: false, body: field('body') ?? release.body };
        return release;
      }
      if (path === 'releases/11' || path === 'releases/latest') return { ...release };
      if (path === 'contents/README.md?ref=main') return readme;
      if (path === 'contents/README.md') {
        assert.equal(field('sha'), readme.sha);
        events.push('readme');
        readme = { ...readme, content: field('content') };
        return readme;
      }
      throw new Error(`Unexpected API request: ${path}`);
    },
  };
  return { cwd, remote, source, version, events, files, readme: () => Buffer.from(readme.content, 'base64').toString('utf8') };
}

test('draft is verified before promotion, README prose is preserved, and rerun is read-only', t => {
  const state = fixture(t);
  const { cwd, remote, source, version, events, files } = state;
  publish(cwd, remote, source, version, 'android');
  assert.deepEqual(events, ['tag', 'draft', 'upload', 'promote', 'readme']);
  const index = JSON.parse(files.find(file => file.name === 'latest-versions.json').bytes);
  assert.deepEqual(index, { schema: 1, android: 'v0.1.1', windows: null });
  assert.match(state.readme(), /^Before\n[\s\S]*LogsAndroid-0\.1\.1\.apk[\s\S]*\nAfter\n$/);
  publish(cwd, remote, source, version, 'android');
  assert.deepEqual(events, ['tag', 'draft', 'upload', 'promote', 'readme']);
});

test('bad readback bytes leave the release a draft', t => {
  const { cwd, remote, source, version, events } = fixture(t, true);
  assert.throws(() => publish(cwd, remote, source, version, 'android'), /Wrong downloaded bytes/);
  assert.deepEqual(events, ['tag', 'draft', 'upload']);
});

test('a web-only release publishes and verifies the image without changing the native index schema', t => {
  const state = fixture(t);
  const { cwd, remote, source, version, events, files } = state;
  const directory = join(cwd, 'dist/web');
  rmSync(join(cwd, 'dist/android'), { recursive: true });
  mkdirSync(directory);
  const archive = `logs-web-${version}-linux-amd64.tar.gz`;
  writeFileSync(join(directory, archive), 'fixture image');
  stage(directory, 'web', version, source);
  assert.equal(publish(cwd, remote, source, version, 'web'), true);
  assert.deepEqual(events, ['tag', 'draft', 'upload', 'promote', 'readme']);
  assert.deepEqual(files.map(file => file.name), [archive, `${archive}.sha256`, 'logs-web-release.json', 'latest-versions.json']);
  assert.deepEqual(JSON.parse(files.at(-1).bytes), { schema: 1, android: null, windows: null });
  assert.ok(state.readme().includes(`/releases/download/v${version}/${archive}`));
  assert.equal(publish(cwd, remote, source, version, 'web'), true);
  writeFileSync(join(directory, archive), 'not the published image');
  assert.throws(() => publish(cwd, remote, source, version, 'web'), /Changed artifact bytes/);
  rmSync(directory, { recursive: true });
  assert.equal(publish(cwd, remote, source, version, 'maintenance'), false);
  assert.deepEqual(events, ['tag', 'draft', 'upload', 'promote', 'readme']);
  files.find(file => file.name === archive).digest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => publish(cwd, remote, source, version, 'maintenance'), /Wrong remote digest/);
});

test('auto rechecks a missing platform under the publication lock before any write', t => {
  const { cwd, remote, source, version, events } = fixture(t);
  assert.throws(() => publish(cwd, remote, source, version), /windows artifacts are now required.*component=all/);
  assert.deepEqual(events, []);
});

test('exact-source draft recovery requires its original artifact inventory even on maintenance', t => {
  const { cwd, remote, source, version, events, files } = fixture(t, true);
  assert.throws(() => publish(cwd, remote, source, version, 'android'), /Wrong downloaded bytes/);
  unlinkSync(join(cwd, 'dist/latest-versions.json'));
  remote.bytes = id => files.find(file => file.id === id).bytes;
  rmSync(join(cwd, 'dist/android'), { recursive: true });
  assert.throws(() => publish(cwd, remote, source, version, 'maintenance'), /original android artifact/);
  assert.deepEqual(events, ['tag', 'draft', 'upload']);
  const directory = join(cwd, 'dist/android');
  mkdirSync(directory);
  for (const file of files.filter(file => file.name !== 'latest-versions.json')) writeFileSync(join(directory, file.name), file.bytes);
  publish(cwd, remote, source, version, 'maintenance');
  assert.deepEqual(events, ['tag', 'draft', 'upload', 'promote', 'readme']);
});
