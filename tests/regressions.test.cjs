const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

// Run the real application components with browser media/DOM boundaries simulated.
function setup() {
  const elements = new Map();
  let ready;
  let now = 0;
  const intervals = new Map();
  let nextInterval = 0;
  let context;
  function element(id = '') {
    const classes = new Set(id === 'judge-modal-overlay' ? ['hidden'] : []);
    return {
      id, value: '', textContent: '', children: [], handlers: {}, attrs: {},
      style: {}, dataset: {}, paused: true, currentTime: 0, duration: 90,
      classList: {
        contains: key => classes.has(key), add: key => classes.add(key),
        remove: key => classes.delete(key),
        toggle(key, on = !classes.has(key)) { on ? classes.add(key) : classes.delete(key); }
      },
      addEventListener(key, fn) { (this.handlers[key] ??= []).push(fn); },
      emit(key, event = {}) { for (const fn of this.handlers[key] || []) fn(event); },
      setAttribute(key, value) { this.attrs[key] = value; },
      getAttribute(key) { return key === 'src' ? this.src : this.attrs[key]; },
      removeAttribute(key) { delete this.attrs[key]; if (key === 'src') this.src = ''; },
      focus() { context.document.activeElement = this; },
      appendChild(child) { this.children.push(child); },
      querySelector() { return card; },
      querySelectorAll(selector) { return selector === '.verse-pill' ? this.children : []; },
      getContext() { return null; }, getClientRects() { return [1]; },
      load() { this.currentTime = 0; },
      pause() { this.paused = true; this.emit('pause'); },
      async play() { this.paused = false; this.emit('play'); }
    };
  }
  for (const match of fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/id="([^"]+)"/g)) {
    elements.set(match[1], element(match[1]));
  }
  const card = element('card');
  context = {
    console, URL, Uint8Array, performance: { now: () => now }, requestAnimationFrame: () => 0,
    setInterval(fn) { intervals.set(++nextInterval, fn); return nextInterval; },
    clearInterval: id => intervals.delete(id), setTimeout: () => 0,
    localStorage: { getItem: () => '', setItem() {} },
    document: { activeElement: card, getElementById: id => elements.get(id), createElement: () => element() },
    addEventListener(event, fn) { if (event === 'DOMContentLoaded') ready = fn; }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['js/types.js', 'js/audioController.js', 'js/components/StageView.js',
    'js/components/JudgeModal.js', 'js/app.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  const savedRecords = [];
  context.DOPANEWS.getLocalConfig = async () => ({ geminiConfigured: true, murekaConfigured: true, reviewSupported: true });
  context.DOPANEWS.listSavedBattles = async () => ({ items: savedRecords });
  context.DOPANEWS.reviewBattle = async input => ({ stage: input.stage, verdict: 'pass', summary: '指摘なし', issues: [] });
  context.DOPANEWS.saveBattle = async record => {
    const saved = JSON.parse(JSON.stringify({ ...record, id: 'saved-test', createdAt: new Date().toISOString(),
      audioUrl: record.audioUrl ? '/api/library/saved-test/audio' : null }));
    savedRecords.push(saved); return saved;
  };
  ready();
  const app = context.dopaNewsApp;
  app.audioController._ensureAudioContext = () => {};
  return { app, savedRecords, data: context.DOPANEWS, get: id => elements.get(id),
    tick(seconds) { now += seconds * 1000; for (const fn of [...intervals.values()]) fn(); } };
}

for (const mode of ['full', 'gemini-only']) {
  test(`${mode}: stop previous playback, block switching, restore controls, then reflect on correct script`, async () => {
    const { app, data, get } = setup();
    await app.audioController.loadAndPlayUrl('old.mp3');
    app.judgeModal.open(app.currentBattleData);
    let release;
    data.generateBattleScriptWithGemini = () => new Promise(resolve => { release = resolve; });
    data.generateBattleTrackWithMureka = async () => ({ audioUrl: 'new.mp3' });
    const pending = mode === 'full' ? app.handleFullBattleGeneration() : app.handleGeminiOnlyGeneration();
    while (!release) await Promise.resolve();
    assert.equal(get('battle-audio').paused, true);
    assert.equal(get('battle-audio').src, '');
    assert.equal(get('judge-modal-overlay').classList.contains('hidden'), true);
    for (const id of ['btn-start-battle', 'btn-gemini-only', 'btn-load-preset', 'input-local-mp3', 'btn-play-pause', 'btn-open-judge']) {
      assert.equal(get(id).disabled, true, id);
    }
    get('btn-load-preset').emit('click'); get('btn-play-pause').emit('click');
    get('btn-open-judge').emit('click'); get('battle-audio').emit('ended');
    assert.equal(app.audioController.synthPlaying, false);
    assert.equal(get('judge-modal-overlay').classList.contains('hidden'), true);
    await Promise.resolve();
    const next = JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
    next.title = 'NEW SCRIPT'; next.kenta_stance = 'new stance';
    release(next); await pending;
    assert.equal(app.isGenerating, false);
    assert.equal(get('btn-load-preset').disabled, false);
    if (mode === 'full') {
      assert.equal(get('battle-audio').src, '/api/library/saved-test/audio');
      get('battle-audio').paused = true; get('battle-audio').emit('ended');
    } else app.audioController.onEnded();
    assert.equal(get('judge-battle-title').textContent, 'NEW SCRIPT');
    assert.equal(get('judge-kenta-stance').textContent, 'new stance');
  });
}

test('generation failure unlocks controls without reviving the old audio', async () => {
  const { app, data, get } = setup();
  await app.audioController.loadAndPlayUrl('old.mp3');
  data.generateBattleScriptWithGemini = async () => { throw new Error('simulated failure'); };
  await app.handleGeminiOnlyGeneration();
  assert.equal(app.isGenerating, false);
  assert.equal(get('btn-play-pause').disabled, false);
  assert.equal(get('battle-audio').src, '');
});

test('preset switch stops real audio and closes reflection; synth completion opens it again', async () => {
  const { app, get, tick } = setup();
  await app.audioController.loadAndPlayUrl('old.mp3');
  app.judgeModal.open(app.currentBattleData);
  get('btn-load-preset').emit('click');
  assert.equal(get('battle-audio').src, '');
  assert.equal(get('judge-modal-overlay').classList.contains('hidden'), true);
  tick(45);
  assert.equal(get('judge-modal-overlay').classList.contains('hidden'), false);
  get('btn-replay-battle').emit('click');
  assert.equal(app.audioController.synthPlaying, true);
});

test('reflection survives style/timing changes but different lyrics have their own state', () => {
  const { app, data, get } = setup();
  const battle = JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
  app.judgeModal.open(battle);
  get('btn-vote-kenta').emit('click');
  get('reflection-note').value = 'my reason'; get('reflection-note').emit('input');
  app.judgeModal.close();
  battle.suno_style = 'new style'; battle.verses[0].start_time_sec = 0.4;
  battle.verses[0].synced_from_mureka = true; battle.verses[0].timed_lines = [];
  app.judgeModal.open(JSON.parse(JSON.stringify(battle)));
  assert.equal(get('btn-vote-kenta').attrs['aria-pressed'], 'true');
  assert.equal(get('reflection-note').value, 'my reason');
  get('btn-reflect-undecided').emit('click');
  assert.equal(get('btn-vote-kenta').attrs['aria-pressed'], 'false');
  assert.equal(get('btn-reflect-undecided').attrs['aria-pressed'], 'true');
  battle.verses[0].lyric += ' changed'; app.judgeModal.open(battle);
  assert.equal(get('reflection-note').value, '');
  assert.equal(get('reflection-panel').classList.contains('hidden'), true);
});

test('Mureka milliseconds convert consistently at 0, 400, 500, 501 and later timestamps', () => {
  const { data } = setup();
  const battle = JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
  const times = [0, 400, 500, 501, 20000];
  data.applyMurekaTimestamps(battle, { lyrics_sections: [{ section_type: 'verse', lines:
    times.map((start, index) => ({ text: battle.verses[index % 4].lyric.split('\n')[0], start, end: start + 100 }))
  }] });
  assert.deepEqual(Array.from(battle.mureka_timeline, line => line.start_sec), [0, 0.4, 0.5, 0.501, 20]);
  assert.equal(battle.verses[0].start_time_sec, 0);
  assert.equal(battle.verses[0].end_time_sec, 20.1);
});

test('MC follows lyric content across merged sections, unequal lengths and repeated verses', () => {
  const { app, data, get } = setup();
  const battle = JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
  const row = (verse, start, end) => ({ text: battle.verses[verse].lyric.split('\n')[0], start, end });
  data.applyMurekaTimestamps(battle, { lyrics_sections: [{ section_type: 'verse', lines: [
    row(0, 400, 3000), row(0, 3500, 6000), row(1, 7000, 8000),
    row(2, 9000, 11000), row(3, 12000, 14000), row(0, 15000, 17000)
  ] }] });
  app._applyBattleData(battle);
  for (const [time, expected] of [[1, 'KENTA'], [7.5, 'REINA'], [10, 'KENTA'], [13, 'REINA'], [16, 'KENTA']]) {
    app.stageView.syncTime(time, 20);
    assert.equal(get('battle-stage').attrs['data-active-mc'], expected);
  }
  app.stageView.syncTime(6.5, 20);
  assert.equal(get('battle-stage').attrs['data-active-mc'], 'NONE');
  assert.equal(battle.mureka_sync.status, 'matched');
});

test('unknown, shared lyrics, overlapping speakers and missing timings do not guess an MC', () => {
  const { app, data, get } = setup();
  const battle = JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
  battle.verses[0].lyric += '\n同じサビを歌おう';
  battle.verses[1].lyric += '\n同じサビを歌おう';
  data.applyMurekaTimestamps(battle, { lyrics_sections: [
    { section_type: 'intro', lines: [{ text: battle.verses[1].lyric.split('\n')[0], start: 1000, end: 2000 }] },
    { section_type: 'verse', lines: [
      { text: '同じサビを歌おう', start: 3000, end: 4000 },
      { text: 'まったく別の歌詞', start: 5000, end: 6000 },
      ...[0, 1].map(index => ({ text: battle.verses[index].lyric.split('\n')[0], start: 7000, end: 8000 }))
    ] }
  ] });
  app._applyBattleData(battle);
  app.stageView.syncTime(1.5, 20);
  assert.equal(get('battle-stage').attrs['data-active-mc'], 'REINA');
  for (const time of [3.5, 5.5, 7.5]) {
    app.stageView.syncTime(time, 20);
    assert.equal(get('battle-stage').attrs['data-active-mc'], 'NONE');
  }
  assert.equal(battle.mureka_sync.status, 'partial');
  data.applyMurekaTimestamps(battle, {});
  app._applyBattleData(battle); app.stageView.syncTime(12, 20);
  assert.equal(get('battle-stage').attrs['data-active-mc'], 'NONE');
  assert.equal(battle.mureka_sync.status, 'unavailable');
});

test('line splitting and punctuation normalization match the original script without section assumptions', () => {
  const { data } = setup();
  const battle = JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
  const line = battle.verses[1].lyric.split('\n')[0];
  data.applyMurekaTimestamps(battle, { lyrics_sections: [{ lines: [
    { text: line.slice(0, 14), start: 400, end: 2000 },
    { text: line.slice(14) + '！！', start: 2100, end: 4000 }
  ] }] });
  assert.deepEqual(Array.from(battle.mureka_timeline, line => line.verse_index), [1, 1]);
  assert.equal(battle.verses[1].start_time_sec, 0.4);
});


test('Mureka waits for the completed response with timings instead of returning a streaming track', async () => {
  const { data } = setup();
  const battle = JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
  let polls = 0;
  const context = {
    window: null, location: { protocol: 'http:', port: '8080' },
    DOPANEWS: data, setTimeout: resolve => resolve(),
    fetch: async (url, options) => {
      if (url.endsWith('/generate')) {
        const payload = JSON.parse(options.body);
        assert.equal(payload.model, 'mureka-9');
        assert.equal(payload.n, 1);
        return { ok: true, json: async () => ({ id: 'test-task' }) };
      }
      polls++;
      return { ok: true, json: async () => polls === 1
        ? { status: 'streaming', choices: [{ stream_url: 'stream.mp3' }] }
        : { status: 'succeeded', choices: [{ url: 'complete.mp3', lyrics_sections: [{ lines: [
          { text: battle.verses[1].lyric.split('\n')[0], start: 1000, end: 2000 }
        ] }] }] } };
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/api.js'), 'utf8'), context);
  const result = await data.generateBattleTrackWithMureka(battle);
  assert.equal(polls, 2);
  assert.equal(result.audioUrl, 'complete.mp3');
  assert.equal(battle.mureka_timeline[0].verse_index, 1);
  assert.equal(battle.mureka_sync.matched_lines, 1);
});


test('saved battle restores article, timed script, audio and supports pause/resume without rewinding', async () => {
  const { app, get, data, savedRecords } = setup();
  const battle = JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
  battle.title = 'saved example'; battle.mureka_timeline = []; battle.mureka_sync = { status: 'unavailable' };
  app._applyBattleData(battle); app.articleInputEl.value = 'original article'; app.currentArticleText = 'original article';
  app.currentAudioUrl = 'https://cdn.mureka.ai/example.mp3';
  await app._saveCurrentBattle();
  assert.equal(savedRecords.length, 1);
  await app._saveCurrentBattle();
  assert.equal(savedRecords.length, 1, 'do not duplicate the same saved item');
  const saved = JSON.parse(JSON.stringify(savedRecords[0]));
  app.articleInputEl.value = 'different article';
  await app._playSavedBattle(saved);
  assert.equal(app.articleInputEl.value, 'original article');
  assert.equal(app.currentBattleData.title, 'saved example');
  const audio = get('battle-audio'); audio.currentTime = 12;
  get('btn-play-pause').emit('click'); assert.equal(audio.paused, true);
  get('btn-play-pause').emit('click'); await Promise.resolve();
  assert.equal(audio.paused, false); assert.equal(audio.currentTime, 12);
});

test('synth pause and resume retain the playback position; real audio errors never replace it with a beat', async () => {
  const { app, get, tick } = setup();
  app.audioController.startSynthBattle(45); tick(10);
  get('btn-play-pause').emit('click');
  assert.equal(app.audioController.synthPausedAt, 10);
  tick(5); get('btn-play-pause').emit('click'); tick(1);
  assert.equal(app.audioController.synthPlaying, true);
  assert.match(get('stage-timer').textContent, /00:11/);
  await app.audioController.loadAndPlayUrl('saved.mp3');
  const audio = get('battle-audio'); audio.pause();
  audio.play = async () => { throw new Error('invalid audio'); };
  get('btn-play-pause').emit('click'); await Promise.resolve(); await Promise.resolve();
  assert.equal(app.audioController.usingSynthFallback, false);
  assert.match(get('generation-status-log').textContent, /音声を再生できません/);
});

test('failed autosave retains remote playback and allows retry', async () => {
  const { app, data, savedRecords } = setup();
  const save = data.saveBattle;
  app.currentAudioUrl = 'https://cdn.mureka.ai/retry.mp3';
  data.saveBattle = async () => { throw new Error('disk full'); };
  await app._autoSaveBattle();
  assert.equal(app.currentSavedId, null);
  assert.equal(app.currentAudioUrl, 'https://cdn.mureka.ai/retry.mp3');
  data.saveBattle = save; await app._saveCurrentBattle();
  assert.equal(savedRecords.length, 1);
});


function pronunciationFixture(data) {
  return data.normalizeBattleData({ title: '読み方のテスト', verses: [
    { speaker: 'KENTA', lyric: '施策を実行\n1日10時間の現場', lyric_reading: 'しさくをじっこう\nいちにちじゅうじかんのげんば' },
    { speaker: 'REINA', lyric: '生産性を高めよう\nAIで仕事を変えよう', lyric_reading: 'せいさんせいをたかめよう\nエーアイでしごとをかえよう' },
    { speaker: 'KENTA', lyric: '日本銀行の判断\n人手不足を見逃すな', lyric_reading: 'にほんぎんこうのはんだん\nひとでぶそくをみのがすな' },
    { speaker: 'REINA', lyric: '地方移住の選択肢\n未来を選ぶ自由', lyric_reading: 'ちほういじゅうのせんたくし\nみらいをえらぶじゆう' }
  ] });
}

test('Mureka receives readings only while saved/display lyrics retain kanji, numbers and abbreviations', () => {
  const { data, app, get } = setup();
  const battle = pronunciationFixture(data);
  data.validateBattleReadings(battle);
  const prompt = data.buildMurekaPrompt(battle);
  assert.match(prompt, /しさくをじっこう/);
  assert.match(prompt, /いちにちじゅうじかん/);
  assert.match(prompt, /エーアイ/);
  assert.doesNotMatch(prompt, /施策|1日10時間|AIで/);
  app._applyBattleData(battle);
  assert.match(get('stage-lyric-box').innerHTML, /施策を実行/);
  assert.doesNotMatch(get('stage-lyric-box').innerHTML, /しさくをじっこう/);
  assert.match(battle.verses[0].lyric, /施策/);
  const legacy = data.normalizeBattleData({ verses: [{ lyric: '既存の保存歌詞' }] });
  assert.match(data.buildMurekaPrompt(legacy), /既存の保存歌詞/);
});

test('kana timestamps align with original display lines across split and merged returned lines', () => {
  const { data, app, get } = setup();
  const battle = pronunciationFixture(data);
  data.applyMurekaTimestamps(battle, { lyrics_sections: [{ lines: [
    { text: 'しさくをじっこう いちにちじゅうじかんのげんば', start: 400, end: 3000 },
    { text: 'せいさんせいを', start: 4000, end: 5000 },
    { text: 'たかめよう', start: 5000, end: 6000 },
    { text: 'えーあいでしごとをかえよう', start: 6100, end: 8000 }
  ] }] });
  assert.deepEqual(Array.from(battle.mureka_timeline, line => line.verse_index), [0, 1, 1, 1]);
  assert.deepEqual(Array.from(battle.mureka_timeline[0].line_indices), [0, 1]);
  assert.deepEqual(Array.from(battle.mureka_timeline[2].line_indices), [0]);
  assert.deepEqual(Array.from(battle.mureka_timeline[3].line_indices), [1]);
  app._applyBattleData(battle);
  const active = new Set();
  const lineElements = [0, 1].map(index => ({ classList: { toggle(name, on) {
    if (name === 'line-active') on ? active.add(index) : active.delete(index);
  } } }));
  get('stage-lyric-box').querySelectorAll = () => lineElements;
  app.stageView.syncTime(1, 10);
  assert.deepEqual([...active], [0, 1]);
  app.stageView.syncTime(5.5, 10);
  assert.equal(get('battle-stage').attrs['data-active-mc'], 'REINA');
  assert.deepEqual([...active], [0]);
  assert.match(get('stage-lyric-box').innerHTML, /生産性を高めよう/);
  assert.doesNotMatch(get('stage-lyric-box').innerHTML, /せいさんせい/);
  app.stageView.syncTime(7, 10);
  assert.deepEqual([...active], [1]);
});

test('missing, ruby-annotated or misaligned readings are rejected before music generation', () => {
  const { data } = setup();
  for (const invalid of [null, 'しさくをじっこう', '施策（しさく）を実行\nげんば', 'しさくをじっこう\nAIでかいけつ', 'しさくをじっこう\n\nげんば']) {
    const battle = pronunciationFixture(data);
    battle.verses[0].lyric_reading = invalid;
    assert.throws(() => data.validateBattleReadings(battle), /音声用かな歌詞が不正/);
  }
});

test('Gemini pronunciation output flows into the Mureka 9 payload without an extra API request', async () => {
  const { data } = setup();
  const fixture = pronunciationFixture(data);
  const calls = [];
  const context = { window: null, DOPANEWS: data, setTimeout: resolve => resolve(),
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.startsWith('/api/gemini/')) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(fixture) }] } }] }) };
      if (url.endsWith('/generate')) return { ok: true, json: async () => ({ id: 'test-task' }) };
      return { ok: true, json: async () => ({ status: 'succeeded', choices: [{ url: 'test.mp3', lyrics_sections: [] }] }) };
    }
  };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/api.js'), 'utf8'), context);
  const battle = await data.generateBattleScriptWithGemini('読み方を確かめるニュース記事の本文を入力するテストです。');
  await data.generateBattleTrackWithMureka(battle);
  assert.equal(calls.filter(call => call.url.startsWith('/api/gemini/')).length, 1);
  assert.match(JSON.parse(calls[0].options.body).contents[0].parts[0].text, /lyric_reading/);
  const payload = JSON.parse(calls.find(call => call.url.endsWith('/generate')).options.body);
  assert.equal(payload.model, 'mureka-9');
  assert.match(payload.lyrics, /しさくをじっこう/);
  assert.doesNotMatch(payload.lyrics, /施策/);
  assert.equal(battle.verses[0].lyric, fixture.verses[0].lyric);
  context.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ verses: [{ lyric: '読みが欠けている歌詞' }] }) }] } }] }) });
  await assert.rejects(data.generateBattleScriptWithGemini('読み方のない応答を返すニュース記事本文のテストです。'), /音声用かな歌詞が不正/);
});


