(function (global) {
  const D = global.DOPANEWS;
  const split = value => String(value || '').split('\n').map(s => s.trim()).filter(Boolean);

  async function requestPart(gender, verses) {
    const response = await fetch('/api/lyria/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gender, verses: verses.map(v => ({ lyric: v.lyric, lyric_reading: v.lyric_reading })) })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Lyriaの音源生成に失敗しました。');
    return result;
  }

  // Preserve actual performance lengths. Never squeeze a verse to an assumed bar grid.
  function buildEditPlan(parts, durations) {
    const cuts = []; let cursor = 0;
    for (let index = 0; index < 4; index++) {
      const part = parts[index % 2];
      const offset = Math.floor(index / 2) * 8;
      const lines = part.lines.slice(offset, offset + 8);
      if (lines.length !== 8) throw new Error('16行の音声時刻が必要です。');
      const from = Math.max(0, lines[0].start - 0.08);
      const nextVocal = offset === 0 ? part.lines[8]?.start - 0.08 : durations[index % 2];
      const to = Math.min(durations[index % 2], Math.max(lines[7].end, nextVocal), lines[7].end + 0.6);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || lines.some(l => l.end > durations[index % 2] || l.start < from)) {
        throw new Error('解析した歌詞時刻が音源の範囲外です。元音源を確認してください。');
      }
      const end = cursor + (to - from);
      cuts.push({ index, source: index % 2, from, to, start: cursor, end,
        lines: lines.map(l => ({ start: cursor + l.start - from, end: cursor + l.end - from })) });
      cursor = end;
    }
    return { cuts, duration: cursor };
  }

  function encodeWav(channels, sampleRate) {
    const frames = channels[0].length;
    const bytes = new Uint8Array(44 + frames * 4);
    const view = new DataView(bytes.buffer);
    const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 4, true);
    for (let i = 0; i < frames; i++) for (let ch = 0; ch < 2; ch++) {
      const value = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(44 + (i * 2 + ch) * 2, value * (value < 0 ? 32768 : 32767), true);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { audioWavBase64: btoa(binary), audioUrl: URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })) };
  }

  async function synthesizeBattleWithLyria(battleData, onProgress = () => {}) {
    if (battleData.verses?.length !== 4) throw new Error('4ターンの歌詞が必要です。');
    const verses = battleData.verses;
    const parts = [];
    for (const [gender, indices] of [['male', [0, 2]], ['female', [1, 3]]]) {
      onProgress(`${gender === 'male' ? '男性' : '女性'}の2ターンをLyriaで準備し、OpenAIで歌詞時刻を確認しています。保存済み音源は再利用します…`);
      parts.push(await requestPart(gender, indices.map(i => verses[i])));
    }
    onProgress('音源を男性→女性→男性→女性につなぎ、歌詞表示を同期しています…');
    const context = new (global.AudioContext || global.webkitAudioContext)({ sampleRate: 44100 });
    try {
      const audio = [];
      for (const part of parts) {
        const response = await fetch(part.audioUrl);
        if (!response.ok) throw new Error('保存済みのLyria音源を読み込めませんでした。');
        audio.push(await context.decodeAudioData(await response.arrayBuffer()));
      }
      const plan = buildEditPlan(parts, audio.map(a => a.duration));
      const rate = context.sampleRate;
      if (plan.duration * rate * 4 + 44 > 40000000) throw new Error('接続音源が保存上限40MBを超えます。元音源は保存済みです。');
      const channels = [new Float32Array(Math.ceil(plan.duration * rate)), new Float32Array(Math.ceil(plan.duration * rate))];
      const timeline = [];
      for (const cut of plan.cuts) {
        const source = audio[cut.source];
        const count = Math.floor((cut.to - cut.from) * rate);
        const from = Math.floor(cut.from * rate), dest = Math.floor(cut.start * rate);
        const fade = Math.max(1, Math.floor(0.005 * rate));
        for (let ch = 0; ch < 2; ch++) {
          const samples = source.getChannelData(Math.min(ch, source.numberOfChannels - 1));
          for (let i = 0; i < count; i++) channels[ch][dest + i] = samples[from + i] * Math.min(1, i / fade, (count - 1 - i) / fade);
        }
        const verse = verses[cut.index];
        verse.start_time_sec = cut.start; verse.end_time_sec = cut.end; verse.synced_from_mureka = true;
        verse.timed_lines = cut.lines.map((l, i) => ({ text: split(verse.lyric)[i], reading: split(verse.lyric_reading)[i],
          start_sec: l.start, end_sec: l.end, line_indices: [i], verse_index: cut.index }));
        timeline.push(...verse.timed_lines);
      }
      battleData.part_segments = plan.cuts.map(c => ({ verseIndex: c.index, speaker: verses[c.index].speaker, start: c.start, end: c.end }));
      battleData.mureka_timeline = timeline;
      battleData.bpm = 100;
      battleData.suno_style = 'Japanese rap battle, heavy boom bap, low male and middle-low female spoken rap, 100 BPM';
      const timingSource = parts.every(p => p.alignmentModel === 'whisper-1') ? 'whisper-1-word-alignment'
        : parts.some(p => p.alignmentModel === 'whisper-1') ? 'mixed-audio-alignment' : 'gemini-audio-alignment';
      battleData.mureka_sync = { mode: 'lyria-3.5-separate-voices', bpm: 100, matched_lines: 32, total_lines: 32, duration_sec: plan.duration, timing_source: timingSource };
      battleData.lyria_sources = parts.map(p => ({ id: p.id, model: p.model, alignmentModel: p.alignmentModel, audioUrl: p.audioUrl }));
      battleData.lyria_edit = plan;
      return { ...encodeWav(channels, rate), durationSec: plan.duration,
        murekaTrack: { model: 'lyria-3.5', provider: 'gemini', duration: Math.round(plan.duration * 1000), part_segments: battleData.part_segments, sources: battleData.lyria_sources } };
    } finally { await context.close(); }
  }
  D.synthesizeBattleWithLyria = synthesizeBattleWithLyria;
  D.buildLyriaEditPlan = buildEditPlan;
})(window);
