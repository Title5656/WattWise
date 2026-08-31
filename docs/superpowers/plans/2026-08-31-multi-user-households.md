# WattWise Multi-user Households Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert WattWise from one shared logical home into an authenticated multi-user, multi-household application with enforced isolation and conflict-safe autosave.

**Architecture:** Sites identity headers are normalized behind a server auth boundary, then every household request resolves membership and role before repository access. D1 uses relational household ownership, a canonical `household_appliances` table, explicit public IDs, and revision-guarded snapshot batches.

**Tech Stack:** Vinext/Next route handlers, React 19, TypeScript, Cloudflare D1/SQLite, Drizzle migrations, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-31-multi-user-households-design.md`

## Global Constraints

- Use strict red-green-refactor TDD for behavior changes.
- Do not trust user IDs, household IDs, roles, or identity claims supplied in request bodies.
- Keep catalog resources global and preserve existing catalog/calculation behavior.
- Use prepared D1 statements; multi-statement mutations use `batch()`.
- Do not publish, deploy, merge, or push without separate user authorization.
- Preserve legacy data through quarantine; never assign it to the first account automatically.

---

### Task 1: Relational tenancy schema and migration

**Files:** Modify `db/schema.ts`; create the next Drizzle migration; modify migration/schema fixtures and tests.

**Produces:** `users`, `user_identities`, enriched `households`, `household_members`, `household_invites`, canonical `household_appliances`, household-FK monthly records, and tariff product/version relations.

- [ ] Write schema/migration tests for keys, checks, indexes, one-owner partial uniqueness, canonical appliance fields, and household/month uniqueness.
- [ ] Run the focused tests and confirm they fail because the new schema is absent.
- [ ] Implement the schema and generate/inspect the forward-only migration.
- [ ] Run focused migration tests, the full suite, and typecheck.

### Task 2: Server identity and authorization boundary

**Files:** Create focused server auth, DB binding, user, household, and authorization modules plus real D1 fixtures/tests.

**Produces:** `getCurrentUser`, `requireUser`, identity provisioning, `requireHouseholdMember`, `requireHouseholdRole`, and role-management policy helpers.

- [ ] Write failing tests for Sites headers, missing identity, identity provisioning, 404 non-member isolation, 403 insufficient role, and role hierarchy.
- [ ] Implement the smallest provider-neutral boundary with a Sites header adapter.
- [ ] Run focused tests, full tests, and typecheck.

### Task 3: Household and membership APIs

**Files:** Create household/member/invitation repositories, services, route handlers, and integration tests.

**Produces:** `/api/me`, household CRUD/listing, member listing/changes, invitations, leave, and ownership transfer.

- [ ] Write failing API/service tests using two users and two households.
- [ ] Implement atomic household creation with one owner and all role invariants.
- [ ] Verify IDOR, invitation expiry/single-use, and ownership transfer behavior.

### Task 4: Canonical Home API with optimistic concurrency

**Files:** Replace legacy home repository/service boundaries, create household-scoped Home route, update D1 fixtures and Home tests.

**Produces:** `GET/PUT /api/households/:householdId/home`, stable instance keys, revision response/input, and atomic conditional replacement.

- [ ] Write failing tests for household isolation, stable instances, stale revision 409, and no lost update.
- [ ] Implement conditional D1 batch behavior and current-month estimate updates.
- [ ] Verify 100-item D1 limits and all existing Home calculation behavior.

### Task 5: Household bills and dashboard APIs

**Files:** Update monthly repository, add household-scoped bills/dashboard handlers, update dashboard integration tests.

**Produces:** scoped bill CRUD and `getHouseholdDashboard` without implicit active-household authorization.

- [ ] Write failing tests for two-household isolation and role permissions.
- [ ] Implement household-FK monthly reads/writes while preserving estimate/actual field independence.
- [ ] Run focused and full verification.

### Task 6: Scoped outbox and autosave concurrency lifecycle

**Files:** Update outbox module, My Home client lifecycle, request cancellation helpers, and outbox/UI tests.

**Produces:** v3 user/household keys and envelopes, scoped locks/queues, revision-aware retries, and conflict preservation.

- [ ] Write failing tests for account switch, household switch, session expiry, logout, and 409 handling.
- [ ] Implement identity-first draft hydration, scoped state, abort/generation guards, and no silent conflict retry.
- [ ] Verify cross-tab behavior and legacy v1/v2 cleanup policy.

### Task 7: Multi-household UI and dynamic identity

**Files:** Add household-aware dashboard/My Home routes and selector/context UI; update sidebar/header and UI contract tests.

**Produces:** explicit household URLs, dynamic user/household/role display, member-aware controls, and conflict UI.

- [ ] Write failing user-visible behavior tests for dynamic identity and household navigation.
- [ ] Implement the smallest coherent UI using existing components and visual language.
- [ ] Run a local first meaningful preview, then responsive/accessibility checks, tests, and typecheck.

### Task 8: Quarantine cutover support, documentation, and contract cleanup

**Files:** Add migration verification/claim tooling and tests; update deployment docs; remove legacy runtime routes after compatibility tests move to scoped APIs.

**Produces:** deterministic quarantine/backfill, explicit claim, read-only cutover procedure, and no runtime `default-home` dependency.

- [ ] Write failing migration fixtures for legacy appliances, duplicate instances, inactive catalog rows, unknown keys, and monthly history.
- [ ] Implement forward-only quarantine/backfill and claim support.
- [ ] Verify counts, checksums, foreign keys, migration replay, full tests, lint, typecheck, and production build.

