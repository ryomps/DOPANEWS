const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

function wavToMp3(bytes) {
  const wav = Buffer.from(bytes);
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAVファイルの形式を確認してください。');
  let format, audio;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4), start = offset + 8;
    if (size > wav.length - start) throw new Error('WAVファイルが途中で切れています。');
    const name = wav.toString('ascii', offset, offset + 4);
    if (name === 'fmt ') format = wav.subarray(start, start + size);
    if (name === 'data' && !audio) audio = wav.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!format || format.length < 16 || !audio || format.readUInt16LE(0) !== 1 || format.readUInt16LE(14) !== 16) throw new Error('WAVは16bit PCM形式を使用してください。MP3／M4Aも選択できます。');
  const channels = format.readUInt16LE(2), rate = format.readUInt32LE(4);
  const block = format.readUInt16LE(12);
  if (![1, 2].includes(channels) || rate < 8000 || rate > 192000 || block !== channels * 2 || audio.length % block) throw new Error('未対応のWAV形式です。');
  const frames = audio.length / block, duration = frames / rate;
  if (!frames || duration > 600) throw new Error('伴奏は10分以内にしてください。');
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'vendor', 'lame.min.js'), 'utf8'), sandbox);
  const encoder = new sandbox.lamejs.Mp3Encoder(1, 22050, 96), chunks = [];
  const length = Math.floor(duration * 22050);
  const sample = frame => {
    let total = 0;
    for (let c = 0; c < channels; c++) total += audio.readInt16LE(frame * block + c * 2);
    return total / channels;
  };
  for (let offset = 0; offset < length; offset += 1152) {
    const samples = new Int16Array(Math.min(1152, length - offset));
    for (let i = 0; i < samples.length; i++) {
      const position = (offset + i) * rate / 22050, index = Math.floor(position), fraction = position - index;
      samples[i] = Math.round(sample(Math.min(index, frames - 1)) * (1 - fraction) + sample(Math.min(index + 1, frames - 1)) * fraction);
    }
    const encoded = encoder.encodeBuffer(samples);
    if (encoded.length) chunks.push(Buffer.from(encoded));
  }
  chunks.push(Buffer.from(encoder.flush()));
  return { bytes: Buffer.concat(chunks), duration };
}

function convertWav(bytes) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: bytes });
    let settled = false;
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('伴奏の変換がタイムアウトしました。MP3を選択してください。')); }, 120000);
    worker.once('message', message => {
      settled = true; clearTimeout(timeout);
      message.error ? reject(new Error(message.error)) : resolve({ bytes: Buffer.from(message.bytes), duration: message.duration });
    });
    worker.once('error', error => { clearTimeout(timeout); reject(error); });
    worker.once('exit', code => { if (!settled && code) { clearTimeout(timeout); reject(new Error('音声変換に失敗しました。')); } });
  });
}

if (!isMainThread) {
  try { parentPort.postMessage(wavToMp3(workerData)); }
  catch (error) { parentPort.postMessage({ error: error.message }); }
}
module.exports = { convertWav, wavToMp3 };
