import assert from 'node:assert/strict';
import test from 'node:test';

import nextConfig from '../next.config.ts';

test('Next configuration requests credentials for bootstrap assets', () => {
  assert.equal(nextConfig.crossOrigin, 'use-credentials');
});
