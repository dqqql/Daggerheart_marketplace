import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import worker, { __test } from "../frontend/_worker.js";
import '../frontend/assets/catalog-order.js';

test('legacy discarded content moves to flavor, while aliases merge without duplication', () => {
  const row = { content_tags: '["战役框架","新人友好","武侠","种族","转变卡","单人游玩"]', flavor_tags: '["武侠"]' };
  for (const convert of [__test.rowToEntry, __test.rowToSubmission]) {
    const entry = convert(row);
    assert.deepEqual(entry.contentTags, ['战役框架', '传承', '扩展规则']);
    assert.deepEqual(entry.flavorTags, ['武侠', '新人友好']);
    assert.deepEqual(globalThis.ContentTags.migrateFlavor(entry.contentTags, entry.flavorTags), entry.flavorTags);
  }
});

test('catalog order prioritizes tags without mutating the JSON arrays', () => {
  const tags = ['敌人', '战役框架', '模组', '设定', 'PbDH', '传承'];
  assert.deepEqual(globalThis.CatalogOrder.tags(tags), ['PbDH', '设定', '战役框架', '敌人', '模组', '传承']);
  assert.deepEqual(tags, ['敌人', '战役框架', '模组', '设定', 'PbDH', '传承']);
});

test('catalog latest uses timestamps and hot uses likes plus recommendation times ten', () => {
  const items = [
    { id: 'a', updatedAt: '2026-09-17T10:00:00+08:00', likeCount: 2, recommendValue: 2 },
    { id: 'b', updatedAt: '2026-09-17T03:00:00Z', likeCount: 21, recommendValue: 0 },
    { id: 'c', updatedAt: '2026-09-17T12:00:00+08:00', likeCount: 1, recommendValue: 0 },
  ];
  const before = JSON.stringify(items);
  assert.deepEqual(globalThis.CatalogOrder.entries(items, 'latest').map(e => e.id), ['c', 'b', 'a']);
  assert.deepEqual(globalThis.CatalogOrder.entries(items, 'hot').map(e => e.id), ['a', 'b', 'c']);
  assert.equal(JSON.stringify(items), before);
});

test('daily rotation uses Beijing midnight, stable candidates and independent section seeds', () => {
  const order = globalThis.CatalogOrder;
  assert.equal(order.dayKey('2026-09-17T15:59:59Z'), '2026-09-17');
  assert.equal(order.dayKey('2026-09-17T16:00:00Z'), '2026-09-18');
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `dhm_${i}`, recommendValue: i < 20 ? 1 : 0, likeCount: 10 }));
  const config = { EDITOR_PICK_COUNT: 8, POPULAR_PICK_COUNT: 4, POPULAR_LIKE_THRESHOLD: 5 };
  const before = JSON.stringify(items);
  const today = order.highlights(items, '2026-09-17', config);
  assert.deepEqual(order.highlights(items.slice().reverse(), '2026-09-17', config), today);
  assert.notDeepEqual(order.highlights(items, '2026-09-18', config), today);
  assert.equal(today.editor.length, 8);
  assert.equal(today.popular.length, 4);
  assert.ok(today.editor.every(e => e.recommendValue > 0));
  assert.ok(today.popular.every(e => e.likeCount >= 5 && !today.editor.some(x => x.id === e.id)));
  const exposed = new Set();
  for (let day = 1; day <= 28; day++) {
    order.highlights(items, `2026-09-${String(day).padStart(2, '0')}`, config).editor.forEach(e => exposed.add(e.id));
  }
  assert.equal(exposed.size, 20);
  assert.equal(JSON.stringify(items), before);
});

test('public JSON retains pre-change entry and tag schemas without ordering metadata', async () => {
  const row = { id: 'dhm_schema', title: '资源', author: '作者', content_tags: '["地点设定"]', flavor_tags: '["西幻"]', recommend_value: 1, like_count: 2, summary: '', cover_path: '', target_url: 'https://example.com', created_at: '2026-09-17', updated_at: '2026-09-17' };
  const env = { DB: { prepare() { return { async all() { return { results: [row] }; } }; } } };
  const response = await worker.fetch(new Request('https://dhvault.top/api/public/bootstrap'), env, { waitUntil() {} });
  const data = await response.json();
  assert.deepEqual(Object.keys(data).sort(), ['entries', 'tags']);
  assert.deepEqual(Object.keys(data.tags).sort(), ['contentTags', 'flavorTags']);
  assert.deepEqual(Object.keys(data.entries[0]).sort(), ['id', 'title', 'author', 'contentTags', 'flavorTags', 'recommendValue', 'likeCount', 'summary', 'coverPath', 'targetUrl', 'createdAt', 'updatedAt'].sort());
  assert.deepEqual(data.entries[0].contentTags, ['设定']);
  assert.deepEqual(data.tags.contentTags, [{ tag: '设定', count: 1 }]);
  assert.equal(typeof data.entries[0].recommendValue, 'number');
  assert.equal(typeof data.entries[0].likeCount, 'number');
});

