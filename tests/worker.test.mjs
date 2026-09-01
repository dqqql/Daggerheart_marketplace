import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import worker, { __test } from "../frontend/_worker.js";

test("admin review control declares distinct states, confirmation, and right-click undo", async () => {
  const html = await readFile(new URL("../frontend/admin/index.html", import.meta.url), "utf8");

  assert.match(html, /btn--review-0/);
  assert.match(html, /btn--review-1/);
  assert.match(html, /btn--review-2/);
  assert.match(html, /--review-red: #963b49/);
  assert.match(html, /--review-yellow: #b58b2d/);
  assert.match(html, /--review-green: #397a52/);
  assert.match(html, /reviewCount >= 2 \? '已审阅 ' \+ \(reviewCount - 1\) : '已审阅'/);
  assert.match(html, /var reviewState = Math\.min\(2, reviewCount\)/);
  assert.match(html, /openConfirm\(\{/);
  assert.match(html, /确认你已审阅「' \+ \(s\.title \|\| id\) \+ '」吗？；请勿替其他审阅者重复确认。/);
  assert.match(html, /addEventListener\('contextmenu'/);
  assert.match(html, /method: 'DELETE'/);
  assert.match(html, /\/api\/admin\/submissions\/.*\/reviewed/);
  assert.doesNotMatch(html, /submission-review-guide/);
});

test("normalizeEntry mirrors Flask entry cleanup", () => {
  const entry = __test.normalizeEntry({
    id: "dhm_manual",
    title: " 黑潮边境 ",
    author: " 某作者 ",
    contentTags: [" 模组 ", "敌人", "敌人", ""],
    flavorTags: [" 西幻 ", " "],
    recommendValue: "1",
    summary: " 适合短团的边境探索模组。 ",
    coverPath: "/the-great-vault/covers/demo.webp",
    targetUrl: "https://example.com/module",
  }, { existingIds: new Set() });

  assert.equal(entry.id, "dhm_manual");
  assert.equal(entry.title, "黑潮边境");
  assert.deepEqual(entry.contentTags, ["模组", "敌人"]);
  assert.deepEqual(entry.flavorTags, ["西幻"]);
  assert.equal(entry.recommendValue, 1);
  assert.equal(entry.summary, "适合短团的边境探索模组。");
  assert.equal(entry.likeCount, 0);
  assert.deepEqual(entry.likedBy, []);
});

test("normalizeEntry updates optional feedback email", () => {
  const entry = __test.normalizeEntry({
    title: "旧资源",
    author: "作者",
    contentTags: [],
    flavorTags: [],
    recommendValue: 0,
    summary: "",
    coverPath: "",
    targetUrl: "https://example.com/legacy",
    feedbackEmail: " New@Example.COM ",
  }, {
    existingIds: new Set(),
    currentEntry: {
      id: "dhm_legacy",
      createdAt: "2026-01-01T00:00:00+00:00",
      likeCount: 3,
      likedBy: ["abc"],
      feedbackEmail: "",
    },
  });

  assert.equal(entry.id, "dhm_legacy");
  assert.equal(entry.feedbackEmail, "new@example.com");
  assert.equal(entry.likeCount, 3);
  assert.deepEqual(entry.likedBy, ["abc"]);
});

test("normalizeSubmission keeps feedback email private-ready and accepts pending covers", () => {
  const submission = __test.normalizeSubmission({
    id: "sub_manual",
    title: " 社区投稿 ",
    targetUrl: "https://example.com/submission",
    feedbackEmail: " Creator@Example.COM ",
    coverPath: "/the-great-vault/covers/pending/cover.webp",
  }, { existingIds: new Set() });

  assert.equal(submission.id, "sub_manual");
  assert.equal(submission.title, "社区投稿");
  assert.equal(submission.feedbackEmail, "creator@example.com");
  assert.equal(submission.coverPath, "/the-great-vault/covers/pending/cover.webp");
  assert.equal(submission.recommendValue, 0);
  assert.equal(submission.reviewCount, 0);
});

test("normalizeSubmission preserves server-owned review count while editing", () => {
  const submission = __test.normalizeSubmission({
    title: "编辑后的投稿",
    targetUrl: "https://example.com/submission",
    feedbackEmail: "creator@example.com",
  }, {
    existingIds: new Set(),
    currentSubmission: {
      id: "sub_existing",
      reviewCount: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  });

  assert.equal(submission.reviewCount, 1);
});

test("rowToSubmission exposes an unbounded non-negative review count", () => {
  const baseRow = {
    id: "sub_reviewed",
    title: "已审阅投稿",
    target_url: "https://example.com/reviewed",
    content_tags: "[]",
    flavor_tags: "[]",
  };

  assert.equal(__test.rowToSubmission({ ...baseRow, review_count: 1 }).reviewCount, 1);
  assert.equal(__test.rowToSubmission({ ...baseRow, review_count: 9 }).reviewCount, 9);
  assert.equal(__test.rowToSubmission({ ...baseRow, review_count: null }).reviewCount, 0);
});

test("markSubmissionReviewed keeps incrementing after the green threshold", async () => {
  let reviewCount = 0;
  let updateCalls = 0;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async run() {
            updateCalls += 1;
            reviewCount += 1;
          },
          async first() {
            return {
              id: "sub_review",
              title: "待审核投稿",
              target_url: "https://example.com/review",
              content_tags: "[]",
              flavor_tags: "[]",
              review_count: reviewCount,
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
            };
          },
        };
      },
    },
  };

  assert.equal((await __test.markSubmissionReviewed(env, "sub_review")).reviewCount, 1);
  assert.equal((await __test.markSubmissionReviewed(env, "sub_review")).reviewCount, 2);
  assert.equal((await __test.markSubmissionReviewed(env, "sub_review")).reviewCount, 3);
  assert.equal(updateCalls, 3);
});

test("unmarkSubmissionReviewed decrements only above zero", async () => {
  let reviewCount = 2;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async run() {
            if (reviewCount > 0) reviewCount -= 1;
          },
          async first() {
            return {
              id: "sub_review",
              title: "待审核投稿",
              target_url: "https://example.com/review",
              content_tags: "[]",
              flavor_tags: "[]",
              review_count: reviewCount,
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
            };
          },
        };
      },
    },
  };

  assert.equal((await __test.unmarkSubmissionReviewed(env, "sub_review")).reviewCount, 1);
  assert.equal((await __test.unmarkSubmissionReviewed(env, "sub_review")).reviewCount, 0);
  assert.equal((await __test.unmarkSubmissionReviewed(env, "sub_review")).reviewCount, 0);
});

