import assert from "node:assert/strict";
import test from "node:test";

import { __test } from "../frontend/_worker.js";

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
