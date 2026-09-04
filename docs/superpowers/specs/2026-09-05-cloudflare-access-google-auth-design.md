# Cloudflare Access with Google Authentication Design

## Goal

Replace the current untrusted Sites-header authentication on the public
`workers.dev` deployment with Cloudflare Access authentication backed by Google.
Every request that reaches a household route must carry an Access JWT that the
Worker validates before it supplies an application identity to Vinext.

## Scope and constraints

- The production hostname remains `wattwise.title5656.workers.dev` for this
  change and is protected by a Cloudflare Access application using Google.
- The existing D1 user, identity, household, membership, and role tables stay
  unchanged. No household data is migrated or reassigned.
- `users` are identified by Cloudflare Access's stable JWT `sub`, not an email
  address. A changed Google email therefore does not create a second user.
- The application must never trust `oai-authenticated-user-*`,
  `cf-access-*`, or WattWise internal identity headers received from a client.
- This Worker uses Vite static assets, so it cannot depend solely on
  `ctx.access`; the generated static-assets router may not propagate that
  context. The Worker validates the signed Access JWT itself.

## Request flow

```text
browser
  -> Cloudflare Access + Google sign-in
  -> Cf-Access-Jwt-Assertion
  -> WattWise Worker guard
  -> sanitized internal identity headers
  -> Vinext route handler
  -> existing user and household authorization
```

The Worker guard is the only component allowed to turn a Cloudflare Access JWT
into internal identity headers. It removes all identity-like input headers
before validation, verifies the JWT, then creates a new `Request` with only
the verified subject, email, and display name. A missing, malformed, expired,
wrong-issuer, wrong-audience, or bad-signature token receives 401 and never
reaches the route handlers.

## Worker and application changes

1. Add a small custom Worker entry module that wraps Vinext's generated
   `fetch` handler. Update Vite's Worker `main` entry to use that wrapper.
2. Add a Cloudflare Access verifier using `jose` and the platform Web Crypto
   runtime. It reads the JWT from `Cf-Access-Jwt-Assertion`, obtains signing
   keys from the configured Access team JWKS endpoint, and checks signature,
   issuer, audience, expiration, subject, and email.
3. Cache the remote JWKS using the verifier's standard cache; do not implement
   custom token parsing or signature code.
4. Replace the Sites-specific request parser with a parser for the
   Worker-created internal headers. The user persistence provider changes from
   `openai-sites` to `cloudflare-access`.
5. Keep the existing `requireUser`, membership, role, and route handlers. They
   continue to return 401 for missing application identity, 404 for
   non-members, and 403 for an insufficient role.
6. Keep the catalog route read-only. The production smoke test becomes an
   authenticated request using a Cloudflare Access service token rather than a
   public request.

## Cloudflare and CI configuration

An operator configures Cloudflare Zero Trust outside this repository:

1. Create a Google identity provider.
2. Create an Access application for the production hostname and an allow policy
   for the intended Google users. The initial policy must be explicit; it must
   not allow every Google account by default.
3. Record the Access team domain and application audience tag as Worker
   environment configuration. They are configuration values, not source code.
4. Create a least-privilege Access service token for CI. Store its client ID
   and secret in GitHub Actions secrets.
5. Protect the direct Worker hostname with Access so it cannot bypass the
   gateway. Do not treat a browser-provided identity header as an alternative
   authentication path.

The GitHub deployment workflow passes the Access configuration into Wrangler
and uses the CI service token for the post-deploy catalog smoke test. Secrets
remain in GitHub and Cloudflare configuration, never in the repository or log
output.

## Tests and acceptance criteria

- A valid verified Access identity reaches the existing user provisioner and
  preserves its user and household membership across requests.
- A request without a token, with a malformed token, or with a JWT for another
  issuer or audience is rejected before Vinext handles it.
- A client-supplied internal, Sites, or Cloudflare identity header is removed;
  it cannot impersonate a user.
- The server identity parser rejects incomplete internal identity data.
- Existing household authorization tests continue to pass after the provider
  changes to `cloudflare-access`.
- Typecheck, lint, full tests, build, and the authenticated production smoke
  test pass.
- Visiting the production hostname in a browser redirects to Cloudflare Access
  sign-in rather than showing WattWise's misleading session-expired screen.

## Non-goals

- No custom Google OAuth flow, user password storage, or application session
  cookie is added.
- No D1 schema migration, household migration, role redesign, or UI redesign
  is part of this work.
- No production deployment or Cloudflare dashboard mutation happens without
  separate authorization.
