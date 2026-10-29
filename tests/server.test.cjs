const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { createServer } = require('../server.cjs');
const { parseReview, reviewBattle } = require('../review.cjs');

async function fixture(t, fetchImpl) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dopanews-test-'));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>DOPANEWS</h1>');
  await fs.writeFile(path.join(root, 'config.local.json'), JSON.stringify({ GeminiApiKey: 'test-gemini', MurekaApiKey: 'test-mureka' }));
  const servers = [];
  async function start() {
    const server = createServer({ root, fetchImpl }); servers.push(server);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    return { server, url: `http://127.0.0.1:${server.address().port}` };
  }
  t.after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
    // Only remove this test's verified temporary directory.
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dopanews-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { root, start, ...(await start()) };
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const script = { title: 'テスト記事', verses: [{ speaker: 'KENTA', lyric: '歌詞', lyric_reading: 'かし' }], mureka_timeline: [{ start_sec: 0.4, end_sec: 2, verse_index: 0, line_indices: [0] }] };

test('server keeps API keys private and injects them into the correct upstream requests', async t => {
  const calls = [];
  const { url } = await fixture(t, async (target, options) => {
    calls.push({ target, options }); return Response.json({ status: 'succeeded' });
  });
  const config = await (await fetch(`${url}/api/config`)).json();
  assert.deepEqual(config, { geminiConfigured: true, murekaConfigured: true, reviewSupported: true });
  for (const route of ['/config.local.json', '/.local/library/x.json', '/server.cjs', '/.git/config']) {
    assert.equal((await fetch(url + route)).status, 404);
  }
  assert.equal((await post(`${url}/api/gemini/gemini-2.5-flash`, { contents: [] })).status, 200);
  assert.equal((await post(`${url}/api/mureka/v1/song/generate`, { lyrics: 'test', model: 'auto', n: 3 })).status, 200);
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-gemini');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-mureka');
  assert.equal(JSON.parse(calls[1].options.body).model, 'mureka-9');
  assert.equal(JSON.parse(calls[1].options.body).n, 1);
  assert.ok(!calls[0].target.includes('test-gemini'));
  assert.equal((await fetch(`${url}/api/config`, { headers: { Origin: 'https://other.example' } })).status, 403);
});

test('saved audio, article and timing metadata survive restart and support range requests', async t => {
  let downloads = 0;
  const { url, start } = await fixture(t, async () => { downloads++; return new Response(Buffer.from('0123456789')); });
  const response = await post(`${url}/api/library`, { battleData: script, articleText: '元記事', audioUrl: 'https://cdn.mureka.ai/test.mp3' });
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.equal(downloads, 1);
  assert.match(saved.audioUrl, /^\/api\/library\/[a-f0-9]{32}\/audio$/);
  const second = await start();
  const { items } = await (await fetch(`${second.url}/api/library`)).json();
  assert.equal(items.length, 1); assert.equal(items[0].articleText, '元記事');
  assert.equal(items[0].battleData.verses[0].lyric_reading, 'かし');
  assert.deepEqual(items[0].battleData.mureka_timeline, script.mureka_timeline);
  const audio = await fetch(second.url + saved.audioUrl);
  assert.equal(await audio.text(), '0123456789'); assert.equal(downloads, 1);
  const range = await fetch(second.url + saved.audioUrl, { headers: { Range: 'bytes=2-5' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await range.text(), '2345');
  assert.equal((await fetch(second.url + saved.audioUrl, { headers: { Range: 'bytes=20-' } })).status, 416);
});

test('lyrics-only records need no audio download and failed downloads never produce a saved record', async t => {
  const { url } = await fixture(t, async () => new Response('', { status: 503 }));
  const saved = await post(`${url}/api/library`, { battleData: script, synthDuration: 64 });
  assert.equal(saved.status, 201); assert.equal((await saved.json()).audioUrl, null);
  const failed = await post(`${url}/api/library`, { battleData: script, audioUrl: 'https://cdn.mureka.ai/fail.mp3' });
  assert.equal(failed.status, 400);
  const forbidden = await post(`${url}/api/library`, { battleData: script, audioUrl: 'http://localhost/private' });
  assert.equal(forbidden.status, 400);
  assert.equal((await (await fetch(`${url}/api/library`)).json()).items.length, 1);
});


function judgeResponse(verdict = 'pass', issues = []) {
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict, summary: '審判結果', issues, transcript: '聞こえた歌詞' }) }] } }] });
}

test('script review makes one Gemini call and never invokes Mureka', async t => {
  const calls = [];
  const { url } = await fixture(t, async (target, options) => { calls.push({ target, options }); return judgeResponse(); });
  const response = await post(`${url}/api/review`, { stage: 'script', articleText: 'これは元記事です。', battleData: script });
  assert.equal(response.status, 200); assert.equal((await response.json()).verdict, 'pass');
  assert.equal(calls.length, 1); assert.match(calls[0].target, /gemini-3.1-flash-lite:generateContent/);
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.contents[0].parts.length, 1);
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-gemini');
});

