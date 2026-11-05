/** Reflect on the two viewpoints after listening; retain votes for Library. */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});
  const VOTES_KEY = 'dopanews_library_votes_v1';
  let sessionVotes = [];
  function battleKey(data) {
    return JSON.stringify({
      title: data?.title, topic_summary: data?.topic_summary,
      kenta_stance: data?.kenta_stance, reina_stance: data?.reina_stance,
      verses: (data?.verses || []).map(v => ({ speaker: v.speaker, lyric: v.lyric, point_summary: v.point_summary }))
    });
  }
  function readVotes() {
    try {
      const stored = JSON.parse(localStorage.getItem(VOTES_KEY) || 'null');
      if (Array.isArray(stored)) sessionVotes = stored.filter(v => typeof v.key === 'string' && v.battleData?.title && ['KENTA','REINA','UNDECIDED'].includes(v.choice));
    } catch { /* Session votes still work when storage is unavailable. */ }
    return sessionVotes;
  }
  function saveVote(data, choice) {
    const key = battleKey(data);
    sessionVotes = [{ key, battleData: data, choice, votedAt: new Date().toISOString() }, ...readVotes().filter(v => v.key !== key)];
    try { localStorage.setItem(VOTES_KEY, JSON.stringify(sessionVotes)); } catch { /* Keep the vote for this session. */ }
  }
  DOPANEWS.battleReflectionKey = battleKey;
  DOPANEWS.readBattleVotes = readVotes;

  class JudgeModal {
    constructor({ onReplay, onChoose }) {
      this.onChoose = onChoose || (() => {});
      this.onReplay = onReplay || (() => {});
      this.battleData = null;
      this.reflections = new Map(readVotes().map(v => [v.key, { choice: v.choice }]));
      this.overlayEl = document.getElementById('judge-modal-overlay');
      this.cardEl = this.overlayEl.querySelector('.judge-modal-card');
      this.titleEl = document.getElementById('judge-battle-title');
      this.kentaStanceEl = document.getElementById('judge-kenta-stance');
      this.reinaStanceEl = document.getElementById('judge-reina-stance');
      this.buttons = {
        KENTA: document.getElementById('btn-vote-kenta'),
        REINA: document.getElementById('btn-vote-reina'),
        UNDECIDED: document.getElementById('btn-reflect-undecided')
      };
      Object.entries(this.buttons).forEach(([choice, button]) => {
        button.addEventListener('click', () => {
          this.reflections.get(this.battleKey).choice = choice;
          saveVote(this.battleData, choice);
          this._renderSelection();
          this.close();
          this.onChoose(choice);
        });
      });
      document.getElementById('btn-close-judge').addEventListener('click', () => this.close());
      document.getElementById('btn-replay-battle').addEventListener('click', () => {
        this.close();
        this.onReplay();
      });
      this.overlayEl.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') this.close();
        if (event.key !== 'Tab') return;
        const focusable = [...this.overlayEl.querySelectorAll('button, textarea')]
          .filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === this.cardEl)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });
    }

    open(battleData) {
      if (this.overlayEl.classList.contains('hidden')) this.previousFocus = document.activeElement;
      this.battleData = battleData;
      // Identify the script, excluding mutable music style and synchronization metadata.
      this.battleKey = battleKey(battleData);
      if (!this.reflections.has(this.battleKey)) {
        this.reflections.set(this.battleKey, { choice: null });
      }
      this.titleEl.textContent = battleData?.title || 'NEWS RAP BATTLE';
      this.kentaStanceEl.textContent = battleData?.kenta_stance || '';
      this.reinaStanceEl.textContent = battleData?.reina_stance || '';
      this._renderSelection();
      this.overlayEl.classList.remove('hidden');
      this.cardEl.focus();
    }

    close() {
      this.overlayEl.classList.add('hidden');
      this.previousFocus?.focus();
    }

    _renderSelection() {
      const { choice } = this.reflections.get(this.battleKey);
      Object.entries(this.buttons).forEach(([value, button]) => {
        button.setAttribute('aria-pressed', String(choice === value));
      });
    }
  }

  DOPANEWS.JudgeModal = JudgeModal;
})(window);
