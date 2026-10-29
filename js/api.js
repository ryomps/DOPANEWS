/**
 * DOPANEWS API Service
 * ① ニュース記事URLからの本文自動抽出
 * ② Gemini API による「8小節（8行）×4本（[Verse] ⇄ [Chorus] 交互構造）」ラップバトル台本生成
 *    - ローカルサーバー (/api/gemini) と ブラウザ直接通信 (generativelanguage.googleapis.com) のハイブリッド対応
 * ③ Mureka 公式API (api.mureka.ai) による楽曲生成＆タイムスタンプ自動同期
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  const STORAGE_KEYS = {
    GEMINI: 'dopanews_gemini_api_key',
    MUREKA: 'dopanews_mureka_api_key',
    LEGACY_SUNO: 'dopanews_suno_api_key'
  };

  const GEMINI_FALLBACK_MODELS = [
    'gemini-3.8-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-1.5-flash'
  ];

  function getStoredKeys() {
    const geminiInput = document.getElementById('input-gemini-key')?.value?.trim() || '';
    const murekaInput = document.getElementById('input-suno-key')?.value?.trim() || '';
    const geminiStored = localStorage.getItem(STORAGE_KEYS.GEMINI) || '';
    const murekaStored =
      localStorage.getItem(STORAGE_KEYS.MUREKA) ||
      localStorage.getItem(STORAGE_KEYS.LEGACY_SUNO) ||
      '';
    return {
      geminiKey: geminiInput || geminiStored,
      murekaKey: murekaInput || murekaStored
    };
  }

  async function localRequest(path, options = {}) {
    const response = await fetch(path, options);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `ローカルサーバーエラー (${response.status})`);
    }
    return response.json();
  }

  DOPANEWS.getLocalConfig = async () => {
    if (!window.location.protocol.startsWith('http')) {
      return { serverAvailable: false, geminiConfigured: false, murekaConfigured: false };
    }
    try {
      const data = await localRequest('/api/config');
      return {
        serverAvailable: true,
        geminiConfigured: Boolean(data.geminiConfigured),
        murekaConfigured: Boolean(data.murekaConfigured)
      };
    } catch {
      return { serverAvailable: false, geminiConfigured: false, murekaConfigured: false };
    }
  };

  DOPANEWS.saveLocalConfigKeys = async ({ geminiKey, murekaKey }) => {
    if (!window.location.protocol.startsWith('http')) return false;
    try {
      await localRequest('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          GeminiApiKey: geminiKey || '',
          MurekaApiKey: murekaKey || ''
        })
      });
      return true;
    } catch {
      return false;
    }
  };

  DOPANEWS.listSavedBattles = async () => {
    if (!window.location.protocol.startsWith('http')) {
      return { items: [] };
    }
    return localRequest('/api/library');
  };

  DOPANEWS.saveBattle = (record) =>
    localRequest('/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record)
    });

  function extractReadableArticleFromHtml(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    const junkSelectors = [
      'script',
      'style',
      'noscript',
      'iframe',
      'svg',
      'nav',
      'footer',
      'header',
      'aside',
      'form',
      '.ad',
      '.ads',
      '.ranking',
      '.recommend'
    ];
    junkSelectors.forEach((sel) => {
      doc.querySelectorAll(sel).forEach((el) => el.remove());
    });

    const title =
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
      doc.querySelector('h1')?.textContent?.trim() ||
      doc.title?.trim() ||
      '';

    const ogDesc =
      doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
      '';

    const container =
      doc.querySelector('article') ||
      doc.querySelector('main') ||
      doc.querySelector('[role="main"]') ||
      doc.body;

    const paragraphs = [];
    if (container) {
      container.querySelectorAll('p, h2, h3, li').forEach((el) => {
        const txt = el.textContent.replace(/\s+/g, ' ').trim();
        if (txt.length >= 22 && !paragraphs.includes(txt)) {
          paragraphs.push(txt);
        }
      });
    }

    let bodyText = paragraphs.join('\n');
    if (bodyText.length < 80 && container) {
      bodyText = container.textContent.replace(/\s+/g, ' ').trim();
    }

    const combined = [
      title ? `【タイトル】${title}` : '',
      ogDesc ? `【概要】${ogDesc}` : '',
      bodyText ? `【本文】\n${bodyText.slice(0, 6000)}` : ''
    ]
      .filter(Boolean)
      .join('\n\n');

    return combined.trim();
  }

  async function fetchArticleFromUrl(targetUrl) {
    const cleanUrl = (targetUrl || '').trim();
    if (!/^https?:\/\/.+/i.test(cleanUrl)) {
      throw new Error('有効なURL（http:// または https:// から始まるアドレス）を入力してください。');
    }

    if (window.location.protocol.startsWith('http')) {
      try {
        const localRes = await fetch(`/api/fetch-url?url=${encodeURIComponent(cleanUrl)}`);
        if (localRes.ok) {
          const localJson = await localRes.json();
          if (localJson.ok && localJson.html) {
            const extracted = extractReadableArticleFromHtml(localJson.html);
            if (extracted.length >= 60) {
              return extracted;
            }
          }
        }
      } catch {
        // 次のフォールバックへ進む
      }
    }

    try {
      const jinaRes = await fetch(`https://r.jina.ai/${cleanUrl}`, {
        headers: {
          Accept: 'text/plain'
        }
      });
      if (jinaRes.ok) {
        const text = (await jinaRes.text()).trim();
        if (text.length >= 60) {
          return text.slice(0, 6500);
        }
      }
    } catch {
      // 次のフォールバックへ進む
    }

    try {
      const proxyRes = await fetch(
        `https://api.allorigins.win/get?url=${encodeURIComponent(cleanUrl)}`
      );
      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        if (proxyData?.contents) {
          const extracted = extractReadableArticleFromHtml(proxyData.contents);
          if (extracted.length >= 50) {
            return extracted;
          }
        }
      }
    } catch {
      // ignore
    }

    throw new Error(
      'このURLから記事本文を自動抽出できませんでした（有料会員限定記事やアクセス制限の可能性があります）。記事のテキストを直接コピー＆ペーストしてください。'
    );
  }

  /**
   * Gemini APIを呼び出し、ニュース記事全文から「8小節（8行）×4本」の男女MCラップバトルJSONを生成する
   * Murekaで声色が確実に切り替わるよう KENTA=[Verse 1/2], REINA=[Chorus 1/2] の交互タグで生成
   */
  async function generateBattleScriptWithGemini(articleText, keyOrProgress, maybeProgress) {
    let explicitKey = '';
    let onProgress = () => {};
    if (typeof keyOrProgress === 'function') {
      onProgress = keyOrProgress;
    } else {
      explicitKey = (keyOrProgress || '').trim();
      if (typeof maybeProgress === 'function') onProgress = maybeProgress;
    }

    const { geminiKey: storedGeminiKey } = getStoredKeys();
    const apiKey = explicitKey || storedGeminiKey;

    if (!articleText || articleText.trim().length < 20) {
      throw new Error('ニュース記事の本文を20文字以上入力してください。');
    }

    const systemPrompt = `あなたは日本のトップMCバトル番組（フリースタイルダンジョン・戦極MCBATTLE）の構成作家兼ニュース解説プロデューサーです。
ユーザーが入力したニュース記事の対立軸（賛成派 vs 反対派 / メリット vs デメリット / 推進派 vs 慎重派）を抽出し、
男性MC「KENTA」と女性MC「REINA」が交互にマイクリレーする【8小節×4本（計32小節）】の本格ラップバトル台本をJSON形式で出力してください。

【キャラクター設定（Murekaで男女の声を確実に切り替えるため [Verse] と [Chorus] を交互に使用）】
- MC KENTA（男性MC / 1本目・3本目）:
  - 1本目のsection_tagは必ず "[Verse 1: Clear Male Vocal, Upbeat Pop Rap]"
  - 3本目のsection_tagは必ず "[Verse 2: Clear Male Vocal, Upbeat Pop Rap]"
  - スタンス: 直感派・庶民目線・現場のリアル・現状への疑問や変革をキャッチーに訴える側（または記事の一方の立場）
- MC REINA（女性MC / 2本目・4本目）:
  - 2本目のsection_tagは必ず "[Chorus 1: Clear Female Vocal, Upbeat Pop Rap]"
  - 4本目のsection_tagは必ず "[Chorus 2: Clear Female Vocal, Upbeat Pop Rap]"
  - スタンス: クール・データや国際標準・経済合理性・現実的なトレードオフを分かりやすく突く側（または記事のもう一方の立場）

【厳守ルール：8小節×4本構成】
1. verses 配列は必ず要素4つ（KENTA [Verse 1] ➔ REINA [Chorus 1] ➔ KENTA [Verse 2] ➔ REINA [Chorus 2]）にすること。
2. 各バースの lyric は【必ず改行区切りで8行（＝8小節、1行が1小節のリズム）】で書くこと！4行ではなく必ず8行（8小節）にすること。
3. 1小節（1行）あたり20〜30文字程度の耳馴染みが良くキャッチーで分かりやすい教育的ポップラップ（Educational Pop Rap）にし、小節末で心地よい脚韻・頭韻を踏むこと。
4. suno_style は必ず "${DOPANEWS.DEFAULT_BATTLE_STYLE}" とすること。

必ず以下のJSONフォーマットのみを出力してください（Markdownコードブロック不要）：
{
  "title": "ニュースのバトルタイトル",
  "topic_summary": "ニュースの1行要約",
  "kenta_stance": "MC KENTAの主張要約（投票画面用）",
  "reina_stance": "MC REINAの主張要約（投票画面用）",
  "suno_style": "${DOPANEWS.DEFAULT_BATTLE_STYLE}",
  "verses": [
    {
      "speaker": "KENTA",
      "section_tag": "[Verse 1: Clear Male Vocal, Upbeat Pop Rap]",
      "lyric": "1小節目の歌詞\\n2小節目の歌詞\\n3小節目の歌詞\\n4小節目の歌詞\\n5小節目の歌詞\\n6小節目の歌詞\\n7小節目の歌詞\\n8小節目のパンチライン",
      "point_summary": "このパートの解説要点（1行）",
      "rhyme_words": "踏んでいる韻のペア（例: 限界 × 展開 / 崩壊 × 後悔）",
      "start_time_sec": 0
    },
    {
      "speaker": "REINA",
      "section_tag": "[Chorus 1: Clear Female Vocal, Upbeat Pop Rap]",
      "lyric": "1小節目の反論歌詞\\n2小節目の歌詞\\n3小節目の歌詞\\n4小節目の歌詞\\n5小節目の歌詞\\n6小節目の歌詞\\n7小節目の歌詞\\n8小節目のパンチライン",
      "point_summary": "このパートの解説要点（1行）",
      "rhyme_words": "踏んでいる韻のペア",
      "start_time_sec": 17
    }
  ]
}`;

    const requestBody = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${systemPrompt}\n\n--- 入力ニュース記事全文 ---\n${articleText.trim()}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.8,
        responseMimeType: 'application/json'
      }
    });

    let lastErrorText = '';
    let lastStatus = 0;

    for (let i = 0; i < GEMINI_FALLBACK_MODELS.length; i++) {
      const modelName = GEMINI_FALLBACK_MODELS[i];

      if (i > 0) {
        if (lastStatus === 503 || lastStatus === 429) {
          onProgress(
            `⚠️ サーバー混雑 (${lastStatus}) のため予備モデル「${modelName}」へ自動切替して作詞中...`
          );
          await new Promise((resolve) => setTimeout(resolve, 1200));
        } else {
          onProgress(`🔄 モデル「${modelName}」で8小節×4本のラップ台本を作詞中...`);
        }
      }

      let response = null;

      // ① まずローカルサーバー経由 (/api/gemini/:model) を試行（http:// 起動時）
      if (window.location.protocol.startsWith('http')) {
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (apiKey) headers['x-goog-api-key'] = apiKey;
          const localRes = await fetch(`/api/gemini/${encodeURIComponent(modelName)}`, {
            method: 'POST',
            headers,
            body: requestBody
          });
          // ローカルサーバーが正常応答、またはモデル混雑(503/429)を返した場合はその結果を採用
          if (localRes.ok || (localRes.status !== 404 && localRes.status !== 400 && localRes.status !== 502)) {
            response = localRes;
          }
        } catch {
          // ローカルサーバー未起動時は②のブラウザ直接通信へフォールバック
        }
      }

      // ② ブラウザから直接 Google Gemini API エンドポイントを呼び出すフォールバック
      if (!response) {
        if (!apiKey) {
          throw new Error(
            '左パネル上部の「Gemini API Key」欄にAPIキーを入力し、「💾 キー保存」を押してください。'
          );
        }
        const directEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
        response = await fetch(directEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody
        });
      }

      if (response.ok) {
        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          throw new Error('Gemini APIから有効なレスポンスが返されませんでした。');
        }

        const cleanedJson = rawText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```\s*$/, '')
          .trim();

        const parsed = JSON.parse(cleanedJson);
        return DOPANEWS.normalizeBattleData(parsed);
      }

      lastStatus = response.status;
      lastErrorText = await response.text();

      if (
        (lastStatus === 401 || lastStatus === 403) &&
        !lastErrorText.includes('not found') &&
        !lastErrorText.includes('no longer available')
      ) {
        throw new Error(
          `Gemini API 認証エラー (${lastStatus}): APIキーを確認してください。詳細: ${lastErrorText}`
        );
      }
    }

    throw new Error(`Gemini API エラー (${lastStatus}): ${lastErrorText}`);
  }

  /**
   * Mureka 公式API で楽曲を生成し、完成時に lyrics_sections タイムスタンプを battleData に反映する
   */
  async function generateBattleTrackWithMureka(battleData, keyOrProgress, maybeProgress) {
    let explicitKey = '';
    let onProgress = () => {};
    if (typeof keyOrProgress === 'function') {
      onProgress = keyOrProgress;
    } else {
      explicitKey = (keyOrProgress || '').trim();
      if (typeof maybeProgress === 'function') onProgress = maybeProgress;
    }

    const { murekaKey: storedMurekaKey } = getStoredKeys();
    const apiKey = explicitKey || storedMurekaKey;

    const lyrics = DOPANEWS.buildSunoPrompt(battleData);
    const stylePrompt = battleData.suno_style || DOPANEWS.DEFAULT_BATTLE_STYLE;

    const payload = {
      lyrics,
      model: 'auto',
      n: 1,
      prompt: stylePrompt
    };

    const reqHeaders = { 'Content-Type': 'application/json' };
    if (apiKey) {
      reqHeaders.Authorization = `Bearer ${apiKey}`;
    }

    onProgress('Mureka 公式API (/v1/song/generate) へ [Verse]⇄[Chorus] 8小節×4本を送信中...');

    let baseUrl = window.location.protocol.startsWith('http')
      ? '/api/mureka'
      : 'https://api.mureka.ai';
    let genRes = null;

    if (baseUrl === '/api/mureka') {
      try {
        genRes = await fetch('/api/mureka/v1/song/generate', {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(payload)
        });
        if (genRes.status === 404) {
          baseUrl = 'https://api.mureka.ai';
          genRes = null;
        }
      } catch {
        baseUrl = 'https://api.mureka.ai';
        genRes = null;
      }
    }

    if (!genRes) {
      if (!apiKey) {
        throw new Error(
          '左パネル上部の「Mureka API Key」欄にAPIキーを入力し、「💾 キー保存」を押してください。'
        );
      }
      try {
        genRes = await fetch(`${baseUrl}/v1/song/generate`, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(payload)
        });
      } catch (fetchErr) {
        throw new Error(
          `Mureka APIへの直接接続がブラウザのCORS制限でブロックされました。フォルダ内の「start_server.bat」をダブルクリックして開くと確実に通信できます。詳細: ${fetchErr.message}`
        );
      }
    }

    if (!genRes.ok) {
      const errText = await genRes.text();
      throw new Error(`Mureka Generate エラー (${genRes.status}): ${errText}`);
    }

    const genJson = await genRes.json();
    const taskId = genJson?.id || genJson?.data?.id || genJson?.task_id;
    if (!taskId) {
      throw new Error(`Mureka APIからtask_idを取得できませんでした: ${JSON.stringify(genJson)}`);
    }

    onProgress(`Murekaレコーディング開始 (Task ID: ${taskId}) 4秒間隔で進行確認中...`);

    const maxAttempts = 75;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 4000));

      const pollUrl = `${baseUrl}/v1/song/query/${encodeURIComponent(taskId)}`;
      const pollHeaders = {};
      if (apiKey) pollHeaders.Authorization = `Bearer ${apiKey}`;

      const pollRes = await fetch(pollUrl, {
        method: 'GET',
        headers: pollHeaders
      });

      if (!pollRes.ok) {
        onProgress(`Murekaポーリング再試行中 (${attempt}/${maxAttempts})...`);
        continue;
      }

      const pollJson = await pollRes.json();
      const status = (pollJson?.status || pollJson?.data?.status || 'preparing').toLowerCase();
      const choices = pollJson?.choices || pollJson?.data?.choices || [];
      const firstTrack = Array.isArray(choices) && choices.length > 0 ? choices[0] : null;

      const playableUrl =
        firstTrack?.url ||
        firstTrack?.audio_url ||
        firstTrack?.stream_url ||
        firstTrack?.flac_url;

      if (playableUrl && status === 'succeeded') {
        DOPANEWS.applyMurekaTimestamps(battleData, firstTrack);

        const sync = battleData.mureka_sync || { matched_lines: 0, total_lines: 32 };
        onProgress(
          `Mureka楽曲完成！115BPM小節計算＋歌詞照合 (${sync.matched_lines}/${sync.total_lines}行) で同期再生を開始します🔥`
        );
        return {
          audioUrl: playableUrl,
          taskId,
          prompt: lyrics,
          murekaTrack: firstTrack
        };
      }

      if (status === 'failed' || status === 'timeouted' || status === 'cancelled') {
        const reason = pollJson?.failed_reason || status;
        throw new Error(`Mureka楽曲生成失敗: ${reason}`);
      }

      onProgress(`Murekaボーカル＆ビート生成中... [${status.toUpperCase()}] (${attempt * 4}秒経過)`);
    }

    throw new Error('Mureka APIの生成がタイムアウトしました。');
  }

  DOPANEWS.STORAGE_KEYS = STORAGE_KEYS;
  DOPANEWS.getStoredKeys = getStoredKeys;
  DOPANEWS.fetchArticleFromUrl = fetchArticleFromUrl;
  DOPANEWS.generateBattleScriptWithGemini = generateBattleScriptWithGemini;
  DOPANEWS.generateBattleTrackWithMureka = generateBattleTrackWithMureka;
  DOPANEWS.generateBattleTrackWithSuno = generateBattleTrackWithMureka;
})(window);