const flaggedReview = stage => ({ stage, verdict: 'needs_revision', summary: '元記事と数値が異なります',
  issues: [{ kind: 'contradiction', quote: '全員の給料が半分', reason: '断定の根拠がありません', source_quote: '', suggestion: '懸念として表現する' }] });

test('script issues stop before Mureka; dismiss never retries or generates audio', async () => {
  const { app, data, get } = setup();
  let lyrics = 0, music = 0, reviews = 0;
  data.generateBattleScriptWithGemini = async () => { lyrics++; return data.PRESET_BATTLE_DATA; };
  data.generateBattleTrackWithMureka = async () => { music++; return { audioUrl: 'song.mp3' }; };
  data.reviewBattle = async () => { reviews++; return flaggedReview('script'); };
  await app.handleFullBattleGeneration();
  assert.equal(lyrics, 1); assert.equal(music, 0); assert.equal(reviews, 1);
  assert.equal(app.reviewState.status, 'needs_revision');
  assert.equal(get('btn-review-regenerate').hidden, false);
  get('btn-review-dismiss').emit('click'); await Promise.resolve();
  assert.equal(get('btn-review-regenerate').hidden, true);
  assert.equal(lyrics, 1); assert.equal(music, 0);
});

test('manual regeneration sends feedback and the original article; each click makes only one attempt', async () => {
  const { app, data } = setup();
  let lyrics = 0, music = 0, reviews = 0;
  const source = app.articleInputEl.value;
  data.generateBattleScriptWithGemini = async (article, progress, feedback) => {
    lyrics++;
    if (lyrics === 2) { assert.equal(article, source); assert.equal(feedback.verdict, 'needs_revision'); }
    return JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
  };
  data.generateBattleTrackWithMureka = async () => { music++; return { audioUrl: 'song.mp3' }; };
  data.reviewBattle = async input => { reviews++; return reviews === 1 ? flaggedReview('script') : { stage: input.stage, verdict: 'pass', summary: '確認完了', issues: [] }; };
  await app.handleFullBattleGeneration(); assert.equal(music, 0);
  app.articleInputEl.value = '別の入力';
  await app._regenerateReviewedBattle(); await app.audioReviewPromise;
  assert.equal(lyrics, 2); assert.equal(music, 1);
  assert.equal(app.reviewState.stage, 'audio'); assert.equal(app.reviewState.status, 'pass');
});