test('audio review sends actual saved audio, persists its result and reuses it after restart', async t => {
  let reviews = 0;
  const { url, start } = await fixture(t, async (target, options) => {
    if (target.startsWith('https://cdn.mureka.ai')) return new Response(Buffer.from('actual-mp3-bytes'));
    reviews++;
    const parts = JSON.parse(options.body).contents[0].parts;
    assert.equal(parts[1].inlineData.mimeType, 'audio/mpeg');
    assert.equal(Buffer.from(parts[1].inlineData.data, 'base64').toString(), 'actual-mp3-bytes');
    return judgeResponse('needs_revision', [{ kind: 'audio_mismatch', quote: '異なる歌詞', reason: '台本との相違', source_quote: '', suggestion: '台本に合わせる' }]);
  });
  const saved = await (await post(`${url}/api/library`, { battleData: script, articleText: '元記事', audioUrl: 'https://cdn.mureka.ai/song.mp3' })).json();
  const input = { stage: 'audio', recordId: saved.id };
  const responses = await Promise.all([post(`${url}/api/review`, input), post(`${url}/api/review`, input)]);
  for (const response of responses) { assert.equal(response.status, 200); assert.equal((await response.json()).verdict, 'needs_revision'); }
  assert.equal(reviews, 1, 'concurrent review requests share one Gemini call');
  const next = await start();
  assert.equal((await post(`${next.url}/api/review`, input)).status, 200); assert.equal(reviews, 1);
  const items = (await (await fetch(`${next.url}/api/library`)).json()).items;
  assert.equal(items[0].reviews.audio.verdict, 'needs_revision');
  assert.equal((await post(`${next.url}/api/review`, { ...input, force: true })).status, 200);
  assert.equal(reviews, 2, 'only an explicit recheck makes an additional request');
});

test('review failures, missing audio and invented evidence are never reported as a pass or auto-retried', async t => {
  let calls = 0;
  let mode = 'invalid';
  const { url } = await fixture(t, async () => {
    calls++;
    return mode === 'invalid' ? Response.json({ candidates: [] }) : judgeResponse('needs_revision', [
      { kind: 'contradiction', quote: '歌詞', reason: '相違', source_quote: '元記事にはない引用', suggestion: '修正' }
    ]);
  });
  const input = { stage: 'script', articleText: '元記事', battleData: script };
  assert.equal((await post(`${url}/api/review`, input)).status, 400); assert.equal(calls, 1);
  mode = 'evidence';
  assert.equal((await post(`${url}/api/review`, input)).status, 400); assert.equal(calls, 2);
  assert.equal((await post(`${url}/api/review`, { ...input, stage: 'audio' })).status, 400); assert.equal(calls, 2);
});

test('inconsistent or inaudible audio reports cannot be presented as verified', () => {
  assert.throws(() => parseReview({ verdict: 'pass', summary: '完了', issues: [] }, 'audio'), /聞き取り結果/);
  assert.throws(() => parseReview({ verdict: 'pass', summary: '完了', issues: [{ kind: 'uncertain', quote: '', reason: '不明', source_quote: '', suggestion: '再確認' }] }, 'script'), /矛盾/);
  const uncertain = parseReview({ verdict: 'uncertain', summary: '聞き取り困難', issues: [{ kind: 'uncertain', quote: '', reason: '音声が不明瞭', source_quote: '', suggestion: '聴き直してください' }] }, 'audio');
  assert.equal(uncertain.verdict, 'uncertain');
});

test('oversized audio is rejected before any Gemini or Mureka request', async () => {
  let calls = 0;
  await assert.rejects(reviewBattle({ articleText: '元記事', battleData: script, stage: 'audio', key: 'test',
    audio: Buffer.alloc(12 * 1024 * 1024 + 1), fetchImpl: async () => { calls++; } }), /12MB/);
  assert.equal(calls, 0);
});


test('review errors retain the provider reason and model without leaking the key or retrying', async () => {
  let calls = 0;
  await assert.rejects(reviewBattle({ articleText: '元記事', battleData: script, stage: 'script', key: 'private-test-key',
    fetchImpl: async () => { calls++; return Response.json({ error: { message: 'Model unavailable: private-test-key' } }, { status: 404 }); } }), error => {
      assert.match(error.message, /404 \/ gemini-3.1-flash-lite/);
      assert.match(error.message, /Model unavailable/);
      assert.doesNotMatch(error.message, /private-test-key/);
      return true;
    });
  assert.equal(calls, 1);
});
