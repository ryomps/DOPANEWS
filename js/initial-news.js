/* Locally available articles and their completed battles; no generation requests. */
(function (global) {
  const D = global.DOPANEWS = global.DOPANEWS || {};
  D.initialNewsArticles = [
  {
    "id": "sns-freedom",
    "imageUrl": "./css/images/news-sns-safety-freedom.png",
    "battleKey": "voice",
    "kind": "report",
    "category": "テクノロジー",
    "title": "SNSの安全と表現の自由、どう両立する？",
    "summary": "偽情報や誹謗中傷への対策と、自由に発信し情報を受け取れる場。SNSの仕組みをどう考えるか。",
    "date": "2026/11/03",
    "dateLabel": "報道日",
    "tags": [
      "SNS",
      "表現の自由"
    ],
    "art": "ads",
    "caption": "SNSと情報のやり取りを表すイメージイラスト",
    "stances": [
      "安心して発言できる場を守るため、サービス設計の改善を",
      "小さな声を消さないため、透明性と異議を伝える手段を"
    ],
    "sources": [
      {
        "name": "時事通信／VIEW next ONLINE「SNSで揺らぐ表現の自由」",
        "url": "https://view-next.benesse.jp/news/page-jiji/jiji/id-2026110200573/",
        "date": "2026年11月3日",
        "scope": "SNSの仕組みと表現の自由を巡る報道をもとに、論点を整理しています。"
      },
      {
        "name": "Yahoo!ニュース",
        "url": "https://news.yahoo.co.jp/pickup/6601198",
        "date": "2026年11月3日",
        "scope": "話題の入口として参照。"
      }
    ],
    "paragraphs": [
      "SNSでは、だれもが自分の意見を発信し、人とつながることができます。一方で、偽情報や誹謗中傷が広がることへの懸念もあります。",
      "時事通信の報道では、SNSのおすすめ機能やサービス設計が情報の広がり方に関わるとして、事業者の仕組みを見直す必要性が紹介されています。",
      "同じ報道では、年齢による一律の利用規制が、発信する機会や人とのつながりを制限する恐れについても、専門家の慎重な見方が示されています。",
      "安全を守る仕組みと、自由に発言できる場は、どうすれば両立するでしょうか。削除や制限の基準を説明すること、異議を伝えられること、利用者が選べることも考える手掛かりです。",
      "ここからのMCバトルでは、サービス設計の改善を重視するKENTAと、小さな声や居場所を守ることを重視するREINAが意見を交わします。両者の発言は、この論点を考えるための創作です。"
    ]
  },
  {
    "id": "children-smartphone",
    "imageUrl": "./css/images/news-child-smartphone-dialogue.png",
    "battleKey": "food",
    "kind": "report",
    "category": "その他",
    "title": "「ドパガキ」問題、子どものスマホをどう考える？ 制限と親子の対話",
    "summary": "動画やゲームに夢中になる子どもへの心配。生活を守るルールと、本人の声を聞くことをどう両立するか。",
    "date": "2026/11/03",
    "dateLabel": "報道日",
    "tags": [
      "スマホ",
      "子育て"
    ],
    "art": "ads",
    "caption": "スマートフォンと家庭での利用を表すイメージイラスト",
    "stances": [
      "生活を守るため、大人も守る利用ルールを",
      "取り上げる前に、子どもの事情を聞いて一緒に考えよう"
    ],
    "sources": [
      {
        "name": "LASISA／Yahoo!ニュース「親たちの不安、我が子のスマホ利用をどう考えるか」",
        "url": "https://news.yahoo.co.jp/articles/e7cc5f79420ced9f738b2a8ee8877121a2f51bfe",
        "date": "2026年11月3日",
        "scope": "保護者の不安とスマホ・動画への没頭を取り上げた記事の、確認できた冒頭部分をもとに論点を整理しています。"
      }
    ],
    "paragraphs": [
      "スマートフォンの動画やゲームに夢中になる子どもを、保護者はどう見守ればよいのでしょうか。LASISAの報道では、子どものスマホ利用に対する親たちの不安が取り上げられています。",
      "本記事では、この話題をきっかけに、食事や睡眠などの日常生活を守ることと、子どもが何を楽しみ、だれとつながっているかを聞くことの両方を考えます。",
      "利用時間や置き場所などのルールを決めるなら、その理由を伝え、大人も守ることが論点になります。一方で、時間だけを見て一方的に取り上げることで、本人の事情を見落としていないかも問い直せます。",
      "スマホを使っているだけで依存症と決めつけることはできません。ここでは医学的な診断や一律の正解を示すのではなく、家族で使い方を考えるための問いとして扱います。",
      "MCバトルでは、生活を守る境界を重視するKENTAと、子どもの声を聞く対話を重視するREINAが意見を交わします。両者は架空の人物であり、歌詞は記事の取材相手の発言ではありません。"
    ]
  }
];
  D.playNewsBattle = async article => {
    const source = article.battleKey === 'voice' ? D.FIXED_DEMO : article.battleKey === 'food' ? D.FOOD_DEMO : null;
    if (!source) return false;
    const record = JSON.parse(JSON.stringify(source));
    record.articleText = article.title + '\n\n' + article.paragraphs.join('\n\n')
      + '\n\n出典：' + article.sources.map(source => source.name + ' ' + source.url).join('\n');
    await global.dopaNewsApp.handleFixedDemo(record);
    return true;
  };
})(window);
