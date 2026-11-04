const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = {window:{}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/news-search.js'),'utf8'),context);
const matches = context.window.DOPANEWS.matchesNewsSearch;
test('search normalizes full-width characters, casing and Japanese whitespace',()=>{
  assert.equal(matches({title:'生成AIの教育活用'},'ＡＩ　教育'),true);
  assert.equal(matches({title:'AIの教育活用'},'ai'),true);
});
test('all keywords are required and an empty query includes every article',()=>{
  assert.equal(matches({title:'AIの教育活用'},'AI スポーツ'),false);
  assert.equal(matches({title:'AIの教育活用'},'　 '),true);
});
test('search covers edited article bodies, source headlines and saved paragraph objects',()=>{
  assert.equal(matches({title:'学校の未来',paragraphs:['一人ずつ学びを支援する生成AI']},'生成AI'),true);
  assert.equal(matches({title:'物価',paragraphs:[{text:'食料品の価格が上昇'}]},'食料品'),true);
  assert.equal(matches({title:'日経平均株価',provider:'Yahoo!ニュース'},'日経'),true);
});
test('search treats special characters literally rather than as markup or patterns',()=>{
  assert.equal(matches({title:'通常の記事'},'<script>'),false);
  assert.equal(matches({title:'通常の記事'},'.*'),false);
});
