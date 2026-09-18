import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAuditEventsQuery,
  buildEntriesQuery,
  buildManifest,
  escapeSqlLiteral,
  mapEntries,
  normalizeD1Result,
  parseExportArgs,
  serializeEventsJsonl,
} from "../scripts/like_audit_common.mjs";
import { exportLikeAudit } from "../scripts/export_like_audit.mjs";
import { parsePruneArgs, pruneLikeAudit } from "../scripts/prune_like_audit.mjs";

const eventRows = [
  {
    event_id: "event-b", occurred_at: "2026-09-02T00:00:00.000Z", entry_id: "dhm_2",
    action: "unlike", outcome: "success", reason_code: "", count_delta: 0,
    visitor_id: "visitor-b", visitor_first_seen_at: "2026-09-01T00:00:00.000Z",
    visitor_id_status: "valid", ip_hash: "hash-b", identity_version: "v1",
    browser_family: "Edge", os_family: "Windows", device_class: "desktop",
  },
  {
    event_id: "event-a", occurred_at: "2026-09-01T00:00:00.000Z", entry_id: "dhm_1",
    action: "like", outcome: "failed", reason_code: "db_error", count_delta: null,
    visitor_id: null, visitor_first_seen_at: null, visitor_id_status: "unavailable",
    ip_hash: null, identity_version: "v1", browser_family: "unknown",
    os_family: "unknown", device_class: "unknown",
  },
];

test("export arguments strictly canonicalize UTC range and require from before to", () => {
  const args = parseExportArgs([
    "--from", "2026-09-01T08:00:00+08:00", "--to", "2026-09-02T08:00:00+08:00", "--out", "exports",
  ]);
  assert.deepEqual(args, {
    from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z", outDir: "exports", target: "remote",
  });
  assert.throws(() => parseExportArgs(["--from", "2026-09-01", "--to", "2026-09-02T00:00:00Z", "--out", "x"]), /ISO 8601 UTC instant/);
  assert.throws(() => parseExportArgs(["--from", "2026-09-02T00:00:00Z", "--to", "2026-09-02T00:00:00Z", "--out", "x"]), /before/);
});

test("export target flags are mutually exclusive", () => {
  assert.equal(parseExportArgs(["--from", "2026-09-01T00:00:00Z", "--to", "2026-09-02T00:00:00Z", "--out", "x", "--local"]).target, "local");
  assert.throws(() => parseExportArgs(["--from", "2026-09-01T00:00:00Z", "--to", "2026-09-02T00:00:00Z", "--out", "x", "--local", "--remote"]), /both/);
});

test("queries safely escape validated SQL literals and apply deterministic ordering", () => {
  assert.equal(escapeSqlLiteral("O'Reilly"), "'O''Reilly'");
  const eventsSql = buildAuditEventsQuery("2026-09-01T00:00:00.000Z", "2026-09-02T00:00:00.000Z");
  assert.match(eventsSql, /occurred_at >= '2026-09-01T00:00:00\.000Z'/);
  assert.match(eventsSql, /occurred_at < '2026-09-02T00:00:00\.000Z'/);
  assert.match(eventsSql, /ORDER BY occurred_at ASC, event_id ASC/);
  assert.match(buildEntriesQuery(["dhm_2", "dhm_1"]), /ORDER BY id ASC/);
});

test("normalizes successful Wrangler D1 JSON and rejects errors or malformed output", () => {
  assert.deepEqual(normalizeD1Result([{ success: true, results: [{ count: 2 }], meta: { changes: 2 } }]), { rows: [{ count: 2 }], meta: { changes: 2 } });
  assert.deepEqual(normalizeD1Result({ result: [{ success: true, results: [] }] }), { rows: [], meta: {} });
  assert.throws(() => normalizeD1Result([{ success: false, errors: [{ message: "nope" }] }]), /unsuccessful/);
  assert.throws(() => normalizeD1Result({ result: "bad" }), /malformed/);
});

test("JSONL preserves null and zero count deltas and sorts events", () => {
  const lines = serializeEventsJsonl(eventRows).trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map((event) => event.eventId), ["event-a", "event-b"]);
  assert.equal(lines[0].countDelta, null);
  assert.equal(lines[1].countDelta, 0);
  assert.deepEqual(Object.keys(lines[0]).sort(), [
    "action", "browserFamily", "countDelta", "deviceClass", "entryId", "eventId", "identityVersion", "ipHash", "occurredAt", "osFamily", "outcome", "reasonCode", "visitorFirstSeenAt", "visitorId", "visitorIdStatus",
  ]);
});

