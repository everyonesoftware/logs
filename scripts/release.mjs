import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const native = ['android', 'windows'];
const platforms = [...native, 'web'];
const shaPattern = /^[a-f0-9]{40}$/;
const versionPattern = /^0\.1\.[1-9]\d{0,8}$/;
const tagPattern = /^v0\.1\.[1-9]\d{0,8}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const commitCount = version => Number(version.split('.').at(-1));
const windowsInstaller = 'LogsWindows-win-x64-Setup.exe';
const indexName = 'latest-versions.json';
const markerStart = '<!-- current-downloads:start -->';
const markerEnd = '<!-- current-downloads:end -->';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function requireThat(value, message) { if (!value) throw new Error(message); }
function versionAt(cwd, sha) {
  requireThat(shaPattern.test(sha), `Invalid source SHA: ${sha}`);
  requireThat(git(cwd, 'rev-parse', '--is-shallow-repository') === 'false', 'Full Git history is required');
  requireThat(git(cwd, 'rev-parse', `${sha}^{commit}`) === sha, `Not a commit: ${sha}`);
  const version = `0.1.${git(cwd, 'rev-list', '--count', sha)}`;
  requireThat(versionPattern.test(version), `Invalid release version: ${version}`);
  return version;
}
function relation(cwd, a, b) {
  for (const sha of [a, b]) requireThat(shaPattern.test(sha), `Invalid source SHA: ${sha}`);
  if (a === b) return 'same';
  const ancestor = (from, to) => {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', from, to], { cwd, encoding: 'utf8' });
    requireThat(result.status === 0 || result.status === 1, `Cannot compare Git sources: ${result.stderr}`);
    return result.status === 0;
  };
  if (ancestor(a, b)) return 'ancestor';
  if (ancestor(b, a)) return 'descendant';
  return 'divergent';
}
function owners(path) {
  if (path === '.dockerignore') return ['web'];
  if (['README.md', 'AGENTS.md', 'scripts/release.mjs', 'scripts/release.test.mjs', 'scripts/publisher.test.mjs', 'scripts/workflow.test.mjs'].includes(path) || path.startsWith('docs/')) return [];
  if (path.startsWith('mockups/')) return [];
  for (const platform of platforms) {
    if (path === `apps/${platform}/README.md`) return [];
    if (path.startsWith(`apps/${platform}/`)) return [platform];
  }
  if (path === 'scripts/package-android.sh') return ['android'];
  if (path === 'scripts/package-windows.ps1') return ['windows'];
  return platforms; // Workflow and unclassified/transitive build inputs are shared.
}
export function affected(cwd, platform, baseline, source) {
  if (!baseline) return true;
  const order = relation(cwd, baseline, source);
  requireThat(order !== 'divergent', `Divergent ${platform} baseline ${baseline} for ${source}`);
  if (order !== 'ancestor') return false;
  return git(cwd, 'diff', '--name-only', '-z', '--no-renames', baseline, source, '--')
    .split('\0').some(path => path && owners(path).includes(platform));
}

