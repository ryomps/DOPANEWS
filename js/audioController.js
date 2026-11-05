/**
 * DOPANEWS Audio & Spectrum Visualizer Controller
 * - Mureka APIの生成音声URL または ローカルMP3を <audio> で確実に再生
 * - 外部CDNのCORS制限による無音化を防ぐため、<audio>は直接出力しビジュアライザーを連動
 * - ブラウザの自動再生ブロック時はステージ上の再生ボタンでワンタップ開始可能
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  class AudioController {
    constructor({
      audioElement,
      canvasElement,
      onTimeUpdate,
      onEnded,
      onPlayStateChange,
      onAutoplayBlocked,
      onPlaybackError
    }) {
      this.audio = audioElement;
      this.canvas = canvasElement;
      this.ctx2d = canvasElement ? canvasElement.getContext('2d') : null;
      this.onTimeUpdate = onTimeUpdate || (() => {});
      this.onEnded = onEnded || (() => {});
      this.onPlayStateChange = onPlayStateChange || (() => {});
      this.onAutoplayBlocked = onAutoplayBlocked || (() => {});
      this.onPlaybackError = onPlaybackError || (() => {});
      this.playbackVersion = 0;

      this.audioCtx = null;
      this.analyser = null;
      this.masterGain = null;
      this.volume = 1;
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
      this.audio.addEventListener('loadedmetadata', () => {
        if (!this.usingSynthFallback && Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
          this.onTimeUpdate(this.audio.currentTime, this.audio.duration);
        }
      });
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
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.value = this.volume;
        this.analyser.connect(this.masterGain);
        this.masterGain.connect(this.audioCtx.destination);
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    }

    /**
     * 生成された楽曲URL（Mureka CDN等）またはローカルMP3をセットして再生
     */
    async loadAndPlayUrl(url) {
      const version = ++this.playbackVersion;
      this.stopSynth();
      this.usingSynthFallback = false;

      // 外部CDNのMP3がCORSエラーでブロックされないよう crossorigin 属性を外す
      this.audio.removeAttribute('crossorigin');
      this.audio.src = url;
      this.audio.load();

      try {
        await this.audio.play();
        if (version === this.playbackVersion) {
          this.onPlayStateChange(true);
          return true;
        }
        return false;
      } catch (err) {
        if (version !== this.playbackVersion) return;
        this.onPlayStateChange(false);
        if (err.name === 'NotAllowedError') this.onAutoplayBlocked(url);
        else this.onPlaybackError(err);
        return false;
      }
    }

    stopPlayback() {
      this.playbackVersion++;
      this.stopSynth();
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.usingSynthFallback = false;
      this.onTimeUpdate(0, 0);
      this.onPlayStateChange(false);
    }

    startSynthBattle(durationSec = 45) {
      this.audio.pause();
      this.usingSynthFallback = true;
      this.synthDuration = durationSec;
      this.synthPausedAt = 0;
      this.onTimeUpdate(0, this.synthDuration);
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

      // Missing/generated-failed audio must never masquerade as a completed song.
      if (!this.audio.getAttribute('src')) {
        this.onPlayStateChange(false);
        this.onPlaybackError(new Error('音源がまだ生成されていません。ラップ生成を完了してから再生してください。'));
        return false;
      }

      if (this.audio.paused) {
        const version = this.playbackVersion;
        this.audio.play().catch((err) => {
          if (version !== this.playbackVersion) return;
          this.onPlayStateChange(false);
          this.onPlaybackError(err);
        });
      } else {
        this.audio.pause();
      }
    }

    pause() {
      if (this.usingSynthFallback) this.pauseSynth();
      else this.audio.pause();
    }

    seekTo(seconds) {
      if (this.usingSynthFallback) {
        this.synthPausedAt = Math.max(0, Math.min(seconds, this.synthDuration));
        this.synthStartTime = performance.now() - this.synthPausedAt * 1000;
        this.onTimeUpdate(this.synthPausedAt, this.synthDuration);
        return;
      }
      if (this.audio.getAttribute('src')) {
        this.audio.currentTime = seconds;
      }
    }

    setActiveSpeaker(speaker) {
      this.activeSpeaker = speaker === 'REINA' ? 'REINA' : 'KENTA';
    }

    setVolume(value) {
      if (!Number.isFinite(value)) return;
      this.volume = Math.max(0, Math.min(1, value));
      this.audio.volume = this.volume;
      if (this.masterGain) this.masterGain.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);
    }

    getCurrentTime() {
      return this.usingSynthFallback
        ? (this.synthPlaying ? (performance.now() - this.synthStartTime) / 1000 : this.synthPausedAt)
        : this.audio.currentTime;
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
        if (this.usingSynthFallback && this.analyser && this.dataArray) {
          this.analyser.getByteFrequencyData(this.dataArray);
          freqValues = this.dataArray;
        }

        const isPlaying = this.usingSynthFallback ? this.synthPlaying : !this.audio.paused;
        const t = performance.now() / 140;

        for (let i = 0; i < barCount; i++) {
          let ratio = 0.12;
          if (isPlaying) {
            const analyserVal = freqValues ? freqValues[i % freqValues.length] / 255 : 0;
            const waveVal =
              0.22 +
              0.55 *
                Math.abs(Math.sin(t + i * 0.55)) *
                Math.abs(Math.cos(t * 0.85 - i * 0.25));
            ratio = Math.max(0.15, Math.min(0.98, analyserVal > 0.05 ? analyserVal : waveVal));
          } else {
            ratio = 0.1 + 0.05 * Math.sin(t * 0.4 + i * 0.3);
          }

          const barHeight = Math.max(4, ratio * height);
          const x = i * (barWidth + gap);
          const y = height - barHeight;

          const grad = this.ctx2d.createLinearGradient(0, 0, width, 0);
          grad.addColorStop(0, '#2363ED');
          grad.addColorStop(0.5, '#A6ABC0');
          grad.addColorStop(1, '#F04448');

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
