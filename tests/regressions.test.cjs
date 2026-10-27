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
  context.DOPANEWS.getLocalConfig = async () => ({ geminiConfigured: true, murekaConfigured: true });
  context.DOPANEWS.listSavedBattles = async () => ({ items: savedRecords });
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
