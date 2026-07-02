#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const entriesPath = args.entries;
const outputPath = args.out || path.join("data", "imports", "entries_import.sql");

if (!entriesPath) {
  console.error("Usage: node scripts/build_d1_import.mjs --entries <entries.json> [--out <output.sql>]");
  process.exit(1);
}

const raw = JSON.parse(await readFile(entriesPath, "utf8"));
const entries = Array.isArray(raw) ? raw : raw.entries;
if (!Array.isArray(entries)) {
  throw new Error("Input JSON must be an array or an object with an entries array.");
}

const lines = [
  "DELETE FROM entry_likes;",
  "DELETE FROM entries;",
];

let likeCount = 0;
const seenEntryIds = new Set();

for (const item of entries) {
  if (!item || typeof item !== "object") continue;
  const id = requiredText(item.id, "id");
  if (seenEntryIds.has(id)) {
    throw new Error(`Duplicate entry id: ${id}`);
  }
  seenEntryIds.add(id);

  const createdAt = optionalText(item.createdAt) || nowIso();
  const updatedAt = optionalText(item.updatedAt) || createdAt;
  const contentTags = normalizeArray(item.contentTags);
  const flavorTags = normalizeArray(item.flavorTags);
  const recommendValue = normalizeInteger(item.recommendValue);

  lines.push(
    `INSERT INTO entries (id, title, author, content_tags, flavor_tags, recommend_value, summary, cover_path, target_url, created_at, updated_at) VALUES (${[
      sqlString(id),
      sqlString(requiredText(item.title, "title")),
      sqlString(optionalText(item.author)),
      sqlString(JSON.stringify(contentTags)),
      sqlString(JSON.stringify(flavorTags)),
      String(recommendValue),
      sqlString(optionalText(item.summary)),
      sqlString(optionalText(item.coverPath)),
      sqlString(requiredText(item.targetUrl, "targetUrl")),
      sqlString(createdAt),
      sqlString(updatedAt),
    ].join(", ")});`
  );

  const likedBy = Array.isArray(item.likedBy) ? item.likedBy : [];
  const uniqueLikes = Array.from(new Set(likedBy.map(optionalText).filter(Boolean)));
  likeCount += uniqueLikes.length;
  for (const ipHash of uniqueLikes) {
    lines.push(
      `INSERT INTO entry_likes (entry_id, ip_hash, created_at) VALUES (${sqlString(id)}, ${sqlString(ipHash)}, ${sqlString(updatedAt)});`
    );
  }
}

lines.push("");

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, lines.join("\n"), "utf8");

console.log(`Wrote ${outputPath}`);
console.log(`Entries: ${seenEntryIds.size}`);
console.log(`Likes: ${likeCount}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    parsed[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return parsed;
}

function requiredText(value, fieldName) {
  const text = optionalText(value);
  if (!text) throw new Error(`Missing required field: ${fieldName}`);
  return text;
}

function optionalText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[ \t]+/g, " ").trim();
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const text = optionalText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < 0) return 0;
  return number;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
