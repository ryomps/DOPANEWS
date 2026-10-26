/**
 * DOPANEWS API Service
 * ① Gemini API (gemini-2.5-flash) によるラップバトル台本・歌詞生成
 * ② Suno API (sunoapi.org互換) による楽曲生成・4秒間隔ポーリング
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  const GEMINI_ENDPOINT =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  const SUNO_GENERATE_ENDPOINT = 'https://api.sunoapi.org/api/v1/generate';
  const SUNO_RECORD_INFO_ENDPOINT = 'https://api.sunoapi.org/api/v1/generate/record-info';

  /**
   * Gemini APIを呼び出し、ニュース記事全文から男女MCラップバトルJSONを生成する
   */
  async function generateBattleScriptWithGemini(articleText, geminiApiKey) {
    if (!geminiApiKey) {
      throw new Error('Gemini APIキーが入力されていません。');
    }
    if (!articleText || articleText.trim().length < 20) {
      throw new Error('ニュース記事の本文を20文字以上入力してください。');
    }

    const systemPrompt = `あなたは日本のトップMCバトル構成作家兼ニュース解説プロデューサーです。
ユーザーが入力したニュース記事の対立軸（賛成派 vs 反対派 / メリット vs デメリット / 推進派 vs 慎重派）を抽出し、
男性MC「KENTA」と女性MC「REINA」が交互にマイクリレーする約45〜60秒の熱いラップバトル台本をJSON形式で出力してください。

【キャラクター設定】
- MC KENTA（男性MC）:
  - section_tagは必ず "[Verse N: Aggressive Deep Male Vocal, Rap]" とすること
  - スタンス: 直感派・庶民目線・現場のリアル・現状への怒りや変革を訴える側（または記事の一方の立場）
- MC REINA（女性MC）:
  - section_tagは必ず "[Verse N: High-Pitched Cool Female Vocal, Fast Rap]" とすること
  - スタンス: クール・データや国際標準・経済合理性・現実的なトレードオフを突く側（または記事のもう一方の立場）

【構成ルール】
- 全4バース構成（KENTA ➔ REINA ➔ KENTA ➔ REINA の交互マイクリレー）
- 各バースの lyric は2〜4行で、明確な脚韻・頭韻を踏み、ニュースの核心を突くパンチラインにすること
- start_time_sec は 0, 12, 24, 36 のように約11〜12秒間隔で設定すること
- suno_style はデフォルトで "Japanese Hip Hop Battle, Male and Female Duet, Call and Response, Fast Boom Bap Beat, Aggressive Male Rapper vs Cool Female Rapper, 112 BPM" とすること
- 必ず以下のJSONフォーマットのみを出力してください（Markdownコードブロック不要）：
{
  "title": "ニュースのバトルタイトル",
  "topic_summary": "ニュースの1行要約",
  "kenta_stance": "MC KENTAの主張要約（投票画面用）",
  "reina_stance": "MC REINAの主張要約（投票画面用）",
  "suno_style": "Japanese Hip Hop Battle, Male and Female Duet, Call and Response, Fast Boom Bap Beat, Aggressive Male Rapper vs Cool Female Rapper, 112 BPM",
  "verses": [
    {
      "speaker": "KENTA",
      "section_tag": "[Verse 1: Aggressive Deep Male Vocal, Rap]",
      "lyric": "韻を踏んだ歌詞（2〜4行）",
      "point_summary": "このパートの解説要点（1行）",
      "rhyme_words": "踏んでいる韻のペア（例: 限界 × 展開）",
      "start_time_sec": 0
    },
    {
      "speaker": "REINA",
      "section_tag": "[Verse 2: High-Pitched Cool Female Vocal, Fast Rap]",
      "lyric": "韻を踏んだ反論歌詞（2〜4行）",
      "point_summary": "このパートの解説要点（1行）",
      "rhyme_words": "踏んでいる韻のペア",
      "start_time_sec": 12
    }
  ]
}`;

    const url = `${GEMINI_ENDPOINT}?key=${encodeURIComponent(geminiApiKey.trim())}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API エラー (${response.status}): ${errText}`);
    }

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

  /**
   * Suno APIで楽曲生成リクエストを送信し、4秒間隔でポーリングして音声URLを取得する
   */
  async function generateBattleTrackWithSuno(battleData, sunoApiKey, onProgress = () => {}) {
    if (!sunoApiKey) {
      throw new Error('Suno APIキーが入力されていません。');
    }

    const prompt = DOPANEWS.buildSunoPrompt(battleData);
    const payload = {
      customMode: true,
      instrumental: false,
      model: 'V3_5',
      prompt,
      style:
        battleData.suno_style ||
        'Japanese Hip Hop Battle, Male and Female Duet, Call and Response, Fast Boom Bap Beat, Aggressive Male Rapper vs Cool Female Rapper, 112 BPM',
      title: battleData.title.slice(0, 80),
      callBackUrl: 'https://httpbin.org/post'
    };

    onProgress('Suno APIへメタタグ付き歌詞＆ビート指定を送信中...');

    const genRes = await fetch(SUNO_GENERATE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sunoApiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!genRes.ok) {
      const errText = await genRes.text();
      throw new Error(`Suno Generate エラー (${genRes.status}): ${errText}`);
    }

    const genJson = await genRes.json();
    const taskId = genJson?.data?.taskId || genJson?.taskId;
    if (!taskId) {
      throw new Error(`Suno APIからtaskIdを取得できませんでした: ${JSON.stringify(genJson)}`);
    }

    onProgress(`Sunoレコーディング開始 (Task ID: ${taskId.slice(0, 8)}...) 4秒間隔で待機中`);

    const maxAttempts = 60;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 4000));

      const pollUrl = `${SUNO_RECORD_INFO_ENDPOINT}?taskId=${encodeURIComponent(taskId)}`;
      const pollRes = await fetch(pollUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${sunoApiKey.trim()}`
        }
      });

      if (!pollRes.ok) {
        onProgress(`ポーリング再試行中 (${attempt}/${maxAttempts})...`);
        continue;
      }

      const pollJson = await pollRes.json();
      const status = pollJson?.data?.status || pollJson?.status || 'PENDING';
      const sunoData =
        pollJson?.data?.response?.sunoData ||
        pollJson?.data?.sunoData ||
        pollJson?.response?.sunoData ||
        [];

      const firstTrack = Array.isArray(sunoData) && sunoData.length > 0 ? sunoData[0] : null;
      const playableUrl =
        firstTrack?.streamAudioUrl ||
        firstTrack?.audioUrl ||
        firstTrack?.stream_audio_url ||
        firstTrack?.audio_url;

      if (playableUrl) {
        onProgress('Sunoストリーム音声取得完了！ステージ再生を開始します🔥');
        return {
          audioUrl: playableUrl,
          taskId,
          prompt
        };
      }

      if (status === 'FAILED' || status === 'ERROR' || status === 'SENSITIVE_WORD_ERROR') {
        throw new Error(`Suno生成失敗 (ステータス: ${status})`);
      }

      onProgress(`Sunoボーカル＆ビート生成中... [${status}] (${attempt * 4}秒経過)`);
    }

    throw new Error('Suno APIの生成がタイムアウトしました。');
  }

  DOPANEWS.generateBattleScriptWithGemini = generateBattleScriptWithGemini;
  DOPANEWS.generateBattleTrackWithSuno = generateBattleTrackWithSuno;
})(window);
