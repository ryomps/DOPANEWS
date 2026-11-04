/* Shared, local-only news search. No requests or generation on search. */
(function (global) {
  const D = global.DOPANEWS = global.DOPANEWS || {};
  const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/g, ' ').trim();
  D.getNewsTags = article => Array.isArray(article.tags) ? article.tags : article.tag ? [article.tag] : [];
  D.matchesNewsSearch = (article, query) => {
    const terms = normalize(query).split(' ').filter(Boolean);
    const body = (article.paragraphs || []).map(p => typeof p === 'string' ? p : p?.text || '').join(' ');
    const text = normalize([article.title, article.summary, article.category, ...D.getNewsTags(article), article.provider, body].join(' '));
    return terms.every(term => text.includes(term));
  };
})(window);
