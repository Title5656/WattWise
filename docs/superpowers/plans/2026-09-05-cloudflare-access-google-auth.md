# Cloudflare Access Google Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require Google-backed Cloudflare Access authentication for WattWise household data without trusting caller-controlled identity headers.

**Architecture:** Access authenticates the browser and sends `Cf-Access-Jwt-Assertion`. A small Worker entry verifies the JWT using `jose`, removes every caller-supplied identity header, and passes only verified identity into Vinext. Existing D1 user, household, membership, and role authorization stays unchanged.

**Tech Stack:** Cloudflare Workers and Access, Google IdP, Vinext, TypeScript, `jose`, D1, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-05-cloudflare-access-google-auth-design.md`

## Global Constraints

- Protect `wattwise.title5656.workers.dev` with Google-backed Access and an explicit allow policy; never allow every Google account by default.
- Use verified Access JWT `sub`, not email, as the stable user identity.
- Reject bad, expired, wrong-issuer, wrong-audience, unsigned, and missing tokens before protected routes run.
- Delete inbound `oai-authenticated-user-*`, `cf-access-*`, and `x-wattwise-auth-*` headers before adding verified internal headers.
- Use `jose` remote JWKS verification; no custom JWT code.
- Keep D1 schema, household data, roles, and existing endpoint contracts. `GET /api/catalog` is the only public endpoint.
- Never put Access or CI secrets in source, docs, logs, or committed configuration.
- Do not deploy or modify Cloudflare Zero Trust settings without separate authorization.

---

## File Structure

- `lib/server/sites-identity.ts`: internal identity parser; retain filename to avoid import-only churn.
- `lib/server/cloudflare-access.ts`: runtime config, JWT verifier, request sanitizer, and guard factory.
- `worker.ts`: wraps Vinext's generated entry.
- `vite.config.ts`: selects `worker.ts` as Worker main.
- `db/env.d.ts`: adds non-secret Access configuration types.
- `tests/auth-boundary.test.mjs`: internal identity and provider tests.
- `tests/cloudflare-access.test.mjs`: JWT, header stripping, and guard tests.
- `.github/workflows/ci.yml` and `tests/deployment-workflow.test.mjs`: Access runtime and service-token smoke test.
- `docs/cloudflare-access-google.md`: operator checklist.

### Task 1: Replace the Sites identity contract

**Files:** Modify `lib/server/sites-identity.ts`, `lib/server/current-user.ts`, and `tests/auth-boundary.test.mjs`.

**Produces:** `getCurrentIdentity(request)` reads `x-wattwise-auth-subject`, `x-wattwise-auth-email`, and optional `x-wattwise-auth-name`; provider is `cloudflare-access`.

- [ ] **Step 1: Write the failing parser test**

```js
test('parses only complete internal Cloudflare Access identity headers', () => {
  assert.equal(getCurrentIdentity(new Request('https://wattwise.test')), null);
  assert.equal(getCurrentIdentity(new Request('https://wattwise.test', {
    headers: { 'x-wattwise-auth-subject': 'google-subject-1' },
  })), null);
  assert.deepEqual(getCurrentIdentity(new Request('https://wattwise.test', {
    headers: {
      'x-wattwise-auth-subject': ' google-subject-1 ',
      'x-wattwise-auth-email': ' ALICE@EXAMPLE.COM ',
      'x-wattwise-auth-name': 'Alice Example',
    },
  })), {
    provider: 'cloudflare-access', subject: 'google-subject-1',
    email: 'alice@example.com', displayName: 'Alice Example',
  });
});
```

Update all fixture provider values and request header names in the same test file.

- [ ] **Step 2: Verify RED**

Run `node --test tests/auth-boundary.test.mjs`. Expected: FAIL because the parser only recognizes Sites headers.

- [ ] **Step 3: Implement the smallest parser**

```ts
const PROVIDER = 'cloudflare-access' as const;
const SUBJECT_HEADER = 'x-wattwise-auth-subject';
const EMAIL_HEADER = 'x-wattwise-auth-email';
const NAME_HEADER = 'x-wattwise-auth-name';
```

Trim subject/name, lowercase email, use `name || email`, and return `null` when subject or email is missing. Change `AuthenticatedUser.provider` to `cloudflare-access`.

- [ ] **Step 4: Verify GREEN and commit**

Run `node --test tests/auth-boundary.test.mjs`; expected PASS. Then commit `feat: use Cloudflare Access identity headers`.

### Task 2: Verify Access JWTs and sanitize requests

**Files:** Modify `package.json`, `package-lock.json`, `db/env.d.ts`; create `lib/server/cloudflare-access.ts` and `tests/cloudflare-access.test.mjs`.

**Produces:** `readAccessConfig(env)`, `verifyAccessJwt(token, config, getKey)`, and `withVerifiedIdentity(request, identity)`.

- [ ] **Step 1: Install `jose` and write failing tests**

Run `npm install jose`. Test with a local RSA key and `createLocalJWKSet` so no network is used.

```js
const identity = {
  subject: 'google-subject-1', email: 'alice@example.com', displayName: 'Alice',
};

