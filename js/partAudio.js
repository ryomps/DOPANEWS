(function (global) {
  const D = global.DOPANEWS = global.DOPANEWS || {};
  const RATE = 22050, SECONDS = 20;

  // Overlapping grains preserve local waveform pitch; large changes can sound grainy.
  function fitPart(samples, rate, start, end) {
    if (!(end > start) || start < 0 || end > samples.length / rate + 0.01) throw new Error('歌唱時刻が音源の範囲外です。');
    const ratio = (end - start) / SECONDS;
    if (ratio < 0.5 || ratio > 2) throw new Error('歌唱部分が10〜40秒の範囲外です。20秒への調整を停止しました。');
    const output = new Float32Array(RATE * SECONDS), weight = new Float32Array(output.length);
    const grain = Math.round(RATE * 0.06), hop = Math.round(grain / 4);
    for (let at = -grain; at < output.length; at += hop) {
      for (let j = 0; j < grain; j++) {
        const target = at + j;
        if (target < 0 || target >= output.length) continue;
        const source = start * rate + (at * ratio + j) * rate / RATE;
        if (source < start * rate || source >= end * rate - 1) continue;
        const index = Math.floor(source), fraction = source - index;
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / (grain - 1));
        output[target] += (samples[index] * (1 - fraction) + samples[index + 1] * fraction) * w;
        weight[target] += w;
      }
    }
    for (let i = 0; i < output.length; i++) {
      const fade = Math.min(1, i / (RATE * 0.008), (output.length - 1 - i) / (RATE * 0.008));
      output[i] = weight[i] ? output[i] / weight[i] * fade : 0;
    }
    return output;
  }

  function encodeWav(samples) {
    const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
    const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true));
    return bytes;
  }

  D.composeBattleParts = async (battle, parts, progress = () => {}) => {
    const context = new (global.AudioContext || global.webkitAudioContext)();
    const combined = new Float32Array(RATE * SECONDS * 4), timeline = [], metadata = [];
    try {
      for (const part of parts) {
        progress('パート ' + (part.index + 1) + '/4 の歌唱区間を20秒に編集中');
        const response = await fetch('/api/audio-source?url=' + encodeURIComponent(part.audioUrl));
        if (!response.ok) throw new Error('パート音声を取得できませんでした。サーバーを再起動してください。');
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        const lines = part.verse.timed_lines || [];
        // Keep the first performance of each display line, excluding generated repetitions.
        const seen = new Set(), first = [];
        for (const line of lines) {
          const fresh = (line.line_indices || []).some(index => !seen.has(index));
          if (fresh) { first.push(line); (line.line_indices || []).forEach(index => seen.add(index)); }
        }
        const count = part.verse.lyric.split(/\r?\n/).filter(Boolean).length;
        if (seen.size !== count || !first.length) throw new Error('パート ' + (part.index + 1) + ' の全歌詞を時刻情報と照合できません。自動再生成は行いません。');
        const start = first[0].start_sec, end = Math.max(...first.map(line => line.end_sec));
        const mono = new Float32Array(buffer.length);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const data = buffer.getChannelData(channel);
          for (let i = 0; i < mono.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
        }
        combined.set(fitPart(mono, buffer.sampleRate, start, end), part.index * RATE * SECONDS);
        const offset = part.index * SECONDS, scale = SECONDS / (end - start);
        timeline.push(...first.map(line => ({ ...line, verse_index: part.index,
          start_sec: offset + (line.start_sec - start) * scale, end_sec: offset + (line.end_sec - start) * scale })));
        metadata.push({ taskId: part.taskId, sourceTrack: part.murekaTrack, sourceStart: start, sourceEnd: end,
          speaker: part.verse.speaker, start: offset, end: offset + SECONDS });
      }
    } finally { await context.close(); }
    const bytes = encodeWav(combined);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
    battle.mureka_timeline = timeline;
    battle.mureka_sync = { status: 'matched', matched_lines: timeline.length, total_lines: timeline.length };
    battle.part_segments = metadata.map(({ speaker, start, end }) => ({ speaker, start, end }));
    battle.verses.forEach((verse, i) => Object.assign(verse, { start_time_sec: i * SECONDS, end_time_sec: (i + 1) * SECONDS,
      synced_from_mureka: true, timed_lines: timeline.filter(line => line.verse_index === i) }));
    return { audioUrl: URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })), audioWavBase64: btoa(binary),
      murekaTrack: { duration: 80000, generation_mode: 'four-parts', parts: metadata } };
  };
  D.partAudio = { fitPart, encodeWav };
})(window);