test("legacy content tags merge, deduplicate and drop non-content labels on reads", () => {
  const row = {
    content_tags: JSON.stringify(['种族', '转变卡', '传承', '碎心者工具集', '工具书', '单人游玩', '扩展规则', '武侠', 'TTTRI', '地点设定']),
    flavor_tags: JSON.stringify(['武侠', 'TTTRI']),
  };
  for (const convert of [__test.rowToEntry, __test.rowToSubmission]) {
    const entry = convert(row);
    assert.deepEqual(entry.contentTags, ['传承', '工具书', '扩展规则', '设定']);
    assert.deepEqual(entry.flavorTags, ['武侠', 'TTTRI']);
    assert.deepEqual(globalThis.ContentTags.canonicalize(entry.contentTags), entry.contentTags);
  }
});

test("entry and submission writes require standard content tags and preserve free flavor tags", () => {
  for (const normalize of [__test.normalizeEntry, __test.normalizeSubmission]) {
    const payload = { title: '资源', targetUrl: 'https://example.com', feedbackEmail: 'a@example.com', flavorTags: ['自定义风味'] };
    const options = { existingIds: new Set() };
    for (const invalid of ['种族', '转变卡', '碎心者工具集', '单人游玩', '武侠', '随意内容标签', '地点设定']) {
      assert.throws(() => normalize({ ...payload, contentTags: [invalid] }, options), /请选择标准内容标签/);
    }
    assert.throws(() => normalize({ ...payload, contentTags: '模组' }, options), /array/);
    const tags = globalThis.ContentTags.definitions.map(item => item.tag);
    const entry = normalize({ ...payload, contentTags: [...tags, ' 传承 '] }, options);
    assert.deepEqual(entry.contentTags, tags);
    assert.deepEqual(entry.flavorTags, ['自定义风味']);
    assert.deepEqual(normalize(payload, options).contentTags, []);
  }
});

test("PbDH membership includes overlapping modules and flavor-tagged entries", () => {
  const entries = [
    { id: 'module', contentTags: ['模组', 'PbDH'] },
    { id: 'flavor', contentTags: ['电子工具'], flavorTags: ['PbDH'] },
    { id: 'other', contentTags: ['电子工具'] },
    { id: 'empty' },
  ];
  assert.deepEqual(entries.filter(globalThis.ContentTags.isPbDH).map(entry => entry.id), ['module', 'flavor']);
});

test("bootstrap counts canonical tags for legacy data without rewriting the DB", async () => {
  const env = { DB: { prepare() { return { async all() { return { results: [
    { id: 'a', content_tags: '["转变卡","种族","传承","新人友好"]', flavor_tags: '["武侠"]' },
    { id: 'b', content_tags: '["碎心者工具集"]', flavor_tags: '[]' }
  ] }; } }; } } };
  const response = await worker.fetch(new Request('https://dhvault.top/api/public/bootstrap'), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.entries.map(entry => entry.contentTags), [['传承'], ['工具书']]);
  assert.deepEqual(new Map(data.tags.contentTags.map(item => [item.tag, item.count])), new Map([['传承', 1], ['工具书', 1]]));
});

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

