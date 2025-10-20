'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  Object.keys(process.env).forEach((key) => {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  });
  Object.entries(ORIGINAL_ENV).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

test('startTunnel returns null when disabled', async () => {
  resetEnv();
  process.env.GPT_CAR_DISABLE_TUNNEL = '1';
  const { startTunnel } = require('../src/tunnel');
  const result = await startTunnel({ port: 5000, logger: null });
  assert.equal(result, null);
  resetEnv();
});

