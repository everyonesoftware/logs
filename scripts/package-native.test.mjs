import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
function run(command, args, env = process.env) {
    const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8' });
    if (result.error) throw result.error;
    return { status: result.status, output: result.stdout + result.stderr };
}
const sha = run('git', ['rev-parse', 'HEAD']).output.trim();

if (process.platform !== 'win32') {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LOGS_KEY')));
    const android = (version, source = sha) => run('bash', ['scripts/package-android.sh', version, source], env);
    test('Android refuses version codes that Android cannot install', () => {
        for (const version of ['0.1.0', '0.1.01', '0.1.2100000001', 'v0.1.5']) {
            const result = android(version);
            assert.equal(result.status, 1);
            assert.match(result.output, /version/i);
            assert.doesNotMatch(result.output, /No such file/);
        }
    });
    test('Android refuses a source other than the checked-out HEAD', () => {
        const result = android('0.1.5', '0'.repeat(40));
        assert.equal(result.status, 1);
        assert.match(result.output, /source SHA.*HEAD/i);
    });
    test('Android release packaging refuses missing signing inputs', () => {
        const result = android('0.1.5');
        assert.equal(result.status, 1);
        assert.match(result.output, /LOGS_KEYSTORE_BASE64/);
    });
}

const pwsh = process.env.PWSH ?? 'pwsh';
const hasPwsh = spawnSync(pwsh, ['-NoProfile', '-Command', 'exit 0']).status === 0;
if (process.platform !== 'win32' && hasPwsh) {
    test('Windows installer packaging refuses non-Windows hosts', () => {
        const result = run(pwsh, ['-NoProfile', '-File', 'scripts/package-windows.ps1', '0.1.5', sha]);
        assert.notEqual(result.status, 0);
        assert.match(result.output, /requires native Windows/i);
    });
}

test('Windows validates the Velopack feed against the staged full package', { skip: !hasPwsh }, t => {
    const directory = mkdtempSync(join(tmpdir(), 'logs-velofeed-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const pack = 'LogsWindows-0.1.5-win-x64-full.nupkg';
    const setup = 'LogsWindows-win-x64-Setup.exe';
    const feed = 'releases.win-x64.json';
    const data = 'fixture full nupkg bytes';
    const digest = algorithm => createHash(algorithm).update(data).digest('hex').toUpperCase();
    writeFileSync(join(directory, setup), 'fixture setup bytes');
    writeFileSync(join(directory, pack), data);
    writeFileSync(join(directory, feed), JSON.stringify({ Assets: [{ PackageId: 'LogsWindows', Version: '0.1.5',
        Type: 'Full', FileName: pack, Size: data.length, SHA1: digest('sha1'), SHA256: digest('sha256') }] }));
    const validate = () => run(pwsh, ['-NoProfile', '-Command', `
        $ErrorActionPreference = 'Stop'
        Set-StrictMode -Version Latest
        $ast = [System.Management.Automation.Language.Parser]::ParseFile('scripts/package-windows.ps1', [ref]$null, [ref]$null)
        $validator = $ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-VelopackOutput'}, $false)
        . ([scriptblock]::Create($validator.Extent.Text))
        Assert-VelopackOutput $env:LOGS_TEST_FEED_DIRECTORY '0.1.5'
    `], { ...process.env, LOGS_TEST_FEED_DIRECTORY: directory });
    const accepted = validate();
    assert.equal(accepted.status, 0, accepted.output);
    assert.deepEqual(accepted.output.trim().split(/\r?\n/), [setup, pack, feed]);
    writeFileSync(join(directory, pack), data.toUpperCase());
    const rejected = validate();
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.output, /feed does not match the full package/i);
});
