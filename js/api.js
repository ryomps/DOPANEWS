/**
 * DOPANEWS API Service
 * ① ニュース記事URLからの本文自動抽出
 * ② Gemini API による「8小節（8行）×4本」ラップバトル台本生成（503混雑時マルチモデル自動切替搭載）
 * ③ Mureka 公式API (api.mureka.ai) による固定インストビート（115 BPM）生成＆保存
 * ④ 固定Murekaビート上に KENTA（男声）・REINA（女声）の8小節×4本ボーカルを乗せるマルチボイス合成エンジン
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  const GEMINI_FALLBACK_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-1.5-flash'
  ];

  const GEMINI_TTS_MODELS = [
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts'
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
  DOPANEWS.getFixedBeat = () => localRequest('/api/fixed-beat');

  /**
   * Mureka API で 115 BPM の固定インストビート（伴奏）を生成し、PC（.local/fixed-beat/beat.mp3）に永久保存・ロックする
   */
  async function generateFixedBeatWithMureka(stylePrompt = DOPANEWS.DEFAULT_FIXED_BEAT_STYLE, onProgress = () => {}) {
    onProgress('🎹 Mureka API へ 115 BPM 固定インストビート（伴奏）の生成をリクエスト中...');
    const startData = await localRequest('/api/fixed-beat/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: stylePrompt || DOPANEWS.DEFAULT_FIXED_BEAT_STYLE,
        bpm: 115
      })
    });

    const taskId = startData.taskId;
    const endpointType = startData.endpointType || 'instrumental';
    if (!taskId) {
      throw new Error('Mureka固定ビートのタスクIDを取得できませんでした。');
    }

    onProgress(`🎹 Murekaで115 BPM固定ビートを作曲中 (Task ID: ${taskId})...`);
    const maxAttempts = 75;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const pollData = await localRequest(
        `/api/fixed-beat/poll/${encodeURIComponent(endpointType)}/${encodeURIComponent(taskId)}`
      );
      const status = String(pollData.status || 'preparing').toLowerCase();

      if (status === 'succeeded' && pollData.beat?.audioUrl) {
        onProgress('✅ Mureka 115 BPM 固定ビートが完成し、このPCにロック保存されました！');
        return pollData.beat;
      }
      if (status === 'failed' || status === 'timeouted' || status === 'cancelled') {
        throw new Error(pollData.error || `Mureka固定ビート生成失敗 (${status})`);
      }
      onProgress(`🎹 Murekaで115 BPM固定ビートを生成中... [${status.toUpperCase()}] (${attempt * 4}秒経過)`);
    }

    throw new Error('Mureka固定ビート生成がタイムアウトしました。');
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

【キャラクター設定（男女交互の8小節マイクリレー）】
- MC KENTA（男性MC / 1本目・3本目）:
  - 1本目のsection_tagは必ず "[Verse 1: Clear Male Vocal, Upbeat Pop Rap]"
  - 3本目のsection_tagは必ず "[Verse 2: Clear Male Vocal, Upbeat Pop Rap]"
  - スタンス: 直感派・庶民目線・現場のリアル・現状への疑問や変革をキャッチーに訴える側（または記事の一方の立場）
- MC REINA（女性MC / 2本目・4本目）:
  - 2本目のsection_tagは必ず "[Chorus 1: Clear Female Vocal, Upbeat Pop Rap]"
  - 4本目のsection_tagは必ず "[Chorus 2: Clear Female Vocal, Upbeat Pop Rap]"
  - スタンス: クール・データや国際標準・経済合理性・現実的なトレードオフを分かりやすく突く側（または記事のもう一方の立場）

