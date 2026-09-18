import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const DATABASE_NAME = "the-great-vault";
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const EVENT_COLUMNS = [
  "event_id", "occurred_at", "entry_id", "action", "outcome", "reason_code", "count_delta",
  "visitor_id", "visitor_first_seen_at", "visitor_id_status", "ip_hash", "identity_version",
  "browser_family", "os_family", "device_class",
];
const require = createRequire(import.meta.url);

export function buildWranglerLaunch(args) {
  return { program: process.execPath, args: [require.resolve("wrangler"), ...args] };
}

export function parseIsoInstant(value, name = "time") {
  const match = ISO_INSTANT.exec(String(value || ""));
  if (!match) throw new Error(`${name} must be an ISO 8601 UTC instant with a timezone`);
  const [, year, month, day, hour, minute, second, , zone] = match;
  const base = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const timeValid = Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
  const calendarValid = base.getUTCFullYear() === Number(year) && base.getUTCMonth() === Number(month) - 1 && base.getUTCDate() === Number(day);
  const offsetValid = zone === "Z" || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59);
  const parsed = Date.parse(value);
  if (!timeValid || !calendarValid || !offsetValid || Number.isNaN(parsed)) throw new Error(`${name} must be an ISO 8601 UTC instant with a timezone`);
  return new Date(parsed).toISOString();
}

function parseFlags(argv, required) {
  const values = new Map();
  let local = false;
  let remote = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--local") { local = true; continue; }
    if (token === "--remote") { remote = true; continue; }
    if (!required.includes(token)) throw new Error(`unknown argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || values.has(token)) throw new Error(`${token} requires one value`);
    values.set(token, value);
    index += 1;
  }
  if (local && remote) throw new Error("cannot specify both --local and --remote");
  for (const flag of required) if (!values.has(flag)) throw new Error(`missing required argument: ${flag}`);
  return { values, target: local ? "local" : "remote" };
}

export function parseExportArgs(argv) {
  const { values, target } = parseFlags(argv, ["--from", "--to", "--out"]);
  const from = parseIsoInstant(values.get("--from"), "--from");
  const to = parseIsoInstant(values.get("--to"), "--to");
  if (from >= to) throw new Error("--from must be before --to");
  return { from, to, outDir: values.get("--out"), target };
}

export function escapeSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildAuditEventsQuery(from, to) {
  return `SELECT ${EVENT_COLUMNS.join(", ")} FROM like_audit_events WHERE occurred_at >= ${escapeSqlLiteral(from)} AND occurred_at < ${escapeSqlLiteral(to)} ORDER BY occurred_at ASC, event_id ASC`;
}

export function buildEntriesQuery(entryIds) {
  if (entryIds.length === 0) return null;
  const ids = [...new Set(entryIds)].sort().map(escapeSqlLiteral).join(", ");
  return `SELECT id, title, author FROM entries WHERE id IN (${ids}) ORDER BY id ASC`;
}

export function buildReviewFallbackQuery(entryIds) {
  if (entryIds.length === 0) return null;
  const ids = [...new Set(entryIds)].sort().map(escapeSqlLiteral).join(", ");
  return `SELECT entry_id, title, author, reviewed_at, id FROM submission_reviews WHERE entry_id IN (${ids}) ORDER BY entry_id ASC, reviewed_at DESC, id DESC`;
}

export function normalizeD1Result(raw) {
  let candidates = raw;
  if (candidates && !Array.isArray(candidates) && Array.isArray(candidates.result)) candidates = candidates.result;
  if (!Array.isArray(candidates) && candidates && typeof candidates === "object" && "success" in candidates) candidates = [candidates];
  if (!Array.isArray(candidates) || candidates.length !== 1) throw new Error("malformed Wrangler D1 JSON result");
  const result = candidates[0];
  if (!result || typeof result !== "object" || result.success !== true || !Array.isArray(result.results)) {
    throw new Error(result?.success === false ? "unsuccessful Wrangler D1 query" : "malformed Wrangler D1 JSON result");
  }
  if (result.meta !== undefined && (!result.meta || typeof result.meta !== "object" || Array.isArray(result.meta))) throw new Error("malformed Wrangler D1 JSON meta");
  return { rows: result.results, meta: result.meta || {} };
}

export async function runWranglerD1Query({ sql, target, spawnImpl = spawn }) {
  const launch = buildWranglerLaunch(["d1", "execute", DATABASE_NAME, `--${target}`, "--command", sql, "--json"]);
  const output = await new Promise((resolve, reject) => {
    const child = spawnImpl(launch.program, launch.args, { shell: false, windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => { stdout.push(Buffer.from(chunk)); });
    child.stderr.on("data", (chunk) => { stderr.push(Buffer.from(chunk)); });
    child.on("error", reject);
    child.on("close", (code) => {
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) reject(new Error(`Wrangler D1 query failed (${code}): ${stderrText.trim() || "no error output"}`));
      else resolve(stdoutText);
    });
  });
  let parsed;
  try { parsed = JSON.parse(output); } catch { throw new Error("Wrangler D1 query did not return JSON"); }
  return normalizeD1Result(parsed);
}

function toEvent(row) {
  return {
    eventId: row.event_id, occurredAt: row.occurred_at, entryId: row.entry_id, action: row.action,
    outcome: row.outcome, reasonCode: row.reason_code, countDelta: row.count_delta,
    visitorId: row.visitor_id, visitorFirstSeenAt: row.visitor_first_seen_at,
    visitorIdStatus: row.visitor_id_status, ipHash: row.ip_hash, identityVersion: row.identity_version,
    browserFamily: row.browser_family, osFamily: row.os_family, deviceClass: row.device_class,
  };
}

export function serializeEventsJsonl(rows) {
  return [...rows]
    .sort((left, right) => left.occurred_at.localeCompare(right.occurred_at) || left.event_id.localeCompare(right.event_id))
    .map((row) => JSON.stringify(toEvent(row)))
    .join("\n") + (rows.length ? "\n" : "");
}

export function mapEntries(entryIds, currentRows, reviewRows) {
  const current = new Map(currentRows.map((row) => [row.id, { id: row.id, title: row.title, author: row.author }]));
  const fallback = new Map();
  for (const row of [...reviewRows].sort((left, right) => left.entry_id.localeCompare(right.entry_id) || right.reviewed_at.localeCompare(left.reviewed_at) || String(right.id || "").localeCompare(String(left.id || "")))) {
    if (!fallback.has(row.entry_id) && row.title != null && row.author != null) fallback.set(row.entry_id, { id: row.entry_id, title: row.title, author: row.author });
  }
  return [...new Set(entryIds)].sort().flatMap((id) => current.has(id) ? [current.get(id)] : fallback.has(id) ? [fallback.get(id)] : []);
}

export function buildManifest({ exportedAt, from, to, events, entries, target }) {
  const sorted = [...events].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at) || left.event_id.localeCompare(right.event_id));
  return {
    format: "like-audit-export", version: 1, exportedAt,
    requested: { from, to },
    actual: { minOccurredAt: sorted[0]?.occurred_at || null, maxOccurredAt: sorted.at(-1)?.occurred_at || null },
    eventCount: sorted.length, resourceCount: entries.length, target,
    knownMissing: "Audit writes are best-effort background work and may have gaps.",
  };
}

export { DATABASE_NAME, parseFlags };
