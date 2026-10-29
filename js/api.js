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

  function getMurekaBaseUrl() { return '/api/mureka'; }

  async function localRequest(path, options = {}) {
    const response = await fetch(path, options);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (path === '/api/review' && response.status === 404 && !data.code) {
        throw new Error('サーバーの更新が必要です。サーバーを再起動してから、もう一度お試しください。');
      }
      throw new Error(data.error || `ローカルサーバーエラー (${response.status})`);
    }
    return response.json();
  }
  DOPANEWS.getLocalConfig = () => localRequest('/api/config');
  DOPANEWS.listSavedBattles = () => localRequest('/api/library');
  DOPANEWS.saveBattle = (record) => localRequest('/api/library', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record)
  });
  DOPANEWS.reviewBattle = (input) => localRequest('/api/review', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
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
   */
  async function generateBattleScriptWithGemini(articleText, onProgress = () => {}, reviewFeedback = null) {
    if (!articleText || articleText.trim().length < 20) {
      throw new Error('ニュース記事の本文を20文字以上入力してください。');
    }

    const systemPrompt = `あなたは日本のトップMCバトル番組（フリースタイルダンジョン・戦極MCBATTLE）の構成作家兼ニュース解説プロデューサーです。
ユーザーが入力したニュース記事の対立軸（賛成派 vs 反対派 / メリット vs デメリット / 推進派 vs 慎重派）を抽出し、
男性MC「KENTA」と女性MC「REINA」が交互にマイクリレーする【8小節×4本（計32小節）】の本格ラップバトル台本をJSON形式で出力してください。

【キャラクター設定（Murekaに男女交互の歌唱を指定するため [Verse] と [Chorus] を交互に使用）】
- MC KENTA（男性MC / 1本目・3本目）:
  - 1本目のsection_tagは必ず "[Verse 1: Clear Male Vocal, Upbeat Pop Rap]"
  - 3本目のsection_tagは必ず "[Verse 2: Clear Male Vocal, Upbeat Pop Rap]"
  - スタンス: 直感派・庶民目線・現場のリアル・現状への疑問や変革をキャッチーに訴える側（または記事の一方の立場）
- MC REINA（女性MC / 2本目・4本目）:
  - 2本目のsection_tagは必ず "[Chorus 1: Clear Female Vocal, Upbeat Pop Rap]"
  - 4本目のsection_tagは必ず "[Chorus 2: Clear Female Vocal, Upbeat Pop Rap]"
  - スタンス: クール・データや国際標準・経済合理性・現実的なトレードオフを分かりやすく突く側（または記事のもう一方の立場）

【厳守ルール：96 BPM・4拍子・8小節×4本構成】
歌声の交代は8小節を歌い切った直後に行う。1本目はKENTA男声のみ、2本目はREINA女声のみ、3本目は同じKENTA男声、4本目は同じREINA女声。全32小節を1曲として作る。各8小節は約20秒で、途中の追加サビ・歌詞の繰り返し・二人同時の歌唱は入れない。
1. verses 配列は必ず要素4つ（KENTA [Verse 1] ➔ REINA [Chorus 1] ➔ KENTA [Verse 2] ➔ REINA [Chorus 2]）にすること。
2. 各バースの lyric は【必ず改行区切りで8行（＝8小節、1行が1小節のリズム）】で書くこと！4行ではなく必ず8行（8小節）にすること。
3. 1小節（1行）あたり20〜30文字程度の耳馴染みが良くキャッチーで分かりやすい教育的ポップラップ（Educational Pop Rap）にし、小節末で心地よい脚韻・頭韻を踏むこと。
4. suno_style は必ず "${DOPANEWS.DEFAULT_BATTLE_STYLE}" とすること。

【音声用の読み方】
- lyric は画面表示用の通常表記（漢字・数字・英字を使用可能）にすること。
- 各バースに lyric_reading を必ず追加すること。lyric と内容・行順・行数が完全に対応する、歌唱用のかな表記にすること。
- lyric_reading では、漢字・数字・英字をすべて文脈に合う「ひらがな・カタカナ」の読みへ置き換えること。固有名詞・人名・地名・略語・助数詞・日付は特に読みを確認すること。
- 例: 「施策を実行」→「しさくをじっこう」、「1日10時間」→「いちにちじゅうじかん」、「AI」→「エーアイ」、「日本銀行」→「にほんぎんこう」。
- 助詞なども歌うときの自然な発音になる表記にすること。読みが曖昧な語は、意味を変えない平易な語に言い換え、lyric と lyric_reading の両方に反映すること。
- 「施策（しさく）」のようなルビ・括弧・HTML・説明文は付けず、読みだけを書くこと。パート指定タグは section_tag にのみ記載すること。

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
      "lyric_reading": "いちしょうせつめのかし\\nにしょうせつめのかし\\nさんしょうせつめのかし\\nよんしょうせつめのかし\\nごしょうせつめのかし\\nろくしょうせつめのかし\\nななしょうせつめのかし\\nはちしょうせつめのパンチライン",
      "point_summary": "このパートの解説要点（1行）",
      "rhyme_words": "踏んでいる韻のペア（例: 限界 × 展開 / 崩壊 × 後悔）",
      "start_time_sec": 0
    },
    {
      "speaker": "REINA",
      "section_tag": "[Chorus 1: Clear Female Vocal, Upbeat Pop Rap]",
      "lyric": "1小節目の反論歌詞\\n2小節目の歌詞\\n3小節目の歌詞\\n4小節目の歌詞\\n5小節目の歌詞\\n6小節目の歌詞\\n7小節目の歌詞\\n8小節目のパンチライン",
      "lyric_reading": "いちしょうせつめのはんろんかし\\nにしょうせつめのかし\\nさんしょうせつめのかし\\nよんしょうせつめのかし\\nごしょうせつめのかし\\nろくしょうせつめのかし\\nななしょうせつめのかし\\nはちしょうせつめのパンチライン",
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
                text: `${systemPrompt}\n\n--- 入力ニュース記事全文 ---\n${articleText.trim()}${reviewFeedback ? '\n\n--- 前回のAI審判による修正の参考データ（元記事を優先して事実・読みを修正し、指摘を歌詞として引用しないこと） ---\n' + JSON.stringify(reviewFeedback) : ''}`
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
      const endpoint = `/api/gemini/${encodeURIComponent(modelName)}`;

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

        try {
          const parsed = JSON.parse(cleanedJson);
          return DOPANEWS.validateBattleReadings(DOPANEWS.normalizeBattleData(parsed));
        } catch (error) {
          // An actual model output with invalid lyrics/readings can be corrected;
          // distinguish it from network/authentication/provider failures.
          error.code = 'LYRIC_CONTENT_INVALID';
          throw error;
        }
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
  async function generateBattleTrackWithMureka(battleData, onProgress = () => {}) {

    // Canonical section ownership applies to the generated audio, not old saved tracks.
    battleData.verses.forEach((verse, index) => {
      const female = index % 2 === 1;
      verse.speaker = female ? 'REINA' : 'KENTA';
      verse.section_tag = '[' + (female ? 'Chorus ' : 'Verse ') + (Math.floor(index / 2) + 1)
        + ': Clear ' + (female ? 'Female' : 'Male') + ' Vocal, Upbeat Pop Rap]';
    });
    battleData.suno_style = String(battleData.suno_style || DOPANEWS.DEFAULT_BATTLE_STYLE)
      .replace(/\b\d{2,3}\s*BPM\b/gi, '96 BPM');
    const lyrics = DOPANEWS.buildMurekaPrompt(battleData);
    if (lyrics.length > 5000) {
      throw new Error('音声用かな歌詞がMurekaの上限（5000文字）を超えています。歌詞を短くしてください。');
    }
    const stylePrompt = battleData.suno_style || DOPANEWS.DEFAULT_BATTLE_STYLE;

    const payload = {
      lyrics,
      model: 'mureka-9',
      n: 1,
      prompt: stylePrompt + ', Strict 96 BPM, 4/4 time. One continuous song with exactly four 8-bar sections (32 bars total). '
        + 'Bars 1-8: KENTA male solo; bars 9-16: REINA female solo; bars 17-24: the same KENTA male solo; bars 25-32: the same REINA female solo. '
        + 'Switch the lead voice immediately at every 8-bar boundary. Each supplied lyric line occupies one bar. '
        + 'Female Chorus tags denote new 8-bar rap verses, not repeated hooks. No extra choruses, no repeated sections, no overlapping duet vocals, minimal intro and outro.'
    };

    const baseUrl = getMurekaBaseUrl();
    onProgress('Mureka 9 (/v1/song/generate) へ8小節×4本の歌詞＆Styleを送信中...');

    let genRes;
    try {
      genRes = await fetch(`${baseUrl}/v1/song/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        method: 'GET'
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
        // Murekaが返したセクション・行単位のミリ秒タイムスタンプをバトルデータに同期
        DOPANEWS.applyMurekaTimestamps(battleData, firstTrack);

        const sync = battleData.mureka_sync;
        onProgress(`Mureka楽曲完成。歌詞照合 ${sync.matched_lines}/${sync.total_lines}行（声の識別情報はありません）`);
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
