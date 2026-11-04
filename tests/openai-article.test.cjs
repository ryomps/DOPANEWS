const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArticleOutput, generateArticleData } = require('../openai-article.cjs');
const message = text => ({ type: 'message', content: [{ type: 'output_text', text }] });
const response = text => ({ status: 'completed', output: [message(text)] });

test('article output accepts a JSON object with optional BOM or complete code fence', () => {
  for (const text of ['{"facts":[]}', '\uFEFF {"facts":[]}', '```json\n{"facts":[]}\n```']) {
    assert.deepEqual(parseArticleOutput(response(text)).value, { facts: [] });
  }
});
test('article output rejects broken, multiple, refused or incomplete answers without repairing content', () => {
  const cases = ['{"facts":', '{}{}', '説明\n{}', 'null', '[]'].map(response);
  cases.push({ status: 'incomplete', output: [message('{}')] }, { status: 'completed', output: [message('{}'), message('{}')] }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] });
  for (const value of cases) assert.throws(() => parseArticleOutput(value), e => e.newsCode === 'NEWS_FORMAT');
});
test('malformed article output never triggers another paid request', async () => {
  let calls = 0;
  await assert.rejects(generateArticleData({ phase: 'facts', prompt: 'test', key: 'private-key', fetchImpl: async () => { calls++; return Response.json(response('{broken')); } }), e => e.newsCode === 'NEWS_FORMAT');
  assert.equal(calls, 1);
});
