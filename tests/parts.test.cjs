const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '..', 'js', name), 'utf8');

function setup(extra = {}) {
  const context = { console, Float32Array, Uint8Array, DataView, Blob, URL, btoa, ...extra };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source('types.js'), context);
  vm.runInContext(source('partAudio.js'), context);
  return context;
}

test('four takes produce an 80-second WAV and remap line timings to 20-second MC slots', async () => {
  const rate = 22050, samples = new Float32Array(rate * 24).fill(0.2);
  let closed = false;
  const context = setup({
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
    AudioContext: class {
      async decodeAudioData() { return { length: samples.length, sampleRate: rate, numberOfChannels: 1, getChannelData: () => samples }; }
      async close() { closed = true; }
    }
  });
  const D = context.DOPANEWS;
  const battle = D.normalizeBattleData({ verses: Array.from({ length: 4 }, (_, i) => ({ speaker: i % 2 ? 'REINA' : 'KENTA', lyric: '一行目\n二行目', lyric_reading: 'いちぎょうめ\nにぎょうめ' })) });
  const parts = battle.verses.map((verse, index) => ({ index, verse: { ...verse, timed_lines: [
    { start_sec: 2, end_sec: 12, line_indices: [0] },
    { start_sec: 12, end_sec: 22, line_indices: [1] },
    { start_sec: 22, end_sec: 24, line_indices: [0] }
  ] }, audioUrl: 'https://cdn.mureka.ai/part.mp3', murekaTrack: {} }));
  const result = await D.composeBattleParts(battle, parts);
  try {
    const wav = Buffer.from(result.audioWavBase64, 'base64');
    assert.equal(wav.length, 3528044);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(24), rate);
    assert.equal(wav.readUInt32LE(40) / (rate * 2), 80);
    assert.equal(battle.mureka_timeline.length, 8);
    assert.deepEqual(Array.from(battle.part_segments, p => p.start), [0, 20, 40, 60]);
    assert.equal(battle.verses[3].timed_lines[1].end_sec, 80);
    assert.equal(closed, true);
  } finally { URL.revokeObjectURL(result.audioUrl); }
});

test('missing lyric alignment fails rather than guessing; decoded context is closed', async () => {
  let closed = false;
  const context = setup({ fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
    AudioContext: class {
      async decodeAudioData() { return {}; }
      async close() { closed = true; }
    }
  });
  await assert.rejects(context.DOPANEWS.composeBattleParts({}, [{ index: 0, audioUrl: 'x', verse: { lyric: '歌詞' } }]), /全歌詞/);
  assert.equal(closed, true);
});

test('part generation makes four single-voice requests and stops on a failed part', async () => {
  const calls = [];
  const context = setup({ setTimeout: fn => fn(), fetch: async (url, options) => {
    if (url.endsWith('/generate')) { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 'task' }) }; }
    return { ok: true, json: async () => ({ status: 'succeeded', choices: [{ url: 'https://cdn.mureka.ai/part.mp3', lyrics_sections: [] }] }) };
  } });
  vm.runInContext(source('api.js'), context);
  context.DOPANEWS.composeBattleParts = async (_, parts) => parts;
  const parts = await context.DOPANEWS.generatePartBattleWithMureka(context.DOPANEWS.PRESET_BATTLE_DATA);
  assert.equal(parts.length, 4);
  assert.equal(calls.length, 4);
  assert.match(calls[0].prompt, /solo male voice only/);
  assert.match(calls[1].prompt, /solo female voice only/);
  assert.match(calls[0].prompt, /96 BPM/);
  assert.doesNotMatch(calls[0].lyrics, /古い価値観/);
  let attempted = 0;
  context.fetch = async () => { attempted++; return { ok: false, status: 500, text: async () => 'failed' }; };
  await assert.rejects(context.DOPANEWS.generatePartBattleWithMureka(context.DOPANEWS.PRESET_BATTLE_DATA), /Generate/);
  assert.equal(attempted, 1);
});