test("homepage exposes one filter trigger and the notification subscription flow", async () => {
  const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");

  assert.match(html, /id="filterTrigger"[^>]*>[\s\S]*?筛选/);
  assert.doesNotMatch(html, /id="contentTagTrigger"/);
  assert.doesNotMatch(html, /id="flavorTagTrigger"/);
  assert.match(html, /id="submitEntryBtn"[^>]*>提交资源<\/button>\s*<button[^>]*id="subscribeBtn"[^>]*>订阅通知/);
  assert.match(html, /fetch\(API_BASE \+ '\/api\/public\/subscriptions'/);
  assert.match(html, /id="subscribeEmail"[^>]*type="email"/);
  assert.match(html, /这个邮箱已经填写过了，无需重复订阅/);
  assert.match(html, /id="unsubscribeBtn"[^>]*>取消订阅<\/button>/);
  assert.match(html, /id="subscribeExistingClose"[^>]*>关闭<\/button>/);
  assert.match(html, /#subscribeModal \[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(html, /method: 'DELETE'/);
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

test("public entries route uses the published catalog schema and only allows GET", async () => {
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
                  author: "作者",
                  content_tags: "not-json",
                  flavor_tags: JSON.stringify(["西幻"]),
                  recommend_value: 2,
                  like_count: 4,
                  summary: "公开简介",
                  cover_path: "/the-great-vault/covers/public.webp",
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
    new Request("https://dhvault.top/api/public/entries"),
    env,
    { waitUntil() {} }
  );
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "public, max-age=60, stale-while-revalidate=300");
  assert.ok(Array.isArray(data.entries));
  assert.deepEqual(Object.keys(data.entries[0]), [
    "id",
    "title",
    "author",
    "contentTags",
    "flavorTags",
    "recommendValue",
    "likeCount",
    "summary",
    "coverPath",
    "targetUrl",
    "createdAt",
    "updatedAt",
  ]);
  assert.deepEqual(data.entries[0].contentTags, []);
  assert.deepEqual(data.entries[0].flavorTags, ["西幻"]);
  assert.equal(Object.hasOwn(data.entries[0], "feedbackEmail"), false);
  assert.equal(Object.hasOwn(data.entries[0], "likedBy"), false);
  assert.equal(Object.hasOwn(data.entries[0], "reviewNote"), false);

  const methodNotAllowed = await worker.fetch(
    new Request("https://dhvault.top/api/public/entries", { method: "POST" }),
    env,
    { waitUntil() {} }
  );
  assert.equal(methodNotAllowed.status, 405);
  assert.equal(methodNotAllowed.headers.get("allow"), "GET");

  const unauthenticatedAdmin = await worker.fetch(
    new Request("https://dhvault.top/api/admin/entries"),
    env,
    { waitUntil() {} }
  );
  assert.equal(unauthenticatedAdmin.status, 401);
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

test("normalizeSubscriberEmail lowercases valid addresses and rejects invalid input", () => {
  assert.equal(__test.normalizeSubscriberEmail(" Reader@Example.COM "), "reader@example.com");
  assert.throws(() => __test.normalizeSubscriberEmail("not-an-email"), /valid email address/);
  assert.throws(() => __test.normalizeSubscriberEmail(""), /email is required/);
});

test("cancelNotificationSubscription removes the normalized address", async () => {
  const calls = [];
  const env = {
    DB: {
      prepare(sql) {
        calls.push({ sql });
        return {
          bind(email) {
            calls[0].email = email;
            return {
              async run() {
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  const result = await __test.cancelNotificationSubscription(env, { email: " Reader@Example.COM " });

  assert.deepEqual(result, { subscribed: false, unsubscribed: true });
  assert.match(calls[0].sql, /DELETE FROM notification_subscribers/);
  assert.equal(calls[0].email, "reader@example.com");
});

test("sendNewEntryNotifications reuses the review mail configuration and exact notice copy", async () => {
  const calls = [];
  const env = {
    RESEND_API_KEY: "test_key",
    RESEND_FROM: "宏伟宝库 <review@mail.dhvault.top>",
    RESEND_REPLY_TO: "contact@dhvault.top",
    DB: {
      prepare(sql) {
        assert.match(sql, /notification_subscribers/);
        return {
          async all() {
            return { results: [{ email: "one@example.com" }, { email: "two@example.com" }] };
          },
        };
      },
    },
  };

  const result = await __test.sendNewEntryNotifications(
    env,
    { title: "龙焰遗迹", author: "星火" },
    async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    }
  );

  assert.deepEqual(result, { status: "sent", total: 2, sent: 2, failed: 0 });
  assert.equal(calls.length, 2);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.from, "宏伟宝库 <review@mail.dhvault.top>");
  assert.equal(body.to, "one@example.com");
  assert.equal(body.reply_to, "contact@dhvault.top");
  assert.equal(body.subject, "宏伟宝库新作品上线：龙焰遗迹");
  assert.equal(body.text, "您好：\n新作品 龙焰遗迹 ，作者：星火\n已上线宏伟宝库，敬请查阅。");
  assert.match(body.html, /<p>您好：<\/p><p>新作品 龙焰遗迹 ，作者：星火<\/p><p>已上线宏伟宝库，敬请查阅。<\/p>/);
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
