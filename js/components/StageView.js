/**
 * DOPANEWS 9:16 Vertical Battle Stage Component
 * - 8小節（8行）× 4本 のMCバトル表示＆現在歌っている小節のリアルタイムハイライト
 * - Murekaの lyrics_sections タイムスタンプ または 楽曲実尺 (durationSec) に基づく完全同期
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
      this.versePillsEl = document.getElementById('stage-verse-pills');

      this.cardKentaEl = document.getElementById('mc-card-kenta');
      this.cardReinaEl = document.getElementById('mc-card-reina');
      this.activeSpeakerBadgeEl = document.getElementById('active-speaker-badge');
      this.sectionTagEl = document.getElementById('stage-section-tag');
      this.lyricBoxEl = document.getElementById('stage-lyric-box');
      this.rhymeBadgeEl = document.getElementById('stage-rhyme-badge');
      this.pointSummaryEl = document.getElementById('stage-point-summary');

      this.factCheckSlotEl = document.getElementById('fact-check-slot');
      this.cutinOverlayLayerEl = document.getElementById('cutin-overlay-layer');
    }

    setBattleData(battleData) {
      this.battleData = battleData;
      this.currentVerseIndex = -1;
      this.currentLineIndex = -1;

      if (this.titleEl) this.titleEl.textContent = battleData.title;
      if (this.topicEl) this.topicEl.textContent = battleData.topic_summary;

      this._renderVersePills();
      if (battleData.verses.length > 0) {
        this.activateVerse(0, false);
      }
    }

    /**
     * 各バースの開始・終了秒数を取得（Murekaタイムスタンプがあればそれを使用し、
     * なければ実際の楽曲尺 durationSec に合わせて4等分＋イントロ補正で自動計算する）
     */
    getVerseWindows(durationSec) {
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

    _renderVersePills() {
      if (!this.versePillsEl || !this.battleData) return;
      this.versePillsEl.innerHTML = '';

      this.battleData.verses.forEach((verse, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `verse-pill ${verse.speaker === 'REINA' ? 'pill-reina' : 'pill-kenta'}`;
        btn.textContent = `V${idx + 1} ${verse.speaker}`;
        btn.title = `${verse.point_summary}`;
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

      if (this.timerEl) {
        this.timerEl.textContent = `${this._formatTime(currentTimeSec)} / ${this._formatTime(this.lastKnownDuration)}`;
      }
      if (this.progressFillEl && this.lastKnownDuration > 0) {
        const pct = Math.min(100, Math.max(0, (currentTimeSec / this.lastKnownDuration) * 100));
        this.progressFillEl.style.width = `${pct}%`;
      }

      if (!this.battleData || !this.battleData.verses.length) return;

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

      // Murekaの行単位タイムスタンプがある場合
      if (Array.isArray(verse.timed_lines) && verse.timed_lines.length > 0) {
        for (let i = 0; i < verse.timed_lines.length; i++) {
          if (currentTimeSec >= verse.timed_lines[i].start_sec) {
            activeLineIdx = Math.min(lineEls.length - 1, i);
          }
        }
      } else if (verseWindow) {
        // バースの開始〜終了時間から8小節の進行度を算出
        const span = Math.max(4, verseWindow.end - verseWindow.start);
        const rel = Math.max(0, Math.min(0.999, (currentTimeSec - verseWindow.start) / span));
        activeLineIdx = Math.floor(rel * lineEls.length);
      }

      if (activeLineIdx === this.currentLineIndex) return;
      this.currentLineIndex = activeLineIdx;

      lineEls.forEach((el, idx) => {
        el.classList.toggle('line-active', idx === activeLineIdx);
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
      const verse = this.battleData.verses[index];
      const isReina = verse.speaker === 'REINA';

      if (this.stageEl) {
        this.stageEl.setAttribute('data-active-mc', verse.speaker);
      }

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
          ? '❄️ MC REINA <span class="mc-sub">8 BARS / DATA & LOGIC</span>'
          : '🔥 MC KENTA <span class="mc-sub">8 BARS / STREET PASSION</span>';
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
