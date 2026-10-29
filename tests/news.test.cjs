const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { createNewsService, parseFeed, readable, primaryFor, validateFacts, validateArticle, publicNewsFailure } = require('../news-service.cjs');
const { createServer } = require('../server.cjs');
const xml = `<rss><channel><item><title><![CDATA[物価と教育 &amp; 調査発表]]></title><link>https://news.yahoo.co.jp/pickup/6600536?source=rss</link><pubDate>Thu, 29 Oct 2026 09:00:00 GMT</pubDate></item></channel></rss>`;
const sourceTexts = [
  '総務省統計局は調査の結果を公表しました。家計調査の対象期間は2025年です。対象とする家計の収入と支出を把握するための調査です。数値の変化は対象期間や対象集団によって異なります。この調査だけで政策の因果的な効果を判断することはできません。',
  '文部科学省は学校教育について資料を公表しました。調査の対象期間は2025年度です。学校における教育の実態を把握するための資料です。調査年と公表年は区別して読む必要があります。他の調査の数値と単純に比較することはできません。'
];
const facts = sourceTexts.map((text, i) => ({ id: `F${i + 1}`, statement: i ? '教育の実態について資料が公表された。' : '家計の収入と支出について調査結果が公表された。', when: '2025年', who: i ? '文部科学省' : '総務省統計局', event: '調査結果公表', numbers: '', uncertainty: '因果的な効果を判断できない', evidence: [{ sourceId: `S${i + 1}`, quote: text.slice(0, 45) }] }));
const article = { title: '調査資料を読み解く', summary: '家計と教育の資料の対象期間を確認する。', paragraphs: [{ text: '家計の調査結果が公表された。', factIds: ['F1'] }, { text: '教育の資料も公表された。', factIds: ['F2'] }, { text: '対象期間を区別して読む必要がある。', factIds: ['F1', 'F2'] }], stances: ['家計への支援を考えよう', '教育環境を考えよう'] };
const envelope = (value, search = false) => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] }, ...(search ? { groundingMetadata: { webSearchQueries: ['test'], groundingChunks: [{ web: { uri: 'https://www.stat.go.jp/test.html' } }], searchEntryPoint: { renderedContent: '<div>Google search</div>' } } } : {}) }] });
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dopanews-news-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('dopanews-news-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const calls = []; let ai = 0, gemini = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/rss/')) {
      if (options.feedError) throw new Error('offline');
      return new Response(xml);
    }
    if (url === 'https://api.openai.com/v1/responses') {
      ai++;
      if (options.aiFailure) return Response.json({error:{message:'private-provider-message test-private-key'}},{status:options.aiStatus || 503});
      const urls = options.urls || ['https://www.stat.go.jp/test.html','https://www.mext.go.jp/test.html'];
      return Response.json({id:'resp_test', status:'completed', output:options.noGrounding ? [] : [{type:'web_search_call',status:'completed',action:{type:'search',sources:urls.map(url=>({type:'url',url}))}}],usage:{input_tokens:100,output_tokens:30}});
    }
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      ai++;
      if (options.geminiFailure) return Response.json({}, {status:429});
      const phase = (gemini++ % 3) + 1;
      if (phase === 1) return envelope({ facts: options.badQuote ? [{ ...facts[0], evidence: [{ sourceId: 'S1', quote: '存在しない根拠です' }] }, facts[1]] : facts, unresolved: ['複数資料だけで政策の効果は確定しない'] });
      if (phase === 2) return envelope(article);
      return envelope(options.held ? { verdict: 'uncertain', summary: '関連性を確認できません。', issues: ['対象が異なる可能性'] } : { verdict: 'pass', summary: '資料との食い違いは見つかりませんでした。', issues: [] });
    }
    const index = url.includes('stat.go.jp') ? 0 : 1;
    return new Response(`<html><main><h1>調査結果</h1><p>${options.sameText ? sourceTexts[0] : sourceTexts[index]}</p></main></html>`, { headers: { 'Content-Type': 'text/html' } });
  };
  const service = createNewsService({ directory, fetchImpl, readConfig: async () => ({ gemini: 'test-private-key', openai:'test-openai-key' }) });
  return { directory, service, fetchImpl, calls, aiCalls: () => ai };
}
test('RSS decodes titles, validates links and dates, rejects XML entities and dangerous links', () => {
  const [item] = parseFeed(xml, { id: 'science' });
  assert.equal(item.title, '物価と教育 & 調査発表');
  assert.equal(item.url, 'https://news.yahoo.co.jp/pickup/6600536');
  assert.equal(item.reportingOrigin, null);
  assert.equal(parseFeed(xml.replace('news.yahoo.co.jp', '127.0.0.1'), { id: 'test' }).length, 0);
  assert.throws(() => parseFeed('<!DOCTYPE rss><rss></rss>', {}));
  for (const url of ['http://www.stat.go.jp/x', 'https://www.stat.go.jp.evil.com/x', 'https://user@www.stat.go.jp/x', 'https://www.stat.go.jp:8443/x', 'https://localhost/x']) assert.ok(!primaryFor(url));
});
test('HTML parser selects nested main content and removes executable/navigation content', () => {
  const text = readable(`<nav>外のメニュー</nav><div id="main"><div>調査の概要</div><p>${sourceTexts[0]}</p><script>bad()</script><nav>メニュー</nav></div><footer>外の末尾</footer>`);
  assert.ok(text.includes(sourceTexts[0])); assert.doesNotMatch(text, /bad|メニュー|末尾/);
  assert.throws(() => readable('<body>本文なし</body>'));
});
test('headlines refresh automatically without Gemini and survive offline using dated stale cache', async t => {
  const f = await fixture(t);
  const a = await f.service.headlines();
  assert.equal(a.items.length, 1); assert.equal(f.aiCalls(), 0);
  await f.service.headlines(); assert.equal(f.calls.length, 3);
  const file = path.join(f.directory, 'headlines.json');
  await fs.writeFile(file, JSON.stringify({ ...a, checkedAt: '2000-01-01' }));
  const offline = createNewsService({ directory: f.directory, fetchImpl: async () => { throw new Error('offline'); }, readConfig: async () => ({}) });
  const stale = await offline.headlines();
  assert.equal(stale.stale, true); assert.equal(stale.fetchedAt, a.fetchedAt); assert.equal(stale.errors.length, 3);
});
test('OpenAI search passes real source documents to three Gemini stages and reuses results across restart', async t => {
  const f = await fixture(t);
  const id = (await f.service.headlines()).items[0].id;
  const [record, concurrent] = await Promise.all([f.service.generate(id), f.service.generate(id)]);
  assert.deepEqual(record, concurrent); assert.equal(record.status, 'ready'); assert.equal(f.aiCalls(), 4);
  assert.match(record.articleText, /原文:/); assert.match(record.articleText, /www.stat.go.jp/);
  assert.ok(!record.articleText.includes('対象が異なる可能性'));
  assert.ok(f.calls.every(c => !c.url.includes('mureka')));
  const aiRequests = f.calls.filter(c => c.url.includes('generativelanguage') || c.url.includes('api.openai.com'));
  assert.equal(aiRequests[0].url, 'https://api.openai.com/v1/responses');
  const searchRequest=JSON.parse(aiRequests[0].init.body);
  assert.equal(searchRequest.tools[0].type,'web_search');
  assert.equal(searchRequest.model,'gpt-6-luna');
  assert.equal(searchRequest.max_tool_calls,1); assert.equal(searchRequest.max_output_tokens,800);
  assert.equal(searchRequest.store,false); assert.equal(searchRequest.parallel_tool_calls,false);
  assert.equal(aiRequests[0].init.headers.Authorization,'Bearer test-openai-key');
  assert.ok(!JSON.stringify(searchRequest).includes('test-private-key'));
  for (const call of aiRequests.slice(1)) {
    assert.match(call.url, /gemini-3\.1-flash-lite:generateContent$/);
    assert.equal(JSON.parse(call.init.body).tools, undefined);
  }
  assert.equal(record.model, 'gemini-3.1-flash-lite');
  assert.equal(record.search.model, 'gpt-6-luna');
  const restarted = createNewsService({ directory: f.directory, readConfig: async () => { throw new Error('must use cache'); }, fetchImpl: async () => { throw new Error('must use cache'); } });
  assert.equal((await restarted.generate(id)).status, 'ready');
  assert.equal((await restarted.list()).length, 1);
  assert.equal((await f.service.generate(id, true)).status, 'ready'); assert.equal(f.aiCalls(), 4);
});

