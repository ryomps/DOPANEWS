const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createLyria, validateAlignment } = require('../lyria.cjs');
const verse = { lyric: Array(8).fill('表示歌詞').join('\n'), lyric_reading: Array(8).fill('ひょうじかし').join('\n') };
const input = { gender: 'male', verses: [verse, verse] };
const alignment = { lines: Array.from({ length: 16 }, (_, id) => ({ id, start: 3 + id * 2.4, end: 5 + id * 2.4 })) };
const music = () => Response.json({ steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/mpeg', data: Buffer.from('ID3music').toString('base64') }] }] });
const analysis = () => Response.json({ words: alignment.lines.map(l => ({ word: '表示歌詞', start: l.start, end: l.end })) });
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dopanews-lyria-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('dopanews-lyria-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('Lyria pins model, keeps key in headers, deduplicates concurrent calls and reuses files after restart', async t => {
  const dir = await directory(t); const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return url.endsWith('/interactions') ? music() : analysis(); };
  const service = createLyria({ directory: dir, fetchImpl });
  const results = await Promise.all([service.generate(input, 'secret', 'openai-secret'), service.generate(input, 'secret', 'openai-secret')]);
  assert.equal(results[0].id, results[1].id); assert.equal(calls.length, 2);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'lyria-3.5'); assert.match(body.input, /male, natural low register/);
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'secret', 'openai-secret');
  assert.ok(!calls[0].url.includes('secret'));
  assert.equal(await fs.readFile(path.join(dir, `${results[0].id}.mp3`), 'utf8'), 'ID3music');
  await createLyria({ directory: dir, fetchImpl }).generate(input, 'secret', 'openai-secret');
  assert.equal(calls.length, 2, 'no paid calls after restart');
  await service.generate({ ...input, verses: input.verses.map(v => ({ ...v, lyric: Array(8).fill('表示歌詞！').join('\n') })) }, 'secret', 'openai-secret');
  assert.equal(calls.length, 2, 'display-only corrections must not buy new audio');
  const cachedFile = path.join(dir, `${results[0].id}.alignment.json`);
  const corrected = JSON.parse(await fs.readFile(cachedFile, 'utf8'));
  corrected.model = 'whisper-1';
  await fs.writeFile(cachedFile, JSON.stringify(corrected));
  const correctedResult = await service.generate(input, 'secret', 'openai-secret');
  assert.equal(correctedResult.alignmentModel, 'whisper-1');
  assert.equal(calls.length, 2, 'corrected timing is reused without an API call');
  await service.generate({ ...input, gender: 'female' }, 'secret', 'openai-secret');
  assert.equal(calls.length, 4); assert.match(JSON.parse(calls[2].options.body).input, /female, firm middle-low register/);
});

test('alignment failure preserves audio; explicit retry buys no new music', async t => {
  const dir = await directory(t); let musicCalls = 0, analysisCalls = 0;
  const fetchImpl = async url => {
    if (url.endsWith('/interactions')) { musicCalls++; return music(); }
    analysisCalls++; return analysisCalls === 1 ? new Response('', { status: 429 }) : analysis();
  };
  const service = createLyria({ directory: dir, fetchImpl });
  await assert.rejects(service.generate(input, 'secret', 'openai-secret'), /429/);
  await service.generate(input, 'secret', 'openai-secret');
  assert.equal(musicCalls, 1); assert.equal(analysisCalls, 2);
});

test('uncertain generation blocks duplicate purchase across restart; definite rejection allows explicit retry', async t => {
  const dir = await directory(t); let requests = 0;
  const fetchImpl = async () => { requests++; throw new Error('timeout'); };
  await assert.rejects(createLyria({ directory: dir, fetchImpl }).generate(input, 'secret', 'openai-secret'), /未確定/);
  await assert.rejects(createLyria({ directory: dir, fetchImpl }).generate(input, 'secret', 'openai-secret'), /二重課金/);
  assert.equal(requests, 1);
  const other = { ...input, gender: 'female' };
  const service = createLyria({ directory: dir, fetchImpl: async () => { requests++; return new Response('', { status: 429 }); } });
  await assert.rejects(service.generate(other, 'secret', 'openai-secret'), /429/);
  await assert.rejects(service.generate(other, 'secret', 'openai-secret'), /429/);
  assert.equal(requests, 3);
});

test('missing lines, overlapping timings and invented durations stop editing', () => {
  assert.throws(() => validateAlignment({ lines: [] }, Array(16)), /歌い出し/);
  const copy = structuredClone(alignment); copy.lines[5].start = 0;
  assert.throws(() => validateAlignment(copy, Array(16)), /時刻/);
});

