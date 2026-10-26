/**
 * DOPANEWS 9:16 Vertical Battle Stage Component
 * - 現在歌っているMC（KENTA / REINA）のアバター強調演出
 * - パンチライン字幕アニメーション、要点メモ、踏んでいる韻バッジの表示
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

      // 将来拡張用レイヤー参照（ファクトチェッカー＆カットイン演出）
      this.factCheckSlotEl = document.getElementById('fact-check-slot');
      this.cutinOverlayLayerEl = document.getElementById('cutin-overlay-layer');
    }

    setBattleData(battleData) {
      this.battleData = battleData;
      this.currentVerseIndex = -1;

      if (this.titleEl) this.titleEl.textContent = battleData.title;
      if (this.topicEl) this.topicEl.textContent = battleData.topic_summary;

      this._renderVersePills();
      if (battleData.verses.length > 0) {
        this.activateVerse(0, false);
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
        btn.title = `${verse.start_time_sec}s〜: ${verse.point_summary}`;
        btn.addEventListener('click', () => {
          this.onSelectVerse(idx, verse.start_time_sec);
        });
        this.versePillsEl.appendChild(btn);
      });
    }

    syncTime(currentTimeSec, durationSec = 45) {
      if (this.timerEl) {
        this.timerEl.textContent = `${this._formatTime(currentTimeSec)} / ${this._formatTime(durationSec)}`;
      }
      if (this.progressFillEl && durationSec > 0) {
        const pct = Math.min(100, Math.max(0, (currentTimeSec / durationSec) * 100));
        this.progressFillEl.style.width = `${pct}%`;
      }

      if (!this.battleData || !this.battleData.verses.length) return;

      let targetIdx = 0;
      for (let i = 0; i < this.battleData.verses.length; i++) {
        if (currentTimeSec >= this.battleData.verses[i].start_time_sec) {
          targetIdx = i;
        }
      }

      if (targetIdx !== this.currentVerseIndex) {
        this.activateVerse(targetIdx, true);
      }
    }

    activateVerse(index, animate = true) {
      if (!this.battleData || !this.battleData.verses[index]) return;
      this.currentVerseIndex = index;
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
          ? '❄️ MC REINA <span class="mc-sub">COOL DATA & LOGIC</span>'
          : '🔥 MC KENTA <span class="mc-sub">STREET VOICE & PASSION</span>';
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
          .map((line) => `<p class="lyric-line">${this._escapeHtml(line)}</p>`)
          .join('');
      }

      if (this.rhymeBadgeEl) {
        this.rhymeBadgeEl.textContent = verse.rhyme_words || '韻ロックオン';
      }

      if (this.pointSummaryEl) {
        this.pointSummaryEl.textContent = verse.point_summary;
      }

      this._renderFutureFactCheckSlot(verse);
    }

    /**
     * 【拡張用】第3の審判AI（ファクトチェッカー）表示フック
     */
    _renderFutureFactCheckSlot(verse) {
      if (!this.factCheckSlotEl) return;
      this.factCheckSlotEl.dataset.factStatus = verse.fact_check_status || 'UNVERIFIED';
    }

    /**
     * 【拡張用】カットイン演出（乱入・パンチライン特大エフェクト）発火用インターフェース
     */
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
