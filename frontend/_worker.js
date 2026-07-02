const COVER_URL_PREFIX = "/the-great-vault/covers";
const PENDING_COVER_URL_PREFIX = "/the-great-vault/covers/pending";
const SESSION_COOKIE_NAME = "dh_market_admin";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const LIKE_HASH_LENGTH = 16;
const ENTRY_ID_PREFIX = "dhm_";
const SUBMISSION_ID_PREFIX = "sub_";
const REVIEW_ID_PREFIX = "rev_";
const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_RESEND_FROM = "宏伟宝库 <review@mail.dhvault.top>";

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      if (error instanceof ValidationError) {
        return json({ error: error.message }, 400);
      }
      console.error(error);
      return json({ error: "internal server error" }, 500);
    }
  },
};

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (path.startsWith("/api/")) {
    return handleApi(request, env, path);
  }

  if (path === "/the-great-vault" || path === "/the-great-vault/") {
    return fetchAsset(request, env, "/");
  }
  if (path === "/the-great-vault/admin" || path === "/the-great-vault/admin/") {
    return fetchAsset(request, env, "/admin/");
  }
  if (path.startsWith("/the-great-vault/assets/")) {
    return fetchAsset(request, env, path.replace("/the-great-vault/assets/", "/assets/"));
  }

  if (path.startsWith(PENDING_COVER_URL_PREFIX + "/")) {
    const filename = filenameFromPath(path.slice((PENDING_COVER_URL_PREFIX + "/").length));
    return serveR2Object(env, `covers/pending/${filename}`);
  }
  if (path.startsWith(COVER_URL_PREFIX + "/")) {
    const filename = filenameFromPath(path.slice((COVER_URL_PREFIX + "/").length));
    return serveR2Object(env, `covers/${filename}`);
  }
  if (path.startsWith("/marketplace/covers/")) {
    const filename = filenameFromPath(path.slice("/marketplace/covers/".length));
    return serveR2Object(env, `covers/${filename}`);
  }

  return env.ASSETS.fetch(request);
}

async function handleApi(request, env, path) {
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/api/health") {
    return json({ ok: true });
  }

  if (method === "GET" && path === "/api/public/entries") {
    return json({ entries: await loadEntries(env) });
  }
  if (method === "GET" && path === "/api/public/tags") {
    return json(await buildTagCountsFromDb(env));
  }
  if (method === "GET" && path === "/api/public/bootstrap") {
    const entries = await loadEntries(env);
    return json({ entries, tags: buildTagCounts(entries) });
  }
  if (method === "GET" && path === "/api/public/likes") {
    const ipHash = await getClientIpHash(request, env);
    const likes = await env.DB.prepare(
      "SELECT entry_id FROM entry_likes WHERE ip_hash = ? ORDER BY entry_id"
    ).bind(ipHash).all();
    return json({ likedEntryIds: likes.results.map((row) => row.entry_id) });
  }

  const likeMatch = path.match(/^\/api\/public\/like\/([^/]+)$/);
  if (method === "POST" && likeMatch) {
    return toggleLike(request, env, decodeURIComponent(likeMatch[1]));
  }

  if (method === "POST" && path === "/api/public/submissions") {
    const payload = await readJson(request);
    const submission = await createSubmission(env, payload);
    return json({ submission }, 201);
  }
  if (method === "POST" && path === "/api/public/covers") {
    return uploadCover(request, env, "pending");
  }

  if (method === "GET" && path === "/api/admin/session") {
    return json({ authenticated: Boolean(await readSession(request, env)) });
  }
  if (method === "POST" && path === "/api/admin/login") {
    return login(request, env);
  }

  const session = await readSession(request, env);
  if (!session) {
    return json({ error: "admin auth required" }, 401);
  }

  if (method === "POST" && path === "/api/admin/logout") {
    return logout(request);
  }
  if (method === "GET" && path === "/api/admin/entries") {
    return json({ entries: await loadEntries(env) });
  }
  if (method === "POST" && path === "/api/admin/entries") {
    const entry = await createEntry(env, await readJson(request));
    return json({ entry }, 201);
  }
  if (method === "POST" && path === "/api/admin/entries/import") {
    const payload = await readJson(request);
    const imported = await importEntries(env, payload.entries);
    return json({ imported });
  }
  if (method === "POST" && path === "/api/admin/covers") {
    return uploadCover(request, env, "public");
  }
  if (method === "GET" && path === "/api/admin/submissions") {
    return json({ submissions: await loadSubmissions(env) });
  }
  if (method === "GET" && path === "/api/admin/submission-reviews") {
    return json({ reviews: await loadSubmissionReviews(env) });
  }

  const entryMatch = path.match(/^\/api\/admin\/entries\/([^/]+)$/);
  if (entryMatch) {
    const entryId = decodeURIComponent(entryMatch[1]);
    if (method === "PUT") {
      const entry = await updateEntry(env, entryId, await readJson(request));
      return json({ entry });
    }
    if (method === "DELETE") {
      await deleteEntry(env, entryId);
      return json({ deletedId: entryId });
    }
  }

  const submissionMatch = path.match(/^\/api\/admin\/submissions\/([^/]+)$/);
  if (submissionMatch) {
    const submissionId = decodeURIComponent(submissionMatch[1]);
    if (method === "PUT") {
      const submission = await updateSubmission(env, submissionId, await readJson(request));
      return json({ submission });
    }
    if (method === "DELETE") {
      const payload = await readJson(request, true);
      return rejectSubmission(env, submissionId, normalizeReviewNote(payload.reviewNote));
    }
  }

  const approveMatch = path.match(/^\/api\/admin\/submissions\/([^/]+)\/approve$/);
  if (method === "POST" && approveMatch) {
    return approveSubmission(env, decodeURIComponent(approveMatch[1]));
  }

  return json({ error: "not found" }, 404);
}

