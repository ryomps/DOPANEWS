/** Reflect on the two viewpoints after listening. State lasts for this page session. */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  class JudgeModal {
    constructor({ onReplay }) {
      this.onReplay = onReplay || (() => {});
      this.battleData = null;
      this.reflections = new Map();
      this.overlayEl = document.getElementById('judge-modal-overlay');
      this.cardEl = this.overlayEl.querySelector('.judge-modal-card');
      this.titleEl = document.getElementById('judge-battle-title');
      this.kentaStanceEl = document.getElementById('judge-kenta-stance');
      this.reinaStanceEl = document.getElementById('judge-reina-stance');
      this.panelEl = document.getElementById('reflection-panel');
      this.selectionEl = document.getElementById('reflection-selection');
      this.noteEl = document.getElementById('reflection-note');
      this.buttons = {
        KENTA: document.getElementById('btn-vote-kenta'),
        REINA: document.getElementById('btn-vote-reina'),
        UNDECIDED: document.getElementById('btn-reflect-undecided')
      };
      Object.entries(this.buttons).forEach(([choice, button]) => {
        button.addEventListener('click', () => {
          this.reflections.get(this.battleKey).choice = choice;
          this._renderSelection();
        });
      });
      this.noteEl.addEventListener('input', () => {
        this.reflections.get(this.battleKey).note = this.noteEl.value;
      });
      document.getElementById('btn-close-judge').addEventListener('click', () => this.close());
      document.getElementById('btn-replay-battle').addEventListener('click', () => {
        this.close();
        this.onReplay();
      });
      this.overlayEl.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') this.close();
        if (event.key !== 'Tab') return;
        const focusable = [...this.cardEl.querySelectorAll('button, textarea')]
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
      this.battleKey = JSON.stringify({
        title: battleData?.title,
        topic_summary: battleData?.topic_summary,
        kenta_stance: battleData?.kenta_stance,
        reina_stance: battleData?.reina_stance,
        verses: (battleData?.verses || []).map((verse) => ({
          speaker: verse.speaker,
          lyric: verse.lyric,
          point_summary: verse.point_summary
        }))
      });
      if (!this.reflections.has(this.battleKey)) {
        this.reflections.set(this.battleKey, { choice: null, note: '' });
      }
      this.titleEl.textContent = battleData?.title || 'NEWS RAP BATTLE';
      this.kentaStanceEl.textContent = battleData?.kenta_stance || '';
      this.reinaStanceEl.textContent = battleData?.reina_stance || '';
      this.noteEl.value = this.reflections.get(this.battleKey).note;
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
      this.panelEl.classList.toggle('hidden', !choice);
      const messages = {
        KENTA: '今の自分は、KENTAの意見に近い。',
        REINA: '今の自分は、REINAの意見に近い。',
        UNDECIDED: 'まだ考え中。それも今の自分の考えです。'
      };
      this.selectionEl.textContent = messages[choice] || '';
    }
  }

  DOPANEWS.JudgeModal = JudgeModal;
})(window);