test('accepts a signed Access JWT with configured issuer and audience', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey); jwk.kid = 'test-key';
  const token = await new SignJWT({ email: 'alice@example.com', name: 'Alice' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(config.issuer).setAudience(config.audience)
    .setSubject('google-subject-1').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  assert.deepEqual(await verifyAccessJwt(token, config, createLocalJWKSet({ keys: [jwk] })), identity);
});

test('removes forged identity headers before setting verified identity', () => {
  const internal = withVerifiedIdentity(new Request('https://wattwise.test/api/me', { headers: {
    'oai-authenticated-user-id': 'forged',
    'cf-access-jwt-assertion': 'forged',
    'x-wattwise-auth-subject': 'forged',
  } }), identity);
  assert.equal(internal.headers.get('oai-authenticated-user-id'), null);
  assert.equal(internal.headers.get('cf-access-jwt-assertion'), null);
  assert.equal(internal.headers.get('x-wattwise-auth-subject'), 'google-subject-1');
});
```

Add assertions for malformed JWT and missing Access configuration.

- [ ] **Step 2: Verify RED**

Run `node --test tests/cloudflare-access.test.mjs`. Expected: FAIL because `lib/server/cloudflare-access.ts` does not exist.

- [ ] **Step 3: Implement with `jose`**

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

export function readAccessConfig(env: Cloudflare.Env) {
  const teamDomain = env.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CLOUDFLARE_ACCESS_AUD?.trim();
  if (!teamDomain || !audience) throw new Error('Cloudflare Access configuration is unavailable.');
  const issuer = `https://${teamDomain}`;
  return { issuer, audience, jwksUrl: `${issuer}/cdn-cgi/access/certs` };
}

export async function verifyAccessJwt(token: string, config: AccessConfig, getKey = createRemoteJWKSet(new URL(config.jwksUrl))) {
  const { payload } = await jwtVerify(token, getKey, {
    issuer: config.issuer, audience: config.audience, algorithms: ['RS256'], requiredClaims: ['sub', 'email'],
  });
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') throw new Error('Cloudflare Access identity is incomplete.');
  return { subject: payload.sub, email: payload.email.toLowerCase(), displayName: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : payload.email };
}
```

`withVerifiedIdentity()` copies the request using `new Request(request, { headers })`, strips headers whose lowercase names use any prohibited prefix, then sets the three internal headers. Add optional team-domain and audience strings to `Cloudflare.Env`.

- [ ] **Step 4: Verify GREEN and commit**

Run `node --test tests/cloudflare-access.test.mjs`; expected PASS. Commit `feat: verify Cloudflare Access JWTs`.

### Task 3: Guard the Vinext Worker entry

**Files:** Create `worker.ts`; modify `vite.config.ts`, `lib/server/cloudflare-access.ts`, and `tests/cloudflare-access.test.mjs`.

**Produces:** `createAccessGuard(handler, verify)`; all routes but public catalog require verified Access identity.

- [ ] **Step 1: Write failing guard tests**

```js
test('does not call Vinext when a protected request has no Access assertion', async () => {
  let calls = 0;
  const guard = createAccessGuard({ fetch: async () => { calls += 1; return new Response('ok'); } }, async () => identity);
  assert.equal((await guard.fetch(new Request('https://wattwise.test/api/me'), {}, {})).status, 401);
  assert.equal(calls, 0);
});

