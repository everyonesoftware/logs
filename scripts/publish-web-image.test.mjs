import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readManifest, publishImage } from './publish-web-image.mjs';
const image = 'ghcr.io/everyonesoftware/logs-web:0.1.11';
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