async function fetchAsset(request, env, nextPath) {
  const url = new URL(request.url);
  url.pathname = nextPath;
  return env.ASSETS.fetch(new Request(url, request));
}

async function serveR2Object(env, key) {
  const object = await env.COVERS.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}

async function loadEntries(env) {
  const entriesResult = await env.DB.prepare(
    `SELECT id, title, author, content_tags, flavor_tags, recommend_value,
            summary, cover_path, target_url, created_at, updated_at
       FROM entries
      ORDER BY updated_at DESC, id ASC`
  ).all();
  const likesResult = await env.DB.prepare(
    "SELECT entry_id, ip_hash FROM entry_likes ORDER BY entry_id, ip_hash"
  ).all();
  const likesByEntry = new Map();
  for (const like of likesResult.results) {
    if (!likesByEntry.has(like.entry_id)) likesByEntry.set(like.entry_id, []);
    likesByEntry.get(like.entry_id).push(like.ip_hash);
  }
  return entriesResult.results.map((row) => rowToEntry(row, likesByEntry.get(row.id) || []));
}

async function loadEntry(env, entryId) {
  const row = await env.DB.prepare(
    `SELECT id, title, author, content_tags, flavor_tags, recommend_value,
            summary, cover_path, target_url, created_at, updated_at
       FROM entries WHERE id = ?`
  ).bind(entryId).first();
  if (!row) throw new ValidationError("entry not found");
  const likes = await env.DB.prepare(
    "SELECT ip_hash FROM entry_likes WHERE entry_id = ? ORDER BY ip_hash"
  ).bind(entryId).all();
  return rowToEntry(row, likes.results.map((item) => item.ip_hash));
}

function rowToEntry(row, likedBy) {
  return {
    id: row.id,
    title: row.title,
    author: row.author || "",
    contentTags: parseJsonArray(row.content_tags),
    flavorTags: parseJsonArray(row.flavor_tags),
    recommendValue: Number(row.recommend_value || 0),
    likeCount: likedBy.length,
    likedBy,
    summary: row.summary || "",
    coverPath: row.cover_path || "",
    targetUrl: row.target_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createEntry(env, payload) {
  const existingIds = await getIds(env, "entries");
  const entry = normalizeEntry(payload, { existingIds });
  await insertEntry(env, entry);
  return entry;
}

async function updateEntry(env, entryId, payload) {
  const current = await loadEntry(env, entryId);
  const existingIds = await getIds(env, "entries", entryId);
  const entry = normalizeEntry(payload, { existingIds, currentEntry: current });
  await env.DB.prepare(
    `UPDATE entries
        SET title = ?, author = ?, content_tags = ?, flavor_tags = ?,
            recommend_value = ?, summary = ?, cover_path = ?, target_url = ?,
            created_at = ?, updated_at = ?
      WHERE id = ?`
  ).bind(
    entry.title,
    entry.author,
    JSON.stringify(entry.contentTags),
    JSON.stringify(entry.flavorTags),
    entry.recommendValue,
    entry.summary,
    entry.coverPath,
    entry.targetUrl,
    entry.createdAt,
    entry.updatedAt,
    entry.id
  ).run();
  return entry;
}

async function deleteEntry(env, entryId) {
  const entry = await loadEntry(env, entryId);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM entry_likes WHERE entry_id = ?").bind(entryId),
    env.DB.prepare("DELETE FROM entries WHERE id = ?").bind(entryId),
  ]);
  await deleteCoverObject(env, entry.coverPath, "public");
}