test('Gemini failure after OpenAI search never repeats the paid search on another explicit attempt', async t => {
  const f = await fixture(t, { geminiFailure: true });
  const id = (await f.service.headlines()).items[0].id;
  await assert.rejects(f.service.generate(id), e => publicNewsFailure(e).code === 'NEWS_QUOTA_LIMIT');
  await assert.rejects(f.service.generate(id), e => publicNewsFailure(e).code === 'NEWS_QUOTA_LIMIT');
  assert.equal(f.calls.filter(c => c.url.includes('api.openai.com')).length, 1);
  assert.equal(f.calls.filter(c => c.url.includes('generativelanguage')).length, 2);
  assert.equal((await f.service.searchUsage()).usedTotal, 1);
});
test('unverified URLs, duplicate documents, fake evidence and missing grounding stop before writing an approved article', async t => {
  for (const options of [{ urls: ['https://localhost/private', 'https://www.asahi.com/secret'] }, { sameText: true }, { badQuote: true }, { noGrounding: true }]) {
    const f = await fixture(t, options); const id = (await f.service.headlines()).items[0].id;
    await assert.rejects(f.service.generate(id));
    assert.equal(await f.service.get(id), null);
    assert.ok(!f.calls.some(c => c.url.includes('localhost') || c.url.includes('asahi.com')));
    assert.ok(f.aiCalls() < 4);
  }
});
test('held articles are persisted without lyric input and not automatically regenerated; API failures never retry', async t => {
  const f = await fixture(t, { held: true }); const id = (await f.service.headlines()).items[0].id;
  const record = await f.service.generate(id); assert.equal(record.status, 'held'); assert.equal(record.articleText, null);
  await f.service.generate(id); assert.equal(f.aiCalls(), 4);
  await f.service.generate(id, true); assert.equal(f.aiCalls(), 7);
  const failed = await fixture(t, { aiFailure: true }); const topic = (await failed.service.headlines()).items[0];
  await assert.rejects(failed.service.generate(topic.id), /503/); assert.equal(failed.aiCalls(), 1);
});
test('unknown fact references and fabricated quotations are rejected', () => {
  assert.throws(() => validateArticle({ ...article, paragraphs: article.paragraphs.map(p => ({ ...p, factIds: ['fake'] })) }, facts));
  assert.throws(() => validateFacts({ facts, unresolved: [] }, [{ id: 'S1', text: 'not the source' }]));
});

