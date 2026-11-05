const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { reviewBattle, reviewFingerprint } = require('./review.cjs');
const { createNewsService, publicNewsFailure } = require('./news-service.cjs');
const { createBackingHandler } = require('./backing.cjs');

function createServer({ root = __dirname, libraryDir = path.join(root, '.local', 'library'),
  fixedBeatDir = path.join(root, '.local', 'fixed-beat'),
  newsDirectory = path.join(root, '.local', 'news'), configPath = path.join(root, 'config.local.json'), env = process.env, fetchImpl = fetch, lan = false } = {}) {
  const allowedHosts = new Set(['localhost', '127.0.0.1']);
  if (lan) Object.values(require('node:os').networkInterfaces()).flat().filter(item => item.family === 'IPv4' && !item.internal).forEach(item => allowedHosts.add(item.address));
  const reviewJobs = new Map();
  const json = (res, data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  async function readConfig() {
    let local = {};
    try { local = JSON.parse(await fsp.readFile(configPath, 'utf8')); }
    catch (err) { if (err.code !== 'ENOENT') throw new Error('config.local.json must contain valid JSON.'); }
    return { gemini: local.GeminiApiKey || env.GEMINI_API_KEY || '', mureka: local.MurekaApiKey || env.MUREKA_API_KEY || '', openai: local.OpenAIApiKey || env.OPENAI_API_KEY || '' };
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
  const news = createNewsService({ directory: newsDirectory, fetchImpl, readConfig });
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
  const handleBacking = createBackingHandler({ root, readConfig, readBody, json, sendFile, fetchImpl });
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!/^([^:]+):\d+$/.test(host) || !allowedHosts.has(host.split(':')[0]) || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
        json(res, { error: 'Origin denied' }, 403); return;
      }
      const url = new URL(req.url, `http://${host}`), route = url.pathname;
      if (route === '/api/news/search-usage' && req.method === 'GET') {
        const [usage, config] = await Promise.all([news.searchUsage(), readConfig()]);
        json(res, { ...usage, configured: Boolean(config.openai) }); return;
      }
      if (route === '/api/news' && req.method === 'GET') {
        const [headlines, articles, searchUsage, config] = await Promise.all([news.headlines(), news.list(), news.searchUsage(), readConfig()]);
        json(res, { headlines, articles, sources: news.sources, primarySources: news.primarySources, searchUsage: { ...searchUsage, configured: Boolean(config.openai) } }); return;
      }
      if (route === '/api/news/generate' && req.method === 'POST') {
        const input = await readBody(req);
        if (!input || typeof input !== 'object' || Object.keys(input).some(k => !['topicId', 'retry', 'refreshSearch'].includes(k)) || ('retry' in input && typeof input.retry !== 'boolean') || ('refreshSearch' in input && typeof input.refreshSearch !== 'boolean')) throw new Error('一覧から話題を選んでください。');
        try { json(res, await news.generate(input.topicId, input.retry, input.refreshSearch)); }
        catch (error) { const problem = publicNewsFailure(error); json(res, { code: problem.code, error: problem.message }, problem.status); }
        return;
      }
      const newsArticle = /^\/api\/news\/articles\/([a-f0-9]{32})$/.exec(route);
      if (newsArticle && req.method === 'GET') {
        const record = await news.get(newsArticle[1]);
        json(res, record || { error: '保存したニュースが見つかりません。' }, record ? 200 : 404); return;
      }
      if (route.startsWith('/api/backing/') && await handleBacking(req, res, url)) return;

      // ==================== 🎹 固定ビート (Mureka Instrumental) 管理API ====================
      if (route === '/api/fixed-beat' && req.method === 'GET') {
        const metaFile = path.join(fixedBeatDir, 'meta.json');
        const beatFile = path.join(fixedBeatDir, 'beat.mp3');
        try {
          const [metaRaw, stat] = await Promise.all([fsp.readFile(metaFile, 'utf8'), fsp.stat(beatFile)]);
          if (stat.size > 0) {
            const meta = JSON.parse(metaRaw);
            json(res, { exists: true, audioUrl: `/api/fixed-beat/audio?t=${meta.updatedAt || Date.now()}`, ...meta });
            return;
          }
        } catch {
          // Not created yet
        }
        json(res, { exists: false }); return;
      }
      if (route === '/api/fixed-beat/audio' && req.method === 'GET') {
        await sendFile(req, res, path.join(fixedBeatDir, 'beat.mp3'), 'audio/mpeg'); return;
      }
      if (route === '/api/fixed-beat/generate' && req.method === 'POST') {
        const config = await readConfig();
        if (!config.mureka) { json(res, { error: 'Mureka APIキーを設定してください。' }, 400); return; }
        const body = await readBody(req);
        const stylePrompt = String(body.prompt || 'Japanese Pop Rap, Educational Rap, Groovy Funky Beat, 115 BPM').trim();
        const bpmMatch = stylePrompt.match(/(\d{2,3})\s*BPM/i);
        const bpm = bpmMatch ? Number(bpmMatch[1]) : (Number(body.bpm) || 115);

        // 1) Try Mureka Official /v1/instrumental/generate first
        let endpointType = 'instrumental';
        let genRes = await fetchImpl('https://api.mureka.ai/v1/instrumental/generate', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.mureka}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'auto',
            prompt: `${stylePrompt}, Pure Instrumental Hip Hop Backing Track, No Vocals, Steady ${bpm} BPM Groove, 4/4 time`
          }),
          signal: AbortSignal.timeout(60000)
        }).catch(() => null);

        // 2) Fallback to /v1/song/generate in instrumental mode if /v1/instrumental/generate is unavailable
        if (!genRes || !genRes.ok) {
          endpointType = 'song';
          genRes = await fetchImpl('https://api.mureka.ai/v1/song/generate', {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.mureka}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'mureka-9',
              n: 1,
              prompt: `Instrumental Only, No Vocals, ${stylePrompt}, Steady ${bpm} BPM Hip Hop Backing Beat, Catchy Groove`,
              lyrics: `[Instrumental Intro]\n\n[Verse 1: Groovy Funky Hip Hop Beat ${bpm} BPM]\n\n[Chorus 1: Upbeat Catchy Instrumental Groove ${bpm} BPM]\n\n[Verse 2: Groovy Funky Hip Hop Beat ${bpm} BPM]\n\n[Chorus 2: Upbeat Catchy Instrumental Groove ${bpm} BPM]\n\n[Outro: Short Fade Out]\n[End]`
            }),
            signal: AbortSignal.timeout(60000)
          });
        }

        if (!genRes.ok) {
          const errText = await genRes.text().catch(() => '');
          json(res, { error: `Mureka固定ビート生成エラー (${genRes.status}): ${errText}` }, genRes.status); return;
        }
        const genData = await genRes.json();
        const taskId = genData?.id || genData?.data?.id || genData?.task_id;
        if (!taskId) { json(res, { error: 'MurekaからtaskIdを取得できませんでした。' }, 502); return; }
        json(res, { taskId, endpointType, bpm, prompt: stylePrompt }); return;
      }
      const fixedBeatPoll = /^\/api\/fixed-beat\/poll\/(instrumental|song)\/([a-zA-Z0-9_-]+)$/.exec(route);
      if (fixedBeatPoll && req.method === 'GET') {
        const config = await readConfig();
        if (!config.mureka) { json(res, { error: 'Mureka APIキーを設定してください。' }, 400); return; }
        const [, endpointType, taskId] = fixedBeatPoll;
        const pollRes = await fetchImpl(`https://api.mureka.ai/v1/${endpointType}/query/${encodeURIComponent(taskId)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${config.mureka}` },
          signal: AbortSignal.timeout(60000)
        });
        if (!pollRes.ok) { json(res, { error: `Murekaクエリエラー (${pollRes.status})` }, pollRes.status); return; }
        const pollData = await pollRes.json();
        const status = String(pollData?.status || pollData?.data?.status || 'preparing').toLowerCase();
        const choices = pollData?.choices || pollData?.data?.choices || [];
        const firstTrack = Array.isArray(choices) && choices.length > 0 ? choices[0] : null;
        const playableUrl = firstTrack?.url || firstTrack?.audio_url || firstTrack?.stream_url || firstTrack?.flac_url || pollData?.url || pollData?.audio_url;

        if (status === 'succeeded' && playableUrl) {
          await fsp.mkdir(fixedBeatDir, { recursive: true });
          const tempFile = path.join(fixedBeatDir, 'beat.part');
          const beatFile = path.join(fixedBeatDir, 'beat.mp3');
          const audioRes = await fetchImpl(playableUrl, { signal: AbortSignal.timeout(120000) });
          if (!audioRes.ok || !audioRes.body) throw new Error('Mureka固定ビート音源のダウンロードに失敗しました。');
          await pipeline(Readable.fromWeb(audioRes.body), fs.createWriteStream(tempFile));
          await fsp.rename(tempFile, beatFile);

          const stylePrompt = url.searchParams.get('prompt') || 'Japanese Pop Rap, Groovy Funky Beat, 115 BPM';
          const bpmMatch = stylePrompt.match(/(\d{2,3})\s*BPM/i);
          const bpm = bpmMatch ? Number(bpmMatch[1]) : Number(url.searchParams.get('bpm') || 115);
          const meta = {
            bpm,
            prompt: stylePrompt,
            taskId,
            endpointType,
            duration: firstTrack?.duration ? Math.round(firstTrack.duration / 1000) : null,
            updatedAt: Date.now(),
            createdAt: new Date().toISOString()
          };
          await fsp.writeFile(path.join(fixedBeatDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
          json(res, {
            status: 'succeeded',
            beat: { exists: true, audioUrl: `/api/fixed-beat/audio?t=${meta.updatedAt}`, ...meta }
          });
          return;
        }
        json(res, { status, failed_reason: pollData?.failed_reason || null }); return;
      }

      if (route === '/api/config' && req.method === 'GET') {
        const config = await readConfig();
        json(res, { geminiConfigured: Boolean(config.gemini), murekaConfigured: Boolean(config.mureka), openaiConfigured: Boolean(config.openai), reviewSupported: true }); return;
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
          const audioFile = path.join(libraryDir, `${input.recordId}.${record.audioFormat === 'wav' ? 'wav' : 'mp3'}`);
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
      if (route === '/api/config' && req.method === 'POST') {
        const input = await readBody(req);
        const fields = ['GeminiApiKey', 'MurekaApiKey', 'OpenAIApiKey'];
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !fields.includes(k)) || fields.some(k => k in input && (typeof input[k] !== 'string' || input[k].length > 4096 || /[\r\n]/.test(input[k])))) {
          json(res, { error: 'Invalid API key settings' }, 400); return;
        }
        let settings = {};
        try { settings = JSON.parse(await fsp.readFile(configPath, 'utf8')); }
        catch (err) { if (err.code !== 'ENOENT') throw err; }
        // Blank fields leave existing values unchanged. Never send keys back to the browser.
        for (const key of fields) if (input[key]?.trim()) settings[key] = input[key].trim();
        await fsp.writeFile(configPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
        const config = await readConfig();
        json(res, { geminiConfigured: Boolean(config.gemini), murekaConfigured: Boolean(config.mureka), openaiConfigured: Boolean(config.openai) }); return;
      }
      const gemini = /^\/api\/gemini\/([a-zA-Z0-9.-]+)$/.exec(route);
      if (gemini && req.method === 'POST') {
        const config = await readConfig();
        const headerKey = (req.headers['x-goog-api-key'] || '').toString().trim();
        const geminiKey = headerKey || config.gemini;
        if (!geminiKey) { json(res, { error: 'Set GeminiApiKey in config.local.json or in the browser API Key input.' }, 400); return; }
        await proxy(res, `https://generativelanguage.googleapis.com/v1beta/models/${gemini[1]}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
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
      if (route === '/api/audio-source' && req.method === 'GET') {
        const source = new URL(url.searchParams.get('url'));
        if (source.protocol !== 'https:' || !['.mureka.ai', '.mureka.cn'].some(suffix => source.hostname.endsWith(suffix))) throw new Error('Only Mureka audio sources are allowed.');
        const upstream = await fetchImpl(source.href, { signal: AbortSignal.timeout(120000), redirect: 'error' });
        if (!upstream.ok || !upstream.body) throw new Error('Audio download failed.');
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
        await pipeline(Readable.fromWeb(upstream.body), res); return;
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
        const audioFile = path.join(libraryDir, `${id}.${input.audioWavBase64 ? 'wav' : 'mp3'}`), tempAudio = path.join(libraryDir, `${id}.part`);
        try {
          if (input.audioWavBase64) {
            if (typeof input.audioWavBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audioWavBase64)) throw new Error('Invalid WAV encoding.');
            const wav = Buffer.from(input.audioWavBase64, 'base64');
            if (wav.length < 44000 || wav.length > 15000000 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 16) !== 'WAVEfmt ' || wav.readUInt32LE(16) !== 16 || wav.readUInt16LE(20) !== 1) throw new Error('Invalid mono PCM WAV.');
            await fsp.writeFile(tempAudio, wav);
            await fsp.rename(tempAudio, audioFile);
            audioUrl = '/api/library/' + id + '/audio';
          } else if (input.audioUrl) {
            if (input.audioUrl === '/api/fixed-beat/audio' || input.audioUrl.startsWith('/api/fixed-beat/audio?')) {
              await fsp.copyFile(path.join(fixedBeatDir, 'beat.mp3'), tempAudio);
              await fsp.rename(tempAudio, audioFile);
              audioUrl = `/api/library/${id}/audio`;
            } else {
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
          }
          const record = { id, createdAt: new Date().toISOString(), battleData: input.battleData,
            articleText: input.articleText || '', audioUrl, ...(input.audioWavBase64 ? { audioFormat: 'wav' } : {}), synthDuration: input.synthDuration || 45,
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
      if (audio && req.method === 'GET') {
        const record = JSON.parse(await fsp.readFile(path.join(libraryDir, audio[1] + '.json'), 'utf8'));
        const wav = record.audioFormat === 'wav';
        await sendFile(req, res, path.join(libraryDir, audio[1] + (wav ? '.wav' : '.mp3')), wav ? 'audio/wav' : 'audio/mpeg'); return;
      }
      if (req.method === 'GET' && route === '/media/demos/food-boundary.mp3') {
        await sendFile(req, res, path.join(root, 'media', 'demos', 'food-boundary.mp3'), 'audio/mpeg'); return;
      }
      if (req.method === 'GET' && route === '/media/demos/voice-no-yukue.mp3') {
        await sendFile(req, res, path.join(root, 'media', 'demos', 'voice-no-yukue.mp3'), 'audio/mpeg'); return;
      }
      if (req.method === 'GET' && route === '/media/demos/voice-no-yukue.mp4') {
        await sendFile(req, res, path.join(root, 'media', 'demos', 'voice-no-yukue.mp4'), 'video/mp4'); return;
      }
      const publicPath = route === '/' ? '/index.html' : route;
      if (req.method === 'GET' && /^\/css\/images\/[a-zA-Z0-9_-]+\.png$/.test(publicPath)) {
        await sendFile(req, res, path.join(root, publicPath.slice(1)), 'image/png'); return;
      }
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
  const lan = args.includes('--lan');
  const server = createServer({ lan, libraryDir: option('--data-directory') ? path.resolve(option('--data-directory')) : undefined });
  server.on('error', err => { console.error(`Server could not start: ${err.message}`); process.exitCode = 1; });
  server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`DOPANEWS: ${url}\nLocal API settings: config.local.json\nSaved music: .local/library/`);
    if (lan) Object.values(require('node:os').networkInterfaces()).flat().filter(item => item.family === 'IPv4' && !item.internal).forEach(item => console.log('Phone: http://' + item.address + ':' + port + '/'));
    if (!args.includes('--no-browser')) {
      const child = require('node:child_process').spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`], { windowsHide: true, stdio: 'ignore' });
      child.on('error', () => console.log(`Open ${url} in your browser.`));
    }
  });
}
