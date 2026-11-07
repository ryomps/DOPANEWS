/**
 * DOPANEWS Main Application Controller
 * - ニュースURLからの本文自動抽出（URL欄・本文欄のどちらにURLを貼っても自動判定）
 * - Mureka 115 BPM 固定インストビート（伴奏）の生成＆PC永久ロック保存
 * - 固定Murekaビート上に KENTA（男声）＆ REINA（女声）の8小節×4本を乗せるマルチボイス合成
 * - 進捗ステップバー（①Gemini作詞中 ➔ ②固定ビート×男女収録 ➔ ③バトル開始！）制御
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  class DopaNewsApp {
    constructor() {
      this.currentBattleData = DOPANEWS.PRESET_BATTLE_DATA;
      this.isGenerating = false;
      this.lastFetchedUrl = '';
      this.reviewVersion = 0;
      this.currentReviews = {};
      this.reviewState = { status: 'idle' };
      this.fixedBeat = { exists: false, audioUrl: null };

      this._cacheDom();
      this._initComponents();
      this.currentAudioUrl = null;
      this.currentSavedId = null;
      this.currentSynthDuration = 67;
      this.currentArticleText = DOPANEWS.PRESET_NEWS_ARTICLE;
      this.configReady = this._loadLocalConfig();
      this._loadFixedBeatStatus();
      this._refreshLibrary();
      this._bindEvents();

      this.articleInputEl.value = DOPANEWS.PRESET_NEWS_ARTICLE;
      this._applyBattleData(DOPANEWS.PRESET_BATTLE_DATA);
      this.stageView.syncTime(0, 67);
    }

    _cacheDom() {
      this.articleGenerationPanelEl = document.getElementById('article-generation-panel');
      this.articleGenerationTitleEl = document.getElementById('article-generation-title');
      this.articleGenerationStatusEl = document.getElementById('article-generation-status');
      this.articleGenerationRetryEl = document.getElementById('article-generation-retry');
      this.apiConfigStatusEl = document.getElementById('api-config-status');
      this.fixedBeatStatusEl = document.getElementById('fixed-beat-status');
      this.generateFixedBeatBtnEl = document.getElementById('btn-generate-fixed-beat');
      this.previewFixedBeatBtnEl = document.getElementById('btn-preview-fixed-beat');
      this.fixedBeatAudioPreviewEl = document.getElementById('fixed-beat-audio-preview');

      this.libraryListEl = document.getElementById('saved-battle-list');
      this.libraryStatusEl = document.getElementById('library-status');
      this.saveBattleBtnEl = document.getElementById('btn-save-battle');
      this.refreshLibraryBtnEl = document.getElementById('btn-refresh-library');

      this.newsUrlInputEl = document.getElementById('input-news-url');
      this.fetchUrlBtnEl = document.getElementById('btn-fetch-url');
      this.generateFromUrlBtnEl = document.getElementById('btn-generate-from-url');
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

      this.audioEl = document.getElementById('battle-audio');
      this.canvasEl = document.getElementById('spectrum-canvas');
      this.playPauseBtnEl = document.getElementById('btn-play-pause');
      this.prevVerseBtnEl = document.getElementById('btn-prev-verse');
      this.nextVerseBtnEl = document.getElementById('btn-next-verse');
      this.seekInputEl = document.getElementById('battle-seek');
      this.volumeInputEl = document.getElementById('battle-volume');
      this.muteButtonEl = document.getElementById('battle-mute');
      this.lastAudibleVolume = 100;
      this.openJudgeBtnEl = document.getElementById('btn-open-judge');
      this.mobileDrawerToggleEl = document.getElementById('btn-toggle-drawer');
      this.sidebarPanelEl = document.getElementById('control-drawer');
    }

    _initComponents() {
      this.stageView = new DOPANEWS.StageView({
        onSelectVerse: (index, startSec) => {
          if (this.isGenerating) return;
          this.stageView.activateVerse(index, true);
          const verse = this.currentBattleData?.verses?.[index];
          if (verse) {
            this.audioController.setActiveSpeaker(verse.speaker);
          }
          this.audioController.seekTo(startSec);
          this._updateTransport();
        }
      });

      this.judgeModal = new DOPANEWS.JudgeModal({
        onChoose: () => {
          document.getElementById('return-to-news')?.click?.();
          if (document.body.classList.contains('news-mode') && !document.body.classList.contains('library-mode')) {
            const screen = document.getElementById('news-screen');
            if (screen?.dataset.view === 'article') screen.scrollTop = 0;
          }
        },
        onReplay: () => {
          if (this.isGenerating) return;
          this.audioController.seekTo(0);
          if (this.audioController.usingSynthFallback ? !this.audioController.synthPlaying : this.audioEl.paused) {
            this.audioController.togglePlay();
          }
        }
      });

      this.audioController = new DOPANEWS.AudioController({
        audioElement: this.audioEl,
        canvasElement: this.canvasEl,
        onTimeUpdate: (currentSec, durationSec) => {
          this.stageView.syncTime(currentSec, durationSec);
          if (this.seekInputEl) {
            this.seekInputEl.max = String(this.stageView.lastKnownDuration);
            this.seekInputEl.value = String(currentSec);
            this.seekInputEl.setAttribute('aria-valuetext', this.stageView.timerEl.textContent);
          }
          this._updateTransport();
          const activeIdx = this.stageView.currentVerseIndex;
          const activeVerse = this.currentBattleData?.verses?.[activeIdx];
          if (activeVerse) {
            this.audioController.setActiveSpeaker(activeVerse.speaker);
          }
        },
        onEnded: () => {
          if (this.isGenerating) return;
          this._setLog('💭 バトル終了。あなたはどっち派？ 今の自分の考えを振り返ってみよう。');
          this.judgeModal.open(this.currentBattleData);
        },
        onPlayStateChange: (isPlaying) => {
          if (this.playPauseBtnEl) {
            this.playPauseBtnEl.textContent = isPlaying ? 'Ⅱ' : '▶';
            this.playPauseBtnEl.setAttribute('aria-label', isPlaying ? '一時停止' : '再生');
            this.playPauseBtnEl.title = isPlaying ? '一時停止' : '再生';
            this.playPauseBtnEl.classList.toggle('playing', isPlaying);
          }
          this.stageView.setPlaybackState(isPlaying);
        },
        onPlaybackError: (error) => {
          if (!this.audioEl.getAttribute('src') && !this.audioController.usingSynthFallback) {
            this._setLog(error?.message || '音源がまだ生成されていません。ラップ生成を完了してから再生してください。', true);
            return;
          }
          this._setLog(this.currentAudioUrl?.startsWith('/media/demos/')
            ? '音源を読み込めませんでした。start_server.batでサーバーを再起動し、Ctrl＋F5で更新してください。'
            : '音声を再生できませんでした。保存一覧から読み直すか、音声ファイルを確認してください。', true);
        },
        onAutoplayBlocked: () => {
          this._setLog(
            '🎵 楽曲の準備が完了しました！ブラウザの自動再生制限のため、右ステージ下の「▶ 再生」ボタンを押してスタートしてください🔥'
          );
          if (this.playPauseBtnEl) {
            this.playPauseBtnEl.style.boxShadow = '0 0 20px #FFE600';
            this.playPauseBtnEl.style.borderColor = '#FFE600';
          }
        }
      });
    }

    async _loadLocalConfig() {
      try {
        const config = await DOPANEWS.getLocalConfig();
        this.apiConfigStatusEl.textContent = config.reviewSupported
          ? `OpenAI検索・音声同期：${config.openaiConfigured ? '接続設定済み' : '未設定'} ／ Gemini：${config.geminiConfigured ? '接続設定済み' : '未設定'} ／ Mureka：${config.murekaConfigured ? '接続設定済み' : '未設定'}`
          : 'サーバーの更新が必要です。サーバーを再起動してください。';
        return config;
      } catch {
        this.apiConfigStatusEl.textContent = 'start_server.bat から起動してください。';
        return {};
      }
    }

    async _loadFixedBeatStatus() {
      if (!this.fixedBeatStatusEl) return;
      try {
        const info = await DOPANEWS.getFixedBeat();
        this._updateFixedBeatUi(info);
      } catch {
        this.fixedBeatStatusEl.textContent = '固定ビート状態を取得できません。サーバー接続を確認してください。';
      }
    }

    _updateFixedBeatUi(info) {
      this.fixedBeat = info && info.exists ? info : { exists: false, audioUrl: null };
      if (!this.fixedBeatStatusEl) return;

      if (this.fixedBeat.exists) {
        const updatedStr = this.fixedBeat.updatedAt
          ? new Date(this.fixedBeat.updatedAt).toLocaleString('ja-JP')
          : '保存済み';
        this.fixedBeatStatusEl.textContent = `🔒 固定ビート保存済み（${this.fixedBeat.bpm || 115} BPM ／ 更新: ${updatedStr}）— 伴奏関連の操作で使用できます（通常生成はLyria）`;
        if (this.generateFixedBeatBtnEl) {
          this.generateFixedBeatBtnEl.textContent = '🔄 Murekaで固定ビートを作り直す';
        }
        if (this.previewFixedBeatBtnEl) {
          this.previewFixedBeatBtnEl.hidden = false;
        }
        if (this.fixedBeatAudioPreviewEl) {
          this.fixedBeatAudioPreviewEl.src = this.fixedBeat.audioUrl;
        }
      } else {
        this.fixedBeatStatusEl.textContent = '⚠️ Mureka固定ビートが未作成です。「🎹 Murekaで115BPM固定ビートを作成＆保存」を押して作成できます。通常のバトル生成には不要です。';
        if (this.generateFixedBeatBtnEl) {
          this.generateFixedBeatBtnEl.textContent = '🎹 Murekaで115BPM固定ビートを作成＆保存';
        }
        if (this.previewFixedBeatBtnEl) {
          this.previewFixedBeatBtnEl.hidden = true;
        }
        if (this.fixedBeatAudioPreviewEl) {
          this.fixedBeatAudioPreviewEl.hidden = true;
          this.fixedBeatAudioPreviewEl.removeAttribute('src');
        }
      }
    }

    async handleGenerateFixedBeat() {
      if (this.isGenerating) return;
      const config = await this._loadLocalConfig();
      if (!config.murekaConfigured) {
        this._setLog('config.local.json または左上の設定欄で Mureka APIキー を保存してください。', true);
        if (this.fixedBeatStatusEl) {
          this.fixedBeatStatusEl.textContent = '❌ Mureka APIキーが未設定です。上の接続状態でキーを保存してください。';
        }
        return;
      }

      this._setGenerating(true);
      try {
        const beat = await DOPANEWS.generateFixedBeatWithMureka(
          DOPANEWS.DEFAULT_FIXED_BEAT_STYLE,
          (msg) => {
            this._setLog(msg);
            if (this.fixedBeatStatusEl) this.fixedBeatStatusEl.textContent = msg;
          }
        );
        this._updateFixedBeatUi(beat);
        if (this.fixedBeatAudioPreviewEl) {
          this.fixedBeatAudioPreviewEl.hidden = false;
        }
        this._setLog('✅ Mureka 115 BPM 固定インストビートを作成・保存しました！伴奏関連の操作で使用できます。');
      } catch (err) {
        this._setLog(`❌ 固定ビート生成エラー: ${err.message}`, true);
        if (this.fixedBeatStatusEl) {
          this.fixedBeatStatusEl.textContent = `❌ 固定ビート生成エラー: ${err.message}`;
        }
      } finally {
        this._setGenerating(false);
      }
    }

    async _refreshLibrary() {
      try {
        const { items } = await DOPANEWS.listSavedBattles();
        this.libraryListEl.innerHTML = '';
        for (const item of items) {
          const row = document.createElement('div');
          row.className = 'saved-battle-item';
          const title = document.createElement('p');
          title.textContent = item.battleData.title;
          const meta = document.createElement('small');
          meta.textContent = `${new Date(item.createdAt).toLocaleString('ja-JP')} · ${item.audioUrl ? '音声保存済み' : '歌詞＋内蔵ビート'}`;
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'btn-sub-action'; button.textContent = '▶ 歌詞画面を開いて再生';
          button.disabled = this.isGenerating;
          button.addEventListener('click', () => this._playSavedBattle(item));
          row.appendChild(title);
          row.appendChild(meta);
          row.appendChild(button);
          this.libraryListEl.appendChild(row);
        }
        this.libraryStatusEl.textContent = items.length ? `${items.length}件をこのPCに保存済み` : 'まだ保存したラップはありません。';
      } catch {
        this.libraryStatusEl.textContent = '保存一覧を読み込めません。ローカルサーバーを確認してください。';
      }
    }

    async _saveCurrentBattle() {
      if (this.currentSavedId) return { audioUrl: this.currentAudioUrl };
      const record = await DOPANEWS.saveBattle({
        battleData: this.currentBattleData,
        articleText: this.currentArticleText,
        audioUrl: this.currentAudioWavBase64 ? null : this.currentAudioUrl,
        audioWavBase64: this.currentAudioWavBase64,
        synthDuration: this.currentSynthDuration,
        murekaTrack: this.currentMurekaTrack || null,
        reviews: this.currentReviews
      });
      this.currentSavedId = record.id;
      this.currentAudioUrl = record.audioUrl;
      await this._refreshLibrary();
      this.libraryStatusEl.textContent = 'このPCに保存しました。次回起動時も一覧から再生できます。';
      return record;
    }

    async _autoSaveBattle() {
      try {
        await this._saveCurrentBattle();
      } catch (err) {
        this.libraryStatusEl.textContent = `保存できませんでした。「今のラップを保存」で再試行できます：${err.message}`;
      }
    }

    async _playSavedBattle(item) {
      if (this.isGenerating || this.articleTransitionPending) return;
      this._beginGeneration();
      try {
        this.articleInputEl.value = item.articleText || '';
        this.currentArticleText = this.articleInputEl.value;
        const restoredBattle = DOPANEWS.normalizeBattleData(item.battleData);
        const originalArticle = DOPANEWS.initialNewsArticles?.find(article =>
          this.currentArticleText.includes(article.title) ||
          (item.audioUrl && item.audioUrl === (article.battleKey === 'voice' ? DOPANEWS.FIXED_DEMO : DOPANEWS.FOOD_DEMO)?.audioUrl));
        if (originalArticle) restoredBattle.title = originalArticle.title;
        this._applyBattleData(restoredBattle);
        if (DOPANEWS.libraryNavigation?.openBattle) {
          DOPANEWS.libraryNavigation.openBattle();
        } else {
          document.body?.classList.remove('news-mode');
          document.body?.classList.remove('library-mode');
          const library = document.getElementById('library-screen');
          if (library) library.hidden = true;
        }
        this.sidebarPanelEl?.classList.remove('drawer-open');
        const back = document.getElementById('return-to-news');
        if (back) back.hidden = false;
        this.currentSavedId = item.id;
        this.currentAudioUrl = item.audioUrl;
        this.currentSynthDuration = item.synthDuration || 67;
        this.currentMurekaTrack = item.murekaTrack;
        this.currentReviews = item.reviews || {};
        const report = this.currentReviews.audio || this.currentReviews.script;
        if (report) {
          this.reviewContext = {
            mode: item.murekaTrack?.backing_request ? 'backing' : 'full',
            stage: report.stage,
            articleText: this.currentArticleText,
            battleData: item.battleData,
            report
          };
          this.reviewState = { status: report.verdict, stage: report.stage, report };
        }
        this.stageView.syncTime(0, item.murekaTrack?.duration / 1000 || this.currentSynthDuration);
        this._setLog(`保存したラップ「${item.battleData.title}」を読み込みました。`);
        this._setStepState(3);
        if (item.audioUrl) return await this.audioController.loadAndPlayUrl(item.audioUrl);
        this.audioController.startSynthBattle(this.currentSynthDuration);
        return true;
      } finally {
        this._setGenerating(false);
      }
    }

    async handleFixedDemo(demo = DOPANEWS.FIXED_DEMO) {
      if (this.isGenerating || this.articleTransitionPending) return;
      // Clone so playback edits cannot alter the bundled battle for later replays.
      const playing = await this._playSavedBattle(JSON.parse(JSON.stringify(demo)));
      if (!playing) return false;

    }

    _bindEvents() {
      this.articleGenerationRetryEl?.addEventListener('click', () => {
        if (this.pendingFullAudioOptions && !this.isGenerating && !this.articleTransitionPending) {
          this.handleFullBattleGeneration(this.pendingFullAudioOptions);
          return;
        }
        if (this.articleGenerationRequest && !this.isGenerating && !this.articleTransitionPending) this.handleArticleBattleGeneration(this.articleGenerationRequest);
      });
      document.getElementById('news-open-studio')?.addEventListener('click', () => {
        if (this.isGenerating) return;
        this._stopCurrentBattle();
        document.body.classList.remove('news-mode');
        const returnButton = document.getElementById('return-to-news');
        if (returnButton) returnButton.hidden = false;
        this.newsUrlInputEl?.focus();
      });

      this.generateFixedBeatBtnEl?.addEventListener('click', () => this.handleGenerateFixedBeat());
      this.previewFixedBeatBtnEl?.addEventListener('click', () => {
        if (!this.fixedBeatAudioPreviewEl || !this.fixedBeat?.audioUrl) return;
        this.fixedBeatAudioPreviewEl.hidden = false;
        if (this.fixedBeatAudioPreviewEl.paused) {
          this.fixedBeatAudioPreviewEl.play().catch(() => {});
        } else {
          this.fixedBeatAudioPreviewEl.pause();
        }
      });

      document.getElementById('btn-sync-vocal-start')?.addEventListener('click', () => {
        if (this.isGenerating || this.audioController.usingSynthFallback) return;
        this.stageView.alignVerseStartToCurrentTime(0, this.audioEl.currentTime);
        this._setLog('歌い出しを現在位置に同期しました。以降は指定BPMで表示します。');
        this._updateTransport();
      });
      this.refreshLibraryBtnEl?.addEventListener('click', () => this._refreshLibrary());
      this.saveBattleBtnEl?.addEventListener('click', async () => {
        if (this.isGenerating) return;
        this.audioController.pause();
        this._setGenerating(true);
        try {
          await this._saveCurrentBattle();
        } catch (err) {
          this.libraryStatusEl.textContent = `保存できませんでした：${err.message}`;
        } finally {
          this._setGenerating(false);
        }
      });

      this.fetchUrlBtnEl?.addEventListener('click', () => this.handleFetchUrl().catch(() => {}));
      this.generateFromUrlBtnEl?.addEventListener('click', () => this.handleUrlBattleGeneration());
      this.newsUrlInputEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleFetchUrl().catch(() => {});
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

      this.generateBtnEl?.addEventListener('click', () => this.handleFullBattleGeneration());
      this.geminiOnlyBtnEl?.addEventListener('click', () => this.handleGeminiOnlyGeneration());

      this.presetTestBtnEl?.addEventListener('click', () => {
        if (this.isGenerating) return;
        this._stopCurrentBattle();
        if (this.newsUrlInputEl) this.newsUrlInputEl.value = '';
        this.articleInputEl.value = DOPANEWS.PRESET_NEWS_ARTICLE;
        this.currentArticleText = DOPANEWS.PRESET_NEWS_ARTICLE;
        this._applyBattleData(DOPANEWS.PRESET_BATTLE_DATA);
        this._setStepState(3);
        this._setLog('🎧 ニュースと115 BPMの内蔵ビートでバトルを開始しました！');
        this.currentSynthDuration = 67;
        this.audioController.startSynthBattle(67);
      });

      this.localMp3InputEl?.addEventListener('change', (e) => {
        if (this.isGenerating) return;
        const file = e.target.files?.[0];
        if (!file) return;
        this._stopCurrentBattle();
        const objUrl = URL.createObjectURL(file);
        if (this.localMp3LabelEl) {
          this.localMp3LabelEl.textContent = `🎵 読込済: ${file.name.slice(0, 22)}`;
        }
        this._setStepState(3);
        this._setLog(`🎵 ローカルMP3「${file.name}」をステージにセットして再生開始！`);
        this.currentAudioUrl = objUrl;
        this.audioController.loadAndPlayUrl(objUrl);
      });

      this.playPauseBtnEl?.addEventListener('click', () => {
        if (this.isGenerating) return;
        this.audioController.togglePlay();
      });
      this.prevVerseBtnEl?.addEventListener('click', () => this._moveVerse(-1));
      this.nextVerseBtnEl?.addEventListener('click', () => this._moveVerse(1));
      this.seekInputEl?.addEventListener('input', () => {
        if (this.isGenerating) return;
        const seconds = Number(this.seekInputEl.value);
        this.audioController.seekTo(seconds);
        this.stageView.syncTime(seconds, this.stageView.lastKnownDuration);
        this._updateTransport();
      });
      const applyVolume = (volume) => {
        if (volume > 0) this.lastAudibleVolume = volume;
        this.audioController.setVolume(volume / 100);
        if (this.volumeInputEl) this.volumeInputEl.value = String(volume);
        this.muteButtonEl?.setAttribute('aria-pressed', String(volume === 0));
        this.muteButtonEl?.setAttribute('aria-label', volume === 0 ? '消音を解除する' : '消音する');
      };
      this.volumeInputEl?.addEventListener('input', () => applyVolume(Number(this.volumeInputEl.value)));
      this.muteButtonEl?.addEventListener('click', () => {
        applyVolume(this.audioController.volume > 0 ? 0 : this.lastAudibleVolume);
      });

      this.openJudgeBtnEl?.addEventListener('click', () => {
        if (this.isGenerating) return;
        this.audioController.pause();
        this.judgeModal.open(this.currentBattleData);
      });

      this.mobileDrawerToggleEl?.addEventListener('click', () => {
        this.sidebarPanelEl?.classList.toggle('drawer-open');
      });
    }

    async handleFetchUrl(customUrl) {
      if (this.isFetchingUrl) throw new Error('ニュース本文を読込中です。完了までお待ちください。');
      const targetUrl = (customUrl || this.newsUrlInputEl?.value || '').trim();
      if (!targetUrl) {
        this._setLog('⚠️ ニュース記事のURLを入力してください。', true);
        this.newsUrlInputEl?.focus();
        return null;
      }

      this.isFetchingUrl = true;
      [this.generateBtnEl, this.generateFromUrlBtnEl, this.geminiOnlyBtnEl, this.newsUrlInputEl, this.articleInputEl].forEach(el => { if (el) el.disabled = true; });
      if (this.fetchUrlBtnEl) {
        this.fetchUrlBtnEl.disabled = true;
        this.fetchUrlBtnEl.textContent = '⏳ 読込中...';
      }
      this._setLog(`🔗 URLからニュース記事の本文を自動抽出中... (${targetUrl.slice(0, 45)}...)`);

      try {
        const articleText = await DOPANEWS.fetchArticleFromUrl(targetUrl);
        this.articleInputEl.value = articleText;
        this.lastFetchedUrl = targetUrl;
        this._setLog(
          `✅ URLからニュース本文を抽出しました！（${articleText.length.toLocaleString()}文字）続けて「🔥 バトル生成スタート」を押せます。`
        );
        return articleText;
      } catch (err) {
        this._setLog(`❌ URL読込エラー: ${err.message}`, true);
        throw err;
      } finally {
        this.isFetchingUrl = false;
        [this.generateBtnEl, this.generateFromUrlBtnEl, this.geminiOnlyBtnEl, this.newsUrlInputEl, this.articleInputEl].forEach(el => { if (el) el.disabled = this.isGenerating; });
        if (this.fetchUrlBtnEl) {
          this.fetchUrlBtnEl.disabled = this.isGenerating;
          this.fetchUrlBtnEl.textContent = '📥 URL読込';
        }
      }
    }

    async _resolveArticleTextBeforeGenerate() {
      const urlFieldVal = this.newsUrlInputEl?.value.trim() || '';
      const textFieldVal = this.articleInputEl?.value.trim() || '';

      // A newly entered URL always supersedes the previous article's body.
      if (/^https?:\/\/\S+$/i.test(urlFieldVal) && urlFieldVal !== this.lastFetchedUrl) {
        return await this.handleFetchUrl(urlFieldVal);
      }
      if (/^https?:\/\/\S+$/i.test(textFieldVal)) {
        if (this.newsUrlInputEl) this.newsUrlInputEl.value = textFieldVal;
        return await this.handleFetchUrl(textFieldVal);
      }

      return textFieldVal;
    }

    async handleUrlBattleGeneration() {
      if (this.isGenerating || this.isFetchingUrl) return;
      const articleUrl = this.newsUrlInputEl?.value.trim() || '';
      try {
        const parsed = new URL(articleUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        this._setLog('ニュース記事のURL（https://…）を入力してください。', true);
        this.newsUrlInputEl?.focus();
        return;
      }
      return await this.handleFullBattleGeneration({ articleUrl });
    }

    async handleArticleBattleGeneration({ articleText, title }) {
      if (this.isGenerating || this.articleTransitionPending) return;
      this.articleTransitionPending = true;
      this.articleGenerationRequest = { articleText, title };
      const stage = document.getElementById('battle-stage');
      this._stopCurrentBattle();
      this.newsUrlInputEl.value = ''; this.lastFetchedUrl = '';
      this.articleInputEl.value = articleText;
      this.currentArticleText = articleText;
      document.body?.classList.remove('news-mode');
      const back = document.getElementById('return-to-news'); if (back) back.hidden = false;
      stage?.classList.add('article-generation-pending');
      if (this.articleGenerationPanelEl) this.articleGenerationPanelEl.hidden = false;
      if (this.articleGenerationTitleEl) this.articleGenerationTitleEl.textContent = title;
      if (this.articleGenerationRetryEl) this.articleGenerationRetryEl.hidden = true;
      this._setLog('ラップの生成を準備しています…');
      try {
        this.audioController._ensureAudioContext();
        const completed = await this.handleFullBattleGeneration({ articleText });
        if (completed) {
          stage?.classList.remove('article-generation-pending');
          if (this.articleGenerationPanelEl) this.articleGenerationPanelEl.hidden = true;
        }
      } catch (error) {
        this._setLog(`ラップを生成できませんでした：${error.message}`, true);
      } finally {
        this.articleTransitionPending = false;
        if (this.articleGenerationRetryEl) this.articleGenerationRetryEl.hidden = Boolean(this.articleGenerationPanelEl?.hidden);
      }
    }

    async handleFullBattleGeneration(options = {}) {
      if (this.isGenerating || this.isFetchingUrl) return;

      const config = await this._loadLocalConfig();
      if (!config.reviewSupported || !config.lyriaSupported || !config.lyriaAlignmentSupported) {
        this._setLog('サーバーの更新が必要です。start_server.batで再起動後、もう一度お試しください。', true);
        return;
      }
      if (!config.geminiConfigured) {
        this._setLog('config.local.json に GeminiApiKey を設定してください。', true);
        return;
      }
      if (!config.openaiConfigured) {
        this._setLog('音声の同期にOpenAIを使用します。config.local.jsonにOpenAIApiKeyを設定してください。音源は生成していません。', true);
        return;
      }
      if (this.isGenerating) return;
      this._beginGeneration();

      try {
        this.fullAudioPending = true;
        this.pendingFullAudioOptions = { ...options };
        document.getElementById('battle-stage')?.classList.add('article-generation-pending');
        if (this.articleGenerationPanelEl) this.articleGenerationPanelEl.hidden = false;
        if (this.articleGenerationRetryEl) this.articleGenerationRetryEl.hidden = true;
        if (this.articleGenerationTitleEl) this.articleGenerationTitleEl.textContent = options.articleUrl || this.articleGenerationRequest?.title || 'ニュースのラップを生成';
        if (typeof DOPANEWS.synthesizeBattleWithLyria !== 'function') throw new Error('Lyriaの処理が読み込まれていません。Ctrl＋F5で画面を更新してから、もう一度生成してください。');
        const articleText = options.articleUrl
          ? await this.handleFetchUrl(options.articleUrl)
          : options.articleText ?? await this._resolveArticleTextBeforeGenerate();
        this.currentArticleText = articleText;
        this.pendingFullAudioOptions = { articleText, ...(options.reviewFeedback ? { reviewFeedback: options.reviewFeedback } : {}) };

        // Retain exactly the same lyrics after an audio failure, including across reloads.
        let pending;
        try { pending = JSON.parse(sessionStorage.getItem('dopanews-lyria-pending') || 'null'); } catch { /* Storage may be unavailable. */ }
        const battleData = !options.reviewFeedback && pending?.articleText === articleText
          ? pending.battleData : await this._generateCheckedLyrics(articleText, 'full', options.reviewFeedback);
        if (!battleData) return;
        try { sessionStorage.setItem('dopanews-lyria-pending', JSON.stringify({ articleText, battleData })); } catch { /* Server audio cache still applies. */ }
        this._applyBattleData(battleData);
        await this._generateApprovedBattle(battleData, config);
        this.fullAudioPending = false;
        this.pendingFullAudioOptions = null;
        document.getElementById('battle-stage')?.classList.remove('article-generation-pending');
        if (this.articleGenerationPanelEl) this.articleGenerationPanelEl.hidden = true;
        try { sessionStorage.removeItem('dopanews-lyria-pending'); } catch { /* Optional checkpoint. */ }
        return true;
      } catch (err) {
        console.error(err);
        this._setLog(`❌ エラー: ${err.message}`, true);
      } finally {
        this._setGenerating(false);
        if (this.articleGenerationRetryEl && this.fullAudioPending) this.articleGenerationRetryEl.hidden = false;
      }
    }

    async _generateApprovedBattle(battleData, config) {
      this._setStepState(2);

      const { audioUrl, audioWavBase64, durationSec, murekaTrack } =
        await DOPANEWS.synthesizeBattleWithLyria(battleData, msg => this._setLog(`② ${msg}`));

      const responsePreview = document.getElementById('mureka-json-preview');
      if (responsePreview) responsePreview.textContent = JSON.stringify(murekaTrack || {}, null, 2);

      this.currentSynthDuration = Math.round(durationSec || 73);
      this._applyBattleData(battleData);
      this.stageView.syncTime(0, durationSec || 73);

      this.currentAudioUrl = audioUrl;
      this.currentMurekaTrack = murekaTrack;
      this.currentAudioWavBase64 = audioWavBase64;
      this.partBlobUrl = audioUrl;
      await this._autoSaveBattle();

      this._setStepState(3);
      this._setLog('③ ラップバトルが完成しました。ステージで再生します。');
      await this.audioController.loadAndPlayUrl(this.currentAudioUrl || audioUrl);
      this.audioReviewPromise = this._startAudioReview();
    }

    async handleGeminiOnlyGeneration(options = {}) {
      if (this.isGenerating) return;

      const config = await this._loadLocalConfig();
      if (!config.reviewSupported) {
        this._setLog('サーバーの更新が必要です。start_server.batで再起動後、もう一度お試しください。', true);
        return;
      }
      if (!config.geminiConfigured) {
        this._setLog('config.local.json に GeminiApiKey を設定してください。', true);
        return;
      }
      if (this.isGenerating) return;
      this._beginGeneration();
      try {
        const articleText = options.articleText ?? await this._resolveArticleTextBeforeGenerate();
        this.currentArticleText = articleText;

        const battleData = await this._generateCheckedLyrics(articleText, 'lyrics', options.reviewFeedback);
        if (!battleData) return;
        this._applyBattleData(battleData);
        this._setStepState(3);
        this._setLog(
          '③ Gemini作詞完了！ステージに歌詞をセットし、115 BPMの内蔵ビートで再生を開始します🔥'
        );
        this.currentSynthDuration = 67;
        await this._autoSaveBattle();
        this.audioController.startSynthBattle(67);
      } catch (err) {
        this._setLog(`❌ エラー: ${err.message}`, true);
      } finally {
        this._setGenerating(false);
      }
    }

    async _generateCheckedLyrics(articleText, mode, feedback = null) {
      this._setStepState(1);
      const attempts = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        this._setLog('① Geminiで8小節×4本（KENTA＆REINA）の歌詞を作成しています…');
        let battleData;
        try {
          battleData = await DOPANEWS.generateBattleScriptWithGemini(
            articleText,
            () => this._setLog('① Geminiで8小節×4本（KENTA＆REINA）の歌詞を作成しています…'),
            feedback || null,
            mode === 'full' ? 'lyria' : 'legacy'
          );
        } catch (error) {
          if (error.code !== 'LYRIC_CONTENT_INVALID') throw error;
          feedback = {
            verdict: 'needs_revision',
            summary: '歌詞の出力形式・読み方を修正してください。',
            issues: [{ kind: 'pronunciation', reason: error.message }]
          };
          this.reviewState = { status: 'needs_revision', stage: 'script', report: feedback };
          attempts.push({ attempt, ...this.reviewState });
          this.currentReviews.scriptAttempts = attempts;
          continue;
        }
        if (mode === 'full' && this.battleStyleInputEl?.value.trim()) {
          battleData.suno_style = this.battleStyleInputEl.value.trim();
        }
        if (mode === 'full') {
          battleData.suno_style = battleData.suno_style.replace(/\b\d{2,3}\s*BPM\b/gi, '115 BPM');
          if (this.battleStyleInputEl) this.battleStyleInputEl.value = battleData.suno_style;
        }
        const approved = await this._reviewScript(battleData, articleText, mode);
        attempts.push({ attempt, ...this.reviewState });
        this.currentReviews.scriptAttempts = attempts;
        if (approved) return battleData;
        if (this.reviewState.status === 'error') break;
        feedback = this.reviewContext.report;
      }
      this._setLog('歌詞の作成を完了できませんでした。時間をおいてもう一度お試しください。音源は生成していません。', true);
      return null;
    }

    async _reviewScript(battleData, articleText, mode) {
      this.reviewContext = { stage: 'script', battleData, articleText, mode };
      this.reviewState = { status: 'checking', stage: 'script' };
      this._setLog('① AI審判が元記事と歌詞・読み仮名を照合しています…');
      try {
        const report = await DOPANEWS.reviewBattle({ stage: 'script', articleText, battleData });
        this.currentReviews.script = report;
        this.reviewContext.report = report;
        this.reviewState = { status: report.verdict, stage: 'script', report };
        return report.verdict === 'pass';
      } catch (err) {
        this.reviewState = { status: 'error', stage: 'script', message: err.message };
        return false;
      }
    }

    async _startAudioReview(force = false) {
      const version = this.reviewVersion;
      this.reviewContext = {
        stage: 'audio',
        articleText: this.currentArticleText,
        battleData: this.currentBattleData,
        mode: this.currentMurekaTrack?.backing_request ? 'backing' : 'full',
        recordId: this.currentSavedId
      };
      this.reviewState = { status: 'checking', stage: 'audio' };
      try {
        if (!this.currentSavedId) throw new Error('音源の保存に失敗したため未確認です。保存してから審判を再実行してください。');
        const report = await DOPANEWS.reviewBattle({ stage: 'audio', recordId: this.currentSavedId, force });
        if (version !== this.reviewVersion) return;
        this.currentReviews.audio = report;
        this.reviewContext.report = report;
        this.reviewState = { status: report.verdict, stage: 'audio', report };
        await this._refreshLibrary();
      } catch (err) {
        if (version !== this.reviewVersion) return;
        this.reviewState = { status: 'error', stage: 'audio', message: err.message };
      }
    }

    _stopCurrentBattle() {
      this.fullAudioPending = false;
      this.pendingFullAudioOptions = null;
      this.reviewVersion++;
      this.currentReviews = {};
      this.reviewContext = null;
      this.reviewState = { status: 'idle' };
      this.audioController.stopPlayback();
      this.currentAudioUrl = null;
      const demoStatus = document.getElementById('fixed-demo-playback-status');
      if (demoStatus) { demoStatus.hidden = true; demoStatus.textContent = ''; }
      this.currentSavedId = null;
      this.currentMurekaTrack = null;
      this.currentAudioWavBase64 = null;
      if (this.partBlobUrl) {
        URL.revokeObjectURL(this.partBlobUrl);
        this.partBlobUrl = null;
      }
      const responsePreview = document.getElementById('mureka-json-preview');
      if (responsePreview) responsePreview.textContent = '';
      if (!this.judgeModal.overlayEl.classList.contains('hidden')) {
        this.judgeModal.close();
      }
    }

    _beginGeneration() {
      this._setGenerating(true);
      this._stopCurrentBattle();
    }

    _verseTarget(direction) {
      const current = this.stageView.currentVerseIndex;
      const time = this.audioController.getCurrentTime();
      const windows = this.stageView.getVerseWindows(this.stageView.lastKnownDuration);
      const available = this.currentBattleData.verses
        .map((verse, index) => ({ verse, index, start: windows[index].start }))
        .filter((item) => !this.currentBattleData.mureka_sync || item.verse.synced_from_mureka);
      return direction > 0
        ? available.find((item) => (current >= 0 ? item.index > current : item.start > time))
        : available.filter((item) => (current >= 0 ? item.index < current : item.start < time)).pop();
    }

    _moveVerse(direction) {
      if (this.isGenerating) return;
      const target = this._verseTarget(direction);
      if (target) this.stageView.onSelectVerse(target.index, target.start);
    }

    _updateTransport() {
      if (this.prevVerseBtnEl) this.prevVerseBtnEl.disabled = this.isGenerating || !this._verseTarget(-1);
      if (this.nextVerseBtnEl) this.nextVerseBtnEl.disabled = this.isGenerating || !this._verseTarget(1);
    }

    _setGenerating(isGenerating) {
      this.isGenerating = isGenerating;
      this.libraryListEl?.querySelectorAll('button').forEach((button) => {
        button.disabled = isGenerating;
      });
      [
        this.generateFixedBeatBtnEl,
        this.previewFixedBeatBtnEl,
        this.generateBtnEl,
        this.geminiOnlyBtnEl,
        this.presetTestBtnEl,
        this.localMp3InputEl,
        this.playPauseBtnEl,
        this.openJudgeBtnEl,
        this.fetchUrlBtnEl,
        this.generateFromUrlBtnEl,
        this.newsUrlInputEl,
        this.articleInputEl,
        this.stylePresetSelectEl,
        this.battleStyleInputEl,
        this.saveBattleBtnEl,
        this.refreshLibraryBtnEl,
        this.seekInputEl
      ].forEach((element) => {
        if (element) element.disabled = isGenerating;
      });
      this._updateTransport();
    }

    _applyBattleData(battleData) {
      if (!battleData.character_ids && DOPANEWS.selectedCharacters) battleData.character_ids = DOPANEWS.selectedCharacters.slice();
      DOPANEWS.applyCharacterSelection?.(battleData.character_ids);
      if (!battleData.category) battleData.category = DOPANEWS.getNewsCategory?.(this.currentArticleText) || 'その他';
      if (!this.articleTransitionPending && !this.fullAudioPending) {
        document.getElementById('battle-stage')?.classList.remove('article-generation-pending');
        if (this.articleGenerationPanelEl) this.articleGenerationPanelEl.hidden = true;
      }
      this.currentBattleData = battleData;
      this.stageView.setBattleData(battleData);
      const syncButton = document.getElementById('btn-sync-vocal-start');
      if (syncButton) syncButton.disabled = Boolean(battleData.part_segments);
      this._updateTransport();

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
      const playbackStatus = document.getElementById('fixed-demo-playback-status');
      if (playbackStatus) {
        const show = Boolean(this.currentAudioUrl) && (isError || message.includes('自動再生制限'));
        playbackStatus.textContent = show ? message : '';
        playbackStatus.hidden = !show;
        playbackStatus.classList.toggle('status-error', isError);
      }
      if (this.articleGenerationStatusEl) {
        this.articleGenerationStatusEl.textContent = message;
        this.articleGenerationStatusEl.classList.toggle('status-error', isError);
      }
      if (!this.statusLogEl) return;
      this.statusLogEl.textContent = message;
      this.statusLogEl.classList.toggle('status-error', isError);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.dopaNewsApp = new DopaNewsApp();
  });
})(window);
