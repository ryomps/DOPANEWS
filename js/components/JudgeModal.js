/**
 * DOPANEWS JUDGE TIME (投票モーダル／オーバーレイ) Component
 * - 曲終了時（endedイベント）または「投票へ進む」ボタン押下時にポップアップ
 * - ワンタップまたは左右スワイプで KENTA（赤） / REINA（青） に投票
 * - ド派手なパーティクル＆勝敗バー演出を表示
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  class JudgeModal {
    constructor({ onReplay }) {
      this.onReplay = onReplay || (() => {});
      this.battleData = null;
      this.hasVoted = false;

      this.overlayEl = document.getElementById('judge-modal-overlay');
      this.titleEl = document.getElementById('judge-battle-title');
      this.kentaStanceEl = document.getElementById('judge-kenta-stance');
      this.reinaStanceEl = document.getElementById('judge-reina-stance');
      this.voteBtnKentaEl = document.getElementById('btn-vote-kenta');
      this.voteBtnReinaEl = document.getElementById('btn-vote-reina');
      this.resultBoxEl = document.getElementById('judge-result-box');
      this.barKentaEl = document.getElementById('judge-bar-kenta');
      this.barReinaEl = document.getElementById('judge-bar-reina');
      this.pctKentaEl = document.getElementById('judge-pct-kenta');
      this.pctReinaEl = document.getElementById('judge-pct-reina');
      this.countKentaEl = document.getElementById('judge-count-kenta');
      this.countReinaEl = document.getElementById('judge-count-reina');
      this.winnerBannerEl = document.getElementById('judge-winner-banner');
      this.closeBtnEl = document.getElementById('btn-close-judge');
      this.replayBtnEl = document.getElementById('btn-replay-battle');
      this.burstContainerEl = document.getElementById('judge-burst-container');

      this._bindEvents();
    }

    _bindEvents() {
      if (this.voteBtnKentaEl) {
        this.voteBtnKentaEl.addEventListener('click', () => this.castVote('KENTA'));
      }
      if (this.voteBtnReinaEl) {
        this.voteBtnReinaEl.addEventListener('click', () => this.castVote('REINA'));
      }
      if (this.closeBtnEl) {
        this.closeBtnEl.addEventListener('click', () => this.close());
      }
      if (this.replayBtnEl) {
        this.replayBtnEl.addEventListener('click', () => {
          this.close();
          this.onReplay();
        });
      }

      let touchStartX = null;
      if (this.overlayEl) {
        this.overlayEl.addEventListener(
          'touchstart',
          (e) => {
            if (e.touches.length === 1) {
              touchStartX = e.touches[0].clientX;
            }
          },
          { passive: true }
        );

        this.overlayEl.addEventListener(
          'touchend',
          (e) => {
            if (touchStartX === null || this.hasVoted) return;
            const deltaX = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(deltaX) > 70) {
              if (deltaX < 0) {
                this.castVote('KENTA');
              } else {
                this.castVote('REINA');
              }
            }
            touchStartX = null;
          },
          { passive: true }
        );
      }
    }

    open(battleData) {
      this.battleData = battleData;
      this.hasVoted = false;

      if (this.titleEl) this.titleEl.textContent = battleData?.title || 'NEWS RAP BATTLE';
      if (this.kentaStanceEl) this.kentaStanceEl.textContent = battleData?.kenta_stance || '';
      if (this.reinaStanceEl) this.reinaStanceEl.textContent = battleData?.reina_stance || '';

      if (this.resultBoxEl) this.resultBoxEl.classList.add('hidden');
      if (this.voteBtnKentaEl) {
        this.voteBtnKentaEl.classList.remove('voted-winner', 'voted-dim');
      }
      if (this.voteBtnReinaEl) {
        this.voteBtnReinaEl.classList.remove('voted-winner', 'voted-dim');
      }

      if (this.overlayEl) {
        this.overlayEl.classList.remove('hidden');
      }
    }

    close() {
      if (this.overlayEl) {
        this.overlayEl.classList.add('hidden');
      }
    }

    castVote(choice) {
      if (this.hasVoted) return;
      this.hasVoted = true;

      const isKenta = choice === 'KENTA';
      if (this.voteBtnKentaEl && this.voteBtnReinaEl) {
        this.voteBtnKentaEl.classList.toggle('voted-winner', isKenta);
        this.voteBtnKentaEl.classList.toggle('voted-dim', !isKenta);
        this.voteBtnReinaEl.classList.toggle('voted-winner', !isKenta);
        this.voteBtnReinaEl.classList.toggle('voted-dim', isKenta);
      }

      const storageKey = `dopanews_votes_${this.battleData?.title || 'default'}`;
      let saved = { kenta: 142, reina: 138 };
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) saved = JSON.parse(raw);
      } catch {
        // ignore
      }

      if (isKenta) {
        saved.kenta += 1;
      } else {
        saved.reina += 1;
      }

      try {
        localStorage.setItem(storageKey, JSON.stringify(saved));
      } catch {
        // ignore
      }

      const total = saved.kenta + saved.reina;
      const kentaPct = Math.round((saved.kenta / total) * 100);
      const reinaPct = 100 - kentaPct;

      if (this.resultBoxEl) {
        this.resultBoxEl.classList.remove('hidden');
      }

      if (this.barKentaEl && this.barReinaEl) {
        this.barKentaEl.style.width = '50%';
        this.barReinaEl.style.width = '50%';
        requestAnimationFrame(() => {
          setTimeout(() => {
            this.barKentaEl.style.width = `${kentaPct}%`;
            this.barReinaEl.style.width = `${reinaPct}%`;
          }, 40);
        });
      }

      if (this.pctKentaEl) this.pctKentaEl.textContent = `${kentaPct}%`;
      if (this.pctReinaEl) this.pctReinaEl.textContent = `${reinaPct}%`;
      if (this.countKentaEl) this.countKentaEl.textContent = `${saved.kenta.toLocaleString()} 票`;
      if (this.countReinaEl) this.countReinaEl.textContent = `${saved.reina.toLocaleString()} 票`;

      if (this.winnerBannerEl) {
        const winnerName = isKenta ? '🔥 MC KENTA に投票完了！' : '❄️ MC REINA に投票完了！';
        const leadText =
          saved.kenta >= saved.reina
            ? '現在 MC KENTA（現場・変革派）が優勢！'
            : '現在 MC REINA（データ・合理派）が優勢！';
        this.winnerBannerEl.innerHTML = `<span class="winner-main">${winnerName}</span><span class="winner-sub">${leadText}</span>`;
        this.winnerBannerEl.className = `judge-winner-banner ${isKenta ? 'banner-kenta' : 'banner-reina'}`;
      }

      this._spawnDopamineBurst(isKenta ? '#FF2A54' : '#00F0FF', isKenta ? '#FF9F1C' : '#0066FF');
    }

    _spawnDopamineBurst(color1, color2) {
      if (!this.burstContainerEl) return;
      this.burstContainerEl.innerHTML = '';

      for (let i = 0; i < 32; i++) {
        const p = document.createElement('span');
        p.className = 'dopamine-particle';
        const angle = (Math.PI * 2 * i) / 32 + (Math.random() - 0.5) * 0.25;
        const dist = 70 + Math.random() * 140;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;
        p.style.setProperty('--tx', `${tx}px`);
        p.style.setProperty('--ty', `${ty}px`);
        p.style.background = i % 2 === 0 ? color1 : color2;
        this.burstContainerEl.appendChild(p);
      }
    }
  }

  DOPANEWS.JudgeModal = JudgeModal;
})(window);
