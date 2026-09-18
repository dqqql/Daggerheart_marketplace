import { access, mkdir, writeFile } from "node:fs/promises";
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

export async function writeExportArtifacts({ outDir, artifacts }) {
  const files = [
    ["events.jsonl", artifacts.events],
    ["entries.json", artifacts.entries],
    ["manifest.json", artifacts.manifest],
  ].map(([name, contents]) => ({ path: `${outDir}/${name}`, contents }));
  await mkdir(outDir, { recursive: true });
  for (const file of files) {
    try {
      await access(file.path);
      throw new Error(`refusing to overwrite existing export artifact: ${file.path}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  for (const file of files) await writeFile(file.path, file.contents, { encoding: "utf8", flag: "wx" });
}

async function main() {
  const args = parseExportArgs(process.argv.slice(2));
  const artifacts = await exportLikeAudit(args);
  await writeExportArtifacts({ outDir: args.outDir, artifacts });
  process.stdout.write(`Exported like audit files to ${args.outDir}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
