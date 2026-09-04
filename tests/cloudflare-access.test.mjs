import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose';

import {
  readAccessConfig,
  verifyAccessJwt,
  withVerifiedIdentity,
} from '../lib/server/cloudflare-access.ts';

const config = {
  issuer: 'https://wattwise.cloudflareaccess.com',
  audience: 'wattwise-audience',
  jwksUrl: 'https://wattwise.cloudflareaccess.com/cdn-cgi/access/certs',
};

const identity = {
  subject: 'google-subject-1',
  email: 'alice@example.com',
  displayName: 'Alice Example',
};

async function signedToken({ audience = config.audience, expiresIn = '5m' } = {}) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  const token = await new SignJWT({ email: identity.email, name: identity.displayName })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(config.issuer)
    .setAudience(audience)
    .setSubject(identity.subject)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
  return { token, getKey: createLocalJWKSet({ keys: [jwk] }) };
}

test('accepts a signed Access JWT with configured issuer and audience', async () => {
  const { token, getKey } = await signedToken();
  assert.deepEqual(await verifyAccessJwt(token, config, getKey), identity);
});

test('rejects malformed and wrong-audience Access JWTs', async () => {
  await assert.rejects(() => verifyAccessJwt('not-a-jwt', config));
  const { token, getKey } = await signedToken({ audience: 'other-audience' });
  await assert.rejects(() => verifyAccessJwt(token, config, getKey));
});

test('requires Access configuration values', () => {
  assert.throws(() => readAccessConfig({}), /configuration is unavailable/);
  assert.deepEqual(readAccessConfig({
    CLOUDFLARE_ACCESS_TEAM_DOMAIN: ' wattwise.cloudflareaccess.com ',
    CLOUDFLARE_ACCESS_AUD: ' wattwise-audience ',
  }), config);
});

test('replaces forged identity headers with verified identity', () => {
  const internal = withVerifiedIdentity(new Request('https://wattwise.test/api/me', {
    headers: {
      'oai-authenticated-user-id': 'forged-sites-id',
      'cf-access-jwt-assertion': 'forged-token',
      'x-wattwise-auth-subject': 'forged-subject',
    },
  }), identity);

  assert.equal(internal.headers.get('oai-authenticated-user-id'), null);
  assert.equal(internal.headers.get('cf-access-jwt-assertion'), null);
  assert.equal(internal.headers.get('x-wattwise-auth-subject'), identity.subject);
  assert.equal(internal.headers.get('x-wattwise-auth-email'), identity.email);
  assert.equal(internal.headers.get('x-wattwise-auth-name'), identity.displayName);
});
