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
test('development has no daily, lifetime or per-topic cap; usage persists across restarts', async t => {
  const f = await fixture(t, () => Response.json({}, { status: 503 }));
  for (let n = 1; n <= 25; n++) {
    await assert.rejects(createOpenAISearch(f.options).search({ topic: topic(1), key: 'key' }), e => e.newsCode === 'OPENAI_PROVIDER');
    assert.equal(f.calls.length, n); // Exactly one request per explicit operation.
  }
  assert.equal((await f.service.usage()).usedToday, 25);
  assert.equal((await f.service.usage()).limits.daily, null);
  assert.equal((await f.service.usage()).limits.perTopic, null);
  f.advance(1000);
  assert.equal((await f.service.usage()).usedToday, 0);
  assert.equal((await f.service.usage()).usedTotal, 25);
  assert.equal(dayKey(new Date('2026-10-29T15:00:00Z')), '2026-10-30');
});

test('legacy failed records count as one attempt; later success is reused', async t => {
  let success = false;
  const f = await fixture(t, () => success ? result() : Response.json({}, { status: 503 }));
  await fs.mkdir(path.join(f.directory, 'searches'));
  const file = path.join(f.directory, 'searches', topic(1).id + '.json');
  await fs.writeFile(file, JSON.stringify({ status: 'failed', attempts: 3 }));
  await assert.rejects(f.service.search({ topic: topic(1), key: 'key' }));
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).attempts, 4);
  success = true;
  const found = await f.service.search({ topic: topic(1), key: 'key' });
  assert.deepEqual(await createOpenAISearch(f.options).search({ topic: topic(1), key: '' }), found);
  assert.equal(f.calls.length, 2);
});

test('unrestricted discovery uses tool sources without a fixed domain filter', async t => {
  const f = await fixture(t, () => Response.json({ status: 'completed', output: [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{url:'https://reissuerecords.net/2026/11/04/news/'}, {url:'https://127.0.0.1/private'}, {url:'https://localhost/private'}] } }] }));
  const service = createOpenAISearch({ ...f.options, allowedDomains: undefined });
  const found = await service.search({ topic: topic(1), key: 'key' });
  assert.equal(JSON.parse(f.calls[0].init.body).tools[0].filters, undefined);
  assert.deepEqual(found.urls, ['https://reissuerecords.net/2026/11/04/news/']);
});

test('in-flight and legacy uncertain reservations prevent duplicate topic requests', async t => {
  let release;
  const f = await fixture(t, () => new Promise(resolve => { release = () => resolve(result()); }));
  const first = f.service.search({ topic: topic(1), key: 'key' });
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  await assert.rejects(createOpenAISearch(f.options).search({ topic: topic(1), key: 'key' }), e => e.newsCode === 'NEWS_BUSY');
  release(); await first;
  const file = path.join(f.directory, 'searches', topic(2).id + '.json');
  await fs.writeFile(file, JSON.stringify({ status: 'reserved' }));
  await assert.rejects(f.service.search({ topic: topic(2), key: 'key' }), e => e.newsCode === 'NEWS_BUSY');
  assert.equal(f.calls.length, 1);
});

test('invalid results consume one recorded attempt without automatic retries', async t => {
  const f = await fixture(t, () => Response.json({ status: 'incomplete', output: [] }));
  for (let n = 1; n <= 4; n++) {
    await assert.rejects(f.service.search({ topic: topic(1), key: 'key' }), e => e.newsCode === 'NEWS_SEARCH');
    assert.equal(f.calls.length, n);
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

test('explicit research bypasses cache and excludes the previous inaccessible URLs', async t => {
  let fresh = false;
  const f = await fixture(t, () => fresh ? Response.json({ status: 'completed', output: [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{url:'https://www.stat.go.jp/test.html'}, {url:'https://www.stat.go.jp/new.html'}] } }] }) : result());
  await f.service.search({ topic: topic(1), key: 'key' });
  await f.service.search({ topic: topic(1), key: 'key' });
  assert.equal(f.calls.length, 1);
  fresh = true;
  const found = await f.service.search({ topic: topic(1), key: 'key', refresh: true });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(found.urls, ['https://www.stat.go.jp/new.html']);
  assert.deepEqual(JSON.parse(JSON.parse(f.calls[1].init.body).input).excludeUrls, ['https://www.stat.go.jp/test.html', 'https://www.mext.go.jp/test.html']);
});
