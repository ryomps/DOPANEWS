const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { reviewBattle, reviewFingerprint } = require('./review.cjs');

function createServer({ root = __dirname, libraryDir = path.join(root, '.local', 'library'),
  configPath = path.join(root, 'config.local.json'), env = process.env, fetchImpl = fetch } = {}) {
  const reviewJobs = new Map();
  const json = (res, data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  async function readConfig() {
    let local = {};
    try { local = JSON.parse(await fsp.readFile(configPath, 'utf8')); }
    catch (err) { if (err.code !== 'ENOENT') throw new Error('config.local.json must contain valid JSON.'); }
    return { gemini: local.GeminiApiKey || env.GEMINI_API_KEY || '', mureka: local.MurekaApiKey || env.MUREKA_API_KEY || '' };
  }
  async function readBody(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON request required.');
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 5_000_000) throw new Error('Request is too large.');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async function sendFile(req, res, file, mime) {
    const stat = await fsp.stat(file);
    let start = 0, end = stat.size - 1, status = 200;
    const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return;
      }
      if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return;
      }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = Math.max(0, end - start + 1);
    res.writeHead(status, headers);
    if (!stat.size) { res.end(); return; }
    await pipeline(fs.createReadStream(file, { start, end }), res);
  }
  async function proxy(res, url, options, provider) {
    try {
      const upstream = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(120000) });
      if (!upstream.ok) { json(res, { error: `${provider} request failed (${upstream.status})` }, upstream.status); return; }
      json(res, await upstream.json());
    } catch { json(res, { error: `${provider} connection failed. Check the local API configuration.` }, 502); }
  }
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
        json(res, { error: 'Origin denied' }, 403); return;
      }
      const url = new URL(req.url, `http://${host}`), route = url.pathname;
      if (route === '/api/config' && req.method === 'GET') {
        const config = await readConfig();
        json(res, { geminiConfigured: Boolean(config.gemini), murekaConfigured: Boolean(config.mureka), reviewSupported: true }); return;
      }
      if (route === '/api/review' && req.method === 'POST') {
        const input = await readBody(req);
        if (!['script', 'audio'].includes(input.stage)) throw new Error('Unknown review stage.');
        let articleText = input.articleText, battleData = input.battleData, record, recordFile, audio;
        if (input.recordId) {
          if (!/^[a-f0-9]{32}$/.test(input.recordId)) throw new Error('Invalid saved record.');
          recordFile = path.join(libraryDir, `${input.recordId}.json`);
          record = JSON.parse(await fsp.readFile(recordFile, 'utf8'));
          articleText = record.articleText; battleData = record.battleData;
        }
        if (input.stage === 'audio') {
          if (!record?.audioUrl) throw new Error('音源審判には保存済みの音声が必要です。先に音源を保存してください。');
          const audioFile = path.join(libraryDir, `${input.recordId}.mp3`);
          if ((await fsp.stat(audioFile)).size > 12 * 1024 * 1024) throw new Error('音源が12MBを超えるため審判できません。');
          audio = await fsp.readFile(audioFile);
        }
        const fingerprint = reviewFingerprint(articleText, battleData, audio);
        const cached = record?.reviews?.[input.stage];
        if (!input.force && cached?.fingerprint === fingerprint) { json(res, cached); return; }
        const jobKey = `${input.stage}:${input.recordId || ''}:${fingerprint}`;
        let job = reviewJobs.get(jobKey);
        if (!job) {
          job = (async () => {
            const config = await readConfig();
            const report = { ...await reviewBattle({ articleText, battleData, stage: input.stage, audio, key: config.gemini, fetchImpl }), fingerprint };
            if (recordFile) {
              const latest = JSON.parse(await fsp.readFile(recordFile, 'utf8'));
              latest.reviews = { ...latest.reviews, [input.stage]: report };
              const temporary = `${recordFile}.${crypto.randomUUID()}.part`;
              try { await fsp.writeFile(temporary, JSON.stringify(latest, null, 2), 'utf8'); await fsp.rename(temporary, recordFile); }
              finally { await fsp.rm(temporary, { force: true }); }
            }
            return report;
          })();
          reviewJobs.set(jobKey, job);
        }
        try { json(res, await job); }
        finally { if (reviewJobs.get(jobKey) === job) reviewJobs.delete(jobKey); }
        return;
      }
      const gemini = /^\/api\/gemini\/([a-zA-Z0-9.-]+)$/.exec(route);
      if (gemini && req.method === 'POST') {
        const config = await readConfig();
        if (!config.gemini) { json(res, { error: 'Set GeminiApiKey in config.local.json' }, 400); return; }
        await proxy(res, `https://generativelanguage.googleapis.com/v1beta/models/${gemini[1]}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini },
          body: JSON.stringify(await readBody(req))
        }, 'Gemini'); return;
      }
      const mureka = /^\/api\/mureka\/v1\/song\/(generate|query\/[a-zA-Z0-9_-]+)$/.exec(route);
      if (mureka) {
        const method = mureka[1] === 'generate' ? 'POST' : 'GET';
        if (req.method !== method) { json(res, { error: 'Method not allowed' }, 405); return; }
        const config = await readConfig();
        if (!config.mureka) { json(res, { error: 'Set MurekaApiKey in config.local.json' }, 400); return; }
        const options = { method, headers: { Authorization: `Bearer ${config.mureka}`, 'Content-Type': 'application/json' } };
        if (method === 'POST') {
          const input = await readBody(req);
          // Pin the model here too so a stale browser cannot select the latest model.
          options.body = JSON.stringify({ ...input, model: 'mureka-9', n: 1 });
        }
        await proxy(res, `https://api.mureka.ai/v1/song/${mureka[1]}`, options, 'Mureka'); return;
      }
      if (route === '/api/fetch-url' && req.method === 'GET') {
        const target = new URL(url.searchParams.get('url'));
        if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Use an http or https article URL.');
        const page = await fetchImpl(target.href, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
        if (!page.ok) throw new Error(`Article download failed (${page.status}).`);
        json(res, { ok: true, html: await page.text() }); return;
      }
      if (route === '/api/library' && req.method === 'GET') {
        await fsp.mkdir(libraryDir, { recursive: true });
        const files = (await fsp.readdir(libraryDir)).filter(name => /^[a-f0-9]{32}\.json$/.test(name));
        const items = [];
        for (const file of files) {
          try { items.push(JSON.parse(await fsp.readFile(path.join(libraryDir, file), 'utf8'))); }
          catch { console.warn('An unreadable library record was skipped.'); }
        }
        items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        json(res, { items }); return;
      }
      if (route === '/api/library' && req.method === 'POST') {
        const input = await readBody(req);
        if (!input.battleData?.title || !Array.isArray(input.battleData.verses) || !input.battleData.verses.length) {
          throw new Error('A battle script is required.');
        }
        const id = crypto.randomUUID().replaceAll('-', '');
        await fsp.mkdir(libraryDir, { recursive: true });
        let audioUrl = null;
        const audioFile = path.join(libraryDir, `${id}.mp3`), tempAudio = path.join(libraryDir, `${id}.part`);
        try {
          if (input.audioUrl) {
            const source = new URL(input.audioUrl);
            if (source.protocol !== 'https:' || !['.mureka.ai', '.mureka.cn'].some(suffix => source.hostname.endsWith(suffix))) {
              throw new Error('Only Mureka audio URLs can be saved. Local MP3 imports are playback-only.');
            }
            const audio = await fetchImpl(source.href, { signal: AbortSignal.timeout(120000) });
            if (!audio.ok || !audio.body) throw new Error('Audio download failed.');
            await pipeline(Readable.fromWeb(audio.body), fs.createWriteStream(tempAudio));
            if (!(await fsp.stat(tempAudio)).size) throw new Error('Audio download was empty.');
            await fsp.rename(tempAudio, audioFile);
            audioUrl = `/api/library/${id}/audio`;
          }
          const record = { id, createdAt: new Date().toISOString(), battleData: input.battleData,
            articleText: input.articleText || '', audioUrl, synthDuration: input.synthDuration || 45,
            murekaTrack: input.murekaTrack || null, reviews: input.reviews || {} };
          const tempRecord = path.join(libraryDir, `${id}.json.part`);
          await fsp.writeFile(tempRecord, JSON.stringify(record, null, 2), 'utf8');
          await fsp.rename(tempRecord, path.join(libraryDir, `${id}.json`));
          json(res, record, 201);
        } catch (err) {
          await Promise.all([tempAudio, audioFile, path.join(libraryDir, `${id}.json.part`)].map(file => fsp.rm(file, { force: true })));
          throw err;
        }
        return;
      }
      const audio = /^\/api\/library\/([a-f0-9]{32})\/audio$/.exec(route);
      if (audio && req.method === 'GET') { await sendFile(req, res, path.join(libraryDir, `${audio[1]}.mp3`), 'audio/mpeg'); return; }
      const publicPath = route === '/' ? '/index.html' : route;
      if (req.method === 'GET' && (publicPath === '/index.html' || /^\/(js|css)\/[a-zA-Z0-9_/-]+\.(js|css)$/.test(publicPath))) {
        const mime = publicPath.endsWith('.js') ? 'application/javascript' : publicPath.endsWith('.css') ? 'text/css' : 'text/html';
        await sendFile(req, res, path.join(root, publicPath.slice(1)), `${mime}; charset=utf-8`); return;
      }
      json(res, { error: 'Not found' }, 404);
    } catch (err) {
      if (!res.headersSent) {
        const missingReviewSource = err.code === 'ENOENT' && req.url.split('?')[0] === '/api/review';
        json(res, {
          error: missingReviewSource ? '保存した歌詞または音源が見つかりません。保存一覧を更新してください。' : err.code === 'ENOENT' ? 'Not found' : err.message,
          ...(missingReviewSource ? { code: 'REVIEW_SOURCE_NOT_FOUND' } : {})
        }, err.code === 'ENOENT' ? 404 : 400);
      }
      else res.destroy();
    }
  });
}
module.exports = { createServer };
if (require.main === module) {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const port = Number(option('--port') || 8080);
  const server = createServer({ libraryDir: option('--data-directory') ? path.resolve(option('--data-directory')) : undefined });
  server.on('error', err => { console.error(`Server could not start: ${err.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`DOPANEWS: ${url}\nLocal API settings: config.local.json\nSaved music: .local/library/`);
    if (!args.includes('--no-browser')) {
      const child = require('node:child_process').spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`], { windowsHide: true, stdio: 'ignore' });
      child.on('error', () => console.log(`Open ${url} in your browser.`));
    }
  });
}