test('failed review stops generation; passing recheck automatically generates audio without regenerating lyrics', async () => {
  const { app, data } = setup();
  let lyrics = 0, music = 0;
  data.generateBattleScriptWithGemini = async () => { lyrics++; return data.PRESET_BATTLE_DATA; };
  data.generateBattleTrackWithMureka = async () => { music++; return { audioUrl: 'song.mp3' }; };
  data.reviewBattle = async () => { throw new Error('connection failed'); };
  await app.handleFullBattleGeneration();
  assert.equal(app.reviewState.status, 'error'); assert.equal(music, 0);
  data.reviewBattle = async input => ({ stage: input.stage, verdict: 'pass', summary: '確認完了', issues: [] });
  await app._recheckReview(); await app.audioReviewPromise;
  assert.equal(lyrics, 1); assert.equal(music, 1);
});

test('audio review runs in background without regenerating and late results cannot overwrite another battle', async () => {
  const { app, data, get } = setup();
  let music = 0, finish;
  data.generateBattleScriptWithGemini = async () => data.PRESET_BATTLE_DATA;
  data.generateBattleTrackWithMureka = async () => { music++; return { audioUrl: 'song.mp3' }; };
  data.reviewBattle = async input => input.stage === 'script'
    ? { stage: 'script', verdict: 'pass', summary: '確認完了', issues: [] }
    : new Promise(resolve => { finish = resolve; });
  await app.handleFullBattleGeneration();
  assert.equal(app.isGenerating, false); assert.equal(app.reviewState.status, 'checking');
  assert.equal(get('battle-audio').paused, false); assert.equal(music, 1);
  const pending = app.audioReviewPromise;
  get('btn-load-preset').emit('click'); finish(flaggedReview('audio')); await pending;
  assert.equal(app.reviewState.status, 'idle'); assert.equal(music, 1);
});

