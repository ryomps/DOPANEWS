/**
 * DOPANEWS Main Application Controller
 * - ニュースURLからの本文自動抽出（URL欄・本文欄のどちらにURLを貼っても自動判定）
 * - ローカルサーバーによるAPI設定・生成履歴の保存
 * - 進捗ステップバー（①Gemini作詞中 ➔ ②Mureka収録中 ➔ ③バトル開始！）制御
 * - プリセットデータ＆ローカルMP3テストフォールバック制御
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

      this._cacheDom();
      this._initComponents();
      this.currentAudioUrl = null;
      this.currentSavedId = null;
      this.currentSynthDuration = 45;
      this.currentArticleText = DOPANEWS.PRESET_NEWS_ARTICLE;
      this.configReady = this._loadLocalConfig();
      this._refreshLibrary();
      this._bindEvents();

      this.articleInputEl.value = DOPANEWS.PRESET_NEWS_ARTICLE;
      this._applyBattleData(DOPANEWS.PRESET_BATTLE_DATA);
    }

    _cacheDom() {
      this.apiConfigStatusEl = document.getElementById('api-config-status');
      this.libraryListEl = document.getElementById('saved-battle-list');
      this.libraryStatusEl = document.getElementById('library-status');
      this.saveBattleBtnEl = document.getElementById('btn-save-battle');
      this.refreshLibraryBtnEl = document.getElementById('btn-refresh-library');

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
        onChoose: () => document.getElementById('return-to-news')?.click?.(),
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
        onPlaybackError: () => {
          this._setLog('音声を再生できませんでした。保存一覧から読み直すか、音声ファイルを確認してください。', true);
        },
        onAutoplayBlocked: () => {
          this._setLog(
            '🎵 楽曲の準備が完了しました！ブラウザの自動再生制限のため、右ステージ下の「▶ 再生・再開」ボタンを押してスタートしてください🔥'
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
          ? `OpenAI検索：${config.openaiConfigured ? '接続設定済み' : '未設定'} ／ Gemini：${config.geminiConfigured ? '接続設定済み' : '未設定'} ／ Mureka：${config.murekaConfigured ? '接続設定済み' : '未設定'}`
          : 'サーバーの更新が必要です。サーバーを再起動してください。';
        return config;
      } catch {
        this.apiConfigStatusEl.textContent = 'start_server.bat から起動してください。';
        return {};
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
          button.type = 'button'; button.className = 'btn-sub-action'; button.textContent = '▶ このラップを聴く';
          button.disabled = this.isGenerating;
          button.addEventListener('click', () => this._playSavedBattle(item));
          row.appendChild(title); row.appendChild(meta); row.appendChild(button);
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
        battleData: this.currentBattleData, articleText: this.currentArticleText,
        audioUrl: this.currentAudioWavBase64 ? null : this.currentAudioUrl, audioWavBase64: this.currentAudioWavBase64, synthDuration: this.currentSynthDuration,
        murekaTrack: this.currentMurekaTrack || null, reviews: this.currentReviews
      });
      this.currentSavedId = record.id;
      this.currentAudioUrl = record.audioUrl;
      await this._refreshLibrary();
      this.libraryStatusEl.textContent = 'このPCに保存しました。次回起動時も一覧から再生できます。';
      return record;
    }

    async _autoSaveBattle() {
      try { await this._saveCurrentBattle(); }
      catch (err) { this.libraryStatusEl.textContent = `保存できませんでした。「今のラップを保存」で再試行できます：${err.message}`; }
    }

    async _playSavedBattle(item) {
      if (this.isGenerating) return;
      this._beginGeneration();
      try {
        this.articleInputEl.value = item.articleText || '';
        this.currentArticleText = this.articleInputEl.value;
        this._applyBattleData(item.battleData);
        this.currentSavedId = item.id; this.currentAudioUrl = item.audioUrl;
        this.currentSynthDuration = item.synthDuration || 45;
        this.currentMurekaTrack = item.murekaTrack;
        this.currentReviews = item.reviews || {};
        const report = this.currentReviews.audio || this.currentReviews.script;
        if (report) {
          this.reviewContext = { mode: item.murekaTrack?.backing_request ? 'backing' : 'full', stage: report.stage, articleText: this.currentArticleText, battleData: item.battleData, report };
          this.reviewState = { status: report.verdict, stage: report.stage, report };
        }
        this.stageView.syncTime(0, item.murekaTrack?.duration / 1000 || this.currentSynthDuration);
        this._setLog(`保存したラップ「${item.battleData.title}」を読み込みました。`);
        if (item.audioUrl) await this.audioController.loadAndPlayUrl(item.audioUrl);
        else this.audioController.startSynthBattle(this.currentSynthDuration);
      } finally { this._setGenerating(false); }
    }

    _bindEvents() {
      document.getElementById('news-open-studio')?.addEventListener('click', () => {
        if (this.isGenerating) return;
        this._stopCurrentBattle();
        document.body.classList.remove('news-mode');
        const returnButton = document.getElementById('return-to-news');
        if (returnButton) returnButton.hidden = false;
        this.newsUrlInputEl?.focus();
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
        try { await this._saveCurrentBattle(); }
        catch (err) { this.libraryStatusEl.textContent = `保存できませんでした：${err.message}`; }
        finally { this._setGenerating(false); }
      });

      // URLから記事本文を読み込むボタン＆Enterキー対応
      this.fetchUrlBtnEl?.addEventListener('click', () => this.handleFetchUrl());
      this.newsUrlInputEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleFetchUrl();
        }
      });

      // Styleプリセット選択時にテキストボックスへ反映
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
        this._setLog('🎧 プリセットニュース＆112BPMデモビートでバトルを開始しました！');
        this.currentSynthDuration = 44;
        this.audioController.startSynthBattle(44);
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

    /**
     * ニュースURLから本文を抽出してテキストエリアにセットする
     */
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
          this.fetchUrlBtnEl.disabled = this.isGenerating;
          this.fetchUrlBtnEl.textContent = '📥 URL読込';
        }
      }
    }

    /**
     * テキストエリアまたはURL欄にURLが入っている場合、自動で本文を取得してから返す
     */
    async _resolveArticleTextBeforeGenerate() {
      const urlFieldVal = this.newsUrlInputEl?.value.trim() || '';
      const textFieldVal = this.articleInputEl?.value.trim() || '';

      // 1) テキストエリア自体にURLが1行だけ貼られている場合
      if (/^https?:\/\/\S+$/i.test(textFieldVal)) {
        if (this.newsUrlInputEl) this.newsUrlInputEl.value = textFieldVal;
        return await this.handleFetchUrl(textFieldVal);
      }

      // 2) URL欄に新しいURLが入力されていて、まだ読み込んでいない場合
      if (
        /^https?:\/\/\S+$/i.test(urlFieldVal) &&
        urlFieldVal !== this.lastFetchedUrl &&
        (textFieldVal === '' || textFieldVal === DOPANEWS.PRESET_NEWS_ARTICLE)
      ) {
        return await this.handleFetchUrl(urlFieldVal);
      }

      return textFieldVal;
    }

    async handleFullBattleGeneration(options = {}) {
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

        const battleData = await this._generateCheckedLyrics(articleText, 'full', options.reviewFeedback);
        if (!battleData) return;
        this._applyBattleData(battleData);
        await this._generateApprovedBattle(battleData, config);
      } catch (err) {
        console.error(err);
        this._setLog(`❌ エラー: ${err.message}`, true);
      } finally {
        this._setGenerating(false);
      }
    }

    async _generateApprovedBattle(battleData, config) {
      this._setStepState(2);
      if (!config.murekaConfigured) {
        this._setLog(
          '⚠️ Murekaが未設定のため、Gemini生成リリック＋内蔵112BPMビートでステージを開始します！'
        );
        this._setStepState(3);
        this.currentSynthDuration = 64;
        await this._autoSaveBattle();
        this.audioController.startSynthBattle(64);
        return;
      }

      this._setLog(
        '② Murekaで8小節×4本を1曲として生成中。96 BPMでは各バース約20秒を目安に、男女交互の歌唱を指定します。'
      );
      const { audioUrl, murekaTrack } = await DOPANEWS.generateBattleTrackWithMureka(
        battleData,
        (progressMsg) => {
          this._setLog(`② ${progressMsg}`);
        }
      );

      // Keep the returned track available for inspecting actual lyric timings.
      const responsePreview = document.getElementById('mureka-json-preview');
      if (responsePreview) responsePreview.textContent = JSON.stringify(murekaTrack || {}, null, 2);
      this._applyBattleData(battleData);
      this.currentAudioUrl = audioUrl;
      this.currentMurekaTrack = murekaTrack;
      this.currentAudioWavBase64 = null;
      await this._autoSaveBattle();

      this._setStepState(3);
      this._setLog('③ 楽曲が完成しました。ステージで再生します。');
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
          '③ Gemini作詞完了！ステージに歌詞をセットし、112BPMビートで再生を開始します🔥'
        );
        this.currentSynthDuration = 45;
        await this._autoSaveBattle();
        this.audioController.startSynthBattle(45);
      } catch (err) {
        this._setLog(`❌ エラー: ${err.message}`, true);
      } finally {
        this._setGenerating(false);
      }
    }

    async _generateCheckedLyrics(articleText, mode, feedback = null) {
      this._setStepState(1);
      // The budget covers the initial lyrics plus up to two corrected versions.
      // Only Gemini is used here. Mureka is called once, after approval.
      const attempts = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        this._setLog('① 歌詞を作成しています…');
        let battleData;
        try {
          battleData = await DOPANEWS.generateBattleScriptWithGemini(
            articleText, () => this._setLog('① 歌詞を作成しています…'), feedback || null
          );
        } catch (error) {
          if (error.code !== 'LYRIC_CONTENT_INVALID') throw error;
          feedback = { verdict: 'needs_revision', summary: '歌詞の出力形式・読み方を修正してください。',
            issues: [{ kind: 'pronunciation', reason: error.message }] };
          this.reviewState = { status: 'needs_revision', stage: 'script', report: feedback };
          attempts.push({ attempt, ...this.reviewState });
          this.currentReviews.scriptAttempts = attempts;
          continue;
        }
        if (mode === 'full' && this.battleStyleInputEl?.value.trim()) {
          battleData.suno_style = this.battleStyleInputEl.value.trim();
        }
        if (mode === 'full') {
          battleData.suno_style = battleData.suno_style.replace(/\b\d{2,3}\s*BPM\b/gi, '96 BPM');
          if (this.battleStyleInputEl) this.battleStyleInputEl.value = battleData.suno_style;
        }
        const approved = await this._reviewScript(battleData, articleText, mode);
        attempts.push({ attempt, ...this.reviewState });
        this.currentReviews.scriptAttempts = attempts;
        if (approved) return battleData;
        // A connection/format failure supplies no correction to make. Do not spend
        // more tokens generating different lyrics against an unavailable checker.
        if (this.reviewState.status === 'error') break;
        feedback = this.reviewContext.report;
      }
      this._setLog('歌詞の作成を完了できませんでした。時間をおいてもう一度お試しください。音源は生成していません。', true);
      return null;
    }

    async _reviewScript(battleData, articleText, mode) {
      this.reviewContext = { stage: 'script', battleData, articleText, mode };
      this.reviewState = { status: 'checking', stage: 'script' };
      this._setLog('① 歌詞を作成しています…');
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
      this.reviewContext = { stage: 'audio', articleText: this.currentArticleText,
        battleData: this.currentBattleData, mode: this.currentMurekaTrack?.backing_request ? 'backing' : 'full', recordId: this.currentSavedId };
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
      this.reviewVersion++;
      this.currentReviews = {};
      this.reviewContext = null;
      this.reviewState = { status: 'idle' };
      this.audioController.stopPlayback();
      this.currentAudioUrl = null;
      this.currentSavedId = null;
      this.currentMurekaTrack = null;
      this.currentAudioWavBase64 = null;
      if (this.partBlobUrl) { URL.revokeObjectURL(this.partBlobUrl); this.partBlobUrl = null; }
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
      const available = this.currentBattleData.verses.map((verse, index) => ({verse, index, start: windows[index].start}))
        .filter(item => !this.currentBattleData.mureka_sync || item.verse.synced_from_mureka);
      return direction > 0
        ? available.find(item => current >= 0 ? item.index > current : item.start > time)
        : available.filter(item => current >= 0 ? item.index < current : item.start < time).pop();
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
      this.libraryListEl?.querySelectorAll('button').forEach((button) => { button.disabled = isGenerating; });
      // Keep the displayed script paired with its audio until generation finishes.
      [this.generateBtnEl, this.geminiOnlyBtnEl, this.presetTestBtnEl,
        this.localMp3InputEl, this.playPauseBtnEl, this.openJudgeBtnEl,
        this.fetchUrlBtnEl, this.newsUrlInputEl, this.articleInputEl,
        this.stylePresetSelectEl, this.battleStyleInputEl, this.saveBattleBtnEl,
        this.refreshLibraryBtnEl, this.seekInputEl].forEach((element) => {
        if (element) element.disabled = isGenerating;
      });
      this._updateTransport();
    }

    _applyBattleData(battleData) {
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
      if (!this.statusLogEl) return;
      this.statusLogEl.textContent = message;
      this.statusLogEl.classList.toggle('status-error', isError);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.dopaNewsApp = new DopaNewsApp();
  });
})(window);
