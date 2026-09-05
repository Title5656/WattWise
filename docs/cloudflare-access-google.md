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
performed. A logo was omitted because the existing logo URL is Access-protected
and could require authentication before the login page can display it.

## One-time Cloudflare setup

1. In Cloudflare Zero Trust, add Google as an identity provider.
2. Create an Access application for `wattwise.title5656.workers.dev` and cover
   every path.
3. Add an explicit Allow policy for the intended Google users or domain. Do not
   create an allow-all Google policy.
4. Copy the Access team domain (for example, `team.cloudflareaccess.com`) and
   the application audience (`aud`) tag.
5. Create a short-lived service token for CI and add a `Service Auth` policy
   for that token on this application.

## GitHub Actions configuration

Add these repository variables:

- `CLOUDFLARE_ACCESS_TEAM_DOMAIN`
- `CLOUDFLARE_ACCESS_AUD`

Add these repository secrets:

- `CLOUDFLARE_ACCESS_CLIENT_ID`
- `CLOUDFLARE_ACCESS_CLIENT_SECRET`

The deployment workflow writes only the two non-secret values into the
generated Wrangler configuration. The post-deploy catalog check sends the
service-token credentials as Access headers and does not print them.

## Verify after deployment

In a fresh browser profile, open the production hostname. Cloudflare Access
should require Google sign-in before WattWise loads. After sign-in, the
household routes should load normally. A request without Access credentials to
`/api/me` must receive `401`.