test('audio issues remain a user choice and keep the generated recording available', async () => {
  const { app, data, get } = setup();
  let music = 0;
  data.generateBattleScriptWithGemini = async () => data.PRESET_BATTLE_DATA;
  data.generateBattleTrackWithMureka = async () => { music++; return { audioUrl: 'song.mp3' }; };
  data.reviewBattle = async input => input.stage === 'audio' ? flaggedReview('audio') : { stage: 'script', verdict: 'pass', summary: '確認完了', issues: [] };
  await app.handleFullBattleGeneration(); await app.audioReviewPromise;
  assert.equal(app.reviewState.status, 'needs_revision'); assert.equal(music, 1);
  assert.equal(get('battle-audio').src, '/api/library/saved-test/audio');
  assert.match(get('ai-review-cost').textContent, /GeminiとMureka/);
  get('btn-review-dismiss').emit('click'); await Promise.resolve(); assert.equal(music, 1);
});


test('outdated local server is detected before spending Gemini or Mureka credits', async () => {
  const { app, data, get } = setup();
  let calls = 0;
  data.getLocalConfig = async () => ({ geminiConfigured: true, murekaConfigured: true });
  data.generateBattleScriptWithGemini = async () => { calls++; };
  data.generateBattleTrackWithMureka = async () => { calls++; };
  await app.handleFullBattleGeneration(); await app.handleGeminiOnlyGeneration();
  assert.equal(calls, 0);
  assert.match(get('generation-status-log').textContent, /サーバー/);
  assert.match(get('api-config-status').textContent, /再起動/);
});

