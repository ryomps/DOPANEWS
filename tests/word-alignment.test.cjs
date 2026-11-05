const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { alignWords, transcribeWords, checkWords, normalize } = require('../word-alignment.cjs');
const expected = Array.from({ length: 16 }, (_, i) => `ニュースの事実と意見を確認する${i + 1}行目`);
const recording = () => ({ words: expected.map((word, i) => ({ word, start: 4 + i * 2.4, end: 6 + i * 2.4 })) });
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dopanews-words-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('dopanews-words-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { base: path.join(directory, 'source'), audio: Buffer.from('ID3audio'), key: 'private-key' };
}

test('all 16 lines use their actual words and timings, with unrelated intro ignored', () => {
  const raw = recording();
  raw.words.unshift({ word: 'イントロの掛け声', start: 0, end: 1 });
  const result = alignWords(expected, raw);
  assert.equal(result.lines.length, 16);
  for (let i = 0; i < 16; i++) {
    assert.equal(result.lines[i].id, i); assert.equal(result.lines[i].coverage, 1);
    assert.equal(result.lines[i].start, 4 + i * 2.4); assert.equal(result.lines[i].end, 6 + i * 2.4);
  }
});

test('missing eighth line and reordered lyrics stop instead of inventing a timestamp', () => {
  const lyrics = Array.from({ length: 16 }, (_, i) => String.fromCharCode(0x3041 + i).repeat(8));
  const raw = { words: lyrics.map((word, i) => ({ word, start: i * 2, end: i * 2 + 1 })) };
  raw.words.splice(7, 1);
  assert.throws(() => alignWords(lyrics, raw), /8行目/);
  raw.words = lyrics.map((word, i) => ({ word: lyrics[15 - i], start: i * 2, end: i * 2 + 1 }));
  assert.throws(() => alignWords(lyrics, raw), /確認できません/);
});

test('misrecognized phrase prefix retains its recognized audio onset', () => {
  const lyrics = [...expected]; lyrics[0] = '流行語大賞にノミネートのドパガキ';
  const raw = recording();
  raw.words.splice(0, 1, { word: '企業語対象', start: 3.5, end: 4.5 }, { word: 'にノミネートのドパガキ', start: 4.5, end: 6 });
  const result = alignWords(lyrics, raw);
  assert.equal(result.lines[0].start, 3.5);
  assert.equal(result.lines[0].end, 6);
});

test('invalid word order and instrumental-gap hallucinations cannot be accepted', () => {
  assert.throws(() => checkWords({ words: [{word:'a',start:2,end:3},{word:'b',start:1,end:4}] }), /時刻形式/);
  const raw = recording(); raw.words[7].end += 15;
  assert.throws(() => alignWords(expected, raw));
});

test('repeated final character never steals the next misrecognized phrase prefix', () => {
  const lyrics = [...expected];
  lyrics[0] = '無謀な運転を食い止めるための最後のライン';
  lyrics[1] = '罰金は授業料と捉えて正しく進化して';
  const raw = recording();
  raw.words.splice(0, 2, {word:lyrics[0],start:4,end:6},
    {word:'バッキン',start:6.4,end:6.8}, {word:'は授業料と捉えて正しく進化して',start:6.8,end:8.4});
  raw.segments = [{start:4,end:6},{start:6.4,end:8.4}];
  const result = alignWords(lyrics, raw);
  assert.equal(result.lines[0].end, 6);
  assert.equal(result.lines[1].start, 6.4);
});

test('phrase ending and misheard ナビ keep distinct boundaries', () => {
  const lyrics = [...expected];
  lyrics[0] = '事故が起きてからじゃ遅すぎるのよそのクール';
  lyrics[1] = 'ナビが必要なら止まって確認が基本中の基本';
  const raw = recording();
  raw.words.splice(0, 2, {word:'事故が起きてからじゃ遅すぎるのよその',start:4,end:5.6},
    {word:'ク',start:5.6,end:5.7},{word:'ル',start:5.7,end:5.8},{word:'ー',start:5.8,end:6},
    {word:'波',start:6.4,end:6.5},{word:'が必要なら止まって確認が基本中の基本',start:6.5,end:8.4});
  raw.segments = [{start:4,end:6},{start:6.4,end:8.4}];
  const result = alignWords(lyrics, raw);
  assert.equal(result.lines[0].end,6); assert.equal(result.lines[1].start,6.4);
});

test('Arabic numbers match kanji numbers split over several recognized words', () => {
  assert.equal(normalize('15000件'), normalize('一万五千件'));
  assert.equal(normalize('1.5倍'), normalize('一点五倍'));
  const lyrics = [...expected]; lyrics[0] = '半年で15000件の違反を確認しました';
  const raw = recording();
  raw.words.splice(0, 1, {word:'半年で',start:4,end:4.3},
    ...['一','万','五','千'].map((word,i)=>({word,start:4.3+i*.1,end:4.4+i*.1})),
    {word:'件の違反を確認しました',start:4.7,end:6});
  const result = alignWords(lyrics,raw);
  assert.equal(result.lines[0].coverage,1);
  assert.equal(result.lines[0].end,6);
});

test('transcription makes one multipart request, keeps keys in headers, and caches the response', async t => {
  const args = await setup(t); let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(options.headers.Authorization, 'Bearer private-key');
    assert.equal(options.body.get('model'), 'whisper-1');
    assert.equal(options.body.get('response_format'), 'verbose_json');
    assert.deepEqual(options.body.getAll('timestamp_granularities[]'), ['word', 'segment']);
    assert.equal(options.body.get('file').type, 'audio/mpeg');
    assert.equal(options.body.get('prompt'), null, 'do not seed lyrics that could be hallucinated');
    return Response.json(recording());
  };
  await transcribeWords({ ...args, fetchImpl });
  await transcribeWords({ ...args, fetchImpl });
  assert.equal(calls, 1);
});

test('unmatchable transcript remains cached, avoiding another paid transcription', async t => {
  const args = await setup(t); let calls = 0;
  const fetchImpl = async () => { calls++; return Response.json({ words: [{word:'無関係',start:2,end:3}] }); };
  const raw = await transcribeWords({ ...args, fetchImpl });
  assert.throws(() => alignWords(expected, raw));
  const again = await transcribeWords({ ...args, fetchImpl });
  assert.throws(() => alignWords(expected, again)); assert.equal(calls, 1);
});

test('uncertain transcription timeout blocks a duplicate upload after restart', async t => {
  const args = await setup(t); let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('timeout'); };
  await assert.rejects(transcribeWords({ ...args, fetchImpl }), /未確定/);
  await assert.rejects(transcribeWords({ ...args, fetchImpl }), /二重課金/);
  assert.equal(calls, 1);
});
