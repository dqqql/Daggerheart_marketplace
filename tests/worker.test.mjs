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
