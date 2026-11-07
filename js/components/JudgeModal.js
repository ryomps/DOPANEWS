/** Reflect on the two viewpoints after listening; retain votes for Library. */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});
  const VOTES_KEY = 'dopanews_library_votes_v1';
  let sessionVotes = [];
  function battleKey(data) {
    return JSON.stringify({
      ...(!data?.verses?.length ? {title:data?.title, topic_summary:data?.topic_summary} : {}),
      kenta_stance: data?.kenta_stance, reina_stance: data?.reina_stance,
      verses: (data?.verses || []).map(v => ({ speaker: v.speaker, lyric: v.lyric, point_summary: v.point_summary }))
    });
  }
  function readVotes() {
    try {
      const stored = JSON.parse(localStorage.getItem(VOTES_KEY) || 'null');
      if (Array.isArray(stored)) sessionVotes = stored.filter(v => typeof v.key === 'string' && v.battleData?.title && ['KENTA','REINA','UNDECIDED'].includes(v.choice));
    } catch { /* Session votes still work when storage is unavailable. */ }
    const latest = new Map();
    sessionVotes.slice().sort((a,b) => String(b.votedAt || '').localeCompare(String(a.votedAt || ''))).forEach(vote => {
      const key = battleKey(vote.battleData);
      if (!latest.has(key)) latest.set(key, {...vote, key});
    });
    sessionVotes = [...latest.values()];
    return sessionVotes;
  }
  function saveVote(data, choice) {
    const key = battleKey(data);
    const app = global.dopaNewsApp;
    const playback = app?.currentBattleData && battleKey(app.currentBattleData) === key
      ? { audioUrl: app.currentAudioUrl, articleText: app.currentArticleText, synthDuration: app.currentSynthDuration } : {};
    sessionVotes = [{ key, battleData: data, ...playback, choice, votedAt: new Date().toISOString() }, ...readVotes().filter(v => v.key !== key)];
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
          this._animateVoteToLibrary(button);
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

    _animateVoteToLibrary(button) {
      const library = document.querySelector?.('.app-nav-library');
      if (!library?.animate) return;

      this.voteFlight?.cancel();
      this.libraryPulse?.cancel();
      const playSound = this._prepareVoteSound();
      const reducedMotion = global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      let reacted = false;
      const react = () => {
        if (reacted) return;
        reacted = true;
        this.libraryPulse = library.animate(reducedMotion
          ? [{ opacity: 1 }, { opacity: 0.65 }, { opacity: 1 }]
          : [{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.3 }, { transform: 'scale(1)' }],
        { duration: 280, easing: 'ease-out' });
        playSound?.();
      };
      const portrait = button.querySelector('img');
      if (!portrait || reducedMotion) { react(); return; }

      const from = portrait.getBoundingClientRect();
      const to = (library.querySelector('svg') || library).getBoundingClientRect();
      if (!from.width || !from.height || !to.width || !to.height) { react(); return; }

      const flyer = document.createElement('img');
      flyer.src = portrait.currentSrc || portrait.src;
      flyer.alt = '';
      flyer.className = 'vote-library-flight';
      Object.assign(flyer.style, {
        left: `${from.left}px`, top: `${from.top}px`,
        width: `${from.width}px`, height: `${from.height}px`
      });
      document.body.append(flyer);
      const dx = to.left + to.width / 2 - from.left - from.width / 2;
      const dy = to.top + to.height / 2 - from.top - from.height / 2;
      // Use one continuous curve for travel, shrink and absorption.
      const frames = Array.from({ length: 61 }, (_, index) => {
        const t = index / 60;
        const sideways = 1 - Math.pow(1 - t, 2);
        const nearIcon = Math.max(0, (t - 0.84) / 0.16);
        const absorb = nearIcon * nearIcon * (3 - 2 * nearIcon);
        const scale = 1 - 0.66 * t - 0.29 * absorb;
        return {
          transform: `translate(${dx * sideways}px, ${dy * t}px) scale(${scale})`,
          opacity: 1 - absorb
        };
      });
      const flight = this.voteFlight = flyer.animate(frames, {
        delay: 180, duration: 750, easing: 'cubic-bezier(.32, 0, .42, 1)', fill: 'both'
      });
      let reactionFrame;
      const checkLanding = () => {
        if (this.voteFlight !== flight || flight.playState === 'idle') return;
        if (flight.effect.getComputedTiming().progress >= 0.94) react();
        else reactionFrame = global.requestAnimationFrame(checkLanding);
      };
      reactionFrame = global.requestAnimationFrame(checkLanding);
      flight.finished.then(react, () => {}).finally(() => {
        global.cancelAnimationFrame(reactionFrame);
        flyer.remove();
        if (this.voteFlight === flight) this.voteFlight = null;
      });
    }

    _prepareVoteSound() {
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return;
      try {
        const audio = this.voteAudio ||= new AudioContext();
        // Resume from the tap so playback can start at landing on iPhone.
        const resumed = audio.resume();
        this.voteSound ||= global.fetch('./media/effects/vote-confirm.mp3')
          .then(response => {
            if (!response.ok) throw new Error('Vote sound unavailable');
            return response.arrayBuffer();
          })
          .then(bytes => audio.decodeAudioData(bytes))
          .catch(() => { this.voteSound = null; });
        const ready = Promise.all([resumed, this.voteSound]).catch(() => []);
        return () => {
          void ready.then(([, buffer]) => {
            if (!buffer || audio.state !== 'running') return;
            const source = audio.createBufferSource();
            source.buffer = buffer;
            const volume = audio.createGain();
            volume.gain.value = 0.4;
            source.connect(volume).connect(audio.destination);
            source.start();
          }).catch(() => {});
        };
      } catch { /* Voting still works if sound is unavailable. */ }
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
