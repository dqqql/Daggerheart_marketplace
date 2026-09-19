# Like Audit Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record privacy-conscious like and unlike audit events in D1 without changing public catalog schemas or allowing audit failures to break successful voting.

**Architecture:** Add a non-cascading D1 audit table, issue a signed 90-day first-party visitor cookie from non-cacheable like endpoints, and write each audit event as best-effort background work through `ctx.waitUntil()`. Add Windows-friendly Node maintenance tools that query D1 through Wrangler for JSONL export and explicit retention pruning; no public or admin audit API is introduced.

**Tech Stack:** Cloudflare Pages advanced-mode Worker, D1/SQLite, Web Crypto, Node.js built-in test runner, Wrangler CLI.

---

### Task 1: D1 audit schema and Worker event capture

**Files:**
- Create: `migrations/0006_like_audit_events.sql`
- Modify: `frontend/_worker.js`
- Modify: `tests/worker.test.mjs`

- [ ] **Step 1: Add failing Worker tests**

Add tests covering: signed visitor issuance and verification; tampered/missing cookies; fixed 90-day expiry; coarse UA classification; successful like (`+1`), unlike (`-1`), no-change (`0`) and failed (`null`) events; millisecond UTC timestamps; `Set-Cookie` only on non-cacheable like endpoints; log insert failure not changing the returned vote result; and no public JSON schema changes.

- [ ] **Step 2: Verify tests fail**

Run: `npm run test:worker`

Expected: new audit tests fail because visitor and audit helpers do not exist.

- [ ] **Step 3: Add the migration**

Create a table equivalent to:

```sql
CREATE TABLE IF NOT EXISTS like_audit_events (
  event_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('like', 'unlike', 'unknown')),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'no_change', 'failed')),
  reason_code TEXT NOT NULL DEFAULT '',
  count_delta INTEGER CHECK (count_delta IS NULL OR count_delta IN (-1, 0, 1)),
  visitor_id TEXT,
  visitor_first_seen_at TEXT,
  visitor_id_status TEXT NOT NULL CHECK (visitor_id_status IN ('valid', 'new', 'unavailable')),
  ip_hash TEXT,
  identity_version TEXT NOT NULL,
  browser_family TEXT NOT NULL,
  os_family TEXT NOT NULL,
  device_class TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_like_audit_occurred_at ON like_audit_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_like_audit_entry_time ON like_audit_events(entry_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_like_audit_visitor_time ON like_audit_events(visitor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_like_audit_ip_time ON like_audit_events(ip_hash, occurred_at);
```

Do not add a foreign key to `entries`; deleting a resource must not erase audit history.

- [ ] **Step 4: Implement visitor and audit identity helpers**

Use constants equivalent to:

```js
const VISITOR_COOKIE_NAME = "dh_market_visitor";
const VISITOR_TTL_SECONDS = 90 * 24 * 60 * 60;
const LIKE_IDENTITY_VERSION = "cf-ip-sha256-trunc16-v1+visitor-hmac-v1";
```

The signed token payload must contain a cryptographically random UUID, server-generated millisecond `firstSeenAt`, fixed expiry and version. Sign it with `env.VISITOR_ID_SECRET`; missing secret or signing failure yields `visitorIdStatus: "unavailable"` and never blocks likes. Production cookies must use `Path=/; Max-Age=7776000; HttpOnly; SameSite=Lax; Secure`.

- [ ] **Step 5: Implement coarse request classification and event persistence**

Classify only `browserFamily`, `osFamily`, and `deviceClass`; never persist the full User-Agent. Persist all columns with a prepared D1 statement. Use `new Date().toISOString()` for audit timestamps so milliseconds remain present.

- [ ] **Step 6: Integrate vote outcomes**

Derive action after reading the current vote state. Use D1 mutation metadata (`meta.changes`) to derive actual delta and `success`/`no_change`; failures before state discovery use action `unknown` and delta `null`. Route-level error handling must schedule a failed event with a stable reason code and return the existing 400/500 response shape.

- [ ] **Step 7: Make logging best-effort**