async function insertEntry(env, entry) {
  await env.DB.prepare(
    `INSERT INTO entries
      (id, title, author, content_tags, flavor_tags, recommend_value,
       summary, cover_path, target_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    entry.id,
    entry.title,
    entry.author,
    JSON.stringify(entry.contentTags),
    JSON.stringify(entry.flavorTags),
    entry.recommendValue,
    entry.summary,
    entry.coverPath,
    entry.targetUrl,
    entry.createdAt,
    entry.updatedAt
  ).run();
}

async function importEntries(env, incoming) {
  if (!Array.isArray(incoming)) {
    throw new ValidationError("entries must be an array");
  }
  const statements = [
    env.DB.prepare("DELETE FROM entry_likes"),
    env.DB.prepare("DELETE FROM entries"),
  ];
  const existingIds = new Set();
  for (const item of incoming) {
    const source = item && typeof item === "object" ? item : {};
    const entry = normalizeEntry(source, { existingIds });
    const originalCreated = normalizeOptionalText(source.createdAt);
    const originalUpdated = normalizeOptionalText(source.updatedAt);
    if (originalCreated) entry.createdAt = originalCreated;
    if (originalUpdated) entry.updatedAt = originalUpdated;
    statements.push(
      env.DB.prepare(
        `INSERT INTO entries
          (id, title, author, content_tags, flavor_tags, recommend_value,
           summary, cover_path, target_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        entry.id,
        entry.title,
        entry.author,
        JSON.stringify(entry.contentTags),
        JSON.stringify(entry.flavorTags),
        entry.recommendValue,
        entry.summary,
        entry.coverPath,
        entry.targetUrl,
        entry.createdAt,
        entry.updatedAt
      )
    );
    const likedBy = Array.isArray(source.likedBy) ? source.likedBy : [];
    const uniqueLikes = Array.from(new Set(likedBy.map(normalizeOptionalText).filter(Boolean)));
    for (const ipHash of uniqueLikes) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO entry_likes (entry_id, ip_hash, created_at) VALUES (?, ?, ?)"
        ).bind(entry.id, ipHash, entry.createdAt)
      );
    }
    existingIds.add(entry.id);
  }
  if (statements.length) await env.DB.batch(statements);
  return incoming.length;
}

async function toggleLike(request, env, entryId) {
  await ensureEntryExists(env, entryId);
  const ipHash = await getClientIpHash(request, env);
  if (!ipHash) throw new ValidationError("unable to identify client");

  const current = await env.DB.prepare(
    "SELECT 1 FROM entry_likes WHERE entry_id = ? AND ip_hash = ?"
  ).bind(entryId, ipHash).first();
  let liked;
  if (current) {
    await env.DB.prepare(
      "DELETE FROM entry_likes WHERE entry_id = ? AND ip_hash = ?"
    ).bind(entryId, ipHash).run();
    liked = false;
  } else {
    await env.DB.prepare(
      "INSERT INTO entry_likes (entry_id, ip_hash, created_at) VALUES (?, ?, ?)"
    ).bind(entryId, ipHash, nowIso()).run();
    liked = true;
  }
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM entry_likes WHERE entry_id = ?"
  ).bind(entryId).first();
  return json({ liked, likeCount: Number(count.count || 0) });
}

async function ensureEntryExists(env, entryId) {
  const row = await env.DB.prepare("SELECT id FROM entries WHERE id = ?").bind(entryId).first();
  if (!row) throw new ValidationError("entry not found");
}

async function buildTagCountsFromDb(env) {
  return buildTagCounts(await loadEntries(env));
}

