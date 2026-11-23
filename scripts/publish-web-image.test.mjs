import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { readManifest, publishImage, promoteLatest } from './publish-web-image.mjs';
const image = 'ghcr.io/everyonesoftware/logs:0.1.11';
const config = `sha256:${'a'.repeat(64)}`;
const digest = `sha256:${'b'.repeat(64)}`;

test('missing manifest permits one push; matching tags retry without a push', async () => {
  let manifest = null;
  let pushes = 0;
  const read = async () => manifest;
  const push = () => { pushes++; manifest = { config, digest }; };
  assert.equal(await publishImage({ image, config, read, push }), digest);
  assert.equal(await publishImage({ image, config, read, push }), digest);
  assert.equal(pushes, 1);
});

test('refuses to overwrite a conflicting tag and requires readback after a push', async () => {
  await assert.rejects(publishImage({ image, config, read: async () => ({ config: digest, digest }), push: () => assert.fail('must not push') }), /Refusing to overwrite/);
  await assert.rejects(publishImage({ image, config, read: async () => null, push: () => {} }), /Registry readback mismatch/);
});

test('only a confirmed missing registry manifest is treated as absent', async () => {
  const request = status => async () => Response.json({ errors: [{ code: 'MANIFEST_UNKNOWN' }] }, { status });
  assert.equal(await readManifest(image, 'fixture', request(404)), null);
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(readManifest(image, 'fixture', request(status)), new RegExp(`HTTP ${status}`));
  }
  assert.deepEqual(await readManifest(image, 'fixture', async () => Response.json({ schemaVersion: 2, config: { digest: config } }, { headers: { 'docker-content-digest': digest } })), { config, digest });
});

test('reads the versioned manifest from the renamed package', async () => {
  await readManifest(image, 'fixture', async url => {
    assert.equal(url, 'https://ghcr.io/v2/everyonesoftware/logs/manifests/0.1.11');
    return Response.json({ errors: [{ code: 'MANIFEST_UNKNOWN' }] }, { status: 404 });
  });
});

test('reads the latest alias from the same package', async () => {
  await readManifest('ghcr.io/everyonesoftware/logs:latest', 'fixture', async url => {
    assert.equal(url, 'https://ghcr.io/v2/everyonesoftware/logs/manifests/latest');
    return Response.json({ errors: [{ code: 'MANIFEST_UNKNOWN' }] }, { status: 404 });
  });
});

test('promotion copies the exact versioned manifest once and verifies the alias', async () => {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 2, config: { digest: config } }, null, 2));
  const expected = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const mediaType = 'application/vnd.oci.image.manifest.v1+json';
  const manifest = () => new Response(bytes, { headers: { 'Content-Type': mediaType, 'Docker-Content-Digest': expected } });
  let writes = 0;
  let visible = false;
  let replicate = false;
  const request = async (url, options) => {
    if (url.endsWith('/0.1.11')) return manifest();
    assert.equal(url, 'https://ghcr.io/v2/everyonesoftware/logs/manifests/latest');
    if (options.method === 'PUT') {
      assert.equal(options.headers['Content-Type'], mediaType);
      assert.deepEqual(options.body, bytes);
      writes++;
      visible = replicate;
      return new Response(null, { status: 201 });
    }
    return visible ? manifest() : Response.json({ errors: [{ code: 'MANIFEST_UNKNOWN' }] }, { status: 404 });
  };
  await assert.rejects(promoteLatest(image, 'fixture', digest, request), /changed versioned manifest/);
  assert.equal(writes, 0);
  await assert.rejects(promoteLatest(image, 'fixture', expected, request), /Registry readback mismatch/);
  replicate = true;
  assert.equal(await promoteLatest(image, 'fixture', expected, request), expected);
  assert.equal(await promoteLatest(image, 'fixture', expected, request), expected);
  assert.equal(writes, 2);
});