function names(platform, version) {
  if (platform === 'android') return [`LogsAndroid-${version}.apk`];
  if (platform === 'windows') return [windowsInstaller, `LogsWindows-${version}-win-x64-full.nupkg`, 'releases.win-x64.json'];
  if (platform === 'web') return [`logs-web-${version}-linux-amd64.tar.gz`];
  throw new Error(`Unknown platform: ${platform}`);
}
const manifestName = platform => `logs-${platform}-release.json`;
const checksumName = (platform, version) => `${names(platform, version)[0]}.sha256`;
const fileNames = (platform, version) => [...names(platform, version), checksumName(platform, version)];
const checksum = file => `${file.sha256}  ${file.name}\n`;
function describeBytes(name, bytes) {
  requireThat(bytes.length > 0, `Empty asset: ${name}`);
  return { name, size: bytes.length, sha256: digest(bytes) };
}
function describe(directory, name) {
  const path = join(directory, name);
  requireThat(lstatSync(path).isFile(), `Artifact must be a regular file: ${path}`);
  return describeBytes(name, readFileSync(path));
}
function requireNames(directory, expected) {
  requireThat(readdirSync(directory).sort().join('\n') === [...expected].sort().join('\n'), `Unexpected inventory in ${directory}; expected ${expected.join(', ')}`);
}
function manifestContract(manifest, platform, version, source) {
  requireThat(versionPattern.test(version) && shaPattern.test(source), 'Invalid package version/source');
  requireThat(manifest?.schema === 1 && manifest.platform === platform && manifest.version === version && manifest.source === source, 'Package manifest identity mismatch');
  requireThat(manifest.signing === (platform === 'android' ? 'signed' : 'unsigned'), 'Unexpected package signing policy');
  const expected = fileNames(platform, version);
  requireThat(Array.isArray(manifest.files) && expected.length === manifest.files.length, 'Package manifest inventory mismatch');
  for (const [i, { name, size, sha256 }] of manifest.files.entries()) {
    requireThat(name === expected[i] && Number.isSafeInteger(size) && size > 0 && /^[a-f0-9]{64}$/.test(sha256), `Invalid package manifest asset: ${name}`);
  }
  return manifest;
}
export function stage(directory, platform, version, source) {
  requireThat(versionPattern.test(version) && shaPattern.test(source), 'Invalid package version/source');
  requireNames(directory, names(platform, version));
  const files = names(platform, version).map(name => describe(directory, name));
  const sidecar = checksumName(platform, version);
  writeFileSync(join(directory, sidecar), checksum(files[0]), { flag: 'wx' });
  files.push(describe(directory, sidecar));
  const manifest = { schema: 1, platform, version, source, signing: platform === 'android' ? 'signed' : 'unsigned', files };
  writeFileSync(join(directory, manifestName(platform)), `${JSON.stringify(manifest)}\n`, { flag: 'wx' });
  return inspect(directory, platform, version, source);
}
export function inspect(directory, platform, version, source) {
  const file = manifestName(platform);
  requireNames(directory, [file, ...fileNames(platform, version)]);
  describe(directory, file);
  const manifest = manifestContract(JSON.parse(readFileSync(join(directory, file), 'utf8')), platform, version, source);
  for (const expected of manifest.files) {
    const actual = describe(directory, expected.name);
    requireThat(actual.size === expected.size && actual.sha256 === expected.sha256, `Changed artifact bytes: ${expected.name}`);
  }
  requireThat(readFileSync(join(directory, checksumName(platform, version)), 'utf8') === checksum(manifest.files[0]), 'Package checksum sidecar mismatch');
  return manifest;
}

export function downloads(repo, tags) {
  const webInstructions = `https://github.com/${repo}/blob/main/apps/web/README.md`;
  const rows = platforms.map(platform => {
    const tag = tags[platform];
    if (platform === 'web' && !tag) return `| Web | — | [Run locally](${webInstructions}) | No production deployment |`;
    const label = platform === 'android' ? 'Android' : 'Windows x64';
    const caveat = platform === 'android' ? 'Signed APK; synthetic-data build' : 'Unsigned installer; synthetic-data build';
    if (!tag) return `| ${label} | — | — | Not published |`;
    requireThat(tagPattern.test(tag), `Invalid download tag: ${tag}`);
    const version = tag.slice(1);
    const url = `https://github.com/${repo}/releases/download/${tag}`;
    if (platform === 'web') return `| Web | ${version} | [Docker image](${url}/${names(platform, version)[0]}) · [SHA-256](${url}/${checksumName(platform, version)}) · [Run instructions](${webInstructions}) | Linux x64; self-hosted, synthetic data |`;
    return `| ${label} | ${version} | [${platform === 'android' ? 'APK' : 'Installer'}](${url}/${names(platform, version)[0]}) · [SHA-256](${url}/${checksumName(platform, version)}) | ${caveat} |`;
  });
  return [markerStart, '## Current downloads', '', '| Platform | Version | Download | Status |', '| --- | --- | --- | --- |', ...rows, markerEnd].join('\n');
}
export function replaceTable(body, table) {
  const start = body.indexOf(markerStart);
  const end = body.indexOf(markerEnd);
  requireThat(start >= 0 && start < end && start === body.lastIndexOf(markerStart) && end === body.lastIndexOf(markerEnd), 'Current downloads markers must exist exactly once and in order');
  return body.slice(0, start) + table + body.slice(end + markerEnd.length);
}

