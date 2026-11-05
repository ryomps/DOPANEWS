const fs = require('node:fs/promises');
const crypto = require('node:crypto');

// Keep the word-timestamp adapter separate so its retiring model can be replaced.
const TRANSCRIPTION_MODEL = 'whisper-1';
const POLICY_VERSION = 2;
function normalizeNumber(text) {
  const digits = '〇一二三四五六七八九';
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000, 億: 100000000, 兆: 1000000000000 };
  let total = 0, section = 0, number = '';
  for (const c of text) {
    if (/\d/.test(c)) number += c;
    else if (c === '零') number += '0';
    else if (digits.includes(c)) number += digits.indexOf(c);
    else if (units[c] < 10000) { section += (number ? Number(number) : 1) * units[c]; number = ''; }
    else { total += (section + Number(number) || 1) * units[c]; section = 0; number = ''; }
  }
  const value = total + section + Number(number);
  return Number.isSafeInteger(value) ? String(value) : text;
}
const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/(\d)\.(?=\d)/g, '$1点')
  .replace(/[0-9〇零一二三四五六七八九十百千万億兆]+/g, normalizeNumber).replace(/[^\p{L}\p{N}]/gu, '');

function alignmentError(message) {
  return new Error(`${message} 元音源は保存済みです。保存済みの認識結果は再利用します。音楽は自動再生成しません。`);
}

function checkWords(raw) {
  if (!Array.isArray(raw?.words) || !raw.words.length || raw.words.length > 5000) throw alignmentError('単語の歌唱時刻を取得できませんでした。');
  let previous = 0;
  for (const w of raw.words) {
    if (typeof w.word !== 'string' || w.word.length > 1000 || !Number.isFinite(w.start) || !Number.isFinite(w.end) ||
        w.start < 0 || w.start < previous || w.end < w.start || w.end > 184) throw alignmentError('音声認識の時刻形式が不正です。');
    previous = w.start;
  }
  return raw.words;
}

