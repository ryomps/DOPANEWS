/**
 * DOPANEWS Main Application Controller
 * - ニュースURLからの本文自動抽出（URL欄・本文欄のどちらにURLを貼っても自動判定）
 * - ローカル設定 (/api/config) ＆ 保存済みライブラリ (/api/library) 完全対応
 * - BPM計算（115 BPM ＝ 8小節 約16.7秒）による正確なステージ画面遷移
 * - 「🎤 歌い出し同期」および「V1〜V4ボタン」による再生中リアルタイム同期補正（巻き戻しなし）
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  class DopaNewsApp {
    constructor() {
      this.currentBattleData = DOPANEWS.PRESET_BATTLE_DATA;
      this.currentArticleText = DOPANEWS.PRESET_NEWS_ARTICLE;
      this.currentAudioUrl = null;
      this.currentMurekaTrack = null;
      this.currentSynthDuration = 67;
      this.isGenerating = false;
      this.lastFetchedUrl = '';
      this.apiConfig = { geminiConfigured: false, murekaConfigured: false };

      this._cacheDom();
      this._loadSavedKeys();
      this._initComponents();
      this._bindEvents();

      this.articleInputEl.value = DOPANEWS.PRESET_NEWS_ARTICLE;
      this._applyBattleData(DOPANEWS.PRESET_BATTLE_DATA, { isSynthMode: true });
      this._checkLocalConfig();
      this.refreshLibrary();
    }

    _cacheDom() {
      this.apiConfigStatusEl = document.getElementById('api-config-status');
      this.geminiKeyInputEl = document.getElementById('input-gemini-key');
      this.sunoKeyInputEl = document.getElementById('input-suno-key');
      this.saveKeysBtnEl = document.getElementById('btn-save-keys');
      this.saveBattleBtnEl = document.getElementById('btn-save-battle');
      this.refreshLibraryBtnEl = document.getElementById('btn-refresh-library');
      this.libraryStatusEl = document.getElementById('library-status');
      this.savedBattleListEl = document.getElementById('saved-battle-list');

      this.newsUrlInputEl = document.getElementById('input-news-url');
      this.fetchUrlBtnEl = document.getElementById('btn-fetch-url');
      this.articleInputEl = document.getElementById('input-news-article');
      this.stylePresetSelectEl = document.getElementById('select-style-preset');
      this.battleStyleInputEl = document.getElementById('input-battle-style');
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
      this.murekaJsonPreviewEl = document.getElementById('mureka-json-preview');

      this.audioEl = document.getElementById('battle-audio');
      this.canvasEl = document.getElementById('spectrum-canvas');
      this.playPauseBtnEl = document.getElementById('btn-play-pause');
      this.openJudgeBtnEl = document.getElementById('btn-open-judge');
      this.syncVocalBtnEl = document.getElementById('btn-sync-vocal-start');
      this.mobileDrawerToggleEl = document.getElementById('btn-toggle-drawer');
      this.sidebarPanelEl = document.getElementById('control-drawer');
    }

    _initComponents() {
      this.stageView = new DOPANEWS.StageView({
        onSelectVerse: (index) => {
          // 楽曲再生中にV1〜V4ボタンを押した場合は、曲を止めずに「今この瞬間」をそのバースの先頭に同期！
          const isAudioPlaying = !this.audioController.usingSynthFallback && !this.audioEl.paused;
          if (isAudioPlaying) {
            this.stageView.alignVerseStartToCurrentTime(index, this.audioEl.currentTime);
            const verse = this.currentBattleData?.verses?.[index];
            if (verse) this.audioController.setActiveSpeaker(verse.speaker);
            this._setLog(
              `🎯 V${index + 1} (${verse?.speaker}) の開始タイミングを現在位置 (${Math.floor(this.audioEl.currentTime)}秒) に同期しました！`
            );
            return;
          }

          // シンセビート再生中または一時停止中は該当バースの秒数へシーク
          const windows = this.stageView.getVerseWindows();
          const startSec = windows[index] ? windows[index].start : 0;
          this.stageView.activateVerse(index, true);
          const verse = this.currentBattleData?.verses?.[index];
          if (verse) {
            this.audioController.setActiveSpeaker(verse.speaker);
          }
          this.audioController.seekTo(startSec);
        },
        onBattleBarsFinished: () => {
          // 4本目（V4 REINA）の8小節を歌い終えたら、Murekaの長い後奏をフェードアウトしてJUDGE TIMEへ自動遷移
          this.audioEl.pause();
          this._setLog('🏁 8小節×4本のマイクリレー完結！振り返り・投票画面を表示します。');
          this.judgeModal.open(this.currentBattleData);
        }
      });

      this.judgeModal = new DOPANEWS.JudgeModal({
        onReplay: () => {
          this.stageView.autoJudgeTriggered = false;
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
          this._setLog('🏁 バトル終了！振り返り・投票画面を表示します。');
          this.judgeModal.open(this.currentBattleData);
        },
        onPlayStateChange: (isPlaying) => {
          if (this.playPauseBtnEl) {
            this.playPauseBtnEl.innerHTML = isPlaying ? '⏸ 一時停止' : '▶ 再生';
            this.playPauseBtnEl.classList.toggle('playing', isPlaying);
          }
        },
        onAutoplayBlocked: () => {
          this._setLog(
            '🎵 楽曲の準備が完了しました！右ステージ下の「▶ 再生」ボタンを押してスタートしてください🔥'
          );
          if (this.playPauseBtnEl) {
            this.playPauseBtnEl.style.boxShadow = '0 0 20px #FFE600';
            this.playPauseBtnEl.style.borderColor = '#FFE600';
          }
        }
      });
    }

    _loadSavedKeys() {
      const keys = DOPANEWS.STORAGE_KEYS || {
        GEMINI: 'dopanews_gemini_api_key',
        MUREKA: 'dopanews_mureka_api_key',
        LEGACY_SUNO: 'dopanews_suno_api_key'
      };
      const savedGemini = localStorage.getItem(keys.GEMINI) || '';
      const savedMureka =
        localStorage.getItem(keys.MUREKA) || localStorage.getItem(keys.LEGACY_SUNO) || '';
      if (this.geminiKeyInputEl && savedGemini) this.geminiKeyInputEl.value = savedGemini;
      if (this.sunoKeyInputEl && savedMureka) this.sunoKeyInputEl.value = savedMureka;
    }

    async saveApiKeys() {
      const keys = DOPANEWS.STORAGE_KEYS || {
        GEMINI: 'dopanews_gemini_api_key',
        MUREKA: 'dopanews_mureka_api_key'
      };
      const geminiKey = this.geminiKeyInputEl?.value.trim() || '';
      const murekaKey = this.sunoKeyInputEl?.value.trim() || '';

      localStorage.setItem(keys.GEMINI, geminiKey);
      localStorage.setItem(keys.MUREKA, murekaKey);

      if (typeof DOPANEWS.saveLocalConfigKeys === 'function') {
        await DOPANEWS.saveLocalConfigKeys({ geminiKey, murekaKey });
      }

      if (this.saveKeysBtnEl) {
        this.saveKeysBtnEl.textContent = '✅ 保存済';
        setTimeout(() => {
          if (this.saveKeysBtnEl) this.saveKeysBtnEl.textContent = '💾 キー保存';
        }, 1800);
      }

      await this._checkLocalConfig();
      this._setLog('🔑 Gemini API Key と Mureka API Key を保存しました！');
    }

    _stopCurrentBattle() {
      this.audioController.stopSynth();
      this.audioEl.pause();
      if (this.stageView && typeof this.stageView.resetTimerDisplay === 'function') {
        this.stageView.resetTimerDisplay();
      }
    }

    async _checkLocalConfig() {
      const stored =
        typeof DOPANEWS.getStoredKeys === 'function'
          ? DOPANEWS.getStoredKeys()
          : { geminiKey: '', murekaKey: '' };

      let serverCfg = { serverAvailable: false, geminiConfigured: false, murekaConfigured: false };
      if (typeof DOPANEWS.getLocalConfig === 'function') {
        serverCfg = await DOPANEWS.getLocalConfig();
      }
      this.apiConfig = serverCfg;

      const geminiReady = Boolean(serverCfg.geminiConfigured || stored.geminiKey);
      const murekaReady = Boolean(serverCfg.murekaConfigured || stored.murekaKey);

      if (this.apiConfigStatusEl) {
        const modeLabel = serverCfg.serverAvailable
          ? '🟢 ローカルサーバー接続中'
          : '🔵 ブラウザ直接モード';
        const gText = geminiReady ? 'Gemini: ✅設定済' : 'Gemini: ⚠️未入力';
        const mText = murekaReady ? 'Mureka: ✅設定済' : 'Mureka: ⚠️未入力';
        this.apiConfigStatusEl.textContent = `${modeLabel} ｜ ${gText} ／ ${mText}`;
        this.apiConfigStatusEl.classList.remove('status-error');
      }

      // ブラウザにキーが保存されていてローカルサーバー側に未保存なら自動同期
      if (
        serverCfg.serverAvailable &&
        ((!serverCfg.geminiConfigured && stored.geminiKey) ||
          (!serverCfg.murekaConfigured && stored.murekaKey)) &&
        typeof DOPANEWS.saveLocalConfigKeys === 'function'
      ) {
        await DOPANEWS.saveLocalConfigKeys(stored);
      }
    }

    async refreshLibrary() {
      if (typeof DOPANEWS.listSavedBattles !== 'function' || !this.savedBattleListEl) return;
      try {
        const res = await DOPANEWS.listSavedBattles();
        const items = res?.items || [];
        this.savedBattleListEl.innerHTML = '';
        if (!items.length) {
          this.savedBattleListEl.innerHTML =
            '<p class="reflection-footnote">まだ保存されたラップはありません。</p>';
          return;
        }
        items.forEach((item) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-sub-action';
          btn.style.width = '100%';
          btn.style.marginBottom = '6px';
          btn.textContent = `🎵 ${item.battleData?.title || '無題のバトル'}`;
          btn.addEventListener('click', () => this.loadSavedBattle(item));
          this.savedBattleListEl.appendChild(btn);
        });
      } catch {
        // ignore
      }
    }

    async loadSavedBattle(item) {
      this._stopCurrentBattle();
      this.currentArticleText = item.articleText || '';
      if (this.articleInputEl) this.articleInputEl.value = this.currentArticleText;
      this.currentMurekaTrack = item.murekaTrack || null;
      this.currentAudioUrl = item.audioUrl || null;
      const isSynth = !item.audioUrl;
      const normalized = DOPANEWS.normalizeBattleData(item.battleData);
      if (item.murekaTrack) {
        DOPANEWS.applyMurekaTimestamps(normalized, item.murekaTrack);
      }
      this._applyBattleData(normalized, { isSynthMode: isSynth });
      if (this.murekaJsonPreviewEl) {
        this.murekaJsonPreviewEl.textContent = item.murekaTrack
          ? JSON.stringify(item.murekaTrack, null, 2)
          : '';
      }
      this._setStepState(3);
      if (item.audioUrl) {
        this._setLog(`📂 保存済みラップ「${normalized.title}」を再生します！`);
        await this.audioController.loadAndPlayUrl(item.audioUrl);
      } else {
        const bpm = DOPANEWS.extractBpmFromStyle(normalized.suno_style);
        const dur = item.synthDuration || Math.round(DOPANEWS.calcEightBarsDurationSec(bpm) * 4);
        this.audioController.startSynthBattle(dur);
      }
    }

    async saveCurrentBattle() {
      if (typeof DOPANEWS.saveBattle !== 'function') return;
      try {
        if (this.libraryStatusEl) this.libraryStatusEl.textContent = '⏳ 保存中...';
        await DOPANEWS.saveBattle({
          battleData: this.currentBattleData,
          articleText: this.currentArticleText || this.articleInputEl?.value || '',
          audioUrl: this.currentAudioUrl,
          synthDuration: this.currentSynthDuration,
          murekaTrack: this.currentMurekaTrack
        });
        if (this.libraryStatusEl) {
          this.libraryStatusEl.textContent = '✅ このPCに保存しました！';
        }
        await this.refreshLibrary();
      } catch (err) {
        if (this.libraryStatusEl) {
          this.libraryStatusEl.textContent = `❌ 保存エラー: ${err.message}`;
        }
      }
    }

    _bindEvents() {
      this.saveKeysBtnEl?.addEventListener('click', () => this.saveApiKeys());
      this.geminiKeyInputEl?.addEventListener('change', () => this.saveApiKeys());
      this.sunoKeyInputEl?.addEventListener('change', () => this.saveApiKeys());
      this.saveBattleBtnEl?.addEventListener('click', () => this.saveCurrentBattle());
      this.refreshLibraryBtnEl?.addEventListener('click', () => this.refreshLibrary());

      this.fetchUrlBtnEl?.addEventListener('click', () => this.handleFetchUrl());
      this.newsUrlInputEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleFetchUrl();
        }
      });

      this.stylePresetSelectEl?.addEventListener('change', (e) => {
        if (this.battleStyleInputEl && e.target.value) {
          this.battleStyleInputEl.value = e.target.value;
          if (this.currentBattleData) {
            this.currentBattleData.suno_style = e.target.value;
          }
        }
      });

      this.battleStyleInputEl?.addEventListener('input', (e) => {
        if (this.currentBattleData && e.target.value.trim()) {
          this.currentBattleData.suno_style = e.target.value.trim();
        }
      });

      // 🎤 歌い出し同期ボタン：今流れている秒数を現在バースの1小節目としてロックオン
      this.syncVocalBtnEl?.addEventListener('click', () => {
        const currentSec = this.audioController.usingSynthFallback
          ? 0
          : this.audioEl.currentTime || 0;
        const activeIdx = Math.max(0, this.stageView.currentVerseIndex);
        this.stageView.alignVerseStartToCurrentTime(activeIdx, currentSec);
        this._setLog(
          `🎤 歌い出し同期完了！現在位置 (${currentSec.toFixed(1)}秒) を V${activeIdx + 1} の1小節目として115BPMでロックオンしました🔥`
        );
      });

      this.generateBtnEl?.addEventListener('click', () => this.handleFullBattleGeneration());
      this.geminiOnlyBtnEl?.addEventListener('click', () => this.handleGeminiOnlyGeneration());

      this.presetTestBtnEl?.addEventListener('click', () => {
        this._stopCurrentBattle();
        if (this.newsUrlInputEl) this.newsUrlInputEl.value = '';
        this.articleInputEl.value = DOPANEWS.PRESET_NEWS_ARTICLE;
        this.currentArticleText = DOPANEWS.PRESET_NEWS_ARTICLE;
        const bpm = DOPANEWS.extractBpmFromStyle(DOPANEWS.PRESET_BATTLE_DATA.suno_style);
        const totalSec = Math.round(DOPANEWS.calcEightBarsDurationSec(bpm) * 4);
        this.currentSynthDuration = totalSec;
        this._applyBattleData(DOPANEWS.PRESET_BATTLE_DATA, { isSynthMode: true });
        this._setStepState(3);
        this._setLog(`🎧 プリセットニュース（8小節×4本 / ${totalSec}秒）でデモバトルを開始しました！`);
        this.audioController.startSynthBattle(totalSec);
      });

      this.localMp3InputEl?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const objUrl = URL.createObjectURL(file);
        if (this.localMp3LabelEl) {
          this.localMp3LabelEl.textContent = `🎵 読込済: ${file.name.slice(0, 22)}`;
        }
        this.stageView.setAudioMode(false);
        this._setStepState(3);
        this._setLog(
          `🎵 ローカルMP3「${file.name}」を再生開始！（歌い出しがズレたら右上の「🎤 歌い出し同期」または「V1〜V4」を押すとピタッと合います）`
        );
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

      document.getElementById('news-open-studio')?.addEventListener('click', () => {
        document.body.classList.remove('news-mode');
        const returnBtn = document.getElementById('return-to-news');
        if (returnBtn) returnBtn.hidden = false;
      });
    }

    async handleFetchUrl(customUrl) {
      const targetUrl = (customUrl || this.newsUrlInputEl?.value || '').trim();
      if (!targetUrl) {
        this._setLog('⚠️ ニュース記事のURLを入力してください。', true);
        this.newsUrlInputEl?.focus();
        return null;
      }

      if (this.fetchUrlBtnEl) {
        this.fetchUrlBtnEl.disabled = true;
        this.fetchUrlBtnEl.textContent = '⏳ 読込中...';
      }
      this._setLog(`🔗 URLからニュース記事の本文を自動抽出中... (${targetUrl.slice(0, 45)}...)`);

      try {
        const articleText = await DOPANEWS.fetchArticleFromUrl(targetUrl);
        this.articleInputEl.value = articleText;
        this.currentArticleText = articleText;
        this.lastFetchedUrl = targetUrl;
        this._setLog(
          `✅ URLからニュース本文を抽出しました！（${articleText.length.toLocaleString()}文字）続けて「🔥 バトル生成スタート」を押せます。`
        );
        return articleText;
      } catch (err) {
        this._setLog(`❌ URL読込エラー: ${err.message}`, true);
        throw err;
      } finally {
        if (this.fetchUrlBtnEl) {
          this.fetchUrlBtnEl.disabled = false;
          this.fetchUrlBtnEl.textContent = '📥 URL読込';
        }
      }
    }

    async _resolveArticleTextBeforeGenerate() {
      const urlFieldVal = this.newsUrlInputEl?.value.trim() || '';
      const textFieldVal = this.articleInputEl?.value.trim() || '';

      if (/^https?:\/\/\S+$/i.test(textFieldVal)) {
        if (this.newsUrlInputEl) this.newsUrlInputEl.value = textFieldVal;
        return await this.handleFetchUrl(textFieldVal);
      }

      if (
        /^https?:\/\/\S+$/i.test(urlFieldVal) &&
        urlFieldVal !== this.lastFetchedUrl &&
        (textFieldVal === '' || textFieldVal === DOPANEWS.PRESET_NEWS_ARTICLE)
      ) {
        return await this.handleFetchUrl(urlFieldVal);
      }

      return textFieldVal;
    }

    async handleFullBattleGeneration() {
      if (this.isGenerating) return;

      this._stopCurrentBattle();
      this.isGenerating = true;
      this.generateBtnEl.disabled = true;

      try {
        const articleText = await this._resolveArticleTextBeforeGenerate();
        this.currentArticleText = articleText;

        this._setStepState(1);
        this._setLog(
          '① Gemini がニュースの対立軸を抽出し、KENTA [Verse] vs REINA [Chorus] の8小節×4本を作詞中...'
        );

        const battleData = await DOPANEWS.generateBattleScriptWithGemini(
          articleText,
          (progressMsg) => this._setLog(`① ${progressMsg}`)
        );
        if (this.battleStyleInputEl?.value.trim()) {
          battleData.suno_style = this.battleStyleInputEl.value.trim();
        }

        const bpm = DOPANEWS.extractBpmFromStyle(battleData.suno_style);
        const synthTotalSec = Math.round(DOPANEWS.calcEightBarsDurationSec(bpm) * 4);
        this.currentSynthDuration = synthTotalSec;

        this._setStepState(2);
        this._applyBattleData(battleData, { isSynthMode: false });
        this._setLog(
          '② Mureka 公式API に [Verse:男声] ⇄ [Chorus:女声] の8小節×4本を送信し、楽曲レコーディング中...'
        );

        const { audioUrl, murekaTrack } = await DOPANEWS.generateBattleTrackWithMureka(
          battleData,
          (progressMsg) => {
            this._setLog(`② ${progressMsg}`);
          }
        );

        this.currentAudioUrl = audioUrl;
        this.currentMurekaTrack = murekaTrack || null;
        if (this.murekaJsonPreviewEl) {
          this.murekaJsonPreviewEl.textContent = murekaTrack
            ? JSON.stringify(murekaTrack, null, 2)
            : '';
        }

        this._applyBattleData(battleData, { isSynthMode: false });
        this._setStepState(3);
        this._setLog(
          '③ Murekaバトル楽曲が完成！ステージで再生します🔥（歌い出しタイミングがズレたら右上の「🎤 歌い出し同期」または「V1〜V4」を押すと即座に揃います！）'
        );
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

      this._stopCurrentBattle();
      this.isGenerating = true;
      try {
        const articleText = await this._resolveArticleTextBeforeGenerate();
        this.currentArticleText = articleText;

        this._setStepState(1);
        this._setLog('① Gemini でニュース記事から8小節×4本のラップバトル歌詞JSONを生成中...');
        const battleData = await DOPANEWS.generateBattleScriptWithGemini(
          articleText,
          (progressMsg) => this._setLog(`① ${progressMsg}`)
        );
        const bpm = DOPANEWS.extractBpmFromStyle(battleData.suno_style);
        const synthTotalSec = Math.round(DOPANEWS.calcEightBarsDurationSec(bpm) * 4);
        this.currentSynthDuration = synthTotalSec;
        this.currentAudioUrl = null;
        this.currentMurekaTrack = null;
        this._applyBattleData(battleData, { isSynthMode: true });
        this._setStepState(3);
        this._setLog(
          `③ Gemini作詞完了！ステージに歌詞をセットし、${bpm}BPM（計${synthTotalSec}秒）で再生を開始します🔥`
        );
        this.audioController.startSynthBattle(synthTotalSec);
      } catch (err) {
        this._setLog(`❌ エラー: ${err.message}`, true);
      } finally {
        this.isGenerating = false;
      }
    }

    _applyBattleData(battleData, { isSynthMode = true } = {}) {
      this.currentBattleData = battleData;
      this.stageView.setBattleData(battleData, { isSynthMode });

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