function buildTagCounts(entries) {
  return {
    contentTags: countTags(entries, "contentTags"),
    flavorTags: countTags(entries, "flavorTags"),
  };
}

function countTags(entries, fieldName) {
  const counts = new Map();
  for (const entry of entries) {
    for (const tag of entry[fieldName] || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .map(([tag, count]) => ({ tag, count }));
}

async function createSubmission(env, payload) {
  const existingIds = await getIds(env, "submissions");
  const submission = normalizeSubmission(payload, { existingIds });
  await insertSubmission(env, submission);
  return submission;
}

async function updateSubmission(env, submissionId, payload) {
  const current = await loadSubmission(env, submissionId);
  const existingIds = await getIds(env, "submissions", submissionId);
  const submission = normalizeSubmission(payload, { existingIds, currentSubmission: current });
  await env.DB.prepare(
    `UPDATE submissions
        SET title = ?, author = ?, content_tags = ?, flavor_tags = ?,
            recommend_value = ?, summary = ?, cover_path = ?, target_url = ?,
            feedback_email = ?, created_at = ?, updated_at = ?
      WHERE id = ?`
  ).bind(
    submission.title,
    submission.author,
    JSON.stringify(submission.contentTags),
    JSON.stringify(submission.flavorTags),
    submission.recommendValue,
    submission.summary,
    submission.coverPath,
    submission.targetUrl,
    submission.feedbackEmail,
    submission.createdAt,
    submission.updatedAt,
    submission.id
  ).run();
  return submission;
}

async function insertSubmission(env, submission) {
  await env.DB.prepare(
    `INSERT INTO submissions
      (id, title, author, content_tags, flavor_tags, recommend_value, summary,
       cover_path, target_url, feedback_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    submission.id,
    submission.title,
    submission.author,
    JSON.stringify(submission.contentTags),
    JSON.stringify(submission.flavorTags),
    submission.recommendValue,
    submission.summary,
    submission.coverPath,
    submission.targetUrl,
    submission.feedbackEmail,
    submission.createdAt,
    submission.updatedAt
  ).run();
}

async function loadSubmissions(env) {
  const result = await env.DB.prepare(
    `SELECT id, title, author, content_tags, flavor_tags, recommend_value,
            summary, cover_path, target_url, feedback_email, created_at, updated_at
       FROM submissions
      ORDER BY created_at DESC, id ASC`
  ).all();
  return result.results.map(rowToSubmission);
}

async function loadSubmission(env, submissionId) {
  const row = await env.DB.prepare(
    `SELECT id, title, author, content_tags, flavor_tags, recommend_value,
            summary, cover_path, target_url, feedback_email, created_at, updated_at
       FROM submissions WHERE id = ?`
  ).bind(submissionId).first();
  if (!row) throw new ValidationError("submission not found");
  return rowToSubmission(row);
}

function rowToSubmission(row) {
  return {
    id: row.id,
    title: row.title,
    author: row.author || "",
    contentTags: parseJsonArray(row.content_tags),
    flavorTags: parseJsonArray(row.flavor_tags),
    recommendValue: Number(row.recommend_value || 0),
    summary: row.summary || "",
    coverPath: row.cover_path || "",
    targetUrl: row.target_url,
    feedbackEmail: row.feedback_email || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function approveSubmission(env, submissionId) {
  const submission = await loadSubmission(env, submissionId);
  const newCoverPath = await migratePendingCover(env, submission.coverPath);
  const existingIds = await getIds(env, "entries");
  const now = nowIso();
  const entry = {
    id: generateId(ENTRY_ID_PREFIX, existingIds),
    title: submission.title,
    author: submission.author,
    contentTags: submission.contentTags,
    flavorTags: submission.flavorTags,
    recommendValue: submission.recommendValue,
    likeCount: 0,
    likedBy: [],
    summary: submission.summary,
    coverPath: newCoverPath,
    targetUrl: submission.targetUrl,
    createdAt: now,
    updatedAt: now,
  };
  const review = await buildSubmissionReview(env, {
    submission,
    action: "approved",
    entry,
    coverPath: newCoverPath,
  });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(submissionId),
    env.DB.prepare(
      `INSERT INTO entries
        (id, title, author, content_tags, flavor_tags, recommend_value,
         summary, cover_path, target_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      entry.id,
      entry.title,
      entry.author,
      JSON.stringify(entry.contentTags),
      JSON.stringify(entry.flavorTags),
      entry.recommendValue,
      entry.summary,
      entry.coverPath,
      entry.targetUrl,
      entry.createdAt,
      entry.updatedAt
    ),
    reviewInsertStatement(env, review),
  ]);
  return json({ entry });
}

async function rejectSubmission(env, submissionId, reviewNote) {
  const submission = await loadSubmission(env, submissionId);
  await deleteCoverObject(env, submission.coverPath, "pending");
  const notification = await sendRejectionNotice(env, submission, reviewNote);
  const review = await buildSubmissionReview(env, {
    submission,
    action: "rejected",
    reviewNote,
    notification,
  });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(submissionId),
    reviewInsertStatement(env, review),
  ]);
  return json({ rejectedId: submissionId, notification });
}

