import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 可通过 PLAYWRIGHT_MODULE 使用本机已有的 Playwright，无需安装全局依赖。
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../frontend/', import.meta.url));
const key = 'dhm-submission-notice:2026-09-18-v1';
const tags = ['模组', '职业', '敌人', '扩展规则', '战役框架'];
const entries = tags.map((tag, index) => ({
  id: `normal-${index}`, title: `普通${tag}`, author: '测试', contentTags: [tag],
  flavorTags: [], summary: '', targetUrl: 'https://example.com', coverPath: '',
  updatedAt: '2026-09-18T00:00:00Z', createdAt: '2026-09-18T00:00:00Z',
  recommendValue: 1, likeCount: 10,
}));
entries.push({ ...entries[0], id: 'pbdh-content', title: '独立规则甲', contentTags: [...tags, 'PbDH'] });
entries.push({ ...entries[0], id: 'pbdh-flavor', title: '独立规则乙', contentTags: tags, flavorTags: ['PbDH'] });

test('public catalog exclusions and submission notice browser workflow', async (t) => {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const filename = path.resolve(root, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
      if (!filename.startsWith(root)) { res.writeHead(403).end(); return; }
      const body = await readFile(filename);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
      res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('dhm-submission-notice:draft-v1', '1'));
  let liked = false;
  await context.route('**/api/**', route => {
    const url = new URL(route.request().url());
    // 点赞请求只返回本地模拟结果，不接触生产 API。
    if (url.pathname === '/api/public/like/normal-0') {
      assert.equal(route.request().method(), 'POST');
      liked = !liked;
      return route.fulfill({ json: { liked, likeCount: liked ? 11 : 10 } });
    }
    assert.equal(route.request().method(), 'GET', '测试不得提交资源');
    return route.fulfill({ json: url.pathname.endsWith('/bootstrap')
      ? { entries, tags: { contentTags: [], flavorTags: [] } } : { likedEntryIds: [] } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  await page.locator('#sec-pbdh').waitFor();
  const tagLines = (await readFile(new URL('../docs/tag-descriptions-draft.md', import.meta.url), 'utf8')).trim().split(/\r?\n/);
  const definitions = await page.evaluate(() => ContentTags.definitions);
  assert.deepEqual(definitions, tagLines.filter((_, index) => index % 2 === 0)
    .map((tag, index) => ({ tag, description: tagLines[index * 2 + 1] })));
  const approvedNotice = (await readFile(new URL('../docs/submission-guidelines-draft.md', import.meta.url), 'utf8'))
    .split(/\r?\n/).map(line => line.replace(/^(# |\- )/, '').trim()).filter(Boolean);
  const noticeText = await page.locator('.submission-notice-body').textContent();
  for (const line of approvedNotice) assert.ok(noticeText.includes(line), `正式说明包含：${line}`);

  const counts = page.locator('.card-like-btn[data-entry-id="normal-0"] .card-like-count');
  await page.waitForFunction(() => [...document.querySelectorAll('.card-like-btn[data-entry-id="normal-0"] .card-like-count')].every(el => el.textContent === '20'));
  assert.ok(await counts.count() > 1, '同一资源出现在多个分区');
  await page.locator('.card-like-btn[data-entry-id="normal-0"]').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.card-like-btn[data-entry-id="normal-0"] .card-like-count')].every(el => el.textContent === '21'));
  await page.locator('.card-like-btn[data-entry-id="normal-0"]').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.card-like-btn[data-entry-id="normal-0"] .card-like-count')].every(el => el.textContent === '20'));

  const sections = await page.evaluate(() => {
    const result = {};
    let current;
    for (const el of document.querySelector('#cardGrid').children) {
      if (el.classList.contains('section-header')) { current = el.id; result[current] = []; }
      if (el.classList.contains('card')) result[current].push(el.dataset.id);
    }
    return result;
  });
  for (const id of ['sec-module', 'sec-player', 'sec-gm', 'sec-extrule', 'sec-campaign']) {
    assert.ok(sections[id].some(entry => entry.startsWith('normal-')), `${id} 保留普通资源`);
    assert.ok(sections[id].every(entry => !entry.startsWith('pbdh-')), `${id} 排除 PbDH`);
  }
  for (const id of ['sec-latest', 'sec-editor', 'sec-pbdh']) {
    assert.ok(sections[id].includes('pbdh-content'));
    assert.ok(sections[id].includes('pbdh-flavor'));
  }
  await page.locator('#searchInput').fill('独立规则');
  await page.waitForFunction(() => document.querySelectorAll('#cardGrid .card').length === 2);
  await page.locator('#searchInput').fill('');

  const openNotice = () => page.locator('#submitEntryBtn').click();
  const notice = page.locator('#submissionNoticeDialog');
  await openNotice();
  assert.ok(await notice.isVisible());
  await page.locator('#submissionNoticeDismiss').check();
  await page.locator('#submissionNoticeCancel').click();
  await notice.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null);
  assert.equal(await page.locator('#submitModalOverlay').evaluate(el => el.classList.contains('visible')), false);
  await openNotice();
  assert.equal(await page.locator('#submissionNoticeDismiss').isChecked(), false);
  await page.keyboard.press('Escape');
  await notice.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement.id === 'submitEntryBtn');

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await openNotice();
    const layout = await notice.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const body = el.querySelector('.submission-notice-body');
      const footer = el.querySelector('.submission-notice-footer').getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth,
        height: innerHeight, overflow: body.scrollWidth > body.clientWidth,
        footerTop: footer.top, bodyBottom: body.getBoundingClientRect().bottom };
    });
    assert.ok(layout.left >= 15 && layout.right <= layout.width - 15);
    assert.ok(layout.bottom <= layout.height && layout.footerTop >= layout.bodyBottom - 1);
    assert.equal(layout.overflow, false);
    if (process.env.UI_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, `submission-notice-${width}.png`) });
    await page.locator('#submissionNoticeCancel').click();
    await notice.waitFor({ state: 'hidden' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openNotice();
  await page.locator('#submissionNoticeDismiss').check();
  await page.locator('#submissionNoticeContinue').click();
  await notice.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), '1');
  const firstInput = page.locator('#submitModalBody [data-field="title"]');
  await firstInput.fill('保留测试内容');
  await page.locator('#submitNoticeReopenBtn').click();
  await page.keyboard.press('Escape');
  await notice.waitFor({ state: 'hidden' });
  assert.equal(await firstInput.inputValue(), '保留测试内容');
  assert.equal(await page.locator('#submitModalOverlay').evaluate(el => el.classList.contains('visible')), true);
  await page.waitForFunction(() => document.activeElement.id === 'submitNoticeReopenBtn');
  await page.locator('#submitNoticeReopenBtn').click();
  await page.locator('#submissionNoticeContinue').click();
  await notice.waitFor({ state: 'hidden' });
  assert.equal(await firstInput.inputValue(), '保留测试内容');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null);
  await page.locator('#submitModalCancelBtn').click();
  await openNotice();
  await page.locator('#submissionNoticeDismiss').check();
  await page.locator('#submissionNoticeContinue').click();
  await page.reload();
  await openNotice();
  assert.equal(await notice.isVisible(), false);
  assert.equal(await page.locator('#submitModalOverlay').evaluate(el => el.classList.contains('visible')), true);

  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('blocked storage'); };
    Storage.prototype.setItem = () => { throw new Error('blocked storage'); };
    Storage.prototype.removeItem = () => { throw new Error('blocked storage'); };
  });
  await page.reload();
  await openNotice();
  await page.locator('#submissionNoticeDismiss').check();
  await page.locator('#submissionNoticeContinue').click();
  await notice.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#submitModalOverlay').evaluate(el => el.classList.contains('visible')), true);
  assert.deepEqual(errors, []);
});
