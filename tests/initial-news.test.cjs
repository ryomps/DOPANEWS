const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function setup() {
  const window = { addEventListener() {} };
  const context = vm.createContext({ window });
  for (const file of ['fixed-demo.js', 'initial-news.js', 'news-search.js', 'news.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context);
  }
  return window;
}
test('two prepared news articles lead the repository and are searchable by their topics', async () => {
  const w = setup(), D = w.DOPANEWS;
  const items = await D.newsRepository.list();
  assert.deepEqual(Array.from(items.slice(0, 2), a => a.id), ['sns-freedom', 'children-smartphone']);
  assert.equal(D.matchesNewsSearch(items[0], 'SNS 自由'), true);
  assert.equal(D.matchesNewsSearch(items[1], 'スマホ 子ども'), true);
  for (const a of items.slice(0,2)) {
    assert.ok(a.paragraphs.length >= 4);
    assert.ok(a.sources.every(s => s.url.startsWith('https://')));
    assert.doesNotMatch(a.title + a.summary + a.paragraphs.join(''), /デモ|デフォルト/);
  }
});
test('each news opens its own completed audio and preserves article context without generation', async () => {
  const w = setup(), D = w.DOPANEWS;
  const beforeVoice = JSON.stringify(D.FIXED_DEMO), beforeFood = JSON.stringify(D.FOOD_DEMO);
  const played = [];
  w.dopaNewsApp = { async handleFixedDemo(record) { played.push(record); } };
  for (const a of D.initialNewsArticles) assert.equal(await D.playNewsBattle(a), true);
  assert.equal(played[0].audioUrl, '/media/demos/voice-no-yukue.mp3');
  assert.equal(played[1].audioUrl, '/media/demos/food-boundary.mp3');
  assert.ok(played[0].articleText.startsWith(D.initialNewsArticles[0].title));
  assert.ok(played[1].articleText.includes(D.initialNewsArticles[1].sources[0].url));
  played[0].battleData.verses[0].lyric = 'edited';
  assert.equal(JSON.stringify(D.FIXED_DEMO), beforeVoice);
  assert.equal(JSON.stringify(D.FOOD_DEMO), beforeFood);
  assert.equal(await D.playNewsBattle({battleKey:'unknown'}), false);
});