test('missing review route explains restart while missing audio keeps its own error', async () => {
  const { data } = setup();
  let detail = { error: 'Not found' };
  const context = { window: null, DOPANEWS: data, fetch: async () => ({ ok: false, status: 404, json: async () => detail }) };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/api.js'), 'utf8'), context);
  await assert.rejects(data.reviewBattle({ stage: 'script' }), /サーバーを再起動後.*審判だけ再確認/);
  detail = { error: '保存音源がありません', code: 'REVIEW_SOURCE_NOT_FOUND' };
  await assert.rejects(data.reviewBattle({ stage: 'audio' }), /保存音源がありません/);
});


test('a recheck with issues still stops before Mureka; audio rechecks never regenerate', async () => {
  const { app, data } = setup();
  let music = 0;
  data.generateBattleScriptWithGemini = async () => data.PRESET_BATTLE_DATA;
  data.generateBattleTrackWithMureka = async () => { music++; return { audioUrl: 'song.mp3' }; };
  data.reviewBattle = async () => flaggedReview('script');
  await app.handleFullBattleGeneration(); await app._recheckReview();
  assert.equal(music, 0); assert.equal(app.reviewState.status, 'needs_revision');
  data.reviewBattle = async input => ({ stage: input.stage, verdict: 'pass', summary: '指摘なし', issues: [] });
  await app._recheckReview(); await app.audioReviewPromise;
  assert.equal(music, 1);
  await app._recheckReview(); assert.equal(music, 1);
});