【厳守ルール：115 BPM・4拍子・8小節×4本構成】
歌声の交代は8小節を歌い切った直後に行う。1本目はKENTA男声のみ、2本目はREINA女声のみ、3本目はKENTA男声のみ、4本目はREINA女声のみ。全32小節を1曲として作る。115 BPMでは1小節＝約2.09秒、8小節＝約16.7秒。
1. verses 配列は必ず要素4つ（KENTA [Verse 1] ➔ REINA [Chorus 1] ➔ KENTA [Verse 2] ➔ REINA [Chorus 2]）にすること。
2. 各バースの lyric は【必ず改行区切りで8行（＝8小節、1行が1小節のリズム）】で書くこと！4行ではなく必ず8行（8小節）にすること。
3. 1小節（1行）あたり18〜26文字程度の耳馴染みが良くキャッチーで分かりやすい教育的ポップラップ（Educational Pop Rap）にし、小節末で心地よい脚韻・頭韻を踏むこと。
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
   * Base64文字列をInt16Array（24kHz mono PCM）に変換し、Float32Arrayに正規化する
   */
  function decodeBase64Pcm16ToFloat32(base64Str) {
    const binary = atob(base64Str);
    const byteLen = binary.length - (binary.length % 2);
    const bytes = new Uint8Array(byteLen);
    for (let i = 0; i < byteLen; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const view = new DataView(bytes.buffer);
    const numSamples = byteLen / 2;
    const out = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      out[i] = view.getInt16(i * 2, true) / 32768;
    }
    return out;
  }

  /**
   * サンプルレート変換（線形補間）
   */
  function resampleFloat32(input, fromRate, toRate) {
    if (!input || !input.length) return new Float32Array(0);
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const outLen = Math.max(1, Math.round(input.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const idx1 = Math.min(input.length - 1, idx0 + 1);
      const frac = srcIdx - idx0;
      out[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
    }
    return out;
  }

  /**
   * 先頭・末尾の無音をトリムする
   */
  function trimSilenceFloat32(samples, threshold = 0.008) {
    if (!samples || !samples.length) return samples;
    let start = 0;
    let end = samples.length - 1;
    while (start < end && Math.abs(samples[start]) < threshold) start++;
    while (end > start && Math.abs(samples[end]) < threshold) end--;
    const pad = Math.min(400, Math.floor(samples.length * 0.02));
    start = Math.max(0, start - pad);
    end = Math.min(samples.length, end + pad);
    return samples.subarray(start, end);
  }

  /**
   * 8行（8小節）のバース音声を、各行の文字数比率と無音谷（ポーズ）を手がかりに8個の小節クリップへ分割する
   */
  function splitVerseIntoEightBars(verseSamples, readingLines, sampleRate) {
    const count = 8;
    const weights = [];
    for (let i = 0; i < count; i++) {
      const line = (readingLines[i] || '').replace(/\s+/g, '');
      weights.push(Math.max(4, line.length));
    }
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);

    const boundaries = [0];
    let cumWeight = 0;
    const winRadius = Math.floor(sampleRate * 0.35);
    const envStep = Math.max(1, Math.floor(sampleRate * 0.01));

    for (let i = 0; i < count - 1; i++) {
      cumWeight += weights[i];
      const expectedIdx = Math.floor((cumWeight / totalWeight) * verseSamples.length);
      const searchStart = Math.max(boundaries[i] + Math.floor(sampleRate * 0.4), expectedIdx - winRadius);
      const searchEnd = Math.min(verseSamples.length - Math.floor(sampleRate * 0.4), expectedIdx + winRadius);

      let bestIdx = expectedIdx;
      if (searchEnd > searchStart) {
        let minEnergy = Infinity;
        for (let pos = searchStart; pos <= searchEnd; pos += envStep) {
          let energy = 0;
          const frameLen = Math.min(envStep * 3, verseSamples.length - pos);
          for (let k = 0; k < frameLen; k++) {
            const s = verseSamples[pos + k];
            energy += s * s;
          }
          const distPenalty = Math.abs(pos - expectedIdx) / (winRadius || 1) * 0.002;
          const score = energy / Math.max(1, frameLen) + distPenalty;
          if (score < minEnergy) {
            minEnergy = score;
            bestIdx = pos;
          }
        }
      }
      boundaries.push(bestIdx);
    }
    boundaries.push(verseSamples.length);

    const clips = [];
    for (let i = 0; i < count; i++) {
      const slice = verseSamples.subarray(boundaries[i], boundaries[i + 1]);
      clips.push(trimSilenceFloat32(slice, 0.006));
    }
    return clips;
  }

  /**
   * Gemini 2.5 TTS で 1バース（8行）のラップボーカル（24kHz PCM）を生成する
   * - KENTA: 男声 ('Puck')
   * - REINA: 女声 ('Kore')
   */
  async function synthesizeVerseVocalWithGeminiTts(verse, verseIndex) {
    const isReina = verse.speaker === 'REINA';
    const voiceName = isReina ? 'Kore' : 'Puck';
    const readingText = (verse.lyric_reading || verse.lyric || '').trim();
    const lines = readingText.split('\n').map((l) => l.trim()).filter(Boolean);

    const ttsPrompt = isReina
      ? `クールで歯切れの良い女性ラッパーの声で、115 BPMのリズムに乗って次の8行をテンポよくハッキリ発音して読んでください。各行の間はほんの一瞬だけ息継ぎを入れてください。\n\n${lines.join('\n')}`
      : `エネルギッシュでクリアな男性ラッパーの声で、115 BPMのリズムに乗って次の8行をテンポよくハッキリ発音して読んでください。各行の間はほんの一瞬だけ息継ぎを入れてください。\n\n${lines.join('\n')}`;

    const requestBody = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: ttsPrompt }]
        }
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName
            }
          }
        }
      }
    });

    let lastErr = '';
    for (const modelName of GEMINI_TTS_MODELS) {
      const res = await fetch(`/api/gemini/${encodeURIComponent(modelName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });

      if (res.ok) {
        const data = await res.json();
        const inlineData = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
        if (inlineData?.data) {
          return {
            samples: decodeBase64Pcm16ToFloat32(inlineData.data),
            sampleRate: 24000
          };
        }
      } else {
        lastErr = await res.text().catch(() => `HTTP ${res.status}`);
      }
    }

    throw new Error(`バース${verseIndex + 1} (${verse.speaker}) のボーカル音声合成に失敗しました: ${lastErr.slice(0, 180)}`);
  }

  /**
   * 固定Murekaビートファイルをデコードして 22,050Hz Mono Float32Array として返す。
   * 固定ビートが未生成の場合やデコード失敗時は 115 BPM ファンキー・ポップラップ・インストビートを自動合成する。
   */
  async function loadOrBuildFixedBeatSamples(fixedBeatUrl, totalSamples, targetSampleRate, bpm = 115) {
    if (fixedBeatUrl) {
      try {
        const res = await fetch(fixedBeatUrl);
        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer();
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          const ctx = new AudioCtx();
          try {
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
            const ch0 = audioBuffer.getChannelData(0);
            const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
            const mono = new Float32Array(ch0.length);
            for (let i = 0; i < ch0.length; i++) {
              mono[i] = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];
            }
            const resampled = resampleFloat32(mono, audioBuffer.sampleRate, targetSampleRate);
            if (resampled.length > targetSampleRate * 2) {
              const looped = new Float32Array(totalSamples);
              for (let i = 0; i < totalSamples; i++) {
                looped[i] = resampled[i % resampled.length];
              }
              return { samples: looped, usedMurekaBeat: true };
            }
          } finally {
            ctx.close().catch(() => {});
          }
        }
      } catch (err) {
        console.warn('Fixed beat decode fallback:', err);
      }
    }

    // フォールバック用 115 BPM Groovy Funky Pop Rap Beat 合成
    const out = new Float32Array(totalSamples);
    const beatSec = 60 / bpm;
    const stepSec = beatSec / 4; // 16分音符
    const bassFreqs = [110, 110, 130.81, 146.83, 98, 98, 130.81, 123.47];
    const chordRoots = [220, 261.63, 196, 246.94];

    for (let i = 0; i < totalSamples; i++) {
      const t = i / targetSampleRate;
      const stepIdx = Math.floor(t / stepSec);
      const stepPos = (t % stepSec) / stepSec;
      const barIdx = Math.floor(stepIdx / 16);
      const stepInBar = stepIdx % 16;

      let sample = 0;

      // Kick on 0, 6, 8, 11
      if (stepInBar === 0 || stepInBar === 6 || stepInBar === 8 || stepInBar === 11) {
        const kt = stepPos * stepSec;
        if (kt < 0.14) {
          const freq = 135 * Math.exp(-kt * 28) + 46;
          sample += Math.sin(2 * Math.PI * freq * kt) * Math.exp(-kt * 16) * 0.65;
        }
      }

      // Snare / Clap on 4, 12
      if (stepInBar === 4 || stepInBar === 12) {
        const st = stepPos * stepSec;
        if (st < 0.12) {
          const noise = (Math.sin(i * 12.9898) * 43758.5453) % 1;
          sample += noise * Math.exp(-st * 26) * 0.42;
        }
      }

      // Hi-hat every 2 steps
      if (stepInBar % 2 === 0) {
        const ht = stepPos * stepSec;
        if (ht < 0.045) {
          const noise = (Math.sin(i * 78.233) * 43758.5453) % 1;
          sample += noise * Math.exp(-ht * 65) * 0.16;
        }
      }

      // Funky Bassline
      const bassFreq = bassFreqs[stepInBar % bassFreqs.length];
      const bt = stepPos * stepSec;
      sample += Math.sin(2 * Math.PI * bassFreq * t) * Math.exp(-bt * 9) * 0.28;

      // Catchy Electric Piano Chord Stabs on 0, 3, 6, 10, 14
      if (stepInBar === 0 || stepInBar === 3 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14) {
        const root = chordRoots[barIdx % chordRoots.length];
        const ct = stepPos * stepSec;
        const env = Math.exp(-ct * 12) * 0.12;
        sample += (
          Math.sin(2 * Math.PI * root * t) +
          Math.sin(2 * Math.PI * (root * 1.2) * t) +
          Math.sin(2 * Math.PI * (root * 1.5) * t)
        ) * env;
      }

      out[i] = Math.max(-0.95, Math.min(0.95, sample));
    }
    return { samples: out, usedMurekaBeat: false };
  }

  /**
   * 22,050Hz 16-bit Mono PCM WAV を生成し、Base64文字列とBlob URLを返す
   */
  function encodeMonoWavBase64(samples, sampleRate) {
    const numSamples = samples.length;
    const dataSize = numSamples * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      const intVal = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
      view.setInt16(offset, intVal, true);
      offset += 2;
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    const audioWavBase64 = btoa(binary);
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const blobUrl = URL.createObjectURL(blob);
    return { audioWavBase64, blobUrl };
  }

  /**
   * 【固定Murekaビート × 男女8小節×4本 ボーカル合成マスタリング】
   * 1. 115 BPM 固定ビート（Mureka伴奏）を読み込む
   * 2. V1 KENTA（男声）・V2 REINA（女声）・V3 KENTA（男声）・V4 REINA（女声）の8小節ラップ音声を生成
   * 3. 2小節イントロ + 8小節×4本（計32小節）+ 1小節アウトロ（合計約73秒）に小節単位でピタッと配置・ミキシング
   * 4. 各行のミリ秒タイムスタンプ（timed_lines）と part_segments を battleData に設定して完全同期させる
   */
  async function synthesizeBattleOnFixedBeat(battleData, fixedBeatUrl, onProgress = () => {}) {
    const sampleRate = 22050;
    const bpm = 115;
    const barSec = (60 / bpm) * 4; // 1小節 = 2.0869565秒
    const eightBarSec = barSec * 8; // 8小節 = 16.695652秒
    const introBars = 2;
    const outroBars = 1;
    const introSec = barSec * introBars; // 約4.17秒
    const totalDurationSec = introSec + eightBarSec * 4 + barSec * outroBars; // 約73.04秒
    const totalSamples = Math.floor(totalDurationSec * sampleRate);

    // 1. 固定ビートの読み込み
    onProgress('🎹 STEP 2/3: 115 BPM 固定Murekaビート（伴奏）をステージにロード中...');
    const { samples: beatSamples, usedMurekaBeat } = await loadOrBuildFixedBeatSamples(
      fixedBeatUrl,
      totalSamples,
      sampleRate,
      bpm
    );

    // 2. KENTA（男声）＆ REINA（女声）の4バースを並列または順番に合成
    const verses = battleData.verses.slice(0, 4);
    verses.forEach((verse, idx) => {
      const isReina = idx % 2 === 1;
      verse.speaker = isReina ? 'REINA' : 'KENTA';
      verse.section_tag = `[${isReina ? 'Chorus' : 'Verse'} ${Math.floor(idx / 2) + 1}: Clear ${isReina ? 'Female' : 'Male'} Vocal, Upbeat Pop Rap]`;
    });

    const vocalResults = [];
    for (let vIdx = 0; vIdx < verses.length; vIdx++) {
      const verse = verses[vIdx];
      const roleLabel = verse.speaker === 'REINA' ? 'REINA（女声・Kore）' : 'KENTA（男声・Puck）';
      onProgress(`🎤 STEP 2/3: V${vIdx + 1} ${roleLabel} の8小節ラップボーカルを収録中 (${vIdx + 1}/4)...`);
      const ttsAudio = await synthesizeVerseVocalWithGeminiTts(verse, vIdx);
      const resampledVocal = resampleFloat32(ttsAudio.samples, ttsAudio.sampleRate, sampleRate);
      vocalResults.push(trimSilenceFloat32(resampledVocal, 0.006));
    }

    // 3. ミキシング（固定ビート + 4バース×8小節ボーカル）＆ タイムスタンプ完全同期
    onProgress('🎚️ STEP 3/3: 固定MurekaビートにKENTA＆REINAの8小節×4本をマスタリング中...');
    const master = new Float32Array(totalSamples);
    const vocalTrack = new Float32Array(totalSamples);
    const vocalEnvelope = new Float32Array(totalSamples);

    const partSegments = [];
    const murekaTimeline = [];

    for (let vIdx = 0; vIdx < verses.length; vIdx++) {
      const verse = verses[vIdx];
      const verseStartSec = introSec + vIdx * eightBarSec;
      const verseEndSec = verseStartSec + eightBarSec;

      verse.start_time_sec = Number(verseStartSec.toFixed(3));
      verse.end_time_sec = Number(verseEndSec.toFixed(3));
      verse.synced_from_mureka = true;

      partSegments.push({
        verseIndex: vIdx,
        speaker: verse.speaker,
        start: verse.start_time_sec,
        end: verse.end_time_sec
      });

      const readingLines = (verse.lyric_reading || verse.lyric || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const displayLines = (verse.lyric || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      const barClips = splitVerseIntoEightBars(vocalResults[vIdx], readingLines, sampleRate);
      const timedLines = [];

      for (let bIdx = 0; bIdx < 8; bIdx++) {
        const barStartSec = verseStartSec + bIdx * barSec;
        const barEndSec = barStartSec + barSec;
        const barStartSample = Math.floor(barStartSec * sampleRate);
        const maxBarSamples = Math.floor(barSec * 0.96 * sampleRate);

        let clip = barClips[bIdx] || new Float32Array(0);
        if (clip.length > maxBarSamples && maxBarSamples > 0) {
          // 1小節（約2.09秒）に収まるよう軽微にテンポフィット
          clip = resampleFloat32(clip, clip.length, maxBarSamples);
        }

        // ピーク正規化で声を前に出す
        let peak = 0;
        for (let i = 0; i < clip.length; i++) {
          const abs = Math.abs(clip[i]);
          if (abs > peak) peak = abs;
        }
        const gain = peak > 0.02 ? Math.min(2.2, 0.88 / peak) : 1.0;

        const fadeLen = Math.min(220, Math.floor(clip.length * 0.05));
        for (let i = 0; i < clip.length; i++) {
          const dstIdx = barStartSample + i;
          if (dstIdx >= totalSamples) break;
          let env = 1.0;
          if (i < fadeLen) env = i / fadeLen;
          else if (i > clip.length - fadeLen) env = (clip.length - i) / fadeLen;
          const vSample = clip[i] * gain * env;
          vocalTrack[dstIdx] += vSample;
          vocalEnvelope[dstIdx] = 1.0;
        }

        const lineRecord = {
          text: displayLines[bIdx] || '',
          reading: readingLines[bIdx] || '',
          start_sec: Number(barStartSec.toFixed(3)),
          end_sec: Number(barEndSec.toFixed(3)),
          line_indices: [bIdx],
          verse_index: vIdx
        };
        timedLines.push(lineRecord);
        murekaTimeline.push(lineRecord);
      }

      verse.timed_lines = timedLines;
    }

    // イントロ・アウトロではビートを大きく、ラップ中はサイドチェイン風にビートを少し下げて声をクリアに聴かせる
    let duckSmooth = 0;
    for (let i = 0; i < totalSamples; i++) {
      const targetDuck = vocalEnvelope[i] > 0 ? 1 : 0;
      duckSmooth = duckSmooth * 0.992 + targetDuck * 0.008;
      const beatGain = 0.72 - duckSmooth * 0.36; // イントロ 0.72 -> ラップ中 0.36
      const mixed = beatSamples[i] * beatGain + vocalTrack[i] * 0.92;
      // ソフトクリッピング
      master[i] = Math.tanh(mixed * 1.15);
    }

    const { audioWavBase64, blobUrl } = encodeMonoWavBase64(master, sampleRate);

    battleData.suno_style = DOPANEWS.DEFAULT_BATTLE_STYLE;
    battleData.part_segments = partSegments;
    battleData.mureka_timeline = murekaTimeline;
    battleData.mureka_sync = {
      matched_lines: 32,
      total_lines: 32,
      mode: usedMurekaBeat ? 'fixed_mureka_beat_plus_gemini_tts' : 'synth_beat_plus_gemini_tts',
      bpm,
      duration_sec: Number(totalDurationSec.toFixed(2))
    };

    const murekaTrackMeta = {
      id: `fixed-beat-battle-${Date.now()}`,
      duration: Math.round(totalDurationSec * 1000),
      bpm,
      used_fixed_mureka_beat: usedMurekaBeat,
      part_segments: partSegments
    };

    return {
      audioUrl: blobUrl,
      audioWavBase64,
      durationSec: totalDurationSec,
      usedMurekaBeat,
      murekaTrack: murekaTrackMeta
    };
  }

  /**
   * 旧互換用: Mureka 公式API で1曲丸ごと生成
   */
  async function generateBattleTrackWithMureka(battleData, onProgress = () => {}) {
    battleData.verses.forEach((verse, index) => {
      const female = index % 2 === 1;
      verse.speaker = female ? 'REINA' : 'KENTA';
      verse.section_tag = '[' + (female ? 'Chorus ' : 'Verse ') + (Math.floor(index / 2) + 1)
        + ': Clear ' + (female ? 'Female' : 'Male') + ' Vocal, Upbeat Pop Rap]';
    });
    battleData.suno_style = String(battleData.suno_style || DOPANEWS.DEFAULT_BATTLE_STYLE)
      .replace(/\b\d{2,3}\s*BPM\b/gi, '115 BPM');
    const lyrics = DOPANEWS.buildMurekaPrompt(battleData);
    if (lyrics.length > 5000) {
      throw new Error('音声用かな歌詞がMurekaの上限（5000文字）を超えています。歌詞を短くしてください。');
    }
    const stylePrompt = battleData.suno_style || DOPANEWS.DEFAULT_BATTLE_STYLE;

    const payload = {
      lyrics,
      model: 'mureka-9',
      n: 1,
      prompt: stylePrompt
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
      const pollRes = await fetch(pollUrl, { method: 'GET' });

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
        const sync = battleData.mureka_sync;
        onProgress(`Mureka楽曲完成。歌詞照合 ${sync.matched_lines}/${sync.total_lines}行`);
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
  DOPANEWS.generateFixedBeatWithMureka = generateFixedBeatWithMureka;
  DOPANEWS.synthesizeBattleOnFixedBeat = synthesizeBattleOnFixedBeat;
  DOPANEWS.generateBattleTrackWithMureka = generateBattleTrackWithMureka;
  DOPANEWS.generateBattleTrackWithSuno = generateBattleTrackWithMureka;
})(window);
