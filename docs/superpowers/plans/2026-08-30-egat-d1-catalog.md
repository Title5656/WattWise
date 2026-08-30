# EGAT Label No.5 D1 Catalog Implementation Plan

## Global constraints

- Runtime catalog data comes only from D1; production code must never call or scrape EGAT.
- Preserve all 13 existing appliance keys and saved-home compatibility.
- Import only source fields or exact unit conversions: AC `BTU/h / EER`, refrigerator annual kWh, washer `Wh/kg * kg / 1000`, water-heater watts, rice-cooker watts.
- Target 300–500 active models, normally 350–380, maximum 80 imported records per large category.
- Use TDD for behavior changes. Do not publish, push, or deploy without separate authorization.
- Authentication is explicitly deferred; document the shared `default-home` deployment risk.

## Task 1: Catalog schema and migration-chain repair

- Add a stable unique `catalog_key` plus calculation method, nullable model energy values, load factor, usage profile, display/source metadata, active flag, and sort order to `appliance_models`.
- Replace brand/model uniqueness with catalog-key uniqueness and add indexes supporting active category/search pagination.
- Reconcile Drizzle journal/snapshots with existing migrations 0000–0004 without changing already-applied SQL semantics.
- Extend the legacy D1 baseline registration through 0004 and add regression tests for the migration contract.

## Task 2: Curated EGAT seed snapshot

- Create a one-time SQL seed/migration containing 300–500 active catalog rows and all 13 legacy keys.
- Use exact source values/conversions only, stable fingerprinted keys for spec variants, category-generic image paths, source URLs, and a verification date.
- Validate row count, unique keys, required fields, conversion formulas, legacy-key presence, and maximum category size with automated tests.
- Do not commit a runtime scraper or refresh job.

## Task 3: Energy domain and calculation correctness

- Introduce `ApplianceEnergySpec` as a discriminated union for `rated-power`, `annual-energy`, and `per-cycle` and carry it through `Appliance` and calculation inputs.
- Resolve energy using model-level annual/per-cycle/rated-power values; add `rice_cooker_hours` with 1 hour/day default.
- Make annual-energy daily/monthly values consistent with a 30-day month (`monthly = annual / 12`, `daily = monthly / 30`).
- Select tariffs using `Asia/Bangkok` calendar dates.
- Add focused red-green regression tests.

## Task 4: Catalog repository and API

- Add D1 catalog access behind a small repository/helper.
- Implement `GET /api/catalog?q=&category=&page=&pageSize=` with defaults page 1/pageSize 24, max pageSize 50, max query length 100, escaped wildcard search, active-only listing, stable ordering, category metadata, and pagination metadata.
- Add public `CatalogResponse` types and API tests for search, literal wildcard characters, categories, bounds, stable paging, empty results, and inactive records.

## Task 5: Saved-home compatibility and audit fixes

- Hydrate saved keys from D1, including inactive legacy rows, while retaining the existing saved `appliance_key` wire/storage shape.
- Validate the complete home payload before mutation; reject unknown keys and quantities outside integer 1–99 with 400 and leave stored data unchanged.
- Execute replacement only after validation succeeds.
- Version the durable outbox for the new energy-spec union and migrate/accept the current payload format.
- When a home becomes empty, clear the current estimated month values while preserving an actual bill row.
- Add API/storage/outbox/history regression tests.

## Task 6: My Home catalog UI and dashboard concurrency

- Replace the static model chooser with the Catalog API while preserving the current visual system.
- Add category filtering, 300 ms debounced search, loading/error/empty states, and Load more.
- Abort obsolete catalog requests and prevent older dashboard responses from overwriting newer state.
- Display energy-spec units as W, kWh/year, or kWh/cycle and retain category-generic imagery.
- Add component/source-contract tests consistent with the repository's existing test approach.

## Task 7: Documentation and full verification

- Document catalog provenance, one-time snapshot behavior, D1 migration/seed procedure, and the deferred unauthenticated shared-home risk.
- Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- Run a separate whole-branch audit for runtime, logic, data integrity, D1 migration, calculation, timezone, persistence compatibility, and UI concurrency defects.
- Fix High/Medium findings once, re-review the fix diff, and record any residual Low findings.
