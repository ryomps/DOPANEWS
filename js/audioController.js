/**
 * DOPANEWS Audio & Spectrum Visualizer Controller
 * - Suno APIのstreamAudioUrl / audioUrl またはローカルMP3を <audio> で再生
 * - MP3未選択時のプリセットテスト用に 112 BPM Boom Bap ビートシンセサイザーも内蔵
 * - 曲終了時（endedイベント）にコールバックを発火し、JUDGE TIME（投票画面）へ自動遷移
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  class AudioController {
    constructor({ audioElement, canvasElement, onTimeUpdate, onEnded, onPlayStateChange }) {
      this.audio = audioElement;
      this.canvas = canvasElement;
      this.ctx2d = canvasElement ? canvasElement.getContext('2d') : null;
      this.onTimeUpdate = onTimeUpdate || (() => {});
      this.onEnded = onEnded || (() => {});
      this.onPlayStateChange = onPlayStateChange || (() => {});

      this.audioCtx = null;
      this.analyser = null;
      this.mediaSource = null;
      this.dataArray = null;
      this.rafId = null;

      this.usingSynthFallback = false;
      this.synthPlaying = false;
      this.synthStartTime = 0;
      this.synthPausedAt = 0;
      this.synthDuration = 45;
      this.synthTimerId = null;
      this.synthBeatIntervalId = null;
      this.activeSpeaker = 'KENTA';

      this._bindAudioEvents();
      this._startIdleVisualizer();
    }

    _bindAudioEvents() {
      this.audio.addEventListener('timeupdate', () => {
        if (!this.usingSynthFallback) {
          const dur =
            Number.isFinite(this.audio.duration) && this.audio.duration > 0
              ? this.audio.duration
              : 48;
          this.onTimeUpdate(this.audio.currentTime, dur);
        }
      });

      this.audio.addEventListener('play', () => {
        if (!this.usingSynthFallback) {
          this.onPlayStateChange(true);
        }
      });

      this.audio.addEventListener('pause', () => {
        if (!this.usingSynthFallback) {
          this.onPlayStateChange(false);
        }
      });

      this.audio.addEventListener('ended', () => {
        if (!this.usingSynthFallback) {
          this.onPlayStateChange(false);
          this.onEnded();
        }
      });
    }

    _ensureAudioContext() {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContextClass();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 64;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    }

    async loadAndPlayUrl(url) {
      this.stopSynth();
      this.usingSynthFallback = false;

      this.audio.src = url;
      this.audio.currentTime = 0;

      try {
        this._ensureAudioContext();
        if (!this.mediaSource) {
          try {
            this.mediaSource = this.audioCtx.createMediaElementSource(this.audio);
            this.mediaSource.connect(this.analyser);
            this.analyser.connect(this.audioCtx.destination);
          } catch {
            // CORS制限時でも再生を継続
          }
        }
        await this.audio.play();
      } catch (err) {
        console.warn('Auto-play warning:', err);
        this.onPlayStateChange(false);
      }
    }

    startSynthBattle(durationSec = 45) {
      this.audio.pause();
      this.usingSynthFallback = true;
      this.synthDuration = durationSec;
      this.synthPausedAt = 0;
      this.playSynth();
    }

    playSynth() {
      this._ensureAudioContext();
      this.usingSynthFallback = true;
      this.synthPlaying = true;
      this.synthStartTime = performance.now() - this.synthPausedAt * 1000;
      this.onPlayStateChange(true);

      let step = 0;
      clearInterval(this.synthBeatIntervalId);
      this.synthBeatIntervalId = setInterval(() => {
        if (!this.synthPlaying) return;
        this._triggerBoomBapStep(step % 16);
        step++;
      }, 134);

      clearInterval(this.synthTimerId);
      this.synthTimerId = setInterval(() => {
        if (!this.synthPlaying) return;
        const elapsed = (performance.now() - this.synthStartTime) / 1000;
        if (elapsed >= this.synthDuration) {
          this.onTimeUpdate(this.synthDuration, this.synthDuration);
          this.stopSynth();
          this.onEnded();
        } else {
          this.onTimeUpdate(elapsed, this.synthDuration);
        }
      }, 80);
    }

    pauseSynth() {
      if (!this.synthPlaying) return;
      this.synthPlaying = false;
      this.synthPausedAt = (performance.now() - this.synthStartTime) / 1000;
      clearInterval(this.synthBeatIntervalId);
      clearInterval(this.synthTimerId);
      this.onPlayStateChange(false);
    }

    stopSynth() {
      this.synthPlaying = false;
      this.synthPausedAt = 0;
      clearInterval(this.synthBeatIntervalId);
      clearInterval(this.synthTimerId);
      this.onPlayStateChange(false);
    }

    togglePlay() {
      if (this.usingSynthFallback) {
        if (this.synthPlaying) {
          this.pauseSynth();
        } else {
          if (this.synthPausedAt >= this.synthDuration) {
            this.synthPausedAt = 0;
          }
          this.playSynth();
        }
        return;
      }

      if (!this.audio.src) {
        this.startSynthBattle(45);
        return;
      }

      if (this.audio.paused) {
        this._ensureAudioContext();
        this.audio.play();
      } else {
        this.audio.pause();
      }
    }

    seekTo(seconds) {
      if (this.usingSynthFallback) {
        this.synthPausedAt = Math.max(0, Math.min(seconds, this.synthDuration));
        this.synthStartTime = performance.now() - this.synthPausedAt * 1000;
        this.onTimeUpdate(this.synthPausedAt, this.synthDuration);
        return;
      }
      if (this.audio.src) {
        this.audio.currentTime = seconds;
      }
    }

    setActiveSpeaker(speaker) {
      this.activeSpeaker = speaker === 'REINA' ? 'REINA' : 'KENTA';
    }

    _triggerBoomBapStep(step16) {
      if (!this.audioCtx) return;
      const now = this.audioCtx.currentTime;

      if (step16 === 0 || step16 === 7 || step16 === 10) {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(135, now);
        osc.frequency.exponentialRampToValueAtTime(38, now + 0.14);
        gain.gain.setValueAtTime(0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.connect(gain);
        gain.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.17);
      }

      if (step16 === 4 || step16 === 12) {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.09);
        gain.gain.setValueAtTime(0.28, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(gain);
        gain.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.11);
      }

      if (step16 === 0 || step16 === 3 || step16 === 6 || step16 === 10 || step16 === 14) {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sawtooth';
        const noteFreq = this.activeSpeaker === 'REINA' ? 65.41 : 55.0;
        osc.frequency.setValueAtTime(noteFreq, now);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.13);
      }
    }

    _startIdleVisualizer() {
      const render = () => {
        this.rafId = requestAnimationFrame(render);
        if (!this.ctx2d || !this.canvas) return;

        const width = this.canvas.width;
        const height = this.canvas.height;
        this.ctx2d.clearRect(0, 0, width, height);

        const barCount = 28;
        const gap = 4;
        const barWidth = (width - gap * (barCount - 1)) / barCount;

        let freqValues = null;
        if (this.analyser && this.dataArray) {
          this.analyser.getByteFrequencyData(this.dataArray);
          freqValues = this.dataArray;
        }

        const isPlaying = this.usingSynthFallback ? this.synthPlaying : !this.audio.paused;
        const t = performance.now() / 160;

        for (let i = 0; i < barCount; i++) {
          let ratio = 0.12;
          if (isPlaying) {
            const analyserVal = freqValues ? freqValues[i % freqValues.length] / 255 : 0;
            const waveVal =
              0.25 +
              0.45 * Math.abs(Math.sin(t + i * 0.45)) * Math.abs(Math.cos(t * 0.7 - i * 0.2));
            ratio = Math.max(0.14, Math.min(0.98, analyserVal > 0.05 ? analyserVal : waveVal));
          } else {
            ratio = 0.1 + 0.05 * Math.sin(t * 0.4 + i * 0.3);
          }

          const barHeight = Math.max(4, ratio * height);
          const x = i * (barWidth + gap);
          const y = height - barHeight;

          const grad = this.ctx2d.createLinearGradient(0, height, 0, 0);
          if (this.activeSpeaker === 'REINA') {
            grad.addColorStop(0, '#0066FF');
            grad.addColorStop(1, '#00F0FF');
          } else {
            grad.addColorStop(0, '#FF2A54');
            grad.addColorStop(1, '#FF9F1C');
          }

          this.ctx2d.fillStyle = grad;
          this.ctx2d.beginPath();
          this.ctx2d.roundRect(x, y, barWidth, barHeight, 3);
          this.ctx2d.fill();
        }
      };

      render();
    }
  }

  DOPANEWS.AudioController = AudioController;
})(window);
