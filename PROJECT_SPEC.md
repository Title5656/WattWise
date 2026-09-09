# WattWise — Product Specification

## 1. Purpose

WattWise is a Thai home-energy planning web app. A user builds one or more model households from a catalog of real appliance models, describes how each appliance is used, and receives an estimated monthly energy use and electricity bill. The product supports comparison and planning; it is not a meter-reading service and must never present an estimate as an actual bill.

## 2. Current product status

The current product slice is operational for authenticated, household-scoped use:

- Appliance catalog search and category filtering, backed by D1/SQLite.
- Household creation, editing, membership management, invitations, and roles: `owner`, `admin`, `member`, and read-only `viewer`.
- A dedicated My Home view for adding appliances, setting quantities and usage schedules, and automatically saving a household snapshot.
- A dashboard with monthly kWh estimate, tariff-based bill estimate and range, appliance/load breakdown, and saved monthly history.
- Entry of actual monthly bills without overwriting calculated estimates.
- Catalog provenance and energy-spec metadata for active models, plus compatibility handling for legacy saved-home data.

Scenario comparison, real-time meter/IoT ingestion, automatic vendor-wide catalog collection, and personalized energy-saving recommendations are not part of the current product slice.

## 3. Core user journeys

### Create and manage a household

After authentication and display-name onboarding, a user creates or selects a household. The household owner can manage metadata, members, invitations, and ownership. Administrators can manage permitted household operations; members can use household data within their granted scope; viewers can read but cannot change homes or bills.

### Build a home model

The user searches the catalog by name, model, or category and adds an appliance to the selected household. They set quantity and usage details such as hours, days, cycles, and time periods where the model profile supports them. The client preserves unsaved work safely and the server validates the canonical snapshot before storing it.

### Review energy and bills

The dashboard aggregates the saved home into monthly energy, an hourly load profile, and an estimated residential bill. Users may record actual bills for comparison. All results remain explicitly approximate because real consumption depends on appliance condition, settings, climate, and user behaviour.

## 4. Calculation and data rules

- The calculation engine supports rated-power, annual-energy, per-cycle, and variable-load model specifications.
- Direct label energy values take precedence over a generic rated-power assumption when available.
- Tariffs are versioned by effective period and calculate base energy charges, service charge, Ft, and VAT for supported residential providers and account classes.
- Energy and bill summaries must identify assumptions, warnings, and uncertainty; the UI must not imply a guaranteed bill amount.
- A publishable catalog record requires provenance, a verification date, and an honest energy specification. Unverified or incompatible legacy records remain isolated until explicitly claimed.
- Data access is always scoped by verified identity and active household membership. Client-supplied identity is never an authorization source.

## 5. Technical architecture

- TypeScript, React 19, Vinext/Vite, and an App Router-style application structure.
- Cloudflare Workers hosts the application; Cloudflare D1 is the production database and SQLite-compatible tooling supports local and automated verification.
- Drizzle owns schema definitions and ordered migrations.
- Cloudflare Access supplies authenticated identity at the edge. The application verifies Access assertions before accepting protected requests; public catalog reads and the required sign-in assets remain explicit exceptions.
- The application uses API routes for catalog, identity, households, homes, memberships, invitations, and bills. Database mutations validate authorization and input on the server.

## 6. Quality and release requirements

Before a release, the project must pass the repository's automated test suite, linting, TypeScript check, and production build. Production deployment is main-branch only, applies D1 migrations before deployment, and performs a smoke check. Secrets belong in the deployment platform and GitHub Actions secrets, never in source files or documentation.

The UI must remain usable on desktop and mobile, provide accessible loading/error/empty states, and keep interactive controls large enough for touch use. Public pages and metadata must use the current WattWise visual identity.

## 7. Documentation boundaries

`README.md` is the contributor-facing introduction and local run guide. `docs/catalog.md` records catalog provenance and the catalog API contract. `docs/residential-tariffs.md` records tariff sources and calculation context. Cloudflare Access and legacy-data cutover guides remain operational documentation for deployment and maintenance.

This file is the product source of truth. Implementation-session plans, agent reports, and dated QA notes are not product specifications and should not be required to understand or operate WattWise.

## 8. Next priorities

1. Keep tariff data current against official provider publications and make the effective-date coverage visible.
2. Improve scenario comparison and explain the effect of changing appliances or usage patterns.
3. Expand verified catalog coverage while preserving provenance and compatibility guarantees.
4. Add user-facing energy-saving guidance only when its assumptions and evidence can be stated clearly.
