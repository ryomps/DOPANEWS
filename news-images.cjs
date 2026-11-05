const fs = require('node:fs/promises');
const path = require('node:path');
const { fetchPublicSource, sourceUrl } = require('./public-source.cjs');

function articleImage(html) {
  const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) attrs[match[1].toLowerCase()] = decode(match[3]);
    if (!['og:image', 'twitter:image'].includes(attrs.property || attrs.name)) continue;
    const url = sourceUrl(attrs.content);
    if (url && /(^|\.)(yimg\.jp|yimg\.com|yahoo\.co\.jp)$/.test(url.hostname) && !/default|ogp_default|og_image_default/i.test(url.pathname)) return url.href;
  }
  return null;
}

function createNewsImages({ directory, fetchImpl = fetch }) {
  const jobs = new Map();
  return async topic => {
    if (!topic || !/^[a-f0-9]{32}$/.test(topic.id)) return { imageUrl: null };
    if (jobs.has(topic.id)) return jobs.get(topic.id);
    const job = (async () => {
      const file = path.join(directory, 'images', topic.id + '.json');
      try {
        const saved = JSON.parse(await fs.readFile(file, 'utf8'));
        if (Date.now() - saved.checkedAt < (saved.imageUrl ? 86400000 : 900000)) return saved;
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      const result = { imageUrl: null, sourceUrl: topic.url, checkedAt: Date.now() };
      try {
        let url = sourceUrl(topic.url);
        for (let redirects = 0; redirects < 4; redirects++) {
          if (!url || url.hostname !== 'news.yahoo.co.jp' || !/^\/(pickup|articles)\//.test(url.pathname)) break;
          const response = await (fetchImpl === fetch ? fetchPublicSource : fetchImpl)(url.href, {redirect:'manual', signal:AbortSignal.timeout(7000), headers:{'User-Agent':'DOPANEWS/1.0'}});
          if ([301,302,303,307,308].includes(response.status)) {
            const next = response.headers.get('location'); await response.body?.cancel();
            url = next ? sourceUrl(new URL(next, url).href) : null; continue;
          }
          if (!response.ok) { await response.body?.cancel(); break; }
          const chunks = []; let size = 0;
          for await (const chunk of response.body) { size += chunk.length; if (size > 1500000) throw new Error('Page too large'); chunks.push(chunk); }
          result.imageUrl = articleImage(Buffer.concat(chunks).toString('utf8')); break;
        }
      } catch { /* An unavailable publisher image must not block the news list. */ }
      await fs.mkdir(path.dirname(file), {recursive:true});
      await fs.writeFile(file, JSON.stringify(result)); return result;
    })();
    jobs.set(topic.id, job);
    try { return await job; } finally { jobs.delete(topic.id); }
  };
}
module.exports = { articleImage, createNewsImages };
