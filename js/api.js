/**
 * DOPANEWS API Service
 * ① ニュース記事URLからの本文自動抽出
 * ② Gemini API による「8小節（8行）×4本」ラップバトル台本生成（503混雑時マルチモデル自動切替搭載）
 * ③ Mureka 公式API (api.mureka.ai) による楽曲生成＆lyrics_sectionsミリ秒タイムスタンプ自動同期
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  const GEMINI_FALLBACK_MODELS = [
    'gemini-3.8-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-1.5-flash'
  ];

  function getMurekaBaseUrl() {
    if (window.location.protocol.startsWith('http') && window.location.port === '8080') {
      return '/api/mureka';
    }
    return 'https://api.mureka.ai';
  }

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

    if (window.location.protocol.startsWith('http') && window.location.port === '8080') {
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
   */
  async function generateBattleScriptWithGemini(articleText, geminiApiKey, onProgress = () => {}) {
    if (!geminiApiKey) {
      throw new Error('Gemini APIキーが入力されていません。');
    }
    if (!articleText || articleText.trim().length < 20) {
      throw new Error('ニュース記事の本文を20文字以上入力してください。');
    }

    const systemPrompt = `あなたは日本のトップMCバトル番組（フリースタイルダンジョン・戦極MCBATTLE）の構成作家兼ニュース解説プロデューサーです。
ユーザーが入力したニュース記事の対立軸（賛成派 vs 反対派 / メリット vs デメリット / 推進派 vs 慎重派）を抽出し、
男性MC「KENTA」と女性MC「REINA」が交互にマイクリレーする【8小節×4本（計32小節）】の本格ラップバトル台本をJSON形式で出力してください。

【キャラクター設定】
- MC KENTA（男性MC）:
  - section_tagは必ず "[Verse 1: Clear Male Vocal, Upbeat Pop Rap]" または "[Verse 3: Clear Male Vocal, Upbeat Pop Rap]" とすること
  - スタンス: 直感派・庶民目線・現場のリアル・現状への疑問や変革をキャッチーに訴える側（または記事の一方の立場）
- MC REINA（女性MC）:
  - section_tagは必ず "[Verse 2: Clear Female Vocal, Upbeat Pop Rap]" または "[Verse 4: Clear Female Vocal, Upbeat Pop Rap]" とすること
  - スタンス: クール・データや国際標準・経済合理性・現実的なトレードオフを分かりやすく突く側（または記事のもう一方の立場）

【厳守ルール：8小節×4本構成】
1. verses 配列は必ず要素4つ（Verse 1: KENTA ➔ Verse 2: REINA ➔ Verse 3: KENTA ➔ Verse 4: REINA）にすること。
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
      "section_tag": "[Verse 2: Clear Female Vocal, Upbeat Pop Rap]",
      "lyric": "1小節目の反論歌詞\\n2小節目の歌詞\\n3小節目の歌詞\\n4小節目の歌詞\\n5小節目の歌詞\\n6小節目の歌詞\\n7小節目の歌詞\\n8小節目のパンチライン",
      "point_summary": "このパートの解説要点（1行）",
      "rhyme_words": "踏んでいる韻のペア",
      "start_time_sec": 20
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
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(geminiApiKey.trim())}`;

      if (i > 0) {
        onProgress(
          `⚠️ サーバー混雑 (${lastStatus}) のため予備モデル「${modelName}」へ自動切替して作詞中...`
        );
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });

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
        throw new Error(`Gemini API 認証エラー (${lastStatus}): APIキーを確認してください。詳細: ${lastErrorText}`);
      }
    }

    throw new Error(`Gemini API エラー (${lastStatus}): ${lastErrorText}`);
  }

  /**
   * Mureka 公式API で楽曲を生成し、完成時に lyrics_sections タイムスタンプを battleData に反映する
   */
  async function generateBattleTrackWithMureka(battleData, murekaApiKey, onProgress = () => {}) {
    if (!murekaApiKey) {
      throw new Error('Mureka APIキーが入力されていません。');
    }

    const lyrics = DOPANEWS.buildSunoPrompt(battleData);
    const stylePrompt = battleData.suno_style || DOPANEWS.DEFAULT_BATTLE_STYLE;

    const payload = {
      lyrics,
      model: 'auto',
      n: 1,
      prompt: stylePrompt
    };

    const baseUrl = getMurekaBaseUrl();
    onProgress('Mureka 公式API (/v1/song/generate) へ8小節×4本の歌詞＆Styleを送信中...');

    let genRes;
    try {
      genRes = await fetch(`${baseUrl}/v1/song/generate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${murekaApiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (fetchErr) {
      throw new Error(
        `Mureka APIへの接続に失敗しました。フォルダ内の「start_server.bat」から開くと確実に通信できます。詳細: ${fetchErr.message}`
      );
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
      const pollRes = await fetch(pollUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${murekaApiKey.trim()}`
        }
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

      if (playableUrl && (status === 'succeeded' || status === 'streaming')) {
        // Murekaが返したセクション・行単位のミリ秒タイムスタンプをバトルデータに同期
        DOPANEWS.applyMurekaTimestamps(battleData, firstTrack);

        onProgress('Mureka楽曲生成＆歌詞タイムスタンプ同期完了！ステージ再生を開始します🔥');
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

  DOPANEWS.fetchArticleFromUrl = fetchArticleFromUrl;
  DOPANEWS.generateBattleScriptWithGemini = generateBattleScriptWithGemini;
  DOPANEWS.generateBattleTrackWithMureka = generateBattleTrackWithMureka;
  DOPANEWS.generateBattleTrackWithSuno = generateBattleTrackWithMureka;
})(window);