function github(repo) {
  requireThat(/^[\w.-]+\/[\w.-]+$/.test(repo), 'Set GH_REPO to owner/repository');
  const prefix = `repos/${repo}`;
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const api = (path, ...args) => JSON.parse(gh('api', `${prefix}/${path}`, ...args));
  const pages = (path, key) => {
    const response = JSON.parse(gh('api', '--paginate', '--slurp', `${prefix}/${path}`));
    return response.flatMap(page => key ? page[key] : page);
  };
  const bytes = id => execFileSync('gh', ['api', `${prefix}/releases/assets/${id}`, '-H', 'Accept: application/octet-stream'], { maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const tagSource = tag => {
    let ref = api(`git/ref/tags/${tag}`).object;
    for (let i = 0; ref.type === 'tag' && i < 5; i++) ref = api(`git/tags/${ref.sha}`).object;
    requireThat(ref.type === 'commit' && shaPattern.test(ref.sha), `Tag does not resolve to a commit: ${tag}`);
    return ref.sha;
  };
  return { gh, api, pages, bytes, tagSource, repo };
}
function inventory(assets) {
  const map = new Map();
  for (const asset of assets) {
    requireThat(!map.has(asset.name), `Duplicate asset: ${asset.name}`);
    map.set(asset.name, asset);
  }
  return map;
}
function checkAsset(remote, asset, expected, download = false) {
  requireThat(asset && asset.state === 'uploaded' && asset.size === expected.size, `Missing or wrong-size asset: ${expected.name}`);
  if (asset.digest) requireThat(asset.digest === `sha256:${expected.sha256}`, `Wrong remote digest: ${expected.name}`);
  if (download || !asset.digest) requireThat(digest(remote.bytes(asset.id)) === expected.sha256, `Wrong downloaded bytes: ${expected.name}`);
}
function readSmall(remote, asset, max = 65536) {
  requireThat(asset && asset.state === 'uploaded' && asset.size > 0 && asset.size <= max, 'Missing or oversized release metadata');
  const bytes = remote.bytes(asset.id);
  requireThat(bytes.length === asset.size && (!asset.digest || asset.digest === `sha256:${digest(bytes)}`), `Metadata bytes mismatch: ${asset.name}`);
  return bytes.toString('utf8');
}
const byVersion = (a, b) => commitCount(b.tag_name) - commitCount(a.tag_name);
function publications(cwd, remote) {
  const releases = remote.pages('releases?per_page=100').filter(r => tagPattern.test(r.tag_name));
  const stable = releases.filter(r => !r.draft && !r.prerelease).sort(byVersion);
  const current = {};
  for (const release of stable) {
    if (platforms.every(platform => current[platform])) break;
    const tag = release.tag_name;
    const version = tag.slice(1);
    const assets = inventory(remote.pages(`releases/${release.id}/assets?per_page=100`));
    for (const platform of platforms) {
      const entry = assets.get(manifestName(platform));
      if (current[platform] || !entry || !fileNames(platform, version).every(name => assets.has(name))) continue;
      const source = remote.tagSource(tag);
      requireThat(versionAt(cwd, source) === version, `Release version does not match source: ${tag}`);
      const manifest = manifestContract(JSON.parse(readSmall(remote, entry)), platform, version, source);
      for (const expected of manifest.files) checkAsset(remote, assets.get(expected.name), expected);
      requireThat(readSmall(remote, assets.get(checksumName(platform, version)), 1024) === checksum(manifest.files[0]), `Bad checksum sidecar on ${tag}`);
      current[platform] = { tag, source };
    }
  }
  return { releases, stable, current };
}
const tagsFor = current => Object.fromEntries(platforms.map(platform => [platform, current[platform]?.tag ?? null]));

function select(cwd, env, remote, source, version) {
  const target = env.TARGET_COMPONENT || 'auto';
  requireThat(['auto', 'all', 'maintenance', ...platforms].includes(target), `Invalid target: ${target}`);
  let decisions;
  if (target !== 'auto') {
    decisions = Object.fromEntries(platforms.map(platform => [platform, target === 'all' || target === platform]));
  } else if (env.GITHUB_BASE_REF) {
    // GitHub checks out the synthetic merge commit; its first parent is the base tip.
    const base = git(cwd, 'rev-parse', `${source}^1`);
    decisions = Object.fromEntries(platforms.map(platform => [platform, affected(cwd, platform, base, source)]));
  } else {
    const { current } = publications(cwd, remote);
    decisions = Object.fromEntries(platforms.map(platform => [platform, affected(cwd, platform, current[platform]?.source, source)]));
  }
  const output = Object.entries({ ...decisions, version }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}

function refreshReadme(remote, table) {
  const file = remote.api('contents/README.md?ref=main');
  requireThat(file.encoding === 'base64' && shaPattern.test(file.sha), 'Unexpected README metadata');
  const original = Buffer.from(file.content, 'base64').toString('utf8');
  const body = replaceTable(original, table);
  if (body === original) return;
  remote.api('contents/README.md', '--method', 'PUT', '-f', 'branch=main', '-f', 'message=docs: refresh current platform downloads', '-f', `sha=${file.sha}`, '-f', `content=${Buffer.from(body).toString('base64')}`);
  const updated = remote.api('contents/README.md?ref=main');
  requireThat(Buffer.from(updated.content, 'base64').toString('utf8') === body, 'README readback mismatch');
}
function refreshRelease(remote, release, table) {
  // Release descriptions do not have a blob-SHA precondition; all automated writers share a job lock.
  const current = remote.api(`releases/${release.id}`);
  requireThat(current.tag_name === release.tag_name && !current.draft && !current.prerelease, 'Release changed before download refresh');
  const desired = replaceTable(current.body ?? '', table);
  if (desired === current.body) return;
  requireThat(remote.api(`releases/${release.id}`).body === current.body, 'Release description changed before refresh');
  remote.api(`releases/${release.id}`, '--method', 'PATCH', '-f', `body=${desired}`);
  requireThat(remote.api(`releases/${release.id}`).body === desired, 'Release description readback mismatch');
}
export function checkDraftAssets(existing, assets) {
  for (const name of existing.keys()) requireThat(assets.has(name), `Unexpected existing release asset: ${name}`);
}
export function publish(cwd, remote, source, version, target = 'auto', androidSigningMissing = false) {
  const state = publications(cwd, remote);
  const tag = `v${version}`;
  let latest = state.stable[0];
  // Runs can finish out of order. Never promote an older commit or mutate its index.
  if (latest) requireThat(relation(cwd, remote.tagSource(latest.tag_name), source) !== 'divergent', 'Latest stable Logs release is divergent');
  const existingRelease = state.releases.find(release => release.tag_name === tag);
  const older = Boolean(latest && byVersion(latest, { tag_name: tag }) < 0);
  const tags = tagsFor(state.current);
  const assets = new Map();
  const prefix = '<!-- logs-release-plan: ';
  let frozen;
  if (!older && existingRelease?.draft) {
    const line = existingRelease.body?.split('\n')[0];
    requireThat(line?.startsWith(prefix) && line.endsWith(' -->'), `Missing original release plan for draft ${tag}`);
    frozen = JSON.parse(line.slice(prefix.length, -4));
    requireThat(frozen?.source === source && platforms.some(platform => frozen[platform] === tag), `Invalid draft release plan for ${tag}`);
  }
  if (!older && !existingRelease?.draft && existingRelease) {
    requireThat(!existingRelease.prerelease && remote.tagSource(tag) === source, `Existing release is not the expected stable source: ${tag}`);
    for (const platform of platforms) {
      if (existsSync(join(cwd, 'dist', platform))) requireThat(tags[platform] === tag, `Cannot add ${platform} to published ${tag}; publish it from a new main commit`);
    }
    console.log(`${tag} already published; leaving binaries unchanged`);
  } else if (!older) {
    for (const platform of platforms) {
      const directory = join(cwd, 'dist', platform);
      const hasArtifact = existsSync(directory);
      if (frozen) {
        if (frozen[platform] !== tag) {
          requireThat((frozen[platform] ?? null) === tags[platform], `Draft ${tag} predates the current ${platform} publication; use a new main commit with component=all`);
          continue;
        }
        requireThat(hasArtifact, `Restore the original ${platform} artifact before retrying draft ${tag}`);
      } else {
        const selected = target === 'all' || target === platform || (target === 'auto' && affected(cwd, platform, state.current[platform]?.source, source));
        if (!selected) continue;
        if (!hasArtifact && platform === 'android' && androidSigningMissing) continue;
        requireThat(hasArtifact, `${platform} artifacts are now required for ${tag}; dispatch Logs CI with component=all at current main`);
      }
      const manifest = inspect(directory, platform, version, source);
      for (const file of [...manifest.files, describe(directory, manifestName(platform))]) assets.set(file.name, { ...file, path: join(directory, file.name) });
      tags[platform] = tag;
    }
  } else {
    console.log(`Skipping stale publication ${tag}; ${latest.tag_name} is already published`);
  }
  if (assets.size) {
    const nativeTags = Object.fromEntries(native.map(platform => [platform, tags[platform]]));
    const index = Buffer.from(`${JSON.stringify({ schema: 1, ...nativeTags })}\n`);
    const indexPath = join(cwd, 'dist', indexName);
    writeFileSync(indexPath, index, { flag: 'wx' });
    assets.set(indexName, { ...describeBytes(indexName, index), path: indexPath });
    const title = `Logs ${version}`;
    const body = downloads(remote.repo, tags);
    const fingerprint = digest(JSON.stringify([...assets.values()].map(({ name, size, sha256 }) => ({ name, size, sha256 }))));
    const draftBody = `${prefix}${JSON.stringify({ source, ...nativeTags, ...(tags.web ? { web: tags.web } : {}), fingerprint })} -->\n\n${body}`;
    const refs = remote.pages(`git/matching-refs/tags/${tag}?per_page=100`);
    if (!refs.some(ref => ref.ref === `refs/tags/${tag}`)) {
      requireThat(!existingRelease, `Existing draft has no exact tag: ${tag}`);
      remote.api('git/refs', '--method', 'POST', '-f', `ref=refs/tags/${tag}`, '-f', `sha=${source}`);
    }
    requireThat(remote.tagSource(tag) === source, `Tag ${tag} does not point to ${source}`);
    const draft = existingRelease ?? remote.api('releases', '--method', 'POST', '-f', `tag_name=${tag}`, '-f', `target_commitish=${source}`, '-f', `name=${title}`, '-f', `body=${draftBody}`, '-F', 'draft=true', '-F', 'prerelease=false', '-f', 'make_latest=false');
    // GitHub ignores target_commitish when a tag already exists; the dereferenced tag binds the draft.
    const correctDraft = value => value.draft && !value.prerelease && value.tag_name === tag && value.name === title && value.body === draftBody;
    requireThat(correctDraft(draft), `Conflicting release draft: ${tag}`);
    const getAssets = () => inventory(remote.pages(`releases/${draft.id}/assets?per_page=100`));
    const existing = getAssets();
    checkDraftAssets(existing, assets);
    for (const [name, asset] of existing) {
      requireThat(!(asset.state === 'starter' && asset.size === 0), `Remove the zero-byte starter asset ${name} from draft ${tag}, then rerun with the original artifacts`);
      checkAsset(remote, asset, assets.get(name));
    }
    const missing = [...assets.values()].filter(file => !existing.has(file.name));
    if (missing.length) remote.gh('release', 'upload', tag, ...missing.map(file => file.path), '--repo', remote.repo);
    const uploaded = getAssets();
    checkDraftAssets(uploaded, assets);
    for (const [name, expected] of assets) checkAsset(remote, uploaded.get(name), expected, true);
    const finalDraft = remote.api(`releases/${draft.id}`);
    requireThat(correctDraft(finalDraft) && remote.tagSource(tag) === source, `Draft changed before publishing: ${tag}`);
    remote.api(`releases/${draft.id}`, '--method', 'PATCH', '-F', 'draft=false', '-f', 'make_latest=true', '-f', `body=${body}`);
    latest = remote.api('releases/latest');
    requireThat(latest.id === draft.id && latest.tag_name === tag && !latest.draft && !latest.prerelease && latest.body === body && remote.tagSource(tag) === source, `Release readback mismatch: ${tag}`);
    console.log(`Published Logs ${version} from ${source}`);
  }
  if (latest) {
    const table = downloads(remote.repo, tags);
    refreshRelease(remote, latest, table);
    refreshReadme(remote, table);
  } else {
    console.log('No published Logs versions to refresh');
  }
}

function main(args, env, cwd) {
  const [command, platform, requestedVersion, requestedSource] = args;
  const source = env.GITHUB_SHA || git(cwd, 'rev-parse', 'HEAD');
  const version = versionAt(cwd, source);
  requireThat(git(cwd, 'rev-parse', 'HEAD') === source, 'Checkout must match release source');
  if (command === 'stage' && args.length === 4) {
    requireThat(source === requestedSource && version === requestedVersion, 'Packaging version/source mismatch');
    stage(join(cwd, 'dist', platform), platform, version, source);
    return;
  }
  requireThat(args.length === 1 && ['select', 'publish', 'preview'].includes(command), 'Usage: release.mjs select | publish | preview | stage PLATFORM VERSION SHA');
  const remote = github(env.GH_REPO || env.GITHUB_REPOSITORY || 'everyonesoftware/logs');
  if (command === 'select') select(cwd, env, remote, source, version);
  if (command === 'preview') console.log(downloads(remote.repo, tagsFor(publications(cwd, remote).current)));
  if (command === 'publish') {
    requireThat(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REF === 'refs/heads/main' && ['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) && env.LOGS_PUBLISH_RELEASES === 'true', 'Only the enabled main release job may publish');
    publish(cwd, remote, source, version, env.TARGET_COMPONENT, env.ANDROID_SIGNING_MISSING === 'true');
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2), process.env, process.cwd()); }
  catch (error) {
    console.error(error.stderr?.toString().trim() || error.message);
    process.exitCode = 1;
  }
}