async function sendRejectionNotice(env, submission, reviewNote, fetchImpl = fetch) {
  const recipient = normalizeOptionalText(submission.feedbackEmail);
  if (!recipient) return { status: "skipped", reason: "no_feedback_email" };
  if (!env.RESEND_API_KEY) return { status: "skipped", reason: "not_configured" };

  try {
    const response = await fetchImpl(RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildRejectionEmailPayload(env, submission, reviewNote, recipient)),
    });

    if (!response.ok) {
      return {
        status: "failed",
        reason: "send_failed",
        message: await readResendError(response),
      };
    }

    const result = await readOptionalJson(response);
    const messageId = normalizeOptionalText(result && result.id);
    return messageId
      ? { status: "sent", provider: "resend", messageId }
      : { status: "sent", provider: "resend" };
  } catch (error) {
    return {
      status: "failed",
      reason: "send_failed",
      message: compactErrorMessage(error && error.message ? error.message : String(error)),
    };
  }
}

function buildRejectionEmailPayload(env, submission, reviewNote, recipient) {
  const replyTo = normalizeOptionalText(env.RESEND_REPLY_TO);
  const payload = {
    from: normalizeOptionalText(env.RESEND_FROM) || DEFAULT_RESEND_FROM,
    to: recipient,
    subject: `你的投稿「${submission.title || "未命名投稿"}」未通过审核`,
    text: buildRejectionText(submission, reviewNote),
    html: buildRejectionHtml(submission, reviewNote),
  };
  if (replyTo) payload.reply_to = replyTo;
  return payload;
}

function buildRejectionText(submission, reviewNote) {
  const note = normalizeOptionalText(reviewNote) || "未填写具体审阅意见。";
  const title = submission.title || "未命名投稿";
  const targetUrl = normalizeOptionalText(submission.targetUrl);
  return [
    `你好，你在宏伟宝库提交的资源「${title}」未通过审核。`,
    "",
    "审阅意见：",
    note,
    "",
    targetUrl ? `投稿链接：${targetUrl}` : "",
    "你可以根据审阅意见调整后重新投稿。",
  ].filter((line) => line !== "").join("\n");
}

function buildRejectionHtml(submission, reviewNote) {
  const note = normalizeOptionalText(reviewNote) || "未填写具体审阅意见。";
  const title = submission.title || "未命名投稿";
  const targetUrl = normalizeOptionalText(submission.targetUrl);
  const linkHtml = targetUrl
    ? `<p>投稿链接：<a href="${escapeHtml(targetUrl)}">${escapeHtml(targetUrl)}</a></p>`
    : "";
  return [
    "<p>你好，</p>",
    `<p>你在宏伟宝库提交的资源「${escapeHtml(title)}」未通过审核。</p>`,
    "<p>审阅意见：</p>",
    `<blockquote>${escapeHtml(note).replace(/\n/g, "<br>")}</blockquote>`,
    linkHtml,
    "<p>你可以根据审阅意见调整后重新投稿。</p>",
  ].join("");
}

async function readOptionalJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function readResendError(response) {
  let text = "";
  try {
    text = await response.text();
  } catch {
    return `Resend API returned ${response.status}`;
  }
  if (!text) return `Resend API returned ${response.status}`;
  try {
    const parsed = JSON.parse(text);
    return compactErrorMessage(parsed.message || parsed.error || text);
  } catch {
    return compactErrorMessage(text);
  }
}

