/**
 * DOPANEWS Data Schema & Preset Sample Data
 * - 8小節（8行）× 4本（KENTA [Verse] ➔ REINA [Chorus] ➔ KENTA [Verse] ➔ REINA [Chorus]）
 * - Murekaで男女の声と曲展開が確実に切り替わる [Verse] ⇄ [Chorus] 交互デュエット構造
 * - BPM（デフォルト115 BPM ＝ 8小節 約16.7秒）に基づく正確な小節・バース同期
 */
(function (global) {
  const DOPANEWS = (global.DOPANEWS = global.DOPANEWS || {});

  const DEFAULT_BATTLE_STYLE =
    'Japanese Pop Rap, Educational Rap, Male and Female Duet, Alternating Male Verse and Female Chorus, Catchy Melody, Upbeat, Clear Male Vocal, Clear Female Vocal, Groovy Funky Beat, 115 BPM';

  /**
   * Style文字列からBPM数値を抽出（デフォルト 115 BPM）
   */
  function extractBpmFromStyle(styleStr) {
    const match = String(styleStr || '').match(/(\d{2,3})\s*BPM/i);
    if (match) {
      const bpm = parseInt(match[1], 10);
      if (bpm >= 60 && bpm <= 200) return bpm;
    }
    return 115;
  }

  /**
   * BPMから「8小節（4拍子×8＝32拍）」の正確な秒数を計算
   * 例: 115 BPM => (60 / 115) * 32 = 16.695秒
   */
  function calcEightBarsDurationSec(bpm = 115) {
    return (60 / bpm) * 4 * 8;
  }

  /**
   * Mureka用の標準セクションタグ（男声＝Verse、女声＝Chorusで交互に声色を切り替えさせる）
   */
  function getDefaultSectionTag(index, isReina) {
    const pairNum = Math.floor(index / 2) + 1;
    if (isReina) {
      return `[Chorus ${pairNum}: Clear Female Vocal, Upbeat Pop Rap]`;
    }
    return `[Verse ${pairNum}: Clear Male Vocal, Upbeat Pop Rap]`;
  }

  /**
   * Verseアイテムの正規化ヘルパー
   */
  function normalizeVerse(verse, index = 0, bpm = 115) {
    const isReina = verse.speaker === 'REINA' || (!verse.speaker && index % 2 === 1);
    const eightBarSec = calcEightBarsDurationSec(bpm);

    // もしGeminiが古い [Verse 2] [Verse 4] を出力しても、Mureka用に自動で [Chorus 1] [Chorus 2] へ変換
    let tag = getDefaultSectionTag(index, isReina);
    if (verse.section_tag) {
      if (isReina && /^\[Verse/i.test(verse.section_tag)) {
        const pairNum = Math.floor(index / 2) + 1;
        tag = verse.section_tag.replace(/^\[Verse\s*\d*/i, `[Chorus ${pairNum}`);
      } else {
        tag = verse.section_tag;
      }
    }

    return {
      speaker: isReina ? 'REINA' : 'KENTA',
      section_tag: tag,
      lyric: verse.lyric || '',
      point_summary: verse.point_summary || '',
      rhyme_words: verse.rhyme_words || '',
      start_time_sec:
        typeof verse.start_time_sec === 'number' && verse.synced_from_mureka
          ? verse.start_time_sec
          : Math.round(index * eightBarSec * 10) / 10,
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
    const sunoStyle = raw?.suno_style || DEFAULT_BATTLE_STYLE;
    const bpm = extractBpmFromStyle(sunoStyle);
    const verses = Array.isArray(raw?.verses)
      ? raw.verses.slice(0, 4).map((v, idx) => normalizeVerse(v, idx, bpm))
      : [];

    return {
      title: raw?.title || 'UNTITLED NEWS BATTLE',
      topic_summary: raw?.topic_summary || '',
      kenta_stance: raw?.kenta_stance || '現場・庶民目線から現状の課題を徹底追及',
      reina_stance: raw?.reina_stance || 'データと国際基準・長期的合理性から冷静に反論',
      suno_style: sunoStyle,
      bpm,
      verses
    };
  }

  /**
   * Mureka送信用メタタグ付き歌詞ビルダー
   * [Verse 1: Male] ➔ [Chorus 1: Female] ➔ [Verse 2: Male] ➔ [Chorus 2: Female] ➔ [End]
   */
  function buildSunoPrompt(battleData) {
    const lines = [];
    for (let i = 0; i < battleData.verses.length; i++) {
      const v = battleData.verses[i];
      if (i > 0) lines.push('');
      lines.push(v.section_tag.trim());
      lines.push(v.lyric.trim());
    }
    lines.push('');
    lines.push('[Outro: Short Fade Out]');
    lines.push('[End]');
    return lines.join('\n');
  }

  /**
   * 歌詞文字列の正規化（記号・空白を除去してMurekaの認識結果と照合しやすくする）
   */
  function normalizeLyricText(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[\s　、。！？!?,."'`「」『』（）()\[\]・…ー〜~]/g, '');
  }

  /**
   * 2つの歌詞行が一致または類似しているか判定
   */
  function isSimilarLyricLine(expectedRaw, actualRaw) {
    const a = normalizeLyricText(expectedRaw);
    const b = normalizeLyricText(actualRaw);
    if (!a || !b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    const headLen = Math.min(5, a.length, b.length);
    if (headLen >= 3 && a.slice(0, headLen) === b.slice(0, headLen)) return true;
    const tailLen = Math.min(5, a.length, b.length);
    if (tailLen >= 3 && a.slice(-tailLen) === b.slice(-tailLen)) return true;
    return false;
  }

  /**
   * Mureka APIのレスポンスに lyrics_sections が含まれる場合のミリ秒タイムスタンプ同期
   * ※Murekaが後半に2周目のリピートや長いアウトロ（合計2分超）を自動追加した場合でも、
   *   必ず「前半の8小節×4本（計32行＝約1分間）」だけを正確に切り出して同期する！
   */
  function applyMurekaTimestamps(battleData, murekaChoice) {
    if (!battleData || !Array.isArray(battleData.verses) || !murekaChoice) {
      return battleData;
    }

    const bpm = extractBpmFromStyle(battleData.suno_style);
    const eightBarSec = calcEightBarsDurationSec(bpm); // 115BPMで約16.7秒

    const sections = Array.isArray(murekaChoice.lyrics_sections)
      ? murekaChoice.lyrics_sections
      : [];

    const toSec = (val) => {
      if (typeof val !== 'number') return 0;
      return val > 500 ? val / 1000 : val;
    };

    // 全セクションから有効な歌詞行を時系列順に取り出す
    const allLines = [];
    sections.forEach((sec) => {
      const type = String(sec.section_type || '').toLowerCase();
      if (type === 'intro' || type === 'outro') return;
      (sec.lines || []).forEach((ln) => {
        if (typeof ln.start === 'number') {
          const startSec = toSec(ln.start);
          const endSec = toSec(ln.end || ln.start + 2100);
          allLines.push({
            text: ln.text || '',
            start_sec: startSec,
            end_sec: Math.max(startSec + 1.2, Math.min(startSec + 4.5, endSec))
          });
        }
      });
    });

    const verseCount = battleData.verses.length;
    const totalExpectedLines = battleData.verses.reduce(
      (sum, v) => sum + String(v.lyric || '').split('\n').filter(Boolean).length,
      0
    );

    if (allLines.length >= 4) {
      let searchCursor = 0;
      let matchedLinesCount = 0;

      battleData.verses.forEach((v, idx) => {
        const expectedLines = String(v.lyric || '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        const lineCount = expectedLines.length || 8;

        // 現在のカーソル位置から、このバースの1行目に一致する行を探索（最大8行先まで）
        let startIdx = searchCursor;
        if (expectedLines[0]) {
          for (
            let probe = searchCursor;
            probe < Math.min(allLines.length, searchCursor + 8);
            probe++
          ) {
            if (isSimilarLyricLine(expectedLines[0], allLines[probe].text)) {
              startIdx = probe;
              break;
            }
          }
        }

        const slice = allLines.slice(startIdx, startIdx + lineCount);
        if (slice.length > 0) {
          matchedLinesCount += slice.length;
          const vStart = slice[0].start_sec;
          const rawEnd = slice[slice.length - 1].end_sec;
          // 1バース(8小節)が異常に間延びしないよう最大でも eightBarSec * 1.35 秒以内に制限
          const maxEnd = vStart + eightBarSec * 1.35;
          v.start_time_sec = Math.round(vStart * 100) / 100;
          v.end_time_sec = Math.round(Math.min(rawEnd, maxEnd) * 100) / 100;
          v.timed_lines = slice;
          v.synced_from_mureka = true;
          searchCursor = startIdx + slice.length;
        } else {
          // 万一Mureka側で行が足りない場合は前のバース終了位置からBPM計算で8小節を割り当て
          const prevEnd =
            idx > 0 && typeof battleData.verses[idx - 1].end_time_sec === 'number'
              ? battleData.verses[idx - 1].end_time_sec
              : 8.3 + idx * eightBarSec;
          v.start_time_sec = Math.round(prevEnd * 100) / 100;
          v.end_time_sec = Math.round((prevEnd + eightBarSec) * 100) / 100;
          v.timed_lines = null;
          v.synced_from_mureka = true;
        }
      });

      battleData.mureka_sync = {
        matched_lines: matchedLinesCount,
        total_lines: totalExpectedLines || 32
      };
    } else {
      battleData.mureka_sync = {
        matched_lines: 0,
        total_lines: totalExpectedLines || 32
      };
    }

    return battleData;
  }

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
        rhyme_words: '限界 × 展開 / カット × ハード / 回らない × ワークスタイル'
      },
      {
        speaker: 'REINA',
        section_tag: '[Chorus 1: Clear Female Vocal, Upbeat Pop Rap]',
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
        rhyme_words: '生産性 × 形成 × 設計 / チャンス × プラス × アンサー'
      },
      {
        speaker: 'KENTA',
        section_tag: '[Verse 2: Clear Male Vocal, Upbeat Pop Rap]',
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
        rhyme_words: '論理 × リアル / 経済格差 × 成長戦略だ'
      },
      {
        speaker: 'REINA',
        section_tag: '[Chorus 2: Clear Female Vocal, Upbeat Pop Rap]',
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
        rhyme_words: '設計 × 選択肢 / 現実になる × 武器になる / 移行中 × ネクストステージ'
      }
    ]
  });

  DOPANEWS.DEFAULT_BATTLE_STYLE = DEFAULT_BATTLE_STYLE;
  DOPANEWS.extractBpmFromStyle = extractBpmFromStyle;
  DOPANEWS.calcEightBarsDurationSec = calcEightBarsDurationSec;
  DOPANEWS.normalizeVerse = normalizeVerse;
  DOPANEWS.normalizeBattleData = normalizeBattleData;
  DOPANEWS.buildSunoPrompt = buildSunoPrompt;
  DOPANEWS.applyMurekaTimestamps = applyMurekaTimestamps;
  DOPANEWS.PRESET_NEWS_ARTICLE = PRESET_NEWS_ARTICLE;
  DOPANEWS.PRESET_BATTLE_DATA = PRESET_BATTLE_DATA;
})(window);
