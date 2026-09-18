import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildAuditEventsQuery, buildEntriesQuery, buildManifest, buildReviewFallbackQuery, mapEntries,
  parseExportArgs, runWranglerD1Query, serializeEventsJsonl,
} from "./like_audit_common.mjs";

export async function exportLikeAudit({ from, to, target, runner = runWranglerD1Query, now = () => new Date().toISOString() }) {
  const events = (await runner({ sql: buildAuditEventsQuery(from, to), target })).rows;
  const entryIds = [...new Set(events.map((event) => event.entry_id).filter(Boolean))];
  const entriesSql = buildEntriesQuery(entryIds);
  const reviewsSql = buildReviewFallbackQuery(entryIds);
  const currentRows = entriesSql ? (await runner({ sql: entriesSql, target })).rows : [];
  const reviewRows = reviewsSql ? (await runner({ sql: reviewsSql, target })).rows : [];
  const entries = mapEntries(entryIds, currentRows, reviewRows);
  return {
    events: serializeEventsJsonl(events), entries: `${JSON.stringify(entries, null, 2)}\n`,
    manifest: `${JSON.stringify(buildManifest({ exportedAt: now(), from, to, events, entries, target }), null, 2)}\n`,
  };
}

async function main() {
  const args = parseExportArgs(process.argv.slice(2));
  const artifacts = await exportLikeAudit(args);
  await mkdir(args.outDir, { recursive: true });
  await Promise.all([
    writeFile(`${args.outDir}/events.jsonl`, artifacts.events, "utf8"),
    writeFile(`${args.outDir}/entries.json`, artifacts.entries, "utf8"),
    writeFile(`${args.outDir}/manifest.json`, artifacts.manifest, "utf8"),
  ]);
  process.stdout.write(`Exported like audit files to ${args.outDir}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
