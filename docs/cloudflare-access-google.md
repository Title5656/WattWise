# Cloudflare Access with Google

## Login branding (BUG-01, 2026-09-06)

The reference page belongs to Cloudflare Access at
`floral-dream-b933.cloudflareaccess.com`, not the app's `app/login/page.tsx`.
The connected Cloudflare API showed an empty organization `login_design`.
Updated that configuration and verified it by reading it back:

- `background_color`: `#f5f7f2`
- `text_color`: `#20332a`
- `header_text`: `WattWise · Home Energy`
- `footer_text`: `วางแผนพลังงานและค่าไฟของบ้านคุณ`

This branding applies to the organization's Access login pages. Both existing
Access applications are for WattWise. Identity providers, application policies,
session duration, and automatic redirects were preserved and checked afterward.
No external configuration blocker remains. A fresh interactive sign-in was not
performed. The app logo is served through the public-assets Bypass application,
so it can be added to Access branding without requiring an existing session.

## One-time Cloudflare setup

1. In Cloudflare Zero Trust, add Google as an identity provider.
2. Create the main Access application for `wattwise.title5656.workers.dev` and
   cover every path.
3. Add an explicit Allow policy for the intended Google users or domain. Do not
   create an allow-all Google policy.
4. Create a second Access application with these exact destinations:
   `wattwise.title5656.workers.dev/login`,
   `wattwise.title5656.workers.dev/_next` (the path-prefix match covers all
   `/_next/*` descendants), and
   `wattwise.title5656.workers.dev/wattwise-logo-small.png`. Give it a
   **Bypass** policy with an **Everyone** selector. Do not use Allow for these
   destinations.
5. Keep every other path on the main Access application; in particular, never
   add `/api/*`, `/onboarding`, or the site root to the Bypass application.
6. Copy the Access team domain (for example, `team.cloudflareaccess.com`) and
   the main protected application's `aud` tag.
7. Create a short-lived service token for CI and add the CI token's Service
   Auth policy to the main protected application, not the public-assets
   application.

## GitHub Actions configuration

Add these repository variables:

- `CLOUDFLARE_ACCESS_TEAM_DOMAIN`
- `CLOUDFLARE_ACCESS_AUD`

Add these repository secrets:

- `CLOUDFLARE_ACCESS_CLIENT_ID`
- `CLOUDFLARE_ACCESS_CLIENT_SECRET`

The deployment workflow writes only the two non-secret values into the
generated Wrangler configuration. Post-deploy checks send the service-token
credentials as Access headers and do not print them.

## Credentialed browser bootstrap

The application pages and APIs are protected by Cloudflare Access. A separate
Access application covers the exact `/login`, `/_next` path prefix, and
`/wattwise-logo-small.png` destinations; its
`Public login assets` policy must use the **Bypass** action with an Everyone
selector. `Allow Everyone` is not equivalent: it still creates a second Access
authentication boundary and audience for the same hostname, which can redirect
uncached route chunks and leave first-time users on server-rendered loading UI.

Keep
`crossOrigin: 'use-credentials'` in `next.config.ts` so Safari, Chrome, and
other WebKit browsers on iOS and iPadOS send the `CF_Authorization` cookie when
they load bootstrap scripts and module preloads. Removing this setting can
leave the server-rendered household loading screen visible indefinitely even
when `/api/me` and `/api/households` return valid JSON.

The membership lifecycle also sets `credentials: 'same-origin'` explicitly on
both API requests. Vinext currently accepts the Next.js configuration but does
not apply it to App Router bootstrap tags, so the Worker guard also enforces the
attribute on module scripts and module preloads in HTML responses. The
production workflow verifies authenticated HTML and onboarding, then downloads
the JavaScript bootstrap and stylesheet without Access credentials. Both public
assets must return `200` with the expected content type; any Access redirect is
a deployment failure. The same smoke test verifies that authenticated
`/api/me` returns a complete user payload and that anonymous `/api/me` remains
blocked. Interactive browser verification remains required for the end-user
Access cookie path.

## Verify after deployment

In a fresh browser profile, open the production hostname. Cloudflare Access
should require Google sign-in before WattWise loads. After sign-in, the
household routes should load normally. A request without Access credentials to
`/api/me` must receive an Access redirect or a `401`/`403` response, never
application data.

On Safari and Chrome for a supported iPhone or iPad, sign in with an account
that belongs to two households. The household picker should appear within 10
seconds without a refresh. Repeat Google sign-in, onboarding, and household
navigation on desktop to check for regressions.
