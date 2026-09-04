# Cloudflare Access with Google

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