function compactErrorMessage(value) {
  const message = String(value || "未知错误").replace(/\s+/g, " ").trim();
  return message.length > 180 ? message.slice(0, 177) + "..." : message;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function buildSubmissionReview(env, options) {
  const existingIds = await getIds(env, "submission_reviews");
  const submission = options.submission;
  return {
    id: generateId(REVIEW_ID_PREFIX, existingIds),
    submissionId: submission.id || "",
    action: options.action,
    entryId: options.entry ? options.entry.id : "",
    title: submission.title || "",
    author: submission.author || "",
    contentTags: [...(submission.contentTags || [])],
    flavorTags: [...(submission.flavorTags || [])],
    summary: submission.summary || "",
    coverPath: options.coverPath !== undefined ? options.coverPath : submission.coverPath || "",
    targetUrl: submission.targetUrl || "",
    feedbackEmail: submission.feedbackEmail || "",
    reviewNote: options.reviewNote || "",
    notification: options.notification || null,
    submittedAt: submission.createdAt || "",
    reviewedAt: nowIso(),
  };
}

function reviewInsertStatement(env, review) {
  return env.DB.prepare(
    `INSERT INTO submission_reviews
      (id, submission_id, action, entry_id, title, author, content_tags, flavor_tags,
       summary, cover_path, target_url, feedback_email, review_note, notification,
       submitted_at, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    review.id,
    review.submissionId,
    review.action,
    review.entryId,
    review.title,
    review.author,
    JSON.stringify(review.contentTags),
    JSON.stringify(review.flavorTags),
    review.summary,
    review.coverPath,
    review.targetUrl,
    review.feedbackEmail,
    review.reviewNote,
    review.notification ? JSON.stringify(review.notification) : null,
    review.submittedAt,
    review.reviewedAt
  );
}

async function loadSubmissionReviews(env) {
  const result = await env.DB.prepare(
    `SELECT id, submission_id, action, entry_id, title, author, content_tags,
            flavor_tags, summary, cover_path, target_url, feedback_email,
            review_note, notification, submitted_at, reviewed_at
       FROM submission_reviews
      ORDER BY reviewed_at DESC, id ASC`
  ).all();
  return result.results.map((row) => ({
    id: row.id,
    submissionId: row.submission_id || "",
    action: row.action,
    entryId: row.entry_id || "",
    title: row.title || "",
    author: row.author || "",
    contentTags: parseJsonArray(row.content_tags),
    flavorTags: parseJsonArray(row.flavor_tags),
    summary: row.summary || "",
    coverPath: row.cover_path || "",
    targetUrl: row.target_url || "",
    feedbackEmail: row.feedback_email || "",
    reviewNote: row.review_note || "",
    notification: row.notification ? JSON.parse(row.notification) : null,
    submittedAt: row.submitted_at || "",
    reviewedAt: row.reviewed_at,
  }));
}

async function uploadCover(request, env, target) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_UPLOAD_BYTES) {
    throw new ValidationError("cover file is too large");
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string" || !file.name) {
    throw new ValidationError("cover file is required");
  }
  const extension = getFileExtension(file.name);
  if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    throw new ValidationError("unsupported cover file type");
  }
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const filename = `cover_${timestamp}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}${extension}`;
  const key = target === "pending" ? `covers/pending/${filename}` : `covers/${filename}`;
  await env.COVERS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || guessContentType(extension) },
  });
  return json({
    fileName: filename,
    coverPath: buildCoverUrl(target === "pending" ? PENDING_COVER_URL_PREFIX : COVER_URL_PREFIX, filename),
  }, 201);
}

async function migratePendingCover(env, coverPath) {
  if (!coverPath) return "";
  const pendingPrefix = PENDING_COVER_URL_PREFIX + "/";
  if (!coverPath.startsWith(pendingPrefix)) return coverPath;
  const filename = filenameFromPath(coverPath.slice(pendingPrefix.length));
  const sourceKey = `covers/pending/${filename}`;
  const targetKey = `covers/${filename}`;
  const object = await env.COVERS.get(sourceKey);
  if (object) {
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    await env.COVERS.put(targetKey, object.body, { httpMetadata: headers });
    await env.COVERS.delete(sourceKey);
  }
  return buildCoverUrl(COVER_URL_PREFIX, filename);
}

async function deleteCoverObject(env, coverPath, target) {
  if (!coverPath) return;
  const prefix = target === "pending" ? PENDING_COVER_URL_PREFIX + "/" : COVER_URL_PREFIX + "/";
  if (!coverPath.startsWith(prefix)) return;
  const filename = filenameFromPath(coverPath.slice(prefix.length));
  const key = target === "pending" ? `covers/pending/${filename}` : `covers/${filename}`;
  await env.COVERS.delete(key);
}

function normalizeEntry(payload, options) {
  const current = options.currentEntry;
  const title = normalizeRequiredText(payload.title, "title");
  const author = normalizeOptionalText(payload.author);
  const contentTags = normalizeTags(payload.contentTags);
  const flavorTags = normalizeTags(payload.flavorTags);
  const recommendValue = normalizeRecommendValue(payload.recommendValue);
  const summary = normalizeOptionalText(payload.summary);
  const targetUrl = normalizeExternalUrl(payload.targetUrl);
  const coverPath = normalizeCoverPath(payload.coverPath, COVER_URL_PREFIX);
  const now = nowIso();

  let id;
  let createdAt;
  if (current) {
    id = current.id;
    createdAt = current.createdAt || now;
  } else {
    const requestedId = normalizeOptionalText(payload.id);
    id = requestedId || generateId(ENTRY_ID_PREFIX, options.existingIds);
    if (options.existingIds.has(id)) throw new ValidationError("entry id already exists");
    createdAt = now;
  }

  return {
    id,
    title,
    author,
    contentTags,
    flavorTags,
    recommendValue,
    likeCount: current ? current.likeCount || 0 : 0,
    likedBy: current ? current.likedBy || [] : [],
    summary,
    coverPath,
    targetUrl,
    createdAt,
    updatedAt: now,
  };
}

function normalizeSubmission(payload, options) {
  const current = options.currentSubmission;
  const title = normalizeRequiredText(payload.title, "title");
  const author = normalizeOptionalText(payload.author);
  const contentTags = normalizeTags(payload.contentTags);
  const flavorTags = normalizeTags(payload.flavorTags);
  const recommendValue = 0;
  const summary = normalizeOptionalText(payload.summary);
  const targetUrl = normalizeExternalUrl(payload.targetUrl);
  const feedbackEmail = normalizeFeedbackEmail(payload.feedbackEmail);
  const coverPath = normalizeOptionalText(payload.coverPath);
  if (coverPath) {
    const formalPrefix = COVER_URL_PREFIX + "/";
    const pendingPrefix = PENDING_COVER_URL_PREFIX + "/";
    if (!coverPath.startsWith(formalPrefix) && !coverPath.startsWith(pendingPrefix)) {
      throw new ValidationError("coverPath must use the local cover URL prefix");
    }
  }

  const now = nowIso();
  let id;
  let createdAt;
  if (current) {
    id = current.id;
    createdAt = current.createdAt || now;
  } else {
    const requestedId = normalizeOptionalText(payload.id);
    id = requestedId || generateId(SUBMISSION_ID_PREFIX, options.existingIds);
    if (options.existingIds.has(id)) throw new ValidationError("submission id already exists");
    createdAt = now;
  }

  return {
    id,
    title,
    author,
    contentTags,
    flavorTags,
    recommendValue,
    summary,
    coverPath,
    targetUrl,
    feedbackEmail,
    createdAt,
    updatedAt: now,
  };
}

function normalizeRequiredText(value, fieldName) {
  const text = normalizeOptionalText(value);
  if (!text) throw new ValidationError(`${fieldName} is required`);
  return text;
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[ \t]+/g, " ").trim();
}

function normalizeTags(value) {
  const tags = value === undefined || value === null ? [] : value;
  if (!Array.isArray(tags)) throw new ValidationError("tags must be provided as an array");
  const seen = new Set();
  const normalized = [];
  for (const rawTag of tags) {
    const tag = normalizeOptionalText(rawTag);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized;
}

function normalizeRecommendValue(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number)) throw new ValidationError("recommendValue must be an integer");
  if (number < 0) throw new ValidationError("recommendValue must be greater than or equal to 0");
  return number;
}

function normalizeExternalUrl(value) {
  const url = normalizeRequiredText(value, "targetUrl");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError("targetUrl must be a valid http or https URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new ValidationError("targetUrl must be a valid http or https URL");
  }
  return url;
}

function normalizeFeedbackEmail(value) {
  const email = normalizeOptionalText(value).toLowerCase();
  if (!email) return "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ValidationError("feedbackEmail must be a valid email address");
  }
  return email;
}

function normalizeReviewNote(value) {
  return normalizeOptionalText(value);
}

function normalizeCoverPath(value, coverPrefix) {
  const coverPath = normalizeOptionalText(value);
  if (!coverPath) return "";
  if (!coverPath.startsWith(coverPrefix + "/")) {
    throw new ValidationError("coverPath must use the local cover URL prefix");
  }
  return coverPath;
}

async function login(request, env) {
  const payload = await readJson(request);
  const password = String(payload.password || "");
  if (!env.ADMIN_PASSWORD) {
    throw new ValidationError("admin password is not configured");
  }
  if (!(await timingSafeEqual(password, env.ADMIN_PASSWORD))) {
    return json({ error: "invalid password" }, 401);
  }
  const loginAt = nowIso();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const value = await signSession({ isAdmin: true, loginAt, exp: expiresAt }, env);
  const response = json({ authenticated: true });
  response.headers.append("set-cookie", buildSessionCookie(value, request, SESSION_TTL_SECONDS));
  return response;
}

function logout(request) {
  const response = json({ authenticated: false });
  response.headers.append("set-cookie", buildExpiredSessionCookie(request));
  return response;
}

async function readSession(request, env) {
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const raw = cookies[SESSION_COOKIE_NAME];
  if (!raw || !env.SESSION_SECRET) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, signature] = parts;
  const expected = await hmac(payloadPart, env.SESSION_SECRET);
  if (!(await timingSafeEqual(signature, expected))) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
  } catch {
    return null;
  }
  if (!payload.isAdmin || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

async function signSession(payload, env) {
  if (!env.SESSION_SECRET) {
    throw new ValidationError("session secret is not configured");
  }
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(payloadPart, env.SESSION_SECRET);
  return `${payloadPart}.${signature}`;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

async function timingSafeEqual(a, b) {
  const aBytes = new TextEncoder().encode(String(a));
  const bBytes = new TextEncoder().encode(String(b));
  const length = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (aBytes[index] || 0) ^ (bBytes[index] || 0);
  }
  return diff === 0;
}

function buildSessionCookie(value, request, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function buildExpiredSessionCookie(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const chunk of cookieHeader.split(";")) {
    const [name, ...rest] = chunk.trim().split("=");
    if (!name) continue;
    cookies[name] = rest.join("=");
  }
  return cookies;
}

async function getClientIpHash(request, env) {
  const forwarded = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const ip = forwarded || request.headers.get("cf-connecting-ip") || "local-dev";
  if (!ip) return "";
  const salt = env.LIKE_HASH_SALT || "dh_like_";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}${ip}`));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, LIKE_HASH_LENGTH);
}

