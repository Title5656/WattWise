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
  createAccessGuard,
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

const accessEnv = {
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'wattwise.cloudflareaccess.com',
  CLOUDFLARE_ACCESS_AUD: 'wattwise-audience',
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

async function signedServiceToken({ commonName = 'ci-smoke.access', subject = '', type = 'app' } = {}) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'service-test-key';
  const token = await new SignJWT({ common_name: commonName, type })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  return { token, getKey: createLocalJWKSet({ keys: [jwk] }) };
}

test('accepts a signed Access JWT with configured issuer and audience', async () => {
  const { token, getKey } = await signedToken();
  assert.deepEqual(await verifyAccessJwt(token, config, getKey), identity);
});

test('maps an authorized Access service token to an isolated application identity', async () => {
  const { token, getKey } = await signedServiceToken();
  assert.deepEqual(await verifyAccessJwt(token, config, getKey), {
    subject: 'service-token:ci-smoke.access',
    email: 'ci-smoke.access@service-token.wattwise.invalid',
    displayName: 'Cloudflare Access service token',
  });
});

test('rejects service-token-shaped JWTs unless their app claims are complete and isolated', async () => {
  for (const claims of [
    { commonName: '', subject: '', type: 'app' },
    { commonName: 'invalid/name', subject: '', type: 'app' },
    { commonName: 'ci-smoke.access', subject: 'unexpected-user', type: 'app' },
    { commonName: 'ci-smoke.access', subject: '', type: 'user' },
  ]) {
    const { token, getKey } = await signedServiceToken(claims);
    await assert.rejects(() => verifyAccessJwt(token, config, getKey));
  }
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

test('does not call Vinext when a protected request has no Access assertion', async () => {
  let calls = 0;
  const guard = createAccessGuard({
    fetch: async () => { calls += 1; return new Response('ok'); },
  }, async () => identity);

  const response = await guard.fetch(new Request('https://wattwise.test/api/me'), {}, {});
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test('passes only verified identity to Vinext', async () => {
  let received;
  const guard = createAccessGuard({
    fetch: async (request) => { received = request; return new Response('ok'); },
  }, async () => identity);

  const response = await guard.fetch(new Request('https://wattwise.test/api/me', {
    headers: {
      'cf-access-jwt-assertion': 'signed-token',
      'x-wattwise-auth-subject': 'forged-subject',
    },
  }), accessEnv, {});

  assert.equal(response.status, 200);
  assert.equal(received.headers.get('cf-access-jwt-assertion'), null);
  assert.equal(received.headers.get('x-wattwise-auth-subject'), identity.subject);
});

test('does not trust a Sites identity outside local development', async () => {
  let received;
  const handler = { fetch: async (request) => { received = request; return new Response('ok'); } };
  const request = new Request('https://wattwise.test/api/me', {
    headers: {
      'oai-authenticated-user-id': identity.subject,
      'oai-authenticated-user-email': identity.email,
      'oai-authenticated-user-full-name': identity.displayName,
    },
  });

  assert.equal((await createAccessGuard(handler).fetch(request, accessEnv, {})).status, 401);
  assert.equal((await createAccessGuard(handler, undefined, true).fetch(request, accessEnv, {})).status, 200);
  assert.equal(received.headers.get('oai-authenticated-user-id'), null);
  assert.equal(received.headers.get('x-wattwise-auth-subject'), identity.subject);
});

test('rejects an assertion when verification fails', async () => {
  let calls = 0;
  const guard = createAccessGuard({
    fetch: async () => { calls += 1; return new Response('ok'); },
  }, async () => { throw new Error('invalid token'); });

  const response = await guard.fetch(new Request('https://wattwise.test/api/me', {
    headers: { 'cf-access-jwt-assertion': 'bad-token' },
  }), accessEnv, {});
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test('allows public catalog reads through without an identity', async () => {
  const guard = createAccessGuard({ fetch: async () => new Response('catalog') }, async () => {
    throw new Error('not used');
  });

  assert.equal((await guard.fetch(new Request('https://wattwise.test/api/catalog?pageSize=1'), {}, {})).status, 200);
});

test('allows the branded login and its assets publicly while keeping the auth start protected', async () => {
  const seen = [];
  const guard = createAccessGuard({ fetch: async (request) => {
    seen.push(new URL(request.url).pathname);
    return new Response('public');
  } }, async () => { throw new Error('verification must not run for public routes'); });

  for (const path of ['/login', '/wattwise-logo-small.png', '/_next/static/app.js']) {
    assert.equal((await guard.fetch(new Request(`https://wattwise.test${path}`), {}, {})).status, 200);
  }
  assert.equal((await guard.fetch(new Request('https://wattwise.test/auth/start'), {}, {})).status, 401);
  assert.deepEqual(seen, ['/login', '/wattwise-logo-small.png', '/_next/static/app.js']);
});
