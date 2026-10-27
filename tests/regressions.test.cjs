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
  ready();
  const app = context.dopaNewsApp;
  app.audioController._ensureAudioContext = () => {};
  return { app, data: context.DOPANEWS, get: id => elements.get(id),
    tick(seconds) { now += seconds * 1000; for (const fn of [...intervals.values()]) fn(); } };
}

for (const mode of ['full', 'gemini-only']) {
  test(`${mode}: stop previous playback, block switching, restore controls, then reflect on correct script`, async () => {
    const { app, data, get } = setup();
    get('input-gemini-key').value = 'dummy'; get('input-suno-key').value = 'dummy';
    await app.audioController.loadAndPlayUrl('old.mp3');
    app.judgeModal.open(app.currentBattleData);
    let release;
    data.generateBattleScriptWithGemini = () => new Promise(resolve => { release = resolve; });
    data.generateBattleTrackWithMureka = async () => ({ audioUrl: 'new.mp3' });
    const pending = mode === 'full' ? app.handleFullBattleGeneration() : app.handleGeminiOnlyGeneration();
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
      assert.equal(get('battle-audio').src, 'new.mp3');
      get('battle-audio').paused = true; get('battle-audio').emit('ended');
    } else app.audioController.onEnded();
    assert.equal(get('judge-battle-title').textContent, 'NEW SCRIPT');
    assert.equal(get('judge-kenta-stance').textContent, 'new stance');
  });
}

test('generation failure unlocks controls without reviving the old audio', async () => {
  const { app, data, get } = setup();
  get('input-gemini-key').value = 'dummy';
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
  data.applyMurekaTimestamps(battle, { lyrics_sections: battle.verses.map((_, index) => ({
    start: index ? index * 20000 : 400, end: (index + 1) * 20000,
    lines: [0, 400, 500, 501].map(start => ({ text: 'line', start, end: start + 100 }))
  })) });
  assert.equal(battle.verses[0].start_time_sec, 0.4);
  assert.equal(battle.verses[1].start_time_sec, 20);
  assert.deepEqual(battle.verses[0].timed_lines.map(line => line.start_sec), [0, 0.4, 0.5, 0.501]);
  const flatBattle = JSON.parse(JSON.stringify(data.PRESET_BATTLE_DATA));
  data.applyMurekaTimestamps(flatBattle, { lyrics_sections: [{ lines:
    [400, 500, 501, 20000].map(start => ({ text: 'line', start })) }] });
  assert.equal(flatBattle.verses[0].start_time_sec, 0.4);
  assert.equal(flatBattle.verses[0].end_time_sec, 2.9);
  assert.equal(flatBattle.verses[3].start_time_sec, 20);
});
