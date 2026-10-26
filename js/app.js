/**
 * DOPANEWS Main Application Controller
 * - localStorage による Gemini / Suno APIキー永続化
 * - 進捗ステップバー（①Gemini作詞中 ➔ ②Sunoレコーディング中 ➔ ③バトル開始！）制御
 * - プリセットデータ＆ローカルMP3テストフォールバック制御
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  const STORAGE_KEYS = {
    GEMINI_KEY: 'dopanews_gemini_api_key',
    SUNO_KEY: 'dopanews_suno_api_key'
  };

  class DopaNewsApp {
    constructor() {
      this.currentBattleData = DOPANEWS.PRESET_BATTLE_DATA;
      this.isGenerating = false;

      this._cacheDom();
      this._initComponents();
      this._loadSavedKeys();
      this._bindEvents();

      this.articleInputEl.value = DOPANEWS.PRESET_NEWS_ARTICLE;
      this._applyBattleData(DOPANEWS.PRESET_BATTLE_DATA);
    }

    _cacheDom() {
      this.geminiKeyInputEl = document.getElementById('input-gemini-key');
      this.sunoKeyInputEl = document.getElementById('input-suno-key');
      this.saveKeysBtnEl = document.getElementById('btn-save-keys');
      this.keySavedToastEl = document.getElementById('key-saved-toast');

      this.articleInputEl = document.getElementById('input-news-article');
      this.generateBtnEl = document.getElementById('btn-start-battle');
      this.geminiOnlyBtnEl = document.getElementById('btn-gemini-only');
      this.presetTestBtnEl = document.getElementById('btn-load-preset');
      this.localMp3InputEl = document.getElementById('input-local-mp3');
      this.localMp3LabelEl = document.getElementById('label-local-mp3');

      this.step1El = document.getElementById('step-1-gemini');
      this.step2El = document.getElementById('step-2-suno');
      this.step3El = document.getElementById('step-3-battle');
      this.statusLogEl = document.getElementById('generation-status-log');

      this.sunoPromptPreviewEl = document.getElementById('suno-prompt-preview');
      this.jsonPreviewEl = document.getElementById('gemini-json-preview');

      this.audioEl = document.getElementById('battle-audio');
      this.canvasEl = document.getElementById('spectrum-canvas');
      this.playPauseBtnEl = document.getElementById('btn-play-pause');
      this.openJudgeBtnEl = document.getElementById('btn-open-judge');
      this.mobileDrawerToggleEl = document.getElementById('btn-toggle-drawer');
      this.sidebarPanelEl = document.getElementById('control-drawer');
    }

    _initComponents() {
      this.stageView = new DOPANEWS.StageView({
        onSelectVerse: (index, startSec) => {
          this.stageView.activateVerse(index, true);
          const verse = this.currentBattleData?.verses?.[index];
          if (verse) {
            this.audioController.setActiveSpeaker(verse.speaker);
          }
          this.audioController.seekTo(startSec);
        }
      });

      this.judgeModal = new DOPANEWS.JudgeModal({
        onReplay: () => {
          this.audioController.seekTo(0);
          this.audioController.togglePlay();
        }
      });

      this.audioController = new DOPANEWS.AudioController({
        audioElement: this.audioEl,
        canvasElement: this.canvasEl,
        onTimeUpdate: (currentSec, durationSec) => {
          this.stageView.syncTime(currentSec, durationSec);
          const activeIdx = this.stageView.currentVerseIndex;
          const activeVerse = this.currentBattleData?.verses?.[activeIdx];
          if (activeVerse) {
            this.audioController.setActiveSpeaker(activeVerse.speaker);
          }
        },
        onEnded: () => {
          this._setLog('🏁 バトル終了！⚖️ JUDGE TIME（投票画面）を表示します。');
          this.judgeModal.open(this.currentBattleData);
        },
        onPlayStateChange: (isPlaying) => {
          if (this.playPauseBtnEl) {
            this.playPauseBtnEl.innerHTML = isPlaying ? '⏸ PAUSE' : '▶ PLAY BATTLE';
            this.playPauseBtnEl.classList.toggle('playing', isPlaying);
          }
        }
      });
    }

    _loadSavedKeys() {
      try {
        const gKey = localStorage.getItem(STORAGE_KEYS.GEMINI_KEY) || '';
        const sKey = localStorage.getItem(STORAGE_KEYS.SUNO_KEY) || '';
        if (this.geminiKeyInputEl) this.geminiKeyInputEl.value = gKey;
        if (this.sunoKeyInputEl) this.sunoKeyInputEl.value = sKey;
      } catch {
        // ignore
      }
    }

    _saveKeys() {
      try {
        const gKey = this.geminiKeyInputEl?.value.trim() || '';
        const sKey = this.sunoKeyInputEl?.value.trim() || '';
        localStorage.setItem(STORAGE_KEYS.GEMINI_KEY, gKey);
        localStorage.setItem(STORAGE_KEYS.SUNO_KEY, sKey);
        if (this.keySavedToastEl) {
          this.keySavedToastEl.textContent = '✓ APIキーをlocalStorageに保存しました';
          setTimeout(() => {
            if (this.keySavedToastEl) this.keySavedToastEl.textContent = '';
          }, 2500);
        }
      } catch {
        // ignore
      }
    }

    _bindEvents() {
      this.geminiKeyInputEl?.addEventListener('change', () => this._saveKeys());
      this.sunoKeyInputEl?.addEventListener('change', () => this._saveKeys());
      this.saveKeysBtnEl?.addEventListener('click', () => this._saveKeys());

      this.generateBtnEl?.addEventListener('click', () => this.handleFullBattleGeneration());
      this.geminiOnlyBtnEl?.addEventListener('click', () => this.handleGeminiOnlyGeneration());

      this.presetTestBtnEl?.addEventListener('click', () => {
        this.articleInputEl.value = DOPANEWS.PRESET_NEWS_ARTICLE;
        this._applyBattleData(DOPANEWS.PRESET_BATTLE_DATA);
        this._setStepState(3);
        this._setLog('🎧 プリセットニュース＆112BPMデモビートでバトルを開始しました！');
        this.audioController.startSynthBattle(44);
      });

      this.localMp3InputEl?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const objUrl = URL.createObjectURL(file);
        if (this.localMp3LabelEl) {
          this.localMp3LabelEl.textContent = `🎵 読込済: ${file.name.slice(0, 22)}`;
        }
        this._setStepState(3);
        this._setLog(`🎵 ローカルMP3「${file.name}」をステージにセットして再生開始！`);
        this.audioController.loadAndPlayUrl(objUrl);
      });

      this.playPauseBtnEl?.addEventListener('click', () => {
        this.audioController.togglePlay();
      });

      this.openJudgeBtnEl?.addEventListener('click', () => {
        this.judgeModal.open(this.currentBattleData);
      });

      this.mobileDrawerToggleEl?.addEventListener('click', () => {
        this.sidebarPanelEl?.classList.toggle('drawer-open');
      });
    }

    async handleFullBattleGeneration() {
      if (this.isGenerating) return;
      this._saveKeys();

      const geminiKey = this.geminiKeyInputEl?.value.trim();
      const sunoKey = this.sunoKeyInputEl?.value.trim();
      const articleText = this.articleInputEl?.value.trim();

      if (!geminiKey) {
        this._setLog(
          '⚠️ Gemini APIキーを入力してください（APIなし試運転は「🎧 プリセット即再生デモ」をクリック）',
          true
        );
        this.geminiKeyInputEl?.focus();
        return;
      }

      this.isGenerating = true;
      this.generateBtnEl.disabled = true;

      try {
        this._setStepState(1);
        this._setLog(
          '① Gemini 2.5 Flash がニュースの対立軸を抽出し、KENTA vs REINA のラップ歌詞を作詞中...'
        );

        const battleData = await DOPANEWS.generateBattleScriptWithGemini(articleText, geminiKey);
        this._applyBattleData(battleData);

        this._setStepState(2);
        if (!sunoKey) {
          this._setLog(
            '⚠️ Suno APIキーが未入力のため、Gemini生成リリック＋内蔵112BPMビートでステージを開始します！'
          );
          this._setStepState(3);
          this.audioController.startSynthBattle(45);
          return;
        }

        this._setLog(
          '② Suno API (V3_5) にメタタグ付き歌詞を送信し、男女マイクリレー楽曲をレコーディング中...'
        );
        const { audioUrl } = await DOPANEWS.generateBattleTrackWithSuno(
          battleData,
          sunoKey,
          (progressMsg) => {
            this._setLog(`② ${progressMsg}`);
          }
        );

        this._setStepState(3);
        this._setLog('③ バトル楽曲が完成！ステージでマイクリレーを自動再生します🔥');
        await this.audioController.loadAndPlayUrl(audioUrl);
      } catch (err) {
        console.error(err);
        this._setLog(`❌ エラー: ${err.message}`, true);
      } finally {
        this.isGenerating = false;
        this.generateBtnEl.disabled = false;
      }
    }

    async handleGeminiOnlyGeneration() {
      if (this.isGenerating) return;
      this._saveKeys();

      const geminiKey = this.geminiKeyInputEl?.value.trim();
      const articleText = this.articleInputEl?.value.trim();

      if (!geminiKey) {
        this._setLog('⚠️ Gemini APIキーを入力してください。', true);
        this.geminiKeyInputEl?.focus();
        return;
      }

      this.isGenerating = true;
      try {
        this._setStepState(1);
        this._setLog('① Gemini 2.5 Flash でニュース記事からラップバトル歌詞JSONを生成中...');
        const battleData = await DOPANEWS.generateBattleScriptWithGemini(articleText, geminiKey);
        this._applyBattleData(battleData);
        this._setStepState(3);
        this._setLog(
          '③ Gemini作詞完了！ステージに歌詞をセットし、112BPMビートで再生を開始します🔥'
        );
        this.audioController.startSynthBattle(45);
      } catch (err) {
        this._setLog(`❌ エラー: ${err.message}`, true);
      } finally {
        this.isGenerating = false;
      }
    }

    _applyBattleData(battleData) {
      this.currentBattleData = battleData;
      this.stageView.setBattleData(battleData);

      if (this.sunoPromptPreviewEl) {
        this.sunoPromptPreviewEl.value = DOPANEWS.buildSunoPrompt(battleData);
      }
      if (this.jsonPreviewEl) {
        this.jsonPreviewEl.textContent = JSON.stringify(battleData, null, 2);
      }
    }

    _setStepState(stepNumber) {
      const steps = [this.step1El, this.step2El, this.step3El];
      steps.forEach((el, idx) => {
        if (!el) return;
        const num = idx + 1;
        el.classList.remove('step-active', 'step-done');
        if (num < stepNumber) {
          el.classList.add('step-done');
        } else if (num === stepNumber) {
          el.classList.add('step-active');
        }
      });
    }

    _setLog(message, isError = false) {
      if (!this.statusLogEl) return;
      this.statusLogEl.textContent = message;
      this.statusLogEl.classList.toggle('status-error', isError);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.dopaNewsApp = new DopaNewsApp();
  });
})(window);
