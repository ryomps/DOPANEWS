/**
 * DOPANEWS 9:16 Vertical Battle Stage Component
 * - 8小節（8行）× 4本 のMCバトル表示＆現在歌っている小節のリアルタイムハイライト
 * - 「曲全体の長さ÷4」ではなく「BPM計算（115 BPM ＝ 8小節 約16.7秒）」による正確なバース＆小節同期
 * - 歌い出しのズレをワンタップで補正できる「🎤 歌い出し同期 (alignIntroOffset)」機能
 * - 4本目（V4 REINA）終了時に長い後奏（アウトロ）を待たず自動で JUDGE TIME（投票画面）を発火可能
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  class StageView {
    constructor({ onSelectVerse, onBattleBarsFinished }) {
      this.onSelectVerse = onSelectVerse || (() => {});
      this.onBattleBarsFinished = onBattleBarsFinished || (() => {});
      this.battleData = null;
      this.currentVerseIndex = -1;
      this.currentLineIndex = -1;
      this.lastKnownDuration = 68;

      // Mureka音源などの前奏（イントロ）オフセット秒数（デフォルト: 115BPMの4小節＝約8.3秒、シンセビート時は0秒）
      this.introOffsetSec = 8.3;
      this.isSynthMode = true;
      this.autoJudgeTriggered = false;

      this.stageEl = document.getElementById('battle-stage');
      this.titleEl = document.getElementById('stage-battle-title');
      this.topicEl = document.getElementById('stage-topic-summary');
      this.timerEl = document.getElementById('stage-timer');
      this.progressFillEl = document.getElementById('stage-progress-fill');
      this.versePillsEl = document.getElementById('stage-verse-pills');
      this.syncVocalBtnEl = document.getElementById('btn-sync-vocal-start');

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

    setBattleData(battleData, { isSynthMode = true } = {}) {
      this.battleData = battleData;
      this.isSynthMode = isSynthMode;
      this.currentVerseIndex = -1;
      this.currentLineIndex = -1;
      this.autoJudgeTriggered = false;

      const bpm = DOPANEWS.extractBpmFromStyle(battleData?.suno_style);
      const fourBarIntro = (60 / bpm) * 4 * 4; // 4小節分の標準イントロ秒数 (115BPMで約8.35秒)
      this.introOffsetSec = isSynthMode ? 0 : Math.round(fourBarIntro * 10) / 10;

      if (this.titleEl) this.titleEl.textContent = battleData.title;
      if (this.topicEl) this.topicEl.textContent = battleData.topic_summary;

      this._renderVersePills();
      if (battleData.verses.length > 0) {
        this.activateVerse(0, false);
      }
      this.resetTimerDisplay();
    }

    /**
     * ステージ上部のタイマーとプログレスバーを 00:00 の待機状態にリセット
     */
    resetTimerDisplay() {
      const windows = this.getVerseWindows();
      const battleEndSec = windows.length > 0 ? windows[windows.length - 1].end : 67;
      const displayTotalSec = Math.ceil(battleEndSec + 1.5);
      if (this.timerEl) {
        this.timerEl.textContent = `00:00 / ${this._formatTime(displayTotalSec)}`;
      }
      if (this.progressFillEl) {
        this.progressFillEl.style.width = '0%';
      }
    }

    /**
     * 音源モード切り替え（Mureka/MP3再生時は標準4小節イントロ、シンセビート時は0秒イントロ）
     */
    setAudioMode(isSynthMode) {
      this.isSynthMode = isSynthMode;
      this.autoJudgeTriggered = false;
      const bpm = DOPANEWS.extractBpmFromStyle(this.battleData?.suno_style);
      const fourBarIntro = (60 / bpm) * 4 * 4;
      this.introOffsetSec = isSynthMode ? 0 : Math.round(fourBarIntro * 10) / 10;
    }

    /**
     * 🎤 ワンタップ歌い出し同期：
     * 再生中にユーザーが「V1〜V4」または「🎤歌い出し同期」を押した瞬間を、
     * そのバースの開始タイミングとしてロックオンし、以降の8小節×4本をBPM計算で完全同期する（曲は止めない）
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
      this.introOffsetSec = currentAudioSec - verseIndex * eightBarSec;
      this.autoJudgeTriggered = false;
      this.activateVerse(verseIndex, true);
    }

    /**
     * BPM計算に基づく各バース（8小節×4本）の正確な開始・終了秒数を取得
     * 115 BPM の場合: 1バース(8小節) = 16.70秒、4バース合計 = 66.78秒
     */
    getVerseWindows() {
      const verses = this.battleData?.verses || [];
      const count = verses.length || 4;
      const bpm = DOPANEWS.extractBpmFromStyle(this.battleData?.suno_style);
      const eightBarSec = DOPANEWS.calcEightBarsDurationSec(bpm);

      // Murekaの lyrics_sections が有効に存在する場合のみそれを使用
      const hasMurekaSync = verses.some((v) => v.synced_from_mureka);
      if (hasMurekaSync) {
        return verses.map((v, i) => {
          const start = typeof v.start_time_sec === 'number' ? v.start_time_sec : 0;
          const nextStart =
            i < count - 1 && typeof verses[i + 1].start_time_sec === 'number'
              ? verses[i + 1].start_time_sec
              : start + eightBarSec;
          const end =
            typeof v.end_time_sec === 'number' && v.end_time_sec > start
              ? v.end_time_sec
              : nextStart;
          return { start, end: Math.max(start + 8, end) };
        });
      }

      // BPM計算による8小節×4本のウィンドウ（Murekaの長い後奏に引きずられない固定テンポ）
      return verses.map((_, i) => ({
        start: this.introOffsetSec + i * eightBarSec,
        end: this.introOffsetSec + (i + 1) * eightBarSec
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
        btn.title = `クリックで V${idx + 1} (${verse.speaker}) に画面を同期`;
        btn.addEventListener('click', () => {
          this.onSelectVerse(idx);
        });
        this.versePillsEl.appendChild(btn);
      });
    }

    /**
     * 再生時間に応じてアクティブなバース（V1〜V4）および小節（1〜8行目）を同期更新
     */
    syncTime(currentTimeSec, durationSec = 68) {
      if (Number.isFinite(durationSec) && durationSec > 0) {
        this.lastKnownDuration = durationSec;
      }

      const windows = this.getVerseWindows();
      const battleEndSec =
        windows.length > 0 ? windows[windows.length - 1].end : this.lastKnownDuration;

      // ステージ上部タイマーは「現在の秒数 / バトル4本終了秒数（約1分）」を表示してショート動画感を明確化
      const displayTotalSec = Math.min(this.lastKnownDuration, Math.ceil(battleEndSec + 1.5));

      if (this.timerEl) {
        this.timerEl.textContent = `${this._formatTime(Math.min(currentTimeSec, displayTotalSec))} / ${this._formatTime(displayTotalSec)}`;
      }
      if (this.progressFillEl && displayTotalSec > 0) {
        const pct = Math.min(100, Math.max(0, (currentTimeSec / displayTotalSec) * 100));
        this.progressFillEl.style.width = `${pct}%`;
      }

      if (!this.battleData || !this.battleData.verses.length) return;

      let targetIdx = 0;
      for (let i = 0; i < windows.length; i++) {
        if (currentTimeSec >= windows[i].start) {
          targetIdx = i;
        }
      }

      if (targetIdx !== this.currentVerseIndex) {
        this.activateVerse(targetIdx, true);
      }

      this._highlightCurrentBar(targetIdx, currentTimeSec, windows[targetIdx]);

      // 4本目（V4 REINA）の8小節＋余韻1.5秒が終了したら、Murekaの2分目のリピートや後奏をカットしてJUDGE TIMEを発火
      if (
        !this.isSynthMode &&
        !this.autoJudgeTriggered &&
        currentTimeSec >= battleEndSec + 1.5
      ) {
        this.autoJudgeTriggered = true;
        this.onBattleBarsFinished();
      }
    }

    _highlightCurrentBar(verseIdx, currentTimeSec, verseWindow) {
      if (!this.lyricBoxEl || !this.battleData?.verses?.[verseIdx]) return;
      const verse = this.battleData.verses[verseIdx];
      const lineEls = this.lyricBoxEl.querySelectorAll('.lyric-line');
      if (!lineEls.length) return;

      let activeLineIdx = 0;

      if (Array.isArray(verse.timed_lines) && verse.timed_lines.length > 0) {
        for (let i = 0; i < verse.timed_lines.length; i++) {
          if (currentTimeSec >= verse.timed_lines[i].start_sec) {
            activeLineIdx = Math.min(lineEls.length - 1, i);
          }
        }
      } else if (verseWindow) {
        // イントロ中（V1開始前）は1小節目に待機
        if (currentTimeSec < verseWindow.start) {
          activeLineIdx = 0;
        } else {
          const span = Math.max(4, verseWindow.end - verseWindow.start);
          const rel = Math.max(0, Math.min(0.999, (currentTimeSec - verseWindow.start) / span));
          activeLineIdx = Math.floor(rel * lineEls.length);
        }
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