async function readJson(request, allowEmpty = false) {
  const text = await request.text();
  if (!text && allowEmpty) return {};
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError("invalid JSON body");
  }
}

async function getIds(env, tableName, excludedId = "") {
  const safeTables = new Set(["entries", "submissions", "submission_reviews"]);
  if (!safeTables.has(tableName)) throw new Error("invalid table name");
  const result = await env.DB.prepare(`SELECT id FROM ${tableName}`).all();
  return new Set(result.results.map((row) => row.id).filter((id) => id !== excludedId));
}

function generateId(prefix, existingIds) {
  while (true) {
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const id = `${prefix}${suffix}`;
    if (!existingIds.has(id)) return id;
  }
}

function buildCoverUrl(prefix, filename) {
  return `${prefix}/${filename}`;
}

function filenameFromPath(value) {
  const decoded = decodeURIComponent(value || "");
  const filename = decoded.split("/").pop();
  if (!filename || filename === "." || filename === ".." || filename.includes("\\")) {
    throw new ValidationError("invalid cover filename");
  }
  return filename;
}

function getFileExtension(filename) {
  const name = String(filename || "").toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function guessContentType(extension) {
  switch (extension) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1) + "/";
  }
  return pathname;
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export const __test = {
  ValidationError,
  buildRejectionEmailPayload,
  buildRejectionHtml,
  buildRejectionText,
  buildTagCounts,
  normalizeEntry,
  normalizeSubmission,
  parseJsonArray,
  sendRejectionNotice,
};
