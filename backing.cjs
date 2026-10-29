const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { convertWav } = require('./backing-audio.cjs');
const { reviewBattle } = require('./review.cjs');

function createBackingHandler({ root, readConfig, readBody, json, sendFile, fetchImpl }) {
  const directory = path.join(root, '.local', 'backing-uploads');
  const getRecord = async id => {
    if (!/^[a-f0-9]{32}$/.test(id || '')) throw new Error('伴奏をアップロードしてください。');
    return JSON.parse(await fsp.readFile(path.join(directory, id + '.json'), 'utf8'));
  };
  const request = async (endpoint, options, key) => {
    let response;
    try {
      response = await fetchImpl('https://api.mureka.ai' + endpoint, {
        ...options, headers: { ...options.headers, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(120000)
      });
    } catch { throw new Error('Murekaに接続できません。通信状態を確認してください。'); }
    if (!response.ok) throw new Error('Mureka APIエラー (' + response.status + ')。キー・残高・ファイル形式を確認してください。自動再試行は行いません。');
    return response.json();
  };
  return async (req, res, url) => {
    const route = url.pathname;
    if (route === '/api/backing/upload' && req.method === 'POST') {
      const config = await readConfig();
      if (!config.mureka) throw new Error('Mureka APIキーを設定してください。');
      const filename = path.basename(decodeURIComponent(req.headers['x-file-name'] || ''));
      const extension = path.extname(filename).toLowerCase();
      if (!['.mp3', '.m4a', '.wav'].includes(extension)) throw new Error('MP3／M4A／16bit PCM WAVを選んでください。');
      const max = extension === '.wav' ? 40_000_000 : 10_000_000;
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > max) throw new Error(extension === '.wav' ? 'WAVは40MB以内にしてください。' : 'MP3／M4Aは10MB以内にしてください。');
        chunks.push(chunk);
      }
      if (!size) throw new Error('ファイルが空です。');
      let bytes = Buffer.concat(chunks), duration = Number(req.headers['x-audio-duration']);
      if (extension === '.wav') ({ bytes, duration } = await convertWav(bytes));
      if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error('伴奏の長さを取得できません。10分以内の音声を選んでください。');
      if (bytes.length > 10_000_000) throw new Error('変換後の音声が10MBを超えています。');
      const format = extension === '.m4a' ? 'm4a' : 'mp3';
      const form = new FormData();
      form.append('purpose', 'audio');
      form.append('file', new Blob([bytes], { type: format === 'm4a' ? 'audio/mp4' : 'audio/mpeg' }), 'backing.' + format);
      const uploaded = await request('/v1/files/upload', { method: 'POST', body: form }, config.mureka);
      const uploadId = uploaded.id || uploaded.data?.id;
      if (!uploadId) throw new Error('MurekaのアップロードIDを取得できませんでした。');
      const id = crypto.randomUUID().replaceAll('-', '');
      const record = { id, filename, format, duration, uploadId, createdAt: new Date().toISOString() };
      await fsp.mkdir(directory, { recursive: true });
      await fsp.writeFile(path.join(directory, id + '.' + format), bytes);
      await fsp.writeFile(path.join(directory, id + '.json'), JSON.stringify(record, null, 2));
      json(res, { id, filename, duration, audioUrl: '/api/backing/' + id + '/audio' }, 201);
      return true;
    }
    const audio = /^\/api\/backing\/([a-f0-9]{32})\/audio$/.exec(route);
    if (audio && req.method === 'GET') {
      const record = await getRecord(audio[1]);
      await sendFile(req, res, path.join(directory, record.id + '.' + record.format), record.format === 'm4a' ? 'audio/mp4' : 'audio/mpeg');
      return true;
    }
    if (route === '/api/backing/generate' && req.method === 'POST') {
      const input = await readBody(req), config = await readConfig();
      if (!config.mureka || !config.gemini) throw new Error('GeminiとMurekaのAPIキーを設定してください。');
      const record = await getRecord(input.backingId);
      const start = input.startSec, end = input.endSec;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > record.duration || end - start > 120) throw new Error('区間は伴奏の範囲内で、開始より終了を後にしてください（最大120秒）。');
      if (!['KENTA', 'REINA'].includes(input.speaker)) throw new Error('担当MCを選択してください。');
      if (typeof input.lyric !== 'string' || !input.lyric.trim() || input.lyric.length > 5000 || typeof input.lyricReading !== 'string' || !input.lyricReading.trim() || input.lyricReading.length > 4900) throw new Error('表示歌詞と音声用の読みを入力してください。');
      if (input.lyric.trim().split(/\r?\n/).length !== input.lyricReading.trim().split(/\r?\n/).length || /[\p{Script=Han}A-Za-z0-9()（）]/u.test(input.lyricReading)) throw new Error('音声用の読みは表示歌詞と同じ行数のかな表記にしてください。');
      if (typeof input.articleText !== 'string' || !input.articleText.trim()) throw new Error('元記事を入力してください。');
      const battleData = { title: input.title || '伴奏にラップを追加', suno_style: 'Japanese rap, 96 BPM', verses: [{
        speaker: input.speaker, lyric: input.lyric.trim(), lyric_reading: input.lyricReading.trim(),
        section_tag: '[Verse: ' + (input.speaker === 'REINA' ? 'Female' : 'Male') + ' Rap]', point_summary: '', rhyme_words: ''
      }] };
      const report = await reviewBattle({ stage: 'script', articleText: input.articleText, battleData, key: config.gemini, fetchImpl });
      if (report.verdict !== 'pass') {
        json(res, { error: '歌詞のAI審判に確認・修正候補があるため、音声生成を停止しました。', report }, 422);
        return true;
      }
      const payload = { upload_audio_id: record.uploadId, generate_type: 'Vocals',
        generate_start: Math.round(start * 1000), generate_end: Math.round(end * 1000),
        vocal_gender: input.speaker === 'REINA' ? 'female' : 'male',
        lyrics: battleData.verses[0].section_tag + '\n' + battleData.verses[0].lyric_reading,
        prompt: 'Japanese rhythmic rap, 96 BPM, solo ' + (input.speaker === 'REINA' ? 'female' : 'male')
          + ' rapper. Follow the uploaded backing and its beat. Perform the supplied lyrics once within the requested interval. No additional singers, no repeated hooks.' };
      const task = await request('/v1/track/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, config.mureka);
      const taskId = task.id || task.data?.id;
      if (!taskId) throw new Error('Murekaの生成タスクIDを取得できませんでした。');
      const requestInfo = { backingId: record.id, filename: record.filename, startSec: start, endSec: end, speaker: input.speaker };
      await fsp.writeFile(path.join(directory, record.id + '-task-' + String(taskId).replace(/[^a-zA-Z0-9_-]/g, '') + '.json'), JSON.stringify({ taskId, requestInfo, battleData, articleText: input.articleText, report }, null, 2));
      json(res, { taskId, requestInfo, battleData, report });
      return true;
    }
    return false;
  };
}
module.exports = { createBackingHandler };
