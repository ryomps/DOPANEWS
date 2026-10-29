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
      this.reviewStatusEl = document.getElementById('ai-review-status');
      this.reviewIssuesEl = document.getElementById('ai-review-issues');
      this.reviewCostEl = document.getElementById('ai-review-cost');
      this.reviewRegenerateBtnEl = document.getElementById('btn-review-regenerate');
      this.reviewDismissBtnEl = document.getElementById('btn-review-dismiss');
      this.reviewRecheckBtnEl = document.getElementById('btn-review-recheck');
      this.showReviewBtnEl = document.getElementById('btn-show-ai-review');

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
      this.volumeValueEl = document.getElementById('battle-volume-value');
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
          ? `Gemini：${config.geminiConfigured ? '接続設定済み' : '未設定'} ／ Mureka：${config.murekaConfigured ? '接続設定済み' : '未設定'}`
          : 'サーバーが古いためAI審判を利用できません。サーバーを再起動してください。';
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
        audioUrl: this.currentAudioUrl, synthDuration: this.currentSynthDuration,
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
          this.reviewContext = { mode: 'full', stage: report.stage, articleText: this.currentArticleText, battleData: item.battleData, report };
          this.reviewState = { status: report.verdict, stage: report.stage, report };
          this._renderReview();
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
      this.showReviewBtnEl?.addEventListener('click', () => {
        this.sidebarPanelEl?.classList.add('drawer-open');
        document.getElementById('ai-review-panel')?.focus();
      });
      this.reviewRegenerateBtnEl?.addEventListener('click', () => this._regenerateReviewedBattle());
      this.reviewRecheckBtnEl?.addEventListener('click', () => this._recheckReview());
      this.reviewDismissBtnEl?.addEventListener('click', () => {
        this.reviewState.dismissed = true;
        this._renderReview();
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
      this.volumeInputEl?.addEventListener('input', () => {
        const volume = Number(this.volumeInputEl.value);
        this.audioController.setVolume(volume / 100);
        if (this.volumeValueEl) this.volumeValueEl.textContent = `${volume}%`;
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
        this._setLog('AI審判対応のサーバーを起動してください。start_server.batで再起動後、もう一度お試しください。APIはまだ使用していません。', true);
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

        this._setStepState(1);
        this._setLog(
          '① Gemini 3.8 Flash がニュースの対立軸を抽出し、KENTA vs REINA のラップ歌詞を作詞中...'
        );

        const battleData = await DOPANEWS.generateBattleScriptWithGemini(
          articleText,
          (progressMsg) => this._setLog(`① ${progressMsg}`),
          options.reviewFeedback || null
        );
        // ユーザーが画面上で指定したStyleプロンプトを優先適用
        if (this.battleStyleInputEl?.value.trim()) {
          battleData.suno_style = this.battleStyleInputEl.value.trim();
        }
        this._applyBattleData(battleData);

        if (!await this._reviewScript(battleData, articleText, 'full')) return;
        await this._generateApprovedBattle(battleData, config);
      } catch (err) {
        console.error(err);
        this._setLog(`❌ エラー: ${err.message}`, true);
      } finally {
        this._setGenerating(false);
      }
    }

    async _generateApprovedBattle(battleData, config) {
      this._renderReview();
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
        '② Mureka 公式API に8小節×4本の歌詞＆Styleを送信し、男女マイクリレー楽曲をレコーディング中...'
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
      await this._autoSaveBattle();

      this._setStepState(3);
      const sync = battleData.mureka_sync;
      this._setLog(sync
        ? `③ 楽曲完成！歌詞と台本の照合：${sync.matched_lines}/${sync.total_lines}行。未照合部分のMC表示は保留します。`
        : '③ Murekaバトル楽曲が完成！ステージで再生します。');
      await this.audioController.loadAndPlayUrl(this.currentAudioUrl || audioUrl);
      this.audioReviewPromise = this._startAudioReview();
    }


    async handleGeminiOnlyGeneration(options = {}) {
      if (this.isGenerating) return;

      const config = await this._loadLocalConfig();
      if (!config.reviewSupported) {
        this._setLog('AI審判対応のサーバーを起動してください。start_server.batで再起動後、もう一度お試しください。APIはまだ使用していません。', true);
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

        this._setStepState(1);
        this._setLog('① Gemini 3.8 Flash でニュース記事からラップバトル歌詞JSONを生成中...');
        const battleData = await DOPANEWS.generateBattleScriptWithGemini(
          articleText,
          (progressMsg) => this._setLog(`① ${progressMsg}`),
          options.reviewFeedback || null
        );
        this._applyBattleData(battleData);
        if (!await this._reviewScript(battleData, articleText, 'lyrics')) return;
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

    async _reviewScript(battleData, articleText, mode) {
      this.reviewContext = { stage: 'script', battleData, articleText, mode };
      this.reviewState = { status: 'checking', stage: 'script' };
      this._renderReview();
      this._setLog('AI審判が元記事と歌詞・読み方を確認しています。Murekaはまだ使用していません。');
      try {
        const report = await DOPANEWS.reviewBattle({ stage: 'script', articleText, battleData });
        this.currentReviews.script = report;
        this.reviewContext.report = report;
        this.reviewState = { status: report.verdict, stage: 'script', report };
        this._renderReview();
        if (report.verdict !== 'pass') this._setLog('歌詞に確認・修正候補があります。内容を確認して再生成するか選んでください。Murekaは使用していません。', true);
        return report.verdict === 'pass';
      } catch (err) {
        this.reviewState = { status: 'error', stage: 'script', message: err.message };
        this._renderReview();
        this._setLog('AI審判を完了できなかったため、音源生成を停止しました。自動で再生成しません。', true);
        return false;
      }
    }

    async _startAudioReview(force = false) {
      const version = this.reviewVersion;
      this.reviewContext = { stage: 'audio', articleText: this.currentArticleText,
        battleData: this.currentBattleData, mode: 'full', recordId: this.currentSavedId };
      this.reviewState = { status: 'checking', stage: 'audio' };
      this._renderReview();
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
      if (version === this.reviewVersion) this._renderReview();
    }

    async _regenerateReviewedBattle() {
      const context = this.reviewContext;
      if (this.isGenerating || this.reviewState.status === 'checking' || !context?.report || context.report.verdict === 'pass') return;
      const options = { articleText: context.articleText, reviewFeedback: context.report };
      if (context.mode === 'lyrics') await this.handleGeminiOnlyGeneration(options);
      else await this.handleFullBattleGeneration(options);
    }

    async _recheckReview() {
      if (this.isGenerating || this.reviewState.status === 'checking' || !this.reviewContext) return;
      if (this.reviewContext.stage === 'audio') { this.audioReviewPromise = this._startAudioReview(true); return this.audioReviewPromise; }
      const context = this.reviewContext;
      const config = await this._loadLocalConfig();
      if (this.isGenerating || this.reviewContext !== context) return;
      if (!config.reviewSupported || !config.geminiConfigured) {
        this._setLog('AI審判の接続設定とサーバーを確認してください。', true);
        return;
      }
      this._setGenerating(true);
      try {
        const approved = await this._reviewScript(context.battleData, context.articleText, context.mode);
        if (!approved) return;
        if (context.mode === 'full') await this._generateApprovedBattle(context.battleData, config);
        else {
          this._setStepState(3);
          this.currentSynthDuration = 45;
          await this._autoSaveBattle();
          this.audioController.startSynthBattle(45);
          this._setLog('歌詞の再確認が完了し、内蔵ビートで再生を開始しました。');
        }
      } catch (err) { this._setLog(`音源生成エラー：${err.message}`, true); }
      finally { this._setGenerating(false); }
    }

    _renderReview() {
      if (!this.reviewStatusEl) return;
      const state = this.reviewState || { status: 'idle' };
      const label = state.stage === 'audio' ? '音源' : '歌詞';
      const statuses = { idle: '未確認', checking: `${label}を確認中`, pass: `${label}：指摘なし`,
        needs_revision: `${label}に修正候補があります`, uncertain: `${label}：判断を保留しています`, error: `${label}：確認できませんでした` };
      const title = statuses[state.status] || '未確認';
      this.reviewStatusEl.textContent = title + (state.report ? `。${state.report.summary}` : state.message ? `。${state.message}` : '');
      if (this.showReviewBtnEl) this.showReviewBtnEl.textContent = `AI審判：${title}`;
      this.reviewIssuesEl.innerHTML = '';
      for (const issue of state.report?.issues || []) {
        const item = document.createElement('div'); item.className = 'ai-review-issue';
        for (const text of [`歌詞・音声：${issue.quote}`, `指摘：${issue.reason}`,
          `元記事の根拠：${issue.source_quote || '元記事から確認できません'}`, `修正案：${issue.suggestion}`]) {
          const paragraph = document.createElement('p'); paragraph.textContent = text; item.appendChild(paragraph);
        }
        this.reviewIssuesEl.appendChild(item);
      }
      const flagged = ['needs_revision', 'uncertain'].includes(state.status);
      this.reviewRegenerateBtnEl.hidden = !flagged || Boolean(state.dismissed);
      this.reviewDismissBtnEl.hidden = !flagged || Boolean(state.dismissed);
      this.reviewRecheckBtnEl.hidden = !['error', 'uncertain'].includes(state.status) || Boolean(state.dismissed);
      const lyricsOnly = this.reviewContext?.mode === 'lyrics';
      const proceedsToAudio = !lyricsOnly && state.stage === 'script';
      this.reviewRecheckBtnEl.textContent = proceedsToAudio ? '再確認して、問題なければ音源生成' : '審判を再確認（Gemini）';
      this.reviewRegenerateBtnEl.textContent = lyricsOnly ? '指摘を反映して歌詞を再生成（Gemini）' : '指摘を反映して再生成（Gemini＋Mureka 9）';
      this.reviewCostEl.textContent = flagged
        ? `${state.dismissed ? '今回は再生成しません。' : '自動では再生成しません。'}再生成を選ぶと${lyricsOnly ? 'Gemini' : 'GeminiとMureka'}を使用します。${proceedsToAudio ? '歌詞の再確認で問題がなければ、Mureka 9で音源生成へ進みます。' : '審判の再確認はGeminiのみ使用します。'}`
        : state.status === 'checking' ? (proceedsToAudio ? 'Geminiで確認中です。指摘がなければ音源生成へ進みます。' : 'Geminiで確認中です。音源の自動再生成は行いません。')
        : state.status === 'error' ? `未確認の状態です。自動では再試行しません。再確認にはGeminiを使用します。${proceedsToAudio ? '指摘がなければ、そのままMureka 9で音源生成へ進みます。' : ''}` : '';
      [this.reviewRegenerateBtnEl, this.reviewDismissBtnEl, this.reviewRecheckBtnEl]
        .forEach((button) => { button.disabled = this.isGenerating || state.status === 'checking'; });
    }

    _stopCurrentBattle() {
      this.reviewVersion++;
      this.currentReviews = {};
      this.reviewContext = null;
      this.reviewState = { status: 'idle' };
      this._renderReview();
      this.audioController.stopPlayback();
      this.currentAudioUrl = null;
      this.currentSavedId = null;
      this.currentMurekaTrack = null;
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
      this._renderReview();
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
