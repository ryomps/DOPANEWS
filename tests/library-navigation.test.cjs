const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('shared saved-track navigation hides Library and returns to it after playback', () => {
  let ready;
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set(); const handlers = {};
      elements.set(id, { hidden: false, attrs: {}, scrollTop: 0,
        classList: { add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)), contains: n => classes.has(n) },
        setAttribute(name, value) { this.attrs[name] = value; },
        querySelector(selector) { return element(id + selector); },
        append() {},
        addEventListener(name, fn) { (handlers[name] ??= []).push(fn); },
        click() { for (const fn of handlers.click || []) fn(); }, replaceChildren() {}
      });
    }
    return elements.get(id);
  };
  const D = { readBattleVotes: () => [], newsRepository: { list: async () => [] }, listSavedBattles: () => new Promise(() => {}) };
  const context = { DOPANEWS: D, dopaNewsApp: { isGenerating: false, audioController: { pause() {} }, judgeModal: { close() {} } },
    location: { hash: '' }, document: { body: element('body'), getElementById: element, querySelector: element },
    addEventListener: (name, fn) => { if (name === 'DOMContentLoaded') ready = fn; }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/library.js'), 'utf8'), context);
  ready();
  context.document.body.classList.add('news-mode', 'library-mode');
  D.libraryNavigation.openBattle();
  assert.equal(element('library-screen').hidden, true);
  assert.equal(context.document.body.classList.contains('library-mode'), false);
  assert.equal(context.document.body.classList.contains('news-mode'), false);
  assert.equal(element('return-to-news').hidden, false);
  element('return-to-news').click();
  assert.equal(element('library-screen').hidden, false);
  assert.equal(context.document.body.classList.contains('library-mode'), true);
});
