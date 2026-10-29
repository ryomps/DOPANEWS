const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createOpenAISearch, SEARCH_MODEL, LIMITS, dayKey } = require('../openai-search.cjs');
const topic = n => ({ id: n.toString(16).padStart(32, '0'), title: '公的資料の発表', publishedAt: '2026-10-29T00:00:00Z' });
const result = () => Response.json({ id: 'resp_mock', status: 'completed', output: [
  { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ url: 'https://www.stat.go.jp/test.html' }, { url: 'https://www.mext.go.jp/test.html' }, { url: 'https://www.stat.go.jp.evil.com/private' }, { url: 'https://user@www.stat.go.jp/private' }] } },
  { type: 'message', content: [{ type: 'output_text', text: 'https://www.stat.go.jp/invented.html' }] }
], usage: { input_tokens: 200, output_tokens: 40 } });
async function fixture(t, fetchImpl) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dopanews-search-test-'));
  t.after(async () => { assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('dopanews-search-test-')); await fs.rm(directory, { recursive: true, force: true }); });
  const calls = []; let clock = new Date('2026-10-29T14:59:59Z');
  const options = { directory, allowedDomains: ['www.stat.go.jp', 'www.mext.go.jp'], now: () => clock, fetchImpl: async (url, init) => { calls.push({ url, init }); return fetchImpl ? fetchImpl(url, init) : result(); } };
  return { directory, calls, options, service: createOpenAISearch(options), advance: milliseconds => { clock = new Date(clock.getTime() + milliseconds); } };
}
test('OpenAI receives only a constrained search; actual tool sources rather than generated URLs are returned', async t => {
  const f = await fixture(t);
  const found = await f.service.search({ topic: topic(1), key: 'private-openai' });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.model, SEARCH_MODEL); assert.equal(body.store, false); assert.equal(body.max_tool_calls, 1);
  assert.equal(body.max_output_tokens, LIMITS.outputTokens); assert.equal(body.parallel_tool_calls, false);
  assert.equal(body.tools.length, 1); assert.equal(body.tools[0].type, 'web_search');
  assert.deepEqual(body.tools[0].filters.allowed_domains, f.options.allowedDomains);
  assert.equal(body.tool_choice, 'required'); assert.deepEqual(body.include, ['web_search_call.action.sources']);
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer private-openai');
  assert.equal(found.urls.length, 2); assert.ok(!found.urls.some(u => /invented|evil|user@/.test(u)));
  const stored = await fs.readFile(path.join(f.directory, 'searches', topic(1).id + '.json'), 'utf8');
  assert.ok(!stored.includes('private-openai'));
});
test('missing key makes no request and consumes no budget; cached successful search needs neither a key nor another request', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.search({ topic: topic(1), key: '' }), e => e.newsCode === 'OPENAI_AUTH');
  assert.equal(f.calls.length, 0); assert.equal((await f.service.usage()).usedTotal, 0);
  const first = await f.service.search({ topic: topic(1), key: 'key' });
  const restart = createOpenAISearch(f.options);
  assert.deepEqual(await restart.search({ topic: topic(1), key: '' }), first);
  assert.equal(f.calls.length, 1); assert.equal((await restart.usage()).usedTotal, 1);
});
test('daily limit stops the sixth request before transmission and resets at midnight Japan time', async t => {
  const f = await fixture(t);
  for (let n = 1; n <= 5; n++) await f.service.search({ topic: topic(n), key: 'key' });
  await assert.rejects(f.service.search({ topic: topic(6), key: 'key' }), e => e.newsCode === 'OPENAI_DAILY_LIMIT');
  assert.equal(f.calls.length, 5); assert.equal((await f.service.usage()).usedToday, 5);
  f.advance(1000);
  assert.equal((await f.service.usage()).usedToday, 0);
  await f.service.search({ topic: topic(6), key: 'key' });
  assert.equal(f.calls.length, 6); assert.equal((await f.service.usage()).usedTotal, 6);
  assert.equal(dayKey(new Date('2026-10-29T15:00:00Z')), '2026-10-30');
});
test('trial lifetime limit persists across restarts and dates, while saved searches still open', async t => {
  const f = await fixture(t);
  for (let day = 0; day < 4; day++) {
    for (let n = 1; n <= 5; n++) await f.service.search({ topic: topic(day * 5 + n), key: 'key' });
    f.advance(24 * 60 * 60 * 1000);
  }
  const restart = createOpenAISearch(f.options);
  await assert.rejects(restart.search({ topic: topic(21), key: 'key' }), e => e.newsCode === 'OPENAI_TOTAL_LIMIT');
  await restart.search({ topic: topic(1), key: 'key' });
  assert.equal(f.calls.length, 20); assert.equal((await restart.usage()).usedTotal, 20);
});
test('provider failures and uncertain network outcomes count once and cannot repeat for the same topic', async t => {
  for (const network of [false, true]) {
    const f = await fixture(t, async () => { if (network) throw new Error('private-openai'); return Response.json({ error: { message: 'private-openai' } }, { status: 429 }); });
    await assert.rejects(f.service.search({ topic: topic(1), key: 'private-openai' }), e => e.newsCode === (network ? 'OPENAI_CONNECTION' : 'OPENAI_QUOTA_LIMIT'));
    const restarted = createOpenAISearch(f.options);
    await assert.rejects(restarted.search({ topic: topic(1), key: 'private-openai' }), e => e.newsCode === 'OPENAI_TOPIC_LIMIT');
    assert.equal(f.calls.length, 1); assert.equal((await restarted.usage()).usedTotal, 1);
    assert.ok(!(await fs.readFile(path.join(f.directory, 'searches', topic(1).id + '.json'), 'utf8')).includes('private-openai'));
  }
});
test('multiple servers cannot race past the remaining daily allowance', async t => {
  const f = await fixture(t);
  for (let n = 1; n <= 4; n++) await f.service.search({ topic: topic(n), key: 'key' });
  const second = createOpenAISearch(f.options);
  await Promise.allSettled([f.service.search({ topic: topic(5), key: 'key' }), second.search({ topic: topic(6), key: 'key' })]);
  assert.equal(f.calls.length, 5); assert.equal((await second.usage()).usedToday, 5);
});
test('missing tool evidence, incomplete results and excessive calls never become a valid cached result', async t => {
  for (const body of [{ status: 'incomplete', output: [] }, { status: 'completed', output: [{ type: 'message', content: [] }] }, { status: 'completed', output: [{ type: 'web_search_call' }, { type: 'web_search_call' }] }]) {
    const f = await fixture(t, async () => Response.json(body));
    await assert.rejects(f.service.search({ topic: topic(1), key: 'key' }), e => e.newsCode === 'NEWS_SEARCH');
    assert.equal((await f.service.usage()).usedTotal, 1);
    await assert.rejects(f.service.search({ topic: topic(1), key: 'key' }), e => e.newsCode === 'OPENAI_TOPIC_LIMIT');
    assert.equal(f.calls.length, 1);
  }
});
test('a corrupt budget or unreleased reservation lock fails closed without spending', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.directory, 'openai-search-budget.json'), JSON.stringify({ days: {}, total: 0.5 }));
  await assert.rejects(f.service.search({ topic: topic(1), key: 'key' }), e => e.newsCode === 'OPENAI_BUDGET_INVALID');
  await fs.writeFile(path.join(f.directory, 'openai-search.lock'), 'reserved');
  await assert.rejects(f.service.search({ topic: topic(2), key: 'key' }), e => e.newsCode === 'NEWS_BUSY');
  assert.equal(f.calls.length, 0);
});