function alignWords(expected, raw) {
  const words = checkWords(raw);
  if (!Array.isArray(expected) || expected.length !== 16) throw new Error('音源ごとに8行×2ターンの歌詞が必要です。');
  let observed = '';
  let times = [];
  for (const w of words) {
    // Long words over instrumental gaps are unreliable transcription artifacts.
    if (w.end - w.start > 5) continue;
    const text = w.word.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}.]/gu, '');
    if (observed.length + text.length > 12000) throw alignmentError('認識結果が長すぎるため照合を停止しました。');
    for (let k = 0; k < text.length; k++) times.push({ start: w.start + (w.end - w.start) * k / text.length,
      end: w.start + (w.end - w.start) * (k + 1) / text.length });
    observed += text;
  }
  // A number can span several ASR words (一 / 万 / 五 / 千). Normalize the
  // complete run and retain the full run's audio interval, rather than each token.
  observed = observed.replace(/(\d)\.(?=\d)/g, '$1点');
  let canonical = '', canonicalTimes = [], previous = 0;
  for (const match of observed.matchAll(/[0-9〇零一二三四五六七八九十百千万億兆]+/g)) {
    canonical += observed.slice(previous, match.index);
    canonicalTimes.push(...times.slice(previous, match.index));
    const text = normalizeNumber(match[0]);
    const start = times[match.index].start, end = times[match.index + match[0].length - 1].end;
    canonical += text;
    for (let k = 0; k < text.length; k++) canonicalTimes.push({ start: start + (end-start)*k/text.length, end: start + (end-start)*(k+1)/text.length });
    previous = match.index + match[0].length;
  }
  canonical += observed.slice(previous); canonicalTimes.push(...times.slice(previous));
  observed = canonical; times = canonicalTimes;
  const chunks = expected.map(normalize);
  const target = chunks.join('');
  if (chunks.some(s => !s.length) || !observed.length || (target.length + 1) * (observed.length + 1) > 8_000_000) throw alignmentError('歌詞と音声を安全に照合できませんでした。');
  const matrix = Array.from({ length: target.length + 1 }, () => new Uint16Array(observed.length + 1));
  for (let i = target.length - 1; i >= 0; i--) for (let j = observed.length - 1; j >= 0; j--) {
    matrix[i][j] = target[i] === observed[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
  }
  const mapping = new Map();
  let i = 0, j = 0;
  while (i < target.length && j < observed.length) {
    // Resolve ambiguous repeated characters toward the first audible occurrence.
    // Backtracking from the end can steal the next phrase's prefix for this line.
    if (target[i] === observed[j]) { mapping.set(i++, j++); }
    else if (matrix[i + 1][j] > matrix[i][j + 1]) i++;
    else j++;
  }
  const result = []; let offset = 0, previousObserved = -1;
  const segments = Array.isArray(raw.segments) ? raw.segments : [];
  for (const [id, text] of chunks.entries()) {
    const matches = [], matchedPositions = [];
    for (let k = offset; k < offset + text.length; k++) if (mapping.has(k)) { matches.push(times[mapping.get(k)]); matchedPositions.push(k - offset); }
    const coverage = matches.length / text.length;
    if (coverage < .6 || matches.length < Math.min(3, text.length)) throw alignmentError(`${id < 8 ? '第1' : '第2'}ターンの${id % 8 + 1}行目を確認できませんでした。`);
    let start = matches[0].start, end = matches.at(-1).end;
    // Misrecognized names at phrase edges must not trim away their actual audio.
    if (matchedPositions[0] > 0) {
      const firstObserved = mapping.get(offset + matchedPositions[0]);
      const prefix = times.slice(previousObserved + 1, firstObserved).filter(t => t.start >= start - 1.5 && t.end <= start && (!result.length || t.start >= result.at(-1).end));
      const segment = segments.find(s => Number.isFinite(s.start) && Number.isFinite(s.end) &&
        s.start <= start && start < s.end && start - s.start <= 1.5 && s.end - s.start <= 10 &&
        (!result.length || s.start >= result.at(-1).end));
      if (prefix.length) start = prefix[0].start;
      else if (segment) start = segment.start;
      else if (matchedPositions[0] > 1) throw alignmentError(`${id % 8 + 1}行目の歌い出しを確認できませんでした。`);
    }
    if (matchedPositions.at(-1) < text.length - 1) {
      const lastObserved = mapping.get(offset + matchedPositions.at(-1));
      let nextObserved = times.length;
      for (let k = offset + text.length; k < target.length; k++) if (mapping.has(k)) { nextObserved = mapping.get(k); break; }
      const suffix = [];
      for (const t of times.slice(lastObserved + 1, nextObserved)) {
        if (t.end > end + 1 || (suffix.length && t.start - suffix.at(-1).end > .25)) break;
        suffix.push(t);
      }
      const segment = segments.find(s => Number.isFinite(s.start) && Number.isFinite(s.end) &&
        s.start < end && end <= s.end && s.end - end <= 1 && s.end - s.start <= 10);
      // Prefer the recognized phrase boundary over unmatched words belonging to the next line.
      if (segment && (nextObserved === times.length || segment.end <= times[nextObserved].start)) end = segment.end;
      else if (suffix.length) end = suffix.at(-1).end;
      else if (text.length - 1 - matchedPositions.at(-1) > 1) throw alignmentError(`${id % 8 + 1}行目の歌い終わりを確認できませんでした。`);
    }
    if (end <= start || end - start > 10 || matches.some((m, k) => k && m.start - matches[k - 1].end > 2.5) ||
        (id % 8 && start - result.at(-1).end > 6)) throw alignmentError(`${id % 8 + 1}行目の時刻が不確かです。`);
    if (result.length && start < result.at(-1).end) {
      if (result.at(-1).end - start > .1 || start <= result.at(-1).start) throw alignmentError('歌詞の順序または時刻が重複しています。');
      result.at(-1).end = start;
    }
    result.push({ id, start, end, coverage });
    previousObserved = mapping.get(offset + matchedPositions.at(-1));
    offset += text.length;
  }
  return { lines: result, model: TRANSCRIPTION_MODEL, policyVersion: POLICY_VERSION };
}

async function atomic(file, data) {
  const temporary = `${file}.${crypto.randomUUID()}.part`;
  await fs.writeFile(temporary, data); await fs.rename(temporary, file);
}

async function transcribeWords({ base, audio, key, fetchImpl = fetch }) {
  const cache = `${base}.whisper.json`;
  try { const raw = JSON.parse(await fs.readFile(cache, 'utf8')); checkWords(raw); return raw; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!key) throw new Error('音声同期にはOpenAIApiKeyのローカル設定が必要です。');
  const reservation = `${base}.transcription.request.json`;
  try { await fs.writeFile(reservation, JSON.stringify({ model: TRANSCRIPTION_MODEL, createdAt: new Date().toISOString() }), { flag: 'wx' }); }
  catch (error) {
    if (error.code === 'EEXIST') throw alignmentError('前回の音声認識の結果が未確定です。二重課金を避けて停止しました。');
    throw error;
  }
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'rap.mp3');
  form.append('model', TRANSCRIPTION_MODEL); form.append('language', 'ja'); form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(120000)
    });
  } catch { throw alignmentError('音声認識との通信が途切れました。結果が未確定のため再送しません。'); }
  if (!response.ok) {
    if ([400, 401, 403, 404, 413, 429].includes(response.status)) await fs.rm(reservation, { force: true });
    const error = alignmentError(`OpenAIの音声認識に失敗しました（HTTP ${response.status}）。自動再試行しません。`);
    error.status = response.status; throw error;
  }
  const raw = await response.json();
  // Save before validating so an imperfect transcript never buys another transcription.
  await atomic(cache, JSON.stringify(raw, null, 2));
  checkWords(raw);
  return raw;
}

module.exports = { TRANSCRIPTION_MODEL, POLICY_VERSION, alignWords, transcribeWords, checkWords, normalize };
