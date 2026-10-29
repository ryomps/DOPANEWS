const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { createServer } = require('../server.cjs');
const { convertWav } = require('../backing-audio.cjs');

function wav() {
  const bytes = Buffer.alloc(44 + 44100 * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(44100, 24); bytes.writeUInt32LE(88200, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < 44100; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / 44100) * 10000), 44 + i * 2);
  return bytes;
}

test('WAV converts to MP3 in a worker and malformed input is rejected', async () => {
  const converted = await convertWav(wav());
  assert.equal(converted.duration, 1);
  assert.ok(converted.bytes.length > 1000);
  assert.equal(converted.bytes[0], 255);
  await assert.rejects(convertWav(Buffer.from('not-wav')), /WAV/);
});

test('upload uses multipart audio purpose; track generation uses milliseconds, gender and lyric review', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dopanews-backing-'));
  await fs.writeFile(path.join(root, 'config.local.json'), JSON.stringify({ GeminiApiKey: 'test-gemini', MurekaApiKey: 'test-mureka' }));
  const calls = []; let verdict = 'pass';
  const server = createServer({ root, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/files/upload')) {
      assert.equal(options.body.get('purpose'), 'audio');
      assert.equal(options.body.get('file').type, 'audio/mpeg');
      assert.equal(options.headers.Authorization, 'Bearer test-mureka');
      return Response.json({ id: 'uploaded-backing' });
    }
    if (url.includes('generativelanguage')) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      verdict, summary: '確認', issues: verdict === 'pass' ? [] : [{ kind: 'uncertain', quote: '歌詞', reason: '確認', source_quote: '', suggestion: '修正' }], transcript: ''
    }) }] } }] });
    return Response.json({ id: 'track-task' });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('dopanews-backing-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const upload = await fetch(url + '/api/backing/upload', { method: 'POST', headers: {
    'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('伴奏.wav'), 'X-Audio-Duration': '1'
  }, body: wav() });
  assert.equal(upload.status, 201);
  const backing = await upload.json();
  assert.equal(backing.duration, 1);
  assert.ok(!JSON.stringify(backing).includes('test-mureka'));
  const preview = await fetch(url + backing.audioUrl, { headers: { Range: 'bytes=0-9' } });
  assert.equal(preview.status, 206);
  assert.equal((await preview.arrayBuffer()).byteLength, 10);
  const body = { backingId: backing.id, startSec: 0.1, endSec: 0.9, speaker: 'REINA', lyric: '歌詞', lyricReading: 'かし', articleText: '元記事の本文', title: '試作' };
  const generate = input => fetch(url + '/api/backing/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const result = await generate(body);
  assert.equal(result.status, 200);
  const track = JSON.parse(calls.find(call => call.url.endsWith('/track/generate')).options.body);
  assert.equal(track.upload_audio_id, 'uploaded-backing');
  assert.equal(track.generate_start, 100); assert.equal(track.generate_end, 900);
  assert.equal(track.vocal_gender, 'female'); assert.equal(track.generate_type, 'Vocals');
  assert.match(track.lyrics, /かし/); assert.doesNotMatch(track.lyrics, /歌詞/);
  const before = calls.length;
  assert.equal((await generate({ ...body, endSec: 2 })).status, 400);
  assert.equal(calls.length, before);
  verdict = 'uncertain';
  assert.equal((await generate(body)).status, 422);
  assert.equal(calls.filter(call => call.url.endsWith('/track/generate')).length, 1);
  assert.equal((await fetch(url + '/api/backing/upload', { method: 'POST', headers: { Origin: 'https://other.example' } })).status, 403);
});
