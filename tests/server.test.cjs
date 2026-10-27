const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { createServer } = require('../server.cjs');

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
const script = { title: 'テスト記事', verses: [{ speaker: 'KENTA', lyric: '歌詞' }], mureka_timeline: [{ start_sec: 0.4, end_sec: 2, verse_index: 0 }] };

test('server keeps API keys private and injects them into the correct upstream requests', async t => {
  const calls = [];
  const { url } = await fixture(t, async (target, options) => {
    calls.push({ target, options }); return Response.json({ status: 'succeeded' });
  });
  const config = await (await fetch(`${url}/api/config`)).json();
  assert.deepEqual(config, { geminiConfigured: true, murekaConfigured: true });
  for (const route of ['/config.local.json', '/.local/library/x.json', '/server.cjs', '/.git/config']) {
    assert.equal((await fetch(url + route)).status, 404);
  }
  assert.equal((await post(`${url}/api/gemini/gemini-2.5-flash`, { contents: [] })).status, 200);
  assert.equal((await post(`${url}/api/mureka/v1/song/generate`, { lyrics: 'test' })).status, 200);
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-gemini');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-mureka');
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
