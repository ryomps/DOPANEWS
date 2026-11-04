const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { Float32Array, window: { DOPANEWS: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/api.js'), 'utf8'), context);
const fit = context.window.DOPANEWS.fitVocalWithoutPitchShift;
function dominantFrequency(samples, rate) {
  let best = 0, energy = -Infinity;
  const start = Math.round(rate * 0.1), end = Math.min(samples.length - start, start + rate);
  for (let hz = 80; hz <= 600; hz++) {
    let a = 0, b = 0;
    for (let i = start; i < end; i++) { a += samples[i] * Math.cos(2 * Math.PI * hz * i / rate); b += samples[i] * Math.sin(2 * Math.PI * hz * i / rate); }
    if (a * a + b * b > energy) { energy = a * a + b * b; best = hz; }
  }
  return best;
}
test('compressing male and female vocal pitches keeps the original frequency and exact bar duration', () => {
  const rate = 22050, target = Math.floor((60 / 115) * 4 * 0.96 * rate);
  for (const hz of [130, 240]) for (const ratio of [1.3, 2, 3]) {
    const input = Float32Array.from({ length: Math.round(target * ratio) }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * i / rate) + 0.15 * Math.sin(4 * Math.PI * hz * i / rate));
    const output = fit(input, target, rate);
    assert.equal(output.length, target);
    assert.ok(Math.abs(dominantFrequency(output, rate) - hz) <= 2, `pitch ${hz}, compression ${ratio}`);
    assert.ok(output.every(Number.isFinite));
  }
});
test('silence and short clips remain finite and input samples are not modified', () => {
  assert.ok(fit(new Float32Array(8000), 4000, 22050).every(x => x === 0));
  const input = new Float32Array([0.1, 0.2, 0.3]);
  assert.deepEqual(Array.from(fit(input, 100, 22050)), Array.from(input));
  assert.equal(input.length, 3);
  assert.throws(() => fit(input, 0, 22050));
});

test('fixed-beat mixing retains all 32 lyric slots and alternating MCs with pitch-preserving vocal fitting', async () => {
  const pcm = Buffer.alloc(24000 * 20 * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 160 * i / 24000)), i * 2);
  let requests = 0;
  const env = { Float32Array, Uint8Array, DataView, Blob, URL, atob, btoa,
    fetch: async () => { requests++; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString('base64') } }] } }] }) }; }
  };
  env.window = env;
  vm.createContext(env);
  for (const file of ['types.js', 'api.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), env);
  const D = env.DOPANEWS;
  const battle = D.normalizeBattleData({ title: '音声検証', verses: Array.from({ length: 4 }, (_, index) => ({ speaker: index % 2 ? 'REINA' : 'KENTA', lyric: Array(8).fill('表示歌詞').join('\n'), lyric_reading: Array(8).fill('ひょうじかし').join('\n') })) });
  const result = await D.synthesizeBattleOnFixedBeat(battle, null);
  try {
    assert.equal(requests, 4, 'one TTS request per verse, no regeneration');
    assert.equal(result.murekaTrack.vocal_time_fit, 'wsola-pitch-preserving-v1');
    assert.equal(battle.mureka_timeline.length, 32);
    assert.deepEqual(Array.from(battle.verses, verse => verse.speaker), ['KENTA', 'REINA', 'KENTA', 'REINA']);
    for (let i = 0; i < 32; i++) {
      const line = battle.mureka_timeline[i];
      assert.ok(Math.abs(line.start_sec - ((2 + i) * 60 / 115 * 4)) < 0.002);
    }
    assert.ok(Math.abs(result.durationSec - 35 * 60 / 115 * 4) < 0.001);
  } finally { URL.revokeObjectURL(result.audioUrl); }
});