test('browser assembly preserves stereo, all four complete turns, and actual timing offsets', async () => {
  const env = { Float32Array, Uint8Array, DataView, Blob, URL, btoa, DOPANEWS: {}, calls: [] };
  env.window = env;
  class AudioContext {
    constructor() { this.sampleRate = 44100; }
    async decodeAudioData() { return { duration: 45, numberOfChannels: 2,
      getChannelData: ch => new Float32Array(45 * 44100).fill(ch ? -0.2 : 0.3) }; }
    async close() {}
  }
  env.AudioContext = AudioContext;
  env.fetch = async (url, options) => {
    env.calls.push(url);
    if (options) return { ok: true, json: async () => ({ ...alignment, id: JSON.parse(options.body).gender, model: 'lyria-3.5', audioUrl: '/source' }) };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../js/lyria.js'), 'utf8'), env);
  const battle = { verses: Array.from({ length: 4 }, (_, i) => ({ ...verse, speaker: i % 2 ? 'REINA' : 'KENTA' })) };
  const result = await env.DOPANEWS.synthesizeBattleWithLyria(battle);
  try {
    assert.equal(env.calls.filter(x => x === '/api/lyria/generate').length, 2);
    assert.equal(battle.mureka_timeline.length, 32);
    assert.equal(battle.part_segments.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.ok(Math.abs(battle.verses[i].timed_lines[0].start_sec - battle.part_segments[i].start - 0.08) < 0.001);
      assert.ok(battle.verses[i].timed_lines[7].end_sec < battle.part_segments[i].end);
      if (i) assert.equal(battle.part_segments[i].start, battle.part_segments[i - 1].end);
    }
    const bytes = Buffer.from(result.audioWavBase64, 'base64');
    assert.equal(bytes.readUInt16LE(22), 2); assert.equal(bytes.readUInt32LE(24), 44100);
    assert.ok(bytes.readInt16LE(44 + 1000 * 4) > 0); assert.ok(bytes.readInt16LE(46 + 1000 * 4) < 0);
    const bad = structuredClone(alignment); bad.lines[15].end = 99;
    assert.throws(() => env.DOPANEWS.buildLyriaEditPlan([bad, bad], [45, 45]), /範囲外/);
  } finally { URL.revokeObjectURL(result.audioUrl); }
});


test('429 identifies zero quota, minute/day limits and retry delay without leaking API keys', async () => {
  const { providerFailure } = require('../lyria.cjs');
  const zero = await providerFailure(Response.json({error:{message:'quota exceeded secret-key',details:[{violations:[{quotaId:'GenerateRequestsPerDayPerProjectPerModel',quotaValue:'0'}]},{retryDelay:'45s'}]}},{status:429}),'secret-key','lyria-3.5','generation');
  assert.match(zero.message,/利用枠が0/); assert.match(zero.message,/45s/);
  assert.ok(!JSON.stringify(zero.report).includes('secret-key')); assert.ok(!zero.message.includes('secret-key'));
  const daily = await providerFailure(Response.json({error:{details:[{violations:[{quotaId:'GenerateRequestsPerDay',quotaValue:'10'}]}]}},{status:429}),'secret','lyria-3.5','generation');
  assert.match(daily.message,/1日/);
  const minute = await providerFailure(Response.json({error:{details:[{violations:[{quotaId:'GenerateRequestsPerMinute'}]}]}},{status:429}),'secret','lyria-3.5','generation');
  assert.match(minute.message,/短時間/);
});


test('missing OpenAI key stops before buying a Lyria song', async t => {
  const dir = await directory(t); let calls = 0;
  const service = createLyria({directory:dir,fetchImpl:async()=>{calls++;return music();}});
  await assert.rejects(service.generate(input,'gemini-only'),/OpenAIApiKey/);
  assert.equal(calls,0);
});

test('legacy Gemini timing migrates using saved audio and transcription without paid calls', async t => {
  const dir = await directory(t); let calls = 0;
  const fetchImpl = async url => {calls++;return url.endsWith('/interactions')?music():analysis();};
  const service = createLyria({directory:dir,fetchImpl});
  const original = await service.generate(input,'secret','openai-secret');
  const file = path.join(dir,original.id+'.alignment.json');
  await fs.writeFile(file,JSON.stringify({model:'gemini-3.1-flash-lite',lines:alignment.lines.map(l=>({...l,start:l.start-1,end:l.end-1}))}));
  const updated = await createLyria({directory:dir,fetchImpl}).generate(input,'secret','openai-secret');
  assert.equal(calls,2); assert.equal(updated.alignmentModel,'whisper-1');
  assert.equal(updated.lines[0].start,3);
});
