import { fileURLToPath } from "node:url";
import { escapeSqlLiteral, parseFlags, runWranglerD1Query } from "./like_audit_common.mjs";

export function parsePruneArgs(argv) {
  const confirm = argv.includes("--confirm");
  const filtered = argv.filter((value) => value !== "--confirm");
  const { values, target } = parseFlags(filtered, ["--days"]);
  const days = Number(values.get("--days"));
  if (!Number.isInteger(days) || days <= 0 || String(days) !== values.get("--days")) throw new Error("--days must be a positive integer");
  return { days, target, confirm };
}

function cutoffForDays(days, now) {
  const timestamp = Date.parse(now());
  if (Number.isNaN(timestamp)) throw new Error("clock did not provide an ISO instant");
  return new Date(timestamp - days * 24 * 60 * 60 * 1000).toISOString();
}

function readCount(rows) {
  const value = rows[0]?.matchingRows ?? rows[0]?.matching_rows ?? rows[0]?.count;
  if (!Number.isInteger(value) || value < 0) throw new Error("malformed D1 count result");
  return value;
}

export async function pruneLikeAudit({ days, target, confirm = false, runner = runWranglerD1Query, now = () => new Date().toISOString() }) {
  const cutoff = cutoffForDays(days, now);
  const where = `occurred_at < ${escapeSqlLiteral(cutoff)}`;
  if (!confirm) {
    const { rows } = await runner({ sql: `SELECT COUNT(*) AS matchingRows FROM like_audit_events WHERE ${where}`, target });
    return { cutoff, affectedRows: readCount(rows), confirmed: false, target };
  }
  const { rows, meta } = await runner({ sql: `DELETE FROM like_audit_events WHERE ${where} RETURNING event_id`, target });
  const affectedRows = Number.isInteger(meta.changes) && meta.changes >= 0 ? meta.changes : rows.length;
  if (!Number.isInteger(affectedRows) || affectedRows < 0) throw new Error("malformed D1 delete result");
  return { cutoff, affectedRows, confirmed: true, target };
}

async function main() {
  const args = parsePruneArgs(process.argv.slice(2));
  const result = await pruneLikeAudit(args);
  const label = result.confirmed ? "Pruned" : "Dry run: would prune";
  process.stdout.write(`${label} ${result.affectedRows} audit events before ${result.cutoff} (${result.target}).\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