Pass the audit insert promise to `ctx.waitUntil()`. Catch insert failures and emit structured `console.error` containing only event ID, entry ID, and a short reason; do not include visitor ID, IP hash, cookie, full UA, or stack. Audit failure must not change a successful like response.

- [ ] **Step 8: Verify and commit**

Run:

```powershell
npm run check:worker
npm run test:worker
npx wrangler pages functions build --build-output-directory frontend --outfile .wrangler-audit-worker.js
```

Expected: all checks pass. Commit as `feat: record privacy-safe like audit events`.

### Task 2: Offline export, retention pruning, disclosure, and operations

**Files:**
- Create: `scripts/like_audit_common.mjs`
- Create: `scripts/export_like_audit.mjs`
- Create: `scripts/prune_like_audit.mjs`
- Create: `tests/like-audit-tools.test.mjs`
- Create: `docs/like-audit-operations.md`
- Modify: `package.json`
- Modify: `frontend/index.html`
- Modify: `wrangler.jsonc`
- Modify: `PLAN.md`
- Modify: `docs/like-audit-requirements.md`

- [ ] **Step 1: Add failing maintenance-tool tests**

Cover strict ISO date-range validation, SQL literal escaping, Wrangler JSON result normalization, JSONL serialization preserving `null`, manifest coverage calculation, resource-map redaction, dry-run pruning, and refusal to delete without `--confirm`.

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/like-audit-tools.test.mjs`

Expected: fail because the maintenance modules do not exist.

- [ ] **Step 3: Implement JSONL export**

`node scripts/export_like_audit.mjs --from <ISO> --to <ISO> --out <directory> [--local|--remote]` must invoke Wrangler safely without a shell, select `[from,to)`, and create:

```text
events.jsonl
entries.json
manifest.json
```

The entry map contains only stable ID, title, and author, using current entries and history where available. The manifest records export time, requested and actual coverage, event count, format version, and known best-effort gaps. Never export feedback emails, secrets, raw IPs, cookies, or full User-Agent strings.

- [ ] **Step 4: Implement explicit pruning**

`node scripts/prune_like_audit.mjs --days 90 [--local|--remote]` performs a count-only dry run. Actual deletion requires `--confirm`; validate `days` as a positive integer and report the cutoff and affected row count.

- [ ] **Step 5: Add scripts and operations documentation**

Add `audit:export` and `audit:prune` package scripts. Document D1 migration, configuring `VISITOR_ID_SECRET` in Pages secrets, export examples, fixed 90-day cookie/log policy, monthly pruning, rollback limits, and the fact that logging is best-effort.

- [ ] **Step 6: Add disclosure and observability**

Add a short public notice stating purpose, hashed IP/browser identifier use, 90-day retention, limitations, and no automatic punishment. Enable Worker observability in `wrangler.jsonc` so structured audit-write failures can be discovered.

- [ ] **Step 7: Reconcile project documentation**

Mark the requirement as implemented, document the chosen D1/90-day/JSONL decisions, update `PLAN.md`, and remove the stale statement that production prioritizes `X-Forwarded-For`.

- [ ] **Step 8: Verify and commit**

Run:

```powershell
node --test tests/like-audit-tools.test.mjs
npm run check:worker
npm run test:worker
git diff --check
```

Expected: all checks pass. Commit as `feat: add like audit maintenance workflow`.

### Task 3: End-to-end acceptance and final review fixes

**Files:**
- Modify only files required to fix verified acceptance gaps.

- [ ] **Step 1: Run full acceptance**

Run Worker tests, maintenance tests, Pages Worker compilation, `wrangler types` to a temporary ignored output, and `git diff --check`.

- [ ] **Step 2: Inspect requirements one by one**

Confirm separate like/unlike history, actual delta, network-independent visitor ID, no-cookie tolerance, signed server timestamps, no caching of visitor cookies, no public audit API, audit-failure isolation, unchanged public catalog/RAG shape, retained events after entry deletion, redacted date-range export, and explicit 90-day pruning.

- [ ] **Step 3: Apply only review-required fixes and commit**

Commit as `fix: close like audit acceptance gaps` only if fixes are required.