test('passes only verified identity to Vinext', async () => {
  let received;
  const guard = createAccessGuard({ fetch: async (request) => { received = request; return new Response('ok'); } }, async () => identity);
  await guard.fetch(new Request('https://wattwise.test/api/me', { headers: {
    'cf-access-jwt-assertion': 'signed-token', 'x-wattwise-auth-subject': 'forged',
  } }), {}, {});
  assert.equal(received.headers.get('x-wattwise-auth-subject'), 'google-subject-1');
});
```

Also test that `GET /api/catalog` reaches the handler with no identity.

- [ ] **Step 2: Verify RED**

Run `node --test tests/cloudflare-access.test.mjs`. Expected: FAIL because `createAccessGuard` is missing.

- [ ] **Step 3: Implement and connect guard**

```ts
export function createAccessGuard(handler: WorkerHandler, verify: VerifyAccessToken) {
  return { async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/catalog') return handler.fetch(request, env, ctx);
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) return Response.json({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' }, { status: 401 });
    try { return handler.fetch(withVerifiedIdentity(request, await verify(token, readAccessConfig(env))), env, ctx); }
    catch { return Response.json({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' }, { status: 401 }); }
  }};
}
```

Create `worker.ts` importing `vinext/server/app-router-entry` and default-exporting `createAccessGuard(app, verifyAccessJwt)`. Set `localBindingConfig.main` to `worker.ts`. Preserve Sites simulation only in Vite development by translating it to internal headers; production never accepts Sites headers.

- [ ] **Step 4: Verify GREEN and commit**

Run `node --test tests/cloudflare-access.test.mjs && npm run typecheck`; expected PASS. Commit `feat: guard Vinext with Cloudflare Access`.

### Task 4: Protect CI smoke tests and document setup

**Files:** Modify `.github/workflows/ci.yml` and `tests/deployment-workflow.test.mjs`; create `docs/cloudflare-access-google.md`.

**Produces:** deploy injects non-secret Access team/audience configuration; smoke test authenticates via an Access service token.

- [ ] **Step 1: Write failing CI contract checks**

```js
assert.match(workflow, /CLOUDFLARE_ACCESS_TEAM_DOMAIN/);
assert.match(workflow, /CLOUDFLARE_ACCESS_AUD/);
assert.match(workflow, /CF-Access-Client-Id/);
assert.match(workflow, /CF-Access-Client-Secret/);
assert.match(workflow, /CLOUDFLARE_ACCESS_CLIENT_ID/);
assert.match(workflow, /CLOUDFLARE_ACCESS_CLIENT_SECRET/);
```

- [ ] **Step 2: Verify RED**

Run `node --test tests/deployment-workflow.test.mjs`. Expected: FAIL because current CI has no Access configuration.

- [ ] **Step 3: Implement CI and runbook**

Extend existing deployment `jq` to add `.vars.CLOUDFLARE_ACCESS_TEAM_DOMAIN` and `.vars.CLOUDFLARE_ACCESS_AUD` from GitHub secrets without echoing values. Add two Access service-token headers to the existing catalog `curl` using `CLOUDFLARE_ACCESS_CLIENT_ID` and `CLOUDFLARE_ACCESS_CLIENT_SECRET` secrets.

Document these operator actions: configure Google IdP; create Access application for the Worker hostname; explicitly allow intended Google users/domains; record team domain and audience; create short-lived CI service token and a `Service Auth` policy; add all four GitHub secrets; verify the direct Worker hostname is covered.

- [ ] **Step 4: Verify GREEN and commit**

Run `node --test tests/deployment-workflow.test.mjs`; expected PASS without a literal credential. Commit `ci: smoke test through Cloudflare Access`.

### Task 5: Full verification and live acceptance

**Files:** Change only a task file if verification finds a defect.

- [ ] **Step 1: Run full checks**

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. Expected: all exit 0.

- [ ] **Step 2: Inspect safe production artifact**

Run `rg -n 'worker\.ts|CLOUDFLARE_ACCESS_(TEAM_DOMAIN|AUD)|CLIENT_SECRET' dist/server/wrangler.json dist/server`.

Expected: Worker entry and two non-secret variables are present; `CLIENT_SECRET` is absent.

- [ ] **Step 3: Run operator-managed live acceptance after authorized deploy**

In a fresh browser profile, production must redirect to Google before WattWise renders. After sign-in, `/api/me` returns 200 and households load. Without Access credentials, protected paths return 401. A caller-created internal identity header never changes the authenticated user.

- [ ] **Step 4: Commit only verification-driven fixes**

If verification required a fix, stage only relevant files and create one focused commit. Otherwise do not create an empty commit.
