/**
 * DOPANEWS 9:16 Vertical Battle Stage Component
 * - 8小節（8行）× 4本 のMCバトル表示＆現在歌っている小節のリアルタイムハイライト
 * - Murekaの返却歌詞と台本の照合結果に基づく表示同期（歌手識別ではない）
 * - 【拡張用】ファクトチェッカー表示スロット (#fact-check-slot) と
 *   カットイン演出用オーバーレイレイヤー (#cutin-overlay-layer) を内蔵
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  class StageView {
    constructor({ onSelectVerse }) {
      this.onSelectVerse = onSelectVerse || (() => {});
      this.battleData = null;
      this.currentVerseIndex = -1;
      this.currentLineIndex = -1;
      this.lastKnownDuration = 48;

      this.stageEl = document.getElementById('battle-stage');
      this.titleEl = document.getElementById('stage-battle-title');
      this.topicEl = document.getElementById('stage-topic-summary');
      this.timerEl = document.getElementById('stage-timer');
      this.progressFillEl = document.getElementById('stage-progress-fill');
      this.progressTrackEl = document.getElementById('stage-progress-track');
      this.versePillsEl = document.getElementById('stage-verse-pills');

      this.cardKentaEl = document.getElementById('mc-card-kenta');
      this.cardReinaEl = document.getElementById('mc-card-reina');
      this.kentaStanceEl = document.getElementById('stage-kenta-stance');
      this.reinaStanceEl = document.getElementById('stage-reina-stance');
      this.speakingStatusEl = document.getElementById('stage-speaking-status');
      this.isPlaying = false;
      this.activeSpeakerBadgeEl = document.getElementById('active-speaker-badge');
      this.sectionTagEl = document.getElementById('stage-section-tag');
      this.lyricBoxEl = document.getElementById('stage-lyric-box');
      this.rhymeBadgeEl = document.getElementById('stage-rhyme-badge');
      this.pointSummaryEl = document.getElementById('stage-point-summary');

      this.factCheckSlotEl = document.getElementById('fact-check-slot');
      this.cutinOverlayLayerEl = document.getElementById('cutin-overlay-layer');
    }

    setBattleData(battleData) {
      this.manualIntroOffsetSec = null;
      this.battleData = battleData;
      this.currentVerseIndex = -1;
      this.currentLineIndex = -1;

      if (this.titleEl) this.titleEl.textContent = battleData.title;
      if (this.progressFillEl) {
        this.progressFillEl.style.width = '100%';
        this.progressFillEl.style.clipPath = 'inset(0 100% 0 0)';
      }
      if (this.topicEl) this.topicEl.textContent = battleData.topic_summary;
      if (this.kentaStanceEl) this.kentaStanceEl.textContent = battleData.kenta_stance;
      if (this.reinaStanceEl) this.reinaStanceEl.textContent = battleData.reina_stance;

      this._renderVersePills();
      this._renderVerseTrack();
      if (battleData.verses.length > 0) {
        this.activateVerse(0, false);
      }
    }

    /**
     * 明示的な歌い出し同期では、現在位置からBPMに基づく表示に切り替える。
     */
    alignVerseStartToCurrentTime(verseIndex, currentAudioSec) {
      const bpm = DOPANEWS.extractBpmFromStyle(this.battleData?.suno_style);
      const eightBarSec = DOPANEWS.calcEightBarsDurationSec(bpm);
      // 手動同期ボタンを押した場合はBPM固定ウィンドウで現在位置にロックオン
      if (this.battleData?.verses) {
        this.battleData.verses.forEach((v) => {
          v.synced_from_mureka = false;
          v.timed_lines = null;
        });
      }
      this.manualIntroOffsetSec = currentAudioSec - verseIndex * eightBarSec;
      this.battleData.mureka_sync = null;
      this.battleData.part_segments = null;
      this._renderVersePills();
      this.activateVerse(verseIndex, true);
    }

    getVerseWindows(durationSec) {
      if (Number.isFinite(this.manualIntroOffsetSec)) {
        const span = DOPANEWS.calcEightBarsDurationSec(DOPANEWS.extractBpmFromStyle(this.battleData?.suno_style));
        return this.battleData.verses.map((_, i) => ({start: this.manualIntroOffsetSec + i * span, end: this.manualIntroOffsetSec + (i + 1) * span}));
      }
      const dur = Number.isFinite(durationSec) && durationSec > 10 ? durationSec : this.lastKnownDuration;
      const verses = this.battleData?.verses || [];
      const count = verses.length || 4;

      // Murekaの lyrics_sections から正確な秒数が同期済みの場合
      const hasMurekaSync = verses.some((v) => v.synced_from_mureka);
      if (hasMurekaSync) {
        return verses.map((v, i) => {
          const start = typeof v.start_time_sec === 'number' ? v.start_time_sec : 0;
          const nextStart =
            i < count - 1 && typeof verses[i + 1].start_time_sec === 'number'
              ? verses[i + 1].start_time_sec
              : dur;
          const end = typeof v.end_time_sec === 'number' && v.end_time_sec > start ? v.end_time_sec : nextStart;
          return { start, end: Math.max(start + 4, end) };
        });
      }

      // 実尺が60秒以上のフル楽曲（Mureka生成曲やローカルMP3）の場合、イントロ・アウトロを考慮して4バースに自動配分
      const introOffset = dur > 65 ? Math.min(10, dur * 0.06) : 0;
      const outroOffset = dur > 65 ? Math.min(10, dur * 0.06) : 0;
      const activeSpan = Math.max(20, dur - introOffset - outroOffset);
      const spanPerVerse = activeSpan / count;

      return verses.map((_, i) => ({
        start: introOffset + i * spanPerVerse,
        end: introOffset + (i + 1) * spanPerVerse
      }));
    }

    _renderVerseTrack() {
      if (!this.progressTrackEl || !this.battleData) return;
      const duration = this.lastKnownDuration;
      const verses = this.battleData.verses;
      const raw = this.battleData.part_segments
        || (this.battleData.mureka_sync ? (this.battleData.mureka_timeline || []).map(line => ({
          start: line.start_sec, end: line.end_sec, verse_index: line.verse_index
        })) : this.getVerseWindows(duration));
      const parts = raw.map((part, index) => ({
        start: Math.max(0, Math.min(duration, part.start)),
        end: Math.max(0, Math.min(duration, part.end)),
        speaker: verses[!this.battleData.part_segments && this.battleData.mureka_sync ? part.verse_index : index]?.speaker
      })).filter(part => part.end > part.start);
      const boundaries = [...new Set([0, duration, ...parts.flatMap(part => [part.start, part.end])])].sort((a,b) => a-b);
      const stops = [];
      let previousColor = null;
      for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i], end = boundaries[i+1];
        const speakers = new Set(parts.filter(part => part.start <= start && part.end >= end).map(part => part.speaker));
        const speaker = speakers.size === 1 ? [...speakers][0] : null;
        const color = speaker === 'KENTA' ? '#4b94ff' : speaker === 'REINA' ? '#ff5067' : '#343e50';
        const boundary = start / duration * 100;
        if (previousColor && previousColor !== color) {
          stops.pop();
          stops.push(`${previousColor} calc(${boundary}% - 1px)`,
            `#fff calc(${boundary}% - 1px)`, `#fff calc(${boundary}% + 1px)`,
            `${color} calc(${boundary}% + 1px)`, `${color} ${end / duration * 100}%`);
        } else {
          stops.push(`${color} ${boundary}%`, `${color} ${end / duration * 100}%`);
        }
        previousColor = color;
      }
      // Repeated stops make crisp verse boundaries, without color blending.
      const background = `linear-gradient(to right, ${stops.join(', ')})`;
      if (this.verseTrackBackground !== background) {
        this.progressTrackEl.style.background = background.replaceAll('#4b94ff', '#343e50').replaceAll('#ff5067', '#343e50');
        if (this.progressFillEl) this.progressFillEl.style.background = background;
        this.verseTrackBackground = background;
      }
    }

    _renderVersePills() {
      if (!this.versePillsEl || !this.battleData) return;
      this.versePillsEl.innerHTML = '';

      this.battleData.verses.forEach((verse, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `verse-pill ${verse.speaker === 'REINA' ? 'pill-reina' : 'pill-kenta'}`;
        btn.textContent = `V${idx + 1} ${verse.speaker}`;
        btn.title = `${verse.point_summary}`;
        btn.disabled = Boolean(this.battleData.mureka_sync && !verse.synced_from_mureka);
        btn.addEventListener('click', () => {
          const windows = this.getVerseWindows(this.lastKnownDuration);
          const targetStart = windows[idx] ? windows[idx].start : verse.start_time_sec;
          this.onSelectVerse(idx, targetStart);
        });
        this.versePillsEl.appendChild(btn);
      });
    }

    /**
     * 再生時間に応じてアクティブなバース（V1〜V4）および小節（1〜8行目）を同期更新
     */
    syncTime(currentTimeSec, durationSec = 48) {
      if (Number.isFinite(durationSec) && durationSec > 0) {
        this.lastKnownDuration = durationSec;
      }
      this._renderVerseTrack();

      if (this.timerEl) {
        this.timerEl.textContent = `${this._formatTime(currentTimeSec)} / ${this._formatTime(this.lastKnownDuration)}`;
      }
      if (this.progressFillEl && this.lastKnownDuration > 0) {
        const pct = Math.min(100, Math.max(0, (currentTimeSec / this.lastKnownDuration) * 100));
        this.progressFillEl.style.width = '100%';
        this.progressFillEl.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
      }

      if (!this.battleData || !this.battleData.verses.length) return;

      if (this.battleData.part_segments) {
        const index = this.battleData.part_segments.findIndex(part => currentTimeSec >= part.start && currentTimeSec < part.end);
        if (index < 0) { this._showUnassignedPart(false); return; }
        if (index !== this.currentVerseIndex) this.activateVerse(index, true);
        this._highlightCurrentBar(index, currentTimeSec);
        return;
      }

      // Mureka timings are used only for lines matched to the script, never equal divisions.
      if (this.battleData.mureka_sync) {
        const active = (this.battleData.mureka_timeline || []).filter((line) =>
          currentTimeSec >= line.start_sec && currentTimeSec < line.end_sec);
        const speakers = new Set(active.map((line) => line.verse_index));
        if (speakers.size !== 1 || speakers.has(null)) {
          this._showUnassignedPart(active.length > 0);
          return;
        }
        const verseIndex = active[0].verse_index;
        if (verseIndex !== this.currentVerseIndex) this.activateVerse(verseIndex, true);
        this._highlightCurrentBar(verseIndex, currentTimeSec);
        return;
      }

      const windows = this.getVerseWindows(this.lastKnownDuration);
      let targetIdx = 0;
      for (let i = 0; i < windows.length; i++) {
        if (currentTimeSec >= windows[i].start) {
          targetIdx = i;
        }
      }

      if (targetIdx !== this.currentVerseIndex) {
        this.activateVerse(targetIdx, true);
      }

      // 現在のバース内の何小節目（何行目）を歌っているかをハイライト
      this._highlightCurrentBar(targetIdx, currentTimeSec, windows[targetIdx]);
    }

    /**
     * 8小節（8行）のうち現在ラップしている行をリアルタイム強調＆自動スクロール
     */
    _highlightCurrentBar(verseIdx, currentTimeSec, verseWindow) {
      if (!this.lyricBoxEl || !this.battleData?.verses?.[verseIdx]) return;
      const verse = this.battleData.verses[verseIdx];
      const lineEls = this.lyricBoxEl.querySelectorAll('.lyric-line');
      if (!lineEls.length) return;

      let activeLineIdx = 0;
      let activeIndices = null;

      // Murekaの行単位タイムスタンプがある場合
      if (Array.isArray(verse.timed_lines) && verse.timed_lines.length > 0) {
        activeLineIdx = -1;
        activeIndices = new Set();
        for (let i = 0; i < verse.timed_lines.length; i++) {
          const timedLine = verse.timed_lines[i];
          if (currentTimeSec >= timedLine.start_sec && currentTimeSec < timedLine.end_sec) {
            const indices = timedLine.line_indices || (verse.lyric_reading ? [] : [i]);
            indices.forEach((index) => { if (index >= 0 && index < lineEls.length) activeIndices.add(index); });
          }
        }
        if (activeIndices.size) activeLineIdx = Math.min(...activeIndices);
      } else if (verseWindow) {
        // バースの開始〜終了時間から8小節の進行度を算出
        const span = Math.max(4, verseWindow.end - verseWindow.start);
        const rel = Math.max(0, Math.min(0.999, (currentTimeSec - verseWindow.start) / span));
        activeLineIdx = Math.floor(rel * lineEls.length);
      }

      const lineKey = activeIndices ? [...activeIndices].sort((a, b) => a - b).join(',') : String(activeLineIdx);
      if (lineKey === this.currentLineKey) return;
      this.currentLineKey = lineKey;
      this.currentLineIndex = activeLineIdx;

      lineEls.forEach((el, idx) => {
        el.classList.toggle('line-active', activeIndices ? activeIndices.has(idx) : idx === activeLineIdx);
        el.classList.toggle('line-past', idx < activeLineIdx);
      });

      const activeEl = lineEls[activeLineIdx];
      if (activeEl && this.lyricBoxEl.scrollHeight > this.lyricBoxEl.clientHeight) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    activateVerse(index, animate = true) {
      if (!this.battleData || !this.battleData.verses[index]) return;
      this.currentVerseIndex = index;
      this.currentLineIndex = -1;
      this.currentLineKey = null;
      const verse = this.battleData.verses[index];
      const isReina = verse.speaker === 'REINA';

      if (this.stageEl) {
        this.stageEl.setAttribute('data-active-mc', verse.speaker);
      }
      this._updateSpeakingStatus();

      if (this.cardKentaEl && this.cardReinaEl) {
        this.cardKentaEl.classList.toggle('mc-active', !isReina);
        this.cardKentaEl.classList.toggle('mc-dim', isReina);
        this.cardReinaEl.classList.toggle('mc-active', isReina);
        this.cardReinaEl.classList.toggle('mc-dim', !isReina);
      }

      if (this.versePillsEl) {
        const pills = this.versePillsEl.querySelectorAll('.verse-pill');
        pills.forEach((pill, i) => {
          pill.classList.toggle('active', i === index);
        });
      }

      if (this.activeSpeakerBadgeEl) {
        this.activeSpeakerBadgeEl.innerHTML = isReina
          ? 'MC REINA <span class="mc-sub">8 BARS / DATA & LOGIC</span>'
          : 'MC KENTA <span class="mc-sub">8 BARS / STREET PASSION</span>';
        this.activeSpeakerBadgeEl.className = `active-speaker-badge ${isReina ? 'badge-reina' : 'badge-kenta'}`;
      }

      if (this.sectionTagEl) {
        this.sectionTagEl.textContent = verse.section_tag;
      }

      if (this.lyricBoxEl) {
        if (animate) {
          this.lyricBoxEl.classList.remove('lyric-slam-anim');
          void this.lyricBoxEl.offsetWidth;
          this.lyricBoxEl.classList.add('lyric-slam-anim');
        }
        const lines = verse.lyric.split('\n').filter(Boolean);
        this.lyricBoxEl.innerHTML = lines
          .map(
            (line, i) =>
              `<p class="lyric-line ${i === 0 ? 'line-active' : ''}"><span class="bar-num">${i + 1}</span>${this._escapeHtml(line)}</p>`
          )
          .join('');
        this.lyricBoxEl.scrollTop = 0;
      }

      if (this.rhymeBadgeEl) {
        this.rhymeBadgeEl.textContent = verse.rhyme_words || '韻ロックオン';
      }

      if (this.pointSummaryEl) {
        this.pointSummaryEl.textContent = verse.point_summary;
      }

      this._renderFutureFactCheckSlot(verse);
    }

    _showUnassignedPart(hasLyrics) {
      this.currentVerseIndex = -1;
      this.currentLineIndex = -1;
      this.stageEl?.setAttribute('data-active-mc', 'NONE');
      this._updateSpeakingStatus();
      [this.cardKentaEl, this.cardReinaEl].forEach((card) => {
        card?.classList.remove('mc-active');
        card?.classList.add('mc-dim');
      });
      this.versePillsEl?.querySelectorAll('.verse-pill').forEach((pill) => pill.classList.remove('active'));
      if (this.activeSpeakerBadgeEl) {
        this.activeSpeakerBadgeEl.textContent = hasLyrics ? '歌詞の担当を確認できません' : '間奏・歌詞の時刻情報なし';
        this.activeSpeakerBadgeEl.className = 'active-speaker-badge';
      }
      if (this.lyricBoxEl) this.lyricBoxEl.textContent = hasLyrics
        ? '元の台本と照合できないため、MC表示を保留しています。' : '次のリリックを待っています。';
      if (this.sectionTagEl) this.sectionTagEl.textContent = '';
      if (this.rhymeBadgeEl) this.rhymeBadgeEl.textContent = '—';
      if (this.pointSummaryEl) this.pointSummaryEl.textContent = '—';
      if (this.factCheckSlotEl) this.factCheckSlotEl.dataset.factStatus = 'UNVERIFIED';
    }

    setPlaybackState(isPlaying) {
      this.isPlaying = isPlaying;
      this.stageEl?.setAttribute('data-playing', String(isPlaying));
      this._updateSpeakingStatus();
    }

    _updateSpeakingStatus() {
      if (!this.speakingStatusEl) return;
      const verse = this.battleData?.verses?.[this.currentVerseIndex];
      this.speakingStatusEl.textContent = verse
        ? `MC ${verse.speaker} ${this.isPlaying ? 'が発言中' : 'のバース・一時停止中'}`
        : '間奏・次のバースを待っています';
    }

    _renderFutureFactCheckSlot(verse) {
      if (!this.factCheckSlotEl) return;
      this.factCheckSlotEl.dataset.factStatus = verse.fact_check_status || 'UNVERIFIED';
    }

    triggerCutInEffect(options = {}) {
      if (!this.cutinOverlayLayerEl) return;
      this.cutinOverlayLayerEl.dataset.lastTrigger = options.type || 'NONE';
    }

    _formatTime(sec) {
      const s = Math.max(0, Math.floor(sec || 0));
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
    }

    _escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }

  DOPANEWS.StageView = StageView;
})(window);