test('live stage follows the active speaker and freezes cheering when playback pauses', () => {
  const { app, get, tick } = setup();
  app.audioController.startSynthBattle(64);
  assert.equal(get('battle-stage').getAttribute('data-playing'), 'true');
  assert.equal(get('stage-kenta-stance').textContent, app.currentBattleData.kenta_stance);
  tick(17);
  assert.equal(get('battle-stage').getAttribute('data-active-mc'), 'REINA');
  assert.match(get('stage-speaking-status').textContent, /REINA が発言中/);
  get('btn-play-pause').emit('click');
  assert.equal(get('battle-stage').getAttribute('data-playing'), 'false');
  assert.match(get('stage-speaking-status').textContent, /一時停止中/);
  tick(10);
  assert.equal(get('battle-stage').getAttribute('data-active-mc'), 'REINA');
});

test('verse arrows seek without resuming paused playback and stop at the first and last verse', () => {
  const { app, get } = setup();
  app.audioController.startSynthBattle(64);
  get('btn-play-pause').emit('click');
  assert.equal(get('btn-prev-verse').disabled, true);
  get('btn-next-verse').emit('click');
  assert.equal(app.stageView.currentVerseIndex, 1);
  assert.equal(app.audioController.synthPausedAt, 16);
  assert.equal(app.audioController.synthPlaying, false);
  get('btn-next-verse').emit('click'); get('btn-next-verse').emit('click');
  assert.equal(app.stageView.currentVerseIndex, 3);
  assert.equal(get('btn-next-verse').disabled, true);
  get('btn-prev-verse').emit('click');
  assert.equal(app.audioController.synthPausedAt, 32);
  get('battle-seek').value = '5'; get('battle-seek').emit('input');
  assert.equal(app.stageView.currentVerseIndex, 0);
  assert.equal(app.audioController.synthPausedAt, 5);
  assert.equal(get('btn-prev-verse').disabled, true);
});

