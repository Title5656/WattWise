# Catalog snapshot and D1 operations

## Runtime contract

The catalog's only runtime data source is D1. Application code does not fetch, scrape, or refresh EGAT data at runtime. The current active snapshot contains 374 rows: 361 curated EGAT Label No.5 rows and the 13 WattWise legacy models required for saved-home compatibility.

The EGAT snapshot was verified on **2026-08-30** (Asia/Bangkok). It is limited to these authorized source pages and categories:

- [wall-mounted inverter air conditioners](https://labelno5.egat.co.th/home/stamp/index1.php?tname=air): direct `BTU/h / EER` to watts;
- [refrigerators](https://labelno5.egat.co.th/home/stamp/index1.php?tname=ref): direct annual kWh;
- [washing machines](https://labelno5.egat.co.th/home/stamp/index1.php?tname=washer): `Wh/kg * capacity kg / 1000` to kWh/cycle;
- [water heaters](https://labelno5.egat.co.th/home/stamp/index1.php?tname=heat): direct watts;
- [rice cookers](https://labelno5.egat.co.th/home/stamp/index1.php?tname=cook): direct watts.

Only exact duplicate source specs were removed. A catalog key is stable: EGAT keys include a deterministic 12-hex fingerprint of canonical direct identity/spec fields, so distinct energy or capacity variants remain distinct. Legacy keys remain stable too. Saved homes hydrate matching models from D1 even if a legacy row is inactive; the public catalog listing itself is active-only.

Product art is category-generic local imagery chosen from the category slug. No EGAT product images are copied or downloaded.

## Migrations and refreshes

`drizzle/0005_mixed_ultimatum.sql` introduces the catalog schema/backfill and `drizzle/0006_egat_catalog_seed.sql` is the idempotent one-time seed. Treat both as applied history: **do not edit either migration after it has been applied**.

After building, make a local copy of the generated Worker configuration and point it at the repository migration directory. This mirrors the path adjustment CI makes for its built artifact:

```powershell
npm run build
$env:WRANGLER_LOG_PATH = '.wrangler/logs'
Copy-Item dist/server/wrangler.json dist/server/wrangler.local.json
$config = Get-Content dist/server/wrangler.local.json -Raw | ConvertFrom-Json
$config.d1_databases[0].migrations_dir = '../../drizzle'
$config | ConvertTo-Json -Depth 20 | Set-Content dist/server/wrangler.local.json
npx wrangler d1 migrations list DB --local --config dist/server/wrangler.local.json
npx wrangler d1 migrations apply DB --local --config dist/server/wrangler.local.json
```

Production deployment is CI-owned. Its workflow first reconciles older D1 migration history, then lists and applies the same `drizzle` migrations against the built Worker configuration before deploying:

```powershell
npx wrangler d1 execute DB --remote --file scripts/d1-baseline.sql --config dist/server/wrangler.json
npx wrangler d1 migrations list DB --remote --config dist/server/wrangler.json
npx wrangler d1 migrations apply DB --remote --config dist/server/wrangler.json
```

Do not run a scraper or rerun a past import to update the catalog. A refresh requires source review, verification, and a new forward-only, reviewed migration (with tests); it must not modify `0005` or `0006`.

## Catalog API

`GET /api/catalog?q=&category=&page=&pageSize=` returns active rows only, with stable ordering and active-category metadata. Defaults are `page=1` and `pageSize=24`; `pageSize` must be at most 50 and `q` at most 100 characters. Search is case-insensitive and treats `%`, `_`, and `\` as literal characters. Invalid page/page-size/bounds receive `400`.

## Deployment privacy warning

Authentication is not implemented. Production currently uses one shared, unauthenticated `default-home`; `/api/home` accepts home mutations and `/api/bills` accepts bill mutations for that shared data. Treat every deployment as private/access-controlled until authentication and per-user ownership are implemented. Do not expose it as a public multi-user service in the meantime.