test("buildTagCounts sorts by count then tag", () => {
  const tags = __test.buildTagCounts([
    { contentTags: ["模组", "敌人"], flavorTags: ["西幻"] },
    { contentTags: ["模组"], flavorTags: ["武侠", "西幻"] },
  ]);

  assert.deepEqual(tags.contentTags, [
    { tag: "模组", count: 2 },
    { tag: "敌人", count: 1 },
  ]);
  assert.deepEqual(tags.flavorTags, [
    { tag: "西幻", count: 2 },
    { tag: "武侠", count: 1 },
  ]);
});

test("rowToEntry uses aggregated likeCount without exposing like identities by default", () => {
  const entry = __test.rowToEntry({
    id: "dhm_public",
    title: "公开资源",
    author: "作者",
    content_tags: JSON.stringify(["模组"]),
    flavor_tags: JSON.stringify(["西幻"]),
    recommend_value: 2,
    like_count: 7,
    summary: "简介",
    cover_path: "/the-great-vault/covers/demo.webp",
    target_url: "https://example.com/public",
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-02T00:00:00+00:00",
  });

  assert.equal(entry.likeCount, 7);
  assert.equal(Object.hasOwn(entry, "likedBy"), false);
});

test("publicEntryOnly strips private email and likedBy hashes", () => {
  const entry = __test.publicEntryOnly({
    id: "dhm_public",
    title: "公开资源",
    likeCount: 2,
    likedBy: ["hash_a", "hash_b"],
    feedbackEmail: "creator@example.com",
  });

  assert.equal(entry.likeCount, 2);
  assert.equal(Object.hasOwn(entry, "likedBy"), false);
  assert.equal(Object.hasOwn(entry, "feedbackEmail"), false);
});

test("public JSON responses can override no-store with cacheable catalog headers", () => {
  const response = __test.json({ ok: true }, 200, {
    "cache-control": "public, max-age=60, stale-while-revalidate=300",
  });

  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "public, max-age=60, stale-while-revalidate=300");
});

test("loadPublicEntries reads aggregated like counts and keeps zero-like entries", async () => {
  let preparedSql = "";
  const env = {
    DB: {
      prepare(sql) {
        preparedSql = sql;
        return {
          async all() {
            return {
              results: [
                {
                  id: "dhm_liked",
                  title: "有赞资源",
                  author: "",
                  content_tags: "[]",
                  flavor_tags: "[]",
                  recommend_value: 0,
                  like_count: 3,
                  summary: "",
                  cover_path: "",
                  target_url: "https://example.com/liked",
                  created_at: "2026-01-01T00:00:00+00:00",
                  updated_at: "2026-01-03T00:00:00+00:00",
                },
                {
                  id: "dhm_zero",
                  title: "零赞资源",
                  author: "",
                  content_tags: "[]",
                  flavor_tags: "[]",
                  recommend_value: 0,
                  like_count: 0,
                  summary: "",
                  cover_path: "",
                  target_url: "https://example.com/zero",
                  created_at: "2026-01-01T00:00:00+00:00",
                  updated_at: "2026-01-02T00:00:00+00:00",
                },
              ],
            };
          },
        };
      },
    },
  };

  const entries = await __test.loadPublicEntries(env);

  assert.match(preparedSql, /COUNT\(\*\) AS like_count/);
  assert.deepEqual(entries.map((entry) => [entry.id, entry.likeCount]), [
    ["dhm_liked", 3],
    ["dhm_zero", 0],
  ]);
  assert.equal(entries.some((entry) => Object.hasOwn(entry, "likedBy")), false);
});

