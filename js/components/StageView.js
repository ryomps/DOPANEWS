/**
 * DOPANEWS 9:16 Vertical Battle Stage Component
 * - 8小節（8行）× 4本 のMCバトル表示＆現在歌っている小節のリアルタイムハイライト
 * - 固定Murekaビート(115 BPM)＋男女MCボーカル合成のミリ秒タイムスタンプ完全同期
 * - 【拡張用】ファクトチェッカー表示スロット (#fact-check-slot) と
 *   カットイン演出用オーバーレイレイヤー (#cutin-overlay-layer) を内蔵
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});
  const shortStances = new Map([
    ['安心して発言できる場を守るため、サービス設計の改善を重視。', '安心して発言できる仕組みを'],
    ['小さな声を消さないため、透明性と異議を伝える手段を重視。', '透明性と異議を伝える手段を'],
    ['生活を守るため、大人も守る利用ルールを重視。', '大人も守るスマホルールを'],
    ['子どもの事情を聞き、一緒にルールを見直すことを重視。', '親子の対話でルールを見直す'],
    ['現代のストレス社会では手軽な癒やしが必要であり、タイパ重視は合理的な生存戦略である。', '手軽な癒やしと効率を重視'],
    ['安易な快楽への依存は思考力を奪い、次世代への悪影響も大きいため、デジタルとの距離を再考すべき。', '親もスマホとの距離を見直す'],
    ['取り締まりの急激な強化に疑問を呈し、庶民の利便性やインフラ整備の遅れを指摘する。', '罰則より先に道路整備を'],
    ['「ながら運転」の多さを危険視し、ルール徹底による事故防止と社会全体の安全性を重視する。', 'ルールの徹底で事故を防ぐ'],
  ]);
  const conciseStance = text => shortStances.get(String(text || '').trim()) || text || '';

  class StageView {
    constructor({ onSelectVerse }) {
      this.onSelectVerse = onSelectVerse || (() => {});
      this.battleData = null;
      this.currentVerseIndex = -1;
      this.currentLineIndex = -1;
      this.lastKnownDuration = 67;

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
      if (this.kentaStanceEl) this.kentaStanceEl.textContent = battleData.kenta_stance_short || conciseStance(battleData.kenta_stance);
      if (this.reinaStanceEl) this.reinaStanceEl.textContent = battleData.reina_stance_short || conciseStance(battleData.reina_stance);

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
        return this.battleData.verses.map((_, i) => ({
          start: this.manualIntroOffsetSec + i * span,
          end: this.manualIntroOffsetSec + (i + 1) * span
        }));
      }
      if (Array.isArray(this.battleData?.part_segments) && this.battleData.part_segments.length > 0) {
        return this.battleData.part_segments.map((seg) => ({
          start: seg.start,
          end: seg.end
        }));
      }
      const dur = Number.isFinite(durationSec) && durationSec > 10 ? durationSec : this.lastKnownDuration;
      const verses = this.battleData?.verses || [];
      const count = verses.length || 4;

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
        btn.textContent = `V${idx + 1} ${DOPANEWS.getMcName?.(verse.speaker, this.battleData) || verse.speaker}`;
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
    syncTime(currentTimeSec, durationSec = 67) {
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

      if (Array.isArray(this.battleData.part_segments) && this.battleData.part_segments.length > 0) {
        const segments = this.battleData.part_segments;
        let index = segments.findIndex((part) => currentTimeSec >= part.start && currentTimeSec < part.end);
        if (index < 0) {
          if (currentTimeSec < segments[0].start) {
            index = 0;
          } else if (currentTimeSec >= segments[segments.length - 1].end) {
            index = segments.length - 1;
          }
        }
        if (index < 0) {
          this._showUnassignedPart(false);
          return;
        }
        if (index !== this.currentVerseIndex) {
          this.activateVerse(index, true);
        }
        this._highlightCurrentBar(index, currentTimeSec, segments[index]);
        return;
      }

      if (this.battleData.mureka_sync) {
        const active = (this.battleData.mureka_timeline || []).filter(
          (line) => currentTimeSec >= line.start_sec && currentTimeSec < line.end_sec
        );
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

      if (Array.isArray(verse.timed_lines) && verse.timed_lines.length > 0) {
        activeLineIdx = -1;
        activeIndices = new Set();
        for (let i = 0; i < verse.timed_lines.length; i++) {
          const timedLine = verse.timed_lines[i];
          if (currentTimeSec >= timedLine.start_sec && currentTimeSec < timedLine.end_sec) {
            const indices = timedLine.line_indices || (verse.lyric_reading ? [] : [i]);
            indices.forEach((index) => {
              if (index >= 0 && index < lineEls.length) activeIndices.add(index);
            });
          }
        }
        if (activeIndices.size) {
          activeLineIdx = Math.min(...activeIndices);
        } else if (currentTimeSec < verse.timed_lines[0].start_sec) {
          activeLineIdx = 0;
          activeIndices.add(0);
        } else if (currentTimeSec >= verse.timed_lines[verse.timed_lines.length - 1].end_sec) {
          activeLineIdx = lineEls.length - 1;
          activeIndices.add(lineEls.length - 1);
        }
      } else if (verseWindow) {
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
      if (this.lyricVerseChanged) {
        this._scrollLyrics(0, false);
      } else if (activeEl && this.lyricBoxEl.scrollHeight > this.lyricBoxEl.clientHeight) {
        // Scroll only the lyrics, including when the phone preview is scaled.
        const box = this.lyricBoxEl;
        const boxRect = box.getBoundingClientRect();
        const scale = boxRect.height / box.offsetHeight || 1;
        const lineRect = activeEl.getBoundingClientRect();
        const lineTop = (lineRect.top - boxRect.top) / scale + box.scrollTop - box.clientTop;
        const target = lineTop - (box.clientHeight - activeEl.offsetHeight) / 2;
        this._scrollLyrics(target, !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      }
      this.lyricVerseChanged = false;
    }

    _scrollLyrics(target, smooth) {
      if (this.lyricScrollFrame) cancelAnimationFrame(this.lyricScrollFrame);
      this.lyricScrollFrame = null;
      const box = this.lyricBoxEl;
      if (!box) return;
      const top = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, target));
      if (!smooth) { box.scrollTop = top; return; }
      const start = box.scrollTop;
      const startedAt = performance.now();
      const step = now => {
        const progress = Math.min(1, (now - startedAt) / 280);
        box.scrollTop = start + (top - start) * (1 - Math.pow(1 - progress, 3));
        this.lyricScrollFrame = progress < 1 ? requestAnimationFrame(step) : null;
      };
      this.lyricScrollFrame = requestAnimationFrame(step);
    }

    activateVerse(index, animate = true) {
      if (!this.battleData || !this.battleData.verses[index]) return;
      this.currentVerseIndex = index;
      this.currentLineIndex = -1;
      this.currentLineKey = null;
      this.lyricVerseChanged = true;
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
        const name = String(DOPANEWS.getMcName?.(verse.speaker, this.battleData) || verse.speaker).replace(/[&<>"']/g, '');
        this.activeSpeakerBadgeEl.innerHTML = 'MC ' + name + '<span class="mc-sub">' + (isReina ? '8 BARS / DATA & LOGIC' : '8 BARS / STREET PASSION') + '</span>';
        this.activeSpeakerBadgeEl.className = `active-speaker-badge ${isReina ? 'badge-reina' : 'badge-kenta'}`;
      }

      if (this.sectionTagEl) {
        this.sectionTagEl.textContent = verse.section_tag;
      }

      if (this.lyricBoxEl) {
        // Cancel the previous verse's scroll before replacing its lines.
        // Scaling this container during entry also distorts scroll coordinates.
        this.lyricBoxEl.classList.remove('lyric-slam-anim');
        this._scrollLyrics(0, false);
        const lines = verse.lyric.split('\n').filter(Boolean);
        this.lyricBoxEl.innerHTML = lines
          .map(
            (line, i) =>
              `<p class="lyric-line ${i === 0 ? 'line-active' : ''}">${this._escapeHtml(line)}</p>`
          )
          .join('');
        this.lyricBoxEl.scrollTop = 0;
        // Reset again after the new verse has laid out; pending smooth scrolls
        // and browser anchoring must not retain the previous MC's position.
        if (this.lyricResetFrame) cancelAnimationFrame(this.lyricResetFrame);
        const renderedVerse = verse;
        this.lyricResetFrame = requestAnimationFrame(() => {
          if (this.battleData?.verses?.[this.currentVerseIndex] !== renderedVerse) return;
          this._scrollLyrics(0, false);
        });
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
      if (this.lyricBoxEl) {
        this.lyricBoxEl.textContent = hasLyrics
          ? '元の台本と照合できないため、MC表示を保留しています。'
          : '次のリリックを待っています。';
      }
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
        ? `MC ${DOPANEWS.getMcName?.(verse.speaker, this.battleData) || verse.speaker} ${this.isPlaying ? 'が発言中' : 'のバース・一時停止中'}`
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