test('verse arrows skip unmatched Mureka sections and generation locks the new transport', () => {
  const { app, data, get } = setup();
  const battle = JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
  battle.mureka_sync = { status: 'partial' };
  battle.verses.forEach((v, i) => { v.synced_from_mureka = i === 0 || i === 2; v.start_time_sec = i * 10; });
  app._applyBattleData(battle);
  get('btn-next-verse').emit('click');
  assert.equal(app.stageView.currentVerseIndex, 2);
  assert.equal(get('btn-next-verse').disabled, true);
  app._setGenerating(true);
  assert.equal(get('btn-prev-verse').disabled, true);
  assert.equal(get('battle-seek').disabled, true);
  get('btn-prev-verse').emit('click');
  assert.equal(app.stageView.currentVerseIndex, 2);
  app._setGenerating(false);
  assert.equal(get('btn-prev-verse').disabled, false);
});

test('volume controls both media audio and the synth master gain, including mute', () => {
  const { app, get } = setup();
  const updates = [];
  app.audioController.audioCtx = { currentTime: 12 };
  app.audioController.masterGain = { gain: { setValueAtTime: (value, time) => updates.push([value, time]) } };
  get('battle-volume').value = '35'; get('battle-volume').emit('input');
  assert.equal(get('battle-audio').volume, .35);
  assert.equal(get('battle-volume-value').textContent, '35%');
  assert.deepEqual(updates.at(-1), [.35, 12]);
  get('battle-volume').value = '0'; get('battle-volume').emit('input');
  assert.equal(get('battle-audio').volume, 0);
  assert.deepEqual(updates.at(-1), [0, 12]);
  app.audioController.setVolume(2);
  assert.equal(get('battle-audio').volume, 1);
});