test("loadPublicEntries can include admin-private fields without like hash details", async () => {
  const env = {
    DB: {
      prepare() {
        return {
          async all() {
            return {
              results: [
                {
                  id: "dhm_admin",
                  title: "后台资源",
                  author: "",
                  content_tags: "[]",
                  flavor_tags: "[]",
                  recommend_value: 0,
                  like_count: 5,
                  summary: "",
                  cover_path: "",
                  target_url: "https://example.com/admin",
                  feedback_email: "creator@example.com",
                  created_at: "2026-01-01T00:00:00+00:00",
                  updated_at: "2026-01-02T00:00:00+00:00",
                },
              ],
            };
          },
        };
      },
    },
  };

  const entries = await __test.loadPublicEntries(env, { includePrivate: true });

  assert.equal(entries[0].likeCount, 5);
  assert.equal(entries[0].feedbackEmail, "creator@example.com");
  assert.equal(Object.hasOwn(entries[0], "likedBy"), false);
});

test("public bootstrap route returns cacheable non-personalized entries", async () => {
  const env = {
    DB: {
      prepare() {
        return {
          async all() {
            return {
              results: [
                {
                  id: "dhm_public",
                  title: "公开资源",
                  author: "",
                  content_tags: JSON.stringify(["模组"]),
                  flavor_tags: JSON.stringify(["西幻"]),
                  recommend_value: 1,
                  like_count: 4,
                  summary: "",
                  cover_path: "",
                  target_url: "https://example.com/public",
                  feedback_email: "creator@example.com",
                  created_at: "2026-01-01T00:00:00+00:00",
                  updated_at: "2026-01-02T00:00:00+00:00",
                },
              ],
            };
          },
        };
      },
    },
  };
  const response = await worker.fetch(
    new Request("https://dhvault.top/api/public/bootstrap"),
    env,
    { waitUntil() {} }
  );
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=60, stale-while-revalidate=300");
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].likeCount, 4);
  assert.equal(Object.hasOwn(data.entries[0], "likedBy"), false);
  assert.equal(Object.hasOwn(data.entries[0], "feedbackEmail"), false);
  assert.deepEqual(data.tags.contentTags, [{ tag: "模组", count: 1 }]);
});

test("sendRejectionNotice posts a Resend email when configured", async () => {
  const calls = [];
  const notification = await __test.sendRejectionNotice(
    {
      RESEND_API_KEY: "test_key",
      RESEND_FROM: "宏伟宝库 <review@mail.dhvault.top>",
      RESEND_REPLY_TO: "contact@dhvault.top",
    },
    {
      title: "社区投稿",
      targetUrl: "https://example.com/submission",
      feedbackEmail: "creator@example.com",
    },
    "请补充授权说明。",
    async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    }
  );

  assert.deepEqual(notification, { status: "sent", provider: "resend", messageId: "email_123" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test_key");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.from, "宏伟宝库 <review@mail.dhvault.top>");
  assert.equal(body.to, "creator@example.com");
  assert.equal(body.reply_to, "contact@dhvault.top");
  assert.equal(body.subject, "宏伟宝库投稿需要调整：社区投稿");
  assert.match(body.text, /你好，感谢你向匕首之心-宏伟宝库提交「社区投稿」。/);
  assert.match(body.text, /请补充授权说明。/);
  assert.match(body.html, /请补充授权说明。/);
});

test("normalizeSubmission requires feedback email", () => {
  assert.throws(
    () => __test.normalizeSubmission({
      title: "缺邮箱投稿",
      targetUrl: "https://example.com/no-email",
    }, { existingIds: new Set() }),
    /feedbackEmail is required/
  );
});

test("sendRejectionNotice skips Resend when email or API key is missing", async () => {
  assert.deepEqual(
    await __test.sendRejectionNotice(
      { RESEND_API_KEY: "test_key" },
      { title: "无反馈邮箱", feedbackEmail: "" },
      "请修改。",
      async () => {
        throw new Error("fetch should not be called");
      }
    ),
    { status: "skipped", reason: "no_feedback_email" }
  );

  assert.deepEqual(
    await __test.sendRejectionNotice(
      {},
      { title: "未配置 Key", feedbackEmail: "creator@example.com" },
      "请修改。",
      async () => {
        throw new Error("fetch should not be called");
      }
    ),
    { status: "skipped", reason: "not_configured" }
  );
});

test("sendRejectionNotice reports Resend API errors without throwing", async () => {
  const notification = await __test.sendRejectionNotice(
    { RESEND_API_KEY: "test_key" },
    { title: "会失败的投稿", feedbackEmail: "creator@example.com" },
    "请修改。",
    async () => new Response(JSON.stringify({ message: "domain is not verified" }), { status: 403 })
  );

  assert.equal(notification.status, "failed");
  assert.equal(notification.reason, "send_failed");
  assert.equal(notification.message, "domain is not verified");
});