test('quota failures are classified and logged without secrets, never retried or mistaken for rejected content', async t => {
  const f = await fixture(t, { aiFailure: true, aiStatus: 429 });
  const id = (await f.service.headlines()).items[0].id;
  await assert.rejects(f.service.generate(id), error => {
    const problem = publicNewsFailure(error);
    assert.equal(problem.code, 'OPENAI_QUOTA_LIMIT'); assert.equal(problem.status, 429);
    assert.match(problem.message, /利用枠/); assert.doesNotMatch(problem.message, /審判|private/);
    return true;
  });
  assert.equal(f.aiCalls(), 1); assert.equal(await f.service.get(id), null);
  const diagnostic = await fs.readFile(path.join(f.directory, 'failures', id + '.json'), 'utf8');
  assert.doesNotMatch(diagnostic, /test-private-key|private-provider-message/);
  assert.equal(JSON.parse(diagnostic).phase, 'search');
  assert.equal(JSON.parse(diagnostic).model, 'gpt-6-luna');
  assert.equal(JSON.parse(diagnostic).code, 'OPENAI_QUOTA_LIMIT');
});

test('source shortages are distinct from quota and connection failures', async t => {
  const f = await fixture(t, { urls: [] }); const id = (await f.service.headlines()).items[0].id;
  await assert.rejects(f.service.generate(id), error => {
    const problem = publicNewsFailure(error);
    assert.equal(problem.code, 'NEWS_SOURCES'); assert.equal(problem.status, 422);
    assert.match(problem.message, /別の話題/); return true;
  });
  assert.equal(f.aiCalls(), 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory, 'failures', id + '.json'), 'utf8')).phase, 'search');
});

test('HTTP quota responses preserve the actionable code and never expose upstream errors', async t => {
  const f = await fixture(t, { aiFailure: true, aiStatus: 429 });
  const root = path.join(f.directory, 'http'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'config.local.json'), JSON.stringify({ GeminiApiKey: 'test-private-key', OpenAIApiKey:'test-openai-key' }));
  const server = createServer({ root, fetchImpl: f.fetchImpl });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const news = await (await fetch(base + '/api/news')).json();
  const response = await fetch(base + '/api/news/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId: news.headlines.items[0].id }) });
  assert.equal(response.status, 429);
  const body = await response.json(); assert.equal(body.code, 'OPENAI_QUOTA_LIMIT');
  assert.doesNotMatch(JSON.stringify(body), /test-private-key|private-provider-message/);
  assert.equal(f.aiCalls(), 1);
});
test('HTTP routes only accept listed topic IDs, keep private storage inaccessible and persist news for later browsing', async t => {
  const f = await fixture(t);
  const root = path.join(f.directory, 'app'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'config.local.json'), JSON.stringify({ GeminiApiKey: 'test-private-key', OpenAIApiKey:'test-openai-key' }));
  const server = createServer({ root, fetchImpl: f.fetchImpl });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const news = await (await fetch(base + '/api/news')).json();
  assert.equal(news.sources.length, 8); assert.equal(news.headlines.items.length, 1); assert.equal(f.aiCalls(), 0);
  const post = body => fetch(base + '/api/news/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ topicId: '../secrets' })).status, 400);
  assert.equal((await post({ topicId: news.headlines.items[0].id, url: 'https://localhost' })).status, 400);
  const response = await post({ topicId: news.headlines.items[0].id }); assert.equal(response.status, 200);
  const saved = await response.json(); assert.equal(saved.status, 'ready');
  assert.equal((await fetch(base + '/.local/news/headlines.json')).status, 404);
  assert.equal((await fetch(base + `/api/news/articles/${saved.id}`)).status, 200);
  const denied = await fetch(base + '/api/news', { headers: { Origin: 'https://example.com' } }); assert.equal(denied.status, 403);
  assert.ok(!JSON.stringify(saved).includes('test-private-key'));
});
