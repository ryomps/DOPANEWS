/**
 * DOPANEWS Data Schema & Preset Sample Data
 * 今後の拡張（ファクトチェッカーAI・カットイン演出）を見据えたデータ構造定義
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  /**
   * Verseアイテムの正規化ヘルパー
   * 将来の「第3の審判AI（ファクトチェッカー）」や「カットイン演出」用のフィールドを
   * 既存コードを壊さずに保持できるようデフォルト値を保証する。
   */
  function normalizeVerse(verse, index = 0) {
    return {
      speaker: verse.speaker === 'REINA' ? 'REINA' : 'KENTA',
      section_tag:
        verse.section_tag ||
        (verse.speaker === 'REINA'
          ? `[Verse ${index + 1}: High-Pitched Cool Female Vocal, Fast Rap]`
          : `[Verse ${index + 1}: Aggressive Deep Male Vocal, Rap]`),
      lyric: verse.lyric || '',
      point_summary: verse.point_summary || '',
      rhyme_words: verse.rhyme_words || '',
      start_time_sec: typeof verse.start_time_sec === 'number' ? verse.start_time_sec : index * 11,

      // ====== 拡張用フィールド（Phase 2: ファクトチェッカー＆カットイン演出用） ======
      fact_check_status: verse.fact_check_status ?? null, // 'FACT' | 'OPINION' | 'EXAGGERATION' | null
      source_quote: verse.source_quote ?? null,           // 元記事からの引用テキスト
      fact_check_note: verse.fact_check_note ?? null,     // 審判AIからの補足コメント
      cutin_trigger: verse.cutin_trigger ?? null          // カットイン演出トリガー ('PUNCHLINE' | 'COUNTER' | null)
    };
  }

  /**
   * バトルデータ全体の正規化ヘルパー
   */
  function normalizeBattleData(raw) {
    const verses = Array.isArray(raw?.verses)
      ? raw.verses.map((v, idx) => normalizeVerse(v, idx))
      : [];

    return {
      title: raw?.title || 'UNTITLED NEWS BATTLE',
      topic_summary: raw?.topic_summary || '',
      kenta_stance: raw?.kenta_stance || '現場・庶民目線から現状の課題を徹底追及',
      reina_stance: raw?.reina_stance || 'データと国際基準・長期的合理性から冷静に反論',
      suno_style:
        raw?.suno_style ||
        'Japanese Hip Hop Battle, Male and Female Duet, Call and Response, Fast Boom Bap Beat, Aggressive Male Rapper vs Cool Female Rapper, 112 BPM',
      verses
    };
  }

  /**
   * Suno API送信用メタタグ付き歌詞ビルダー
   * 男女MCのボーカルスイッチを確実に機能させるため、section_tag と lyric を連結する
   */
  function buildSunoPrompt(battleData) {
    const lines = ['[Intro: Fast Boom Bap Beat Drop, DJ Scratch]'];
    for (const v of battleData.verses) {
      lines.push('');
      lines.push(v.section_tag.trim());
      lines.push(v.lyric.trim());
    }
    lines.push('');
    lines.push('[Chorus: Male and Female Duet, Shout]');
    lines.push('真実はどこだ ぶつかるマイクリレー\n右か左か ジャッジは君の手で！');
    lines.push('[Outro: Beat Fade Out]');
    return lines.join('\n');
  }

  /**
   * テスト用プリセット記事全文＆生成済みバトルデータ
   */
  const PRESET_NEWS_ARTICLE = `政府および経済団体で「週休3日制（選択的週休3日）」の導入拡大に向けた議論が加速している。賛成派は「育児・介護と仕事の両立や、リスキリング（学び直し）・副業の時間が確保でき、労働生産性の向上や地方移住の促進につながる」と強調する。一方で反対派や中小企業現場からは「1日あたりの労働時間延長による過労リスクや、総労働時間減少に伴う基本給2割カットへの懸念、さらに人手不足に悩む中小企業ではシフト維持が不可能になる」との強い反発も出ており、大企業と中小企業の格差拡大を危惧する声も根強い。`;

  const PRESET_BATTLE_DATA = normalizeBattleData({
    title: '選択的週休3日制：自由な未来か、給料カットの罠か！？',
    topic_summary: '週休3日制の拡大を巡り、「働き方改革・生産性向上」と「給与減額・現場の負担増」が真っ向対立！',
    kenta_stance: '給料2割減＆現場のシワ寄せは限界！中小企業と庶民の生活を守れ！',
    reina_stance: '時間当たり生産性の向上とリスキリング・副業解禁こそが日本の成長戦略！',
    suno_style:
      'Japanese Hip Hop Battle, Male and Female Duet, Call and Response, Fast Boom Bap Beat, Aggressive Male Rapper vs Cool Female Rapper, 112 BPM',
    verses: [
      {
        speaker: 'KENTA',
        section_tag: '[Verse 1: Aggressive Deep Male Vocal, Rap]',
        lyric: '週休3日？聞こえは最高だが現場はいつも限界の展開！\n休みが増えても給料2割カットじゃ生活自体がマジでハード！\n中小企業のシフトは崩壊、綺麗なスローガンじゃ腹は膨れない！',
        point_summary: '基本給カットへの懸念と、人手不足の中小企業現場への負担を痛烈批判',
        rhyme_words: '限界 × 展開 / カット × ハード / 崩壊 × 膨れない',
        start_time_sec: 0,
        fact_check_status: 'FACT',
        source_quote: '総労働時間減少に伴う基本給2割カットへの懸念、人手不足に悩む中小企業ではシフト維持が不可能'
      },
      {
        speaker: 'REINA',
        section_tag: '[Verse 2: High-Pitched Cool Female Vocal, Fast Rap]',
        lyric: '古い価値観に縛られ思考停止、大事なのは時間あたりの生産性！\nリスキリングと副業でキャリアを形成、介護や育児も両立する設計！\nダラダラ残業する時代は終焉、アップデートできない方がリスクでしょ？',
        point_summary: '労働生産性の向上・リスキリング・育児介護との両立メリットを論理的に主張',
        rhyme_words: '生産性 × 形成 × 設計',
        start_time_sec: 11,
        fact_check_status: 'FACT',
        source_quote: '育児・介護と仕事の両立や、リスキリング・副業の時間が確保でき、労働生産性の向上につながる'
      },
      {
        speaker: 'KENTA',
        section_tag: '[Verse 3: Aggressive Deep Male Vocal, Rap]',
        lyric: 'アップデート？それは余裕ある大企業の論理、現場は毎日がサバイバル！\n1日10時間労働の圧縮シフト、体壊したら元も子もないリアル！\n格差を広げるだけの綺麗事なら、俺がマイク一本で今すぐ論破する！',
        point_summary: '1日あたりの労働時間延長による過労リスクと大企業・中小企業の格差を指摘',
        rhyme_words: 'サバイバル × リアル / 論理 × 論破',
        start_time_sec: 22,
        fact_check_status: 'FACT',
        source_quote: '1日あたりの労働時間延長による過労リスク、大企業と中小企業の格差拡大を危惧'
      },
      {
        speaker: 'REINA',
        section_tag: '[Verse 4: High-Pitched Cool Female Vocal, Fast Rap]',
        lyric: 'だからこそ「選択的」な制度の設計、選べる自由を奪うのはナンセンス！\n地方移住や新しい稼ぎ方のチャンス、変化を恐れず掴み取るアドバンス！\n感情論だけで未来を閉ざすな、データと実績で証明するネクストステージ！',
        point_summary: '強制ではなく「選択的」制度である点と、地方移住や多様な収入源の可能性を強調',
        rhyme_words: 'ナンセンス × チャンス × アドバンス',
        start_time_sec: 33,
        fact_check_status: 'FACT',
        source_quote: '選択的週休3日の導入拡大、地方移住の促進につながる'
      }
    ]
  });

  DOPANEWS.normalizeVerse = normalizeVerse;
  DOPANEWS.normalizeBattleData = normalizeBattleData;
  DOPANEWS.buildSunoPrompt = buildSunoPrompt;
  DOPANEWS.PRESET_NEWS_ARTICLE = PRESET_NEWS_ARTICLE;
  DOPANEWS.PRESET_BATTLE_DATA = PRESET_BATTLE_DATA;
})(window);
