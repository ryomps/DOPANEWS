/**
 * DOPANEWS Data Schema & Preset Sample Data
 * - 8小節（8行）× 4本（KENTA ➔ REINA ➔ KENTA ➔ REINA）の本格MCバトルフォーマット
 * - Mureka APIの lyrics_sections タイムスタンプ（ミリ秒）による完全同期対応
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  const DEFAULT_BATTLE_STYLE =
    'Japanese Pop Rap, Educational Rap, Catchy Melody, Upbeat, Clear Male Vocal, Clear Female Vocal, Male and Female Duet, Groovy Funky Beat, 115 BPM';

  /**
   * Verseアイテムの正規化ヘルパー
   */
  function normalizeVerse(verse, index = 0) {
    const isReina = verse.speaker === 'REINA' || ( !verse.speaker && index % 2 === 1 );
    return {
      speaker: isReina ? 'REINA' : 'KENTA',
      section_tag:
        verse.section_tag ||
        (isReina
          ? `[Verse ${index + 1}: Clear Female Vocal, Upbeat Pop Rap]`
          : `[Verse ${index + 1}: Clear Male Vocal, Upbeat Pop Rap]`),
      lyric: verse.lyric || '',
      point_summary: verse.point_summary || '',
      rhyme_words: verse.rhyme_words || '',
      start_time_sec: typeof verse.start_time_sec === 'number' ? verse.start_time_sec : index * 20,
      end_time_sec: typeof verse.end_time_sec === 'number' ? verse.end_time_sec : null,
      timed_lines: Array.isArray(verse.timed_lines) ? verse.timed_lines : null,
      synced_from_mureka: Boolean(verse.synced_from_mureka),

      // ====== 拡張用フィールド（Phase 2: ファクトチェッカー＆カットイン演出用） ======
      fact_check_status: verse.fact_check_status ?? null,
      source_quote: verse.source_quote ?? null,
      fact_check_note: verse.fact_check_note ?? null,
      cutin_trigger: verse.cutin_trigger ?? null
    };
  }

  /**
   * バトルデータ全体の正規化ヘルパー
   */
  function normalizeBattleData(raw) {
    const verses = Array.isArray(raw?.verses)
      ? raw.verses.slice(0, 4).map((v, idx) => normalizeVerse(v, idx))
      : [];

    return {
      title: raw?.title || 'UNTITLED NEWS BATTLE',
      topic_summary: raw?.topic_summary || '',
      kenta_stance: raw?.kenta_stance || '現場・庶民目線から現状の課題を徹底追及',
      reina_stance: raw?.reina_stance || 'データと国際基準・長期的合理性から冷静に反論',
      suno_style: raw?.suno_style || DEFAULT_BATTLE_STYLE,
      verses
    };
  }

  /**
   * Mureka / Suno 送信用メタタグ付き歌詞ビルダー
   * 余計な [Intro] や [Chorus] を入れず、純粋な「8小節×4バース」のみを送ることで
   * 声の切り替わりと4バースの構成を1対1で一致させる
   */
  function buildSunoPrompt(battleData) {
    const lines = [];
    for (let i = 0; i < battleData.verses.length; i++) {
      const v = battleData.verses[i];
      if (i > 0) lines.push('');
      lines.push(v.section_tag.trim());
      lines.push(v.lyric.trim());
    }
    return lines.join('\n');
  }

  /**
   * Mureka APIのレスポンス (choices[0].lyrics_sections) に含まれる正確なミリ秒タイムスタンプを
   * 各バース (V1〜V4) および各行 (8小節) にマッピングして声と画面遷移を完全一致させる
   */
  function applyMurekaTimestamps(battleData, murekaChoice) {
    if (!battleData || !Array.isArray(battleData.verses) || !murekaChoice) {
      return battleData;
    }

    const sections = Array.isArray(murekaChoice.lyrics_sections)
      ? murekaChoice.lyrics_sections
      : [];

    // 歌詞行を持つセクション（intro / outro 以外）を抽出
    const vocalSections = sections.filter((sec) => {
      const type = String(sec.section_type || '').toLowerCase();
      const hasLines = Array.isArray(sec.lines) && sec.lines.length > 0;
      return hasLines && type !== 'intro' && type !== 'outro';
    });

    const toSec = (val) => {
      if (typeof val !== 'number') return 0;
      // Murekaのタイムスタンプはミリ秒 (例: 11960 = 11.96秒)
      return val > 500 ? val / 1000 : val;
    };

    if (vocalSections.length > 0) {
      // 全ボーカル行をフラット化して4バース（各8行）に割り当てるか、セクション単位で割り当てる
      const allLines = [];
      vocalSections.forEach((sec) => {
        (sec.lines || []).forEach((ln) => {
          if (typeof ln.start === 'number') {
            allLines.push({
              text: ln.text || '',
              start_sec: toSec(ln.start),
              end_sec: toSec(ln.end || ln.start + 2500)
            });
          }
        });
      });

      const verseCount = battleData.verses.length;
      if (vocalSections.length === verseCount) {
        // セクション数が4バースと完全一致している場合
        battleData.verses.forEach((v, idx) => {
          const sec = vocalSections[idx];
          v.start_time_sec = toSec(sec.start);
          v.end_time_sec = toSec(sec.end);
          v.synced_from_mureka = true;
          if (Array.isArray(sec.lines) && sec.lines.length > 0) {
            v.timed_lines = sec.lines.map((ln) => ({
              text: ln.text || '',
              start_sec: toSec(ln.start),
              end_sec: toSec(ln.end || ln.start + 2500)
            }));
          }
        });
      } else if (allLines.length >= verseCount) {
        // 行数ベースで4バース（各8小節）に均等マッピング
        const linesPerVerse = Math.max(1, Math.floor(allLines.length / verseCount));
        battleData.verses.forEach((v, idx) => {
          const startLineIdx = idx * linesPerVerse;
          const endLineIdx =
            idx === verseCount - 1 ? allLines.length - 1 : (idx + 1) * linesPerVerse - 1;
          const slice = allLines.slice(startLineIdx, endLineIdx + 1);
          if (slice.length > 0) {
            v.start_time_sec = slice[0].start_sec;
            v.end_time_sec = slice[slice.length - 1].end_sec;
            v.timed_lines = slice;
            v.synced_from_mureka = true;
          }
        });
      }
    }

    return battleData;
  }

  /**
   * テスト用プリセット記事全文＆生成済みバトルデータ（8小節×4本構成）
   */
  const PRESET_NEWS_ARTICLE = `政府および経済団体で「週休3日制（選択的週休3日）」の導入拡大に向けた議論が加速している。賛成派は「育児・介護と仕事の両立や、リスキリング（学び直し）・副業の時間が確保でき、労働生産性の向上や地方移住の促進につながる」と強調する。一方で反対派や中小企業現場からは「1日あたりの労働時間延長による過労リスクや、総労働時間減少に伴う基本給2割カットへの懸念、さらに人手不足に悩む中小企業ではシフト維持が不可能になる」との強い反発も出ており、大企業と中小企業の格差拡大を危惧する声も根強い。`;

  const PRESET_BATTLE_DATA = normalizeBattleData({
    title: '選択的週休3日制：自由な未来か、給料カットの罠か！？',
    topic_summary:
      '週休3日制の拡大を巡り、「働き方改革・生産性向上」と「給与減額・現場の負担増」が8小節×4本で真っ向対立！',
    kenta_stance: '給料2割減＆現場のシワ寄せは限界！中小企業と庶民の生活を守れ！',
    reina_stance: '時間当たり生産性の向上とリスキリング・副業解禁こそが日本の成長戦略！',
    suno_style: DEFAULT_BATTLE_STYLE,
    verses: [
      {
        speaker: 'KENTA',
        section_tag: '[Verse 1: Clear Male Vocal, Upbeat Pop Rap]',
        lyric: [
          '週休3日？聞こえは最高だが現場はいつも限界の展開',
          '休みが増えても給料2割カットじゃ生活自体がマジでハード',
          '物価は上がるのに手取りが減ったら家族の笑顔も守れないだろ',
          '中小企業のシフトは崩壊、現場の悲鳴が聞こえてないのか',
          '1日10時間働く圧縮労働、体壊したら元も子もない',
          '人手不足の町工場や店舗じゃ3日も休めば店は回らない',
          'スーツ着たエリートが机の上で描いた綺麗事のワークスタイル',
          '俺たちが欲しいのは休日の数より明日を生き抜く確かな給料！'
        ].join('\n'),
        point_summary: '基本給2割カットへの懸念と、人手不足の中小企業現場へのシワ寄せを8小節で痛烈批判',
        rhyme_words: '限界 × 展開 / カット × ハード / 回らない × ワークスタイル',
        start_time_sec: 0
      },
      {
        speaker: 'REINA',
        section_tag: '[Verse 2: Clear Female Vocal, Upbeat Pop Rap]',
        lyric: [
          '古い価値観に縛られ思考停止、大事なのは時間あたりの生産性',
          'ダラダラ会社に居残る時代はとっくに終わってるの分からない？',
          '空いた1日でリスキリング、最新のスキルでキャリアを形成',
          '副業解禁で収入の柱を自分で増やすのが現代の設計',
          '育児や介護で離職していた人材も週4なら現場に戻れるチャンス',
          'AIとITを使いこなせば4日間でも成果は十分にプラス',
          '現状維持にしがみつくだけじゃ日本全体が沈んでいくだけ',
          '変化を恐れず仕組みを変える、それが未来を勝ち取るアンサー！'
        ].join('\n'),
        point_summary: '労働生産性の向上・リスキリング・介護育児との両立メリットを8小節で論理的に主張',
        rhyme_words: '生産性 × 形成 × 設計 / チャンス × プラス × アンサー',
        start_time_sec: 12
      },
      {
        speaker: 'KENTA',
        section_tag: '[Verse 3: Clear Male Vocal, Upbeat Pop Rap]',
        lyric: [
          'リスキリングだの副業だの、それは余裕ある大企業の論理',
          '毎日クタクタの現場労働者にこれ以上いつ勉強しろって言うんだ',
          '結局トクするのは一部のホワイト企業、広がるばかりの経済格差',
          '地方や中小の現場を無視して何がスマートな成長戦略だ',
          '「選択的」と言いながら職場の空気で強制されるのが日本のリアル',
          '給料減らして自己責任に丸投げする魂胆が透けて見えるぜ',
          '地に足つかないデータ遊びより目の前の労働者の汗を見ろ',
          'このマイク一本で綺麗事の化けの皮を今すぐ剥がしてやる！'
        ].join('\n'),
        point_summary: '大企業と中小企業の格差拡大と、「選択的」の名の下での実質的賃下げリスクを追及',
        rhyme_words: '論理 × リアル / 経済格差 × 成長戦略だ',
        start_time_sec: 24
      },
      {
        speaker: 'REINA',
        section_tag: '[Verse 4: Clear Female Vocal, Upbeat Pop Rap]',
        lyric: [
          '感情論だけで未来を閉ざすな、だからこそ「選択的」な制度の設計',
          '全員に強制する話じゃない、働き方のカードを増やす選択肢',
          '週末3日あれば地方移住や二拠点生活だって現実になる',
          '人手不足の中小企業こそ柔軟な雇用で若者を集める武器になる',
          '「前例がない」「無理だ」と叫ぶだけなら誰にでもできる簡単なこと',
          '世界のスタンダードはすでに労働時間からアウトプット評価へ移行中',
          '痛みを恐れて改革を止めれば10年後の現場はもっと苦しくなる',
          'データと実績で証明する、これが令和を生き抜くネクストステージ！'
        ].join('\n'),
        point_summary: '選択制による多様な働き方の確保と、地方移住・人材獲得へのポジティブな効果を強調',
        rhyme_words: '設計 × 選択肢 / 現実になる × 武器になる / 移行中 × ネクストステージ',
        start_time_sec: 36
      }
    ]
  });

  DOPANEWS.DEFAULT_BATTLE_STYLE = DEFAULT_BATTLE_STYLE;
  DOPANEWS.normalizeVerse = normalizeVerse;
  DOPANEWS.normalizeBattleData = normalizeBattleData;
  DOPANEWS.buildSunoPrompt = buildSunoPrompt;
  DOPANEWS.applyMurekaTimestamps = applyMurekaTimestamps;
  DOPANEWS.PRESET_NEWS_ARTICLE = PRESET_NEWS_ARTICLE;
  DOPANEWS.PRESET_BATTLE_DATA = PRESET_BATTLE_DATA;
})(window);
