import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const { parse } = createRequire(import.meta.url)('yaml');
const directory = new URL('../.github/workflows/', import.meta.url);
const trustedMain = "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')";
const targetComponent = "${{ github.event_name == 'workflow_dispatch' && inputs.component || 'auto' }}";
const signingSecrets = ['LOGS_KEYSTORE_BASE64', 'LOGS_KEYSTORE_PASSWORD', 'LOGS_KEY_ALIAS', 'LOGS_KEY_PASSWORD'];

function workflow() {
  const file = new URL('ci.yml', directory);
  assert.ok(existsSync(file), 'Logs CI workflow is missing');
  return parse(readFileSync(file, 'utf8'));
}

function action(job, name) {
  const step = job.steps.find(step => step.uses?.startsWith(`${name}@`));
  assert.ok(step, `Missing ${name} step`);
  return step;
}

function command(job, source) {
  const step = job.steps.find(step => step.run?.includes(source));
  assert.ok(step, `Missing ${source} step`);
  return step;
}

test('one workflow owns main pushes and validates pull requests without write permissions', () => {
  const ci = workflow();
  const triggers = Object.fromEntries(readdirSync(directory).filter(file => /\.ya?ml$/.test(file)).map(file => [file, parse(readFileSync(new URL(file, directory), 'utf8')).on]));
  const owners = event => Object.keys(triggers).filter(file => Object.hasOwn(triggers[file], event));
  for (const event of ['push', 'pull_request', 'workflow_dispatch']) assert.deepEqual(owners(event), ['ci.yml']);
  for (const event of ['workflow_run', 'pull_request_target']) assert.deepEqual(owners(event), []);
  assert.deepEqual(ci.on.push, { branches: ['main'] });
  assert.deepEqual(ci.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(ci.jobs).sort(), ['android', 'release', 'validate', 'web', 'windows']);
  for (const [id, job] of Object.entries(ci.jobs)) {
    assert.equal(job.uses, undefined, id);
    assert.equal(job['continue-on-error'], undefined, id);
    if (id !== 'release') assert.equal(job.permissions, undefined, id);
    for (const step of job.steps) {
      assert.equal(step['continue-on-error'], undefined, step.name);
      if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}$/, step.uses);
    }
    assert.equal(action(job, 'actions/checkout').with['persist-credentials'], false);
  }
});

test('the live selector fans out to independent platform jobs and uses full history', () => {
  const ci = workflow();
  const { validate } = ci.jobs;
  const { component } = ci.on.workflow_dispatch.inputs;
  assert.deepEqual(component.options, ['all', 'android', 'windows', 'web', 'maintenance']);
  assert.equal(component.default, 'all');
  assert.equal(action(validate, 'actions/checkout').with['fetch-depth'], 0);
  const select = command(validate, 'node scripts/release.mjs select');
  assert.equal(select.env.TARGET_COMPONENT, targetComponent);
  assert.ok(validate.steps.indexOf(command(validate, 'node --test scripts/*.test.mjs')) < validate.steps.indexOf(select));
  for (const output of ['web', 'android', 'windows', 'version']) {
    assert.equal(validate.outputs[output], `\${{ steps.${select.id}.outputs.${output} }}`);
    if (output === 'version') continue;
    assert.equal(ci.jobs[output].needs, 'validate');
    assert.equal(ci.jobs[output].if, `needs.validate.outputs.${output} == 'true'`);
  }
});