test('manual vocal alignment overrides returned timings without seeking and resets for the next battle', async () => {
  const { app, data, get } = setup();
  const battle = JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
  data.applyMurekaTimestamps(battle, { lyrics_sections: [] });
  app._applyBattleData(battle);
  await app.audioController.loadAndPlayUrl('manual.mp3');
  get('battle-audio').currentTime = 12;
  get('btn-sync-vocal-start').emit('click');
  const span = data.calcEightBarsDurationSec(data.extractBpmFromStyle(battle.suno_style));
  assert.equal(get('battle-audio').currentTime, 12);
  assert.equal(get('battle-audio').paused, false);
  assert.equal(app.stageView.getVerseWindows(180)[0].start, 12);
  assert.equal(app.stageView.getVerseWindows(180)[1].start, 12 + span);
  app.stageView.syncTime(12 + span + 0.1, 180);
  assert.equal(app.stageView.currentVerseIndex, 1);
  app._applyBattleData(JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA)));
  assert.equal(app.stageView.manualIntroOffsetSec, null);
});

test('normalized vocal tags keep male verses and female choruses with pronunciation readings', () => {
  const { data } = setup();
  const battle = data.normalizeBattleData({ verses: [
    { speaker: 'KENTA', lyric: '表示', lyric_reading: 'ひょうじ' },
    { speaker: 'REINA', section_tag: '[Verse 2: Female]', lyric: '表示', lyric_reading: 'ひょうじ' },
    { speaker: 'KENTA', lyric: '表示', lyric_reading: 'ひょうじ' },
    { speaker: 'REINA', lyric: '表示', lyric_reading: 'ひょうじ' }
  ] });
  assert.match(battle.verses[0].section_tag, /^\[Verse 1:/);
  assert.match(battle.verses[1].section_tag, /^\[Chorus 1:/);
  assert.match(battle.verses[2].section_tag, /^\[Verse 2:/);
  assert.match(battle.verses[3].section_tag, /^\[Chorus 2:/);
  assert.match(data.buildMurekaPrompt(battle), /ひょうじ/);
});


test('composed parts switch MC at exactly 20/40/60 seconds including lyric gaps and seeking backwards', () => {
  const { app, data, get } = setup();
  const battle = JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
  battle.part_segments = battle.verses.map((verse, i) => ({ speaker: verse.speaker, start: i * 20, end: (i + 1) * 20 }));
  battle.mureka_sync = { status: 'matched' };
  battle.verses.forEach((verse, i) => Object.assign(verse, { synced_from_mureka: true, start_time_sec: i * 20, end_time_sec: (i + 1) * 20, timed_lines: [{ start_sec: i * 20 + 2, end_sec: i * 20 + 10, line_indices: [0] }] }));
  app._applyBattleData(battle);
  for (const [time, index] of [[0,0],[19.99,0],[20,1],[39.99,1],[40,2],[60,3],[79.99,3],[5,0]]) {
    app.stageView.syncTime(time, 80);
    assert.equal(app.stageView.currentVerseIndex, index);
    assert.equal(get('battle-stage').attrs['data-active-mc'], battle.verses[index].speaker);
  }
  app.stageView.syncTime(80, 80);
  assert.equal(get('battle-stage').attrs['data-active-mc'], 'NONE');
});