test("entry mapping redacts private fields and falls back to latest historical review", () => {
  const entries = mapEntries(["dhm_1", "dhm_2"], [
    { id: "dhm_1", title: "Current", author: "Author", feedback_email: "private@example.test" },
  ], [
    { entry_id: "dhm_2", title: "Old", author: "Former", reviewed_at: "2026-09-01T00:00:00.000Z", feedback_email: "hidden@example.test" },
    { entry_id: "dhm_2", title: "Older", author: "Old", reviewed_at: "2026-08-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(entries, [
    { id: "dhm_1", title: "Current", author: "Author" },
    { id: "dhm_2", title: "Old", author: "Former" },
  ]);
});

test("manifest covers requested and actual range plus known best-effort gaps", () => {
  const manifest = buildManifest({
    exportedAt: "2026-09-03T00:00:00.000Z", from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z",
    events: eventRows, entries: [{ id: "dhm_1", title: "One", author: "A" }], target: "local",
  });
  assert.deepEqual(manifest, {
    format: "like-audit-export", version: 1, exportedAt: "2026-09-03T00:00:00.000Z",
    requested: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" },
    actual: { minOccurredAt: "2026-09-01T00:00:00.000Z", maxOccurredAt: "2026-09-02T00:00:00.000Z" },
    eventCount: 2, resourceCount: 1, target: "local", knownMissing: "Audit writes are best-effort background work and may have gaps.",
  });
});

test("export runs injected D1 queries and returns only safe serialized artifacts", async () => {
  const calls = [];
  const result = await exportLikeAudit({
    from: "2026-09-01T00:00:00.000Z", to: "2026-09-03T00:00:00.000Z", target: "local", now: () => "2026-09-04T00:00:00.000Z",
    runner: async ({ sql, target }) => {
      calls.push({ sql, target });
      if (sql.includes("FROM like_audit_events")) return { rows: eventRows, meta: {} };
      if (sql.includes("FROM entries")) return { rows: [{ id: "dhm_1", title: "One", author: "A", feedback_email: "private@example.test" }], meta: {} };
      return { rows: [{ entry_id: "dhm_2", title: "Two", author: "B", reviewed_at: "2026-09-02T00:00:00.000Z" }], meta: {} };
    },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.target === "local"));
  assert.equal(result.entries.includes("feedbackEmail"), false);
  assert.equal(JSON.parse(result.manifest).eventCount, 2);
});

test("prune validates positive days and needs explicit confirmation before DELETE", async () => {
  assert.deepEqual(parsePruneArgs(["--days", "90", "--local"]), { days: 90, target: "local", confirm: false });
  assert.throws(() => parsePruneArgs(["--days", "0"]), /positive integer/);
  assert.throws(() => parsePruneArgs(["--days", "90", "--local", "--remote"]), /both/);
  const calls = [];
  const dryRun = await pruneLikeAudit({ days: 90, target: "local", now: () => "2026-09-18T12:00:00.000Z", runner: async (call) => { calls.push(call); return { rows: [{ matchingRows: 4 }], meta: {} }; } });
  assert.equal(dryRun.confirmed, false);
  assert.equal(dryRun.affectedRows, 4);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^SELECT COUNT\(\*\)/);
});

test("confirmed prune deletes and derives affected count from D1 meta", async () => {
  const calls = [];
  const result = await pruneLikeAudit({ days: 1, target: "local", confirm: true, now: () => "2026-09-18T12:00:00.000Z", runner: async (call) => { calls.push(call); return { rows: [], meta: { changes: 3 } }; } });
  assert.equal(result.confirmed, true);
  assert.equal(result.affectedRows, 3);
  assert.match(calls[0].sql, /^DELETE FROM like_audit_events/);
  assert.match(calls[0].sql, /2026-09-17T12:00:00\.000Z/);
});

test("confirmed prune can count locally returned deleted rows when Wrangler omits changes metadata", async () => {
  const result = await pruneLikeAudit({
    days: 1, target: "local", confirm: true, now: () => "2026-09-18T12:00:00.000Z",
    runner: async () => ({ rows: [{ event_id: "one" }, { event_id: "two" }], meta: { duration: 1 } }),
  });
  assert.equal(result.affectedRows, 2);
});

test("public footer discloses the limited like-audit data use without forcing consent", async () => {
  const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /点赞审计/);
  assert.match(html, /随机浏览器凭据/);
  assert.match(html, /哈希 IP/);
  assert.match(html, /粗略设备信息/);
  assert.match(html, /90 天/);
  assert.match(html, /不保存原始 IP 或完整 UA/);
  assert.match(html, /不会自动处罚/);
  assert.match(html, /清除 Cookie 会更换该标识/);
});