test('selected clients execute their real tests, not just build their test binaries', () => {
  const { web, android, windows } = workflow().jobs;
  const browser = command(web, 'playwright install --with-deps chromium');
  const webTest = command(web, 'npm test');
  assert.equal(web.defaults.run['working-directory'], 'apps/web');
  assert.ok(web.steps.indexOf(browser) < web.steps.indexOf(webTest));
  assert.equal(webTest.if, undefined);
  const androidChecks = command(android, ':app:testDebugUnitTest');
  assert.equal(androidChecks.if, undefined);
  assert.match(androidChecks.run, /:app:lintDebug/);
  assert.match(androidChecks.run, /:app:assembleRelease/);
  assert.equal(androidChecks.env, undefined);
  const emulator = action(android, 'reactivecircus/android-emulator-runner');
  assert.equal(emulator.if, undefined);
  assert.match(emulator.with.script, /:app:connectedDebugAndroidTest/);
  assert.ok(android.steps.indexOf(emulator) < android.steps.indexOf(command(android, 'scripts/package-android.sh')));
  assert.equal(command(windows, 'dotnet run --project apps/windows/Logs.Tests').if, undefined);
  const pack = command(windows, './scripts/package-windows.ps1');
  const smoke = command(windows, '--installto');
  assert.equal(pack.if, undefined);
  assert.equal(smoke.if, undefined);
  assert.match(smoke.run, /dist\/windows\/LogsWindows-win-x64-Setup\.exe/);
  assert.match(smoke.run, /MainWindowHandle/);
  assert.match(smoke.run, /--uninstall/);
  assert.ok(windows.steps.indexOf(pack) < windows.steps.indexOf(smoke));
  assert.ok(windows.steps.indexOf(smoke) < windows.steps.indexOf(command(windows, 'node scripts/release.mjs stage windows')));
});

test('Android signing is trusted-main-only, skips absent credentials and rejects partial configuration', t => {
  const { android } = workflow().jobs;
  const pack = command(android, 'scripts/package-android.sh');
  assert.equal(pack.if, trustedMain);
  assert.deepEqual(Object.keys(pack.env).filter(key => key.startsWith('LOGS_')).sort(), [...signingSecrets].sort());
  for (const secret of signingSecrets) assert.equal(pack.env[secret], `\${{ secrets.${secret} }}`);

  // Execute the actual workflow shell with disposable stand-ins for the two downstream commands.
  const cwd = mkdtempSync(join(tmpdir(), 'logs-ci-signing-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'scripts'));
  const source = 'a'.repeat(40);
  const version = '0.1.42';
  const output = join(cwd, 'github-output');
  writeFileSync(join(cwd, 'scripts/package-android.sh'), 'printf "package %s\\n" "$*" >> calls\n');
  writeFileSync(join(cwd, 'scripts/release.mjs'), "import { appendFileSync } from 'node:fs'; appendFileSync('calls', process.argv.slice(2).join(' ') + '\\n');\n");
  const run = count => spawnSync('bash', ['-euo', 'pipefail', '-c', pack.run], {
    cwd,
    env: { PATH: process.env.PATH, VERSION: version, GITHUB_SHA: source, GITHUB_OUTPUT: output, ...Object.fromEntries(signingSecrets.slice(0, count).map(key => [key, 'fixture-only'])) },
    encoding: 'utf8',
  });
  const absent = run(0);
  assert.equal(absent.status, 0, absent.stderr);
  assert.match(absent.stdout, /signing.*not configured/i);
  assert.equal(readFileSync(output, 'utf8'), 'signing_missing=true\n');
  assert.equal(existsSync(join(cwd, 'calls')), false);
  for (const count of [1, 2, 3]) assert.notEqual(run(count).status, 0, `accepted ${count}/4 signing values`);
  assert.equal(existsSync(join(cwd, 'calls')), false);
  writeFileSync(output, '');
  const ready = run(4);
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(readFileSync(join(cwd, 'calls'), 'utf8'), `package ${version} ${source}\nstage android ${version} ${source}\n`);
  assert.equal(readFileSync(output, 'utf8'), 'ready=true\n');
  assert.equal(action(android, 'actions/upload-artifact').if, `steps.${pack.id}.outputs.ready == 'true'`);
});

test('Web builds and reloads a Docker archive before running browser tests and retaining it', () => {
  const { web } = workflow().jobs;
  assert.equal(action(web, 'actions/checkout').with['fetch-depth'], 0, 'staging must verify the release version against full history');
  const build = command(web, 'docker build');
  const reload = command(web, 'docker image load');
  const browser = command(web, 'npm test');
  const stop = command(web, 'docker rm');
  const stage = command(web, 'node scripts/release.mjs stage web');
  const upload = action(web, 'actions/upload-artifact');
  assert.equal(web.env.VERSION, '${{ needs.validate.outputs.version }}');
  assert.equal(reload.if, undefined);
  assert.match(reload.run, /LOGS_WEB_TEST_URL=.*GITHUB_ENV/);
  assert.equal(browser.env.LOGS_WEB_TEST_VERSION, web.env.VERSION);
  assert.equal(stop.if, 'always()');
  for (const [earlier, later] of [[build, reload], [reload, browser], [browser, stage], [stage, upload]]) {
    assert.ok(web.steps.indexOf(earlier) < web.steps.indexOf(later));
  }
});

test('Web readiness retries a TCP reset while the container starts', async t => {
  const probe = command(workflow().jobs.web, 'curl --fail').run.split('\n').find(line => line.startsWith('curl '));
  let requests = 0;
  const server = createServer((request, response) => {
    assert.equal(request.url, '/version.json');
    if (++requests === 1) request.socket.resetAndDestroy();
    else response.end('{"version":"0.1.1"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await promisify(execFile)('bash', ['-euo', 'pipefail', '-c', probe], {
    env: { ...process.env, address: `127.0.0.1:${server.address().port}` },
    timeout: 5000,
  });
  assert.equal(requests, 2);
});

test('release is opt-in, serialized, and blocks failed, cancelled, or unexpectedly skipped selected jobs', () => {
  const { release } = workflow().jobs;
  assert.deepEqual(release.needs, ['validate', 'web', 'android', 'windows']);
  assert.deepEqual(release.permissions, { contents: 'write', actions: 'read' });
  assert.deepEqual(release.concurrency, { group: 'logs-release-publication', 'cancel-in-progress': false, queue: 'max' });
  assert.equal(action(release, 'actions/checkout').with['fetch-depth'], 0);
  const expected = ['!cancelled()', trustedMain, "vars.LOGS_PUBLISH_RELEASES == 'true'", "needs.validate.result == 'success'"];
  for (const platform of ['web', 'android', 'windows']) {
    expected.push(`(needs.${platform}.result == 'success' || (needs.${platform}.result == 'skipped' && needs.validate.outputs.${platform} == 'false'))`);
  }
  assert.equal(release.if.replace(/\s+/g, ' ').trim(), expected.join(' && '));
  assert.equal(release.env?.LOGS_PUBLISH_RELEASES, '${{ vars.LOGS_PUBLISH_RELEASES }}');
  assert.equal(release.env?.TARGET_COMPONENT, targetComponent);
  assert.equal(command(release, 'node scripts/release.mjs publish').if, undefined, 'publisher must run to repair tables even with no artifacts');
});

test('publication restores exact-source artifacts from the same run and rejects digest mismatch', () => {
  const ci = workflow();
  const { release } = ci.jobs;
  const publish = command(release, 'node scripts/release.mjs publish');

  for (const platform of ['android', 'windows', 'web']) {
    const job = ci.jobs[platform];
    const upload = action(job, 'actions/upload-artifact');
    if (platform === 'windows') {
      assert.equal(upload.if, trustedMain);
      assert.ok(job.steps.indexOf(command(job, './scripts/package-windows.ps1')) < job.steps.indexOf(command(job, 'node scripts/release.mjs stage windows')));
    }
    assert.equal(upload.with.name, `logs-${platform}-\${{ github.sha }}`);
    assert.equal(upload.with.path, `dist/${platform}/`);
    assert.equal(upload.with['if-no-files-found'], 'error');
    assert.equal(job.outputs.artifact, `\${{ steps.${upload.id}.outputs.artifact-id }}`);
    const restore = release.steps.find(step => step.uses?.startsWith('actions/download-artifact@') && step.with?.name === upload.with.name);
    assert.ok(restore, `no restore for ${platform}`);
    assert.equal(restore.if, `needs.${platform}.result == 'success' && needs.${platform}.outputs.artifact != ''`);
    assert.equal(restore.with.path, `dist/${platform}`);
    assert.equal(restore.with['digest-mismatch'], 'error');
    for (const key of ['run-id', 'github-token', 'repository', 'pattern']) assert.equal(restore.with[key], undefined);
    assert.ok(release.steps.indexOf(restore) < release.steps.indexOf(publish));
    assert.equal(publish.env[`${platform.toUpperCase()}_BUILT`], undefined);
  }
});
