/* Local sample repository. Replace list() with a news API adapter later. */
(function (global) {
  const D = global.DOPANEWS;
  const articles = [
    { id: 'work', category: '働き方', title: '週休3日で、暮らしは変わる？ 自由な時間と現場の負担、そのあいだ', summary: '休みが増える、その先に。働く時間と収入のバランスを考える。', date: '2026/10/27 09:00', tag: '働き方改革', color: '#e2eee9', accent: '#226b57', art: 'work', caption: '働く時間と、自分の時間を見つめ直す（イメージイラスト）', stances: ['休みを増やす前に、収入と現場の人手を守ろう', '働き方を見直して、時間の選択肢を増やそう'], paragraphs: [
      'もし、毎週の休みがもう1日増えたら。家族と過ごす、資格の勉強をする、あるいは、ただゆっくり休む。週休3日制は、仕事と暮らしの関係を見つめ直すテーマです。この記事では、架空の企業で導入を検討する場面をもとに、その可能性と課題を考えます。',
      '制度を考えるうえで大切なのは、「週休3日」の中身です。1日の勤務時間を長くして週の労働時間を保つ方法もあれば、働く時間そのものを減らす方法もあります。休日の数が同じでも、給与や体への負担は異なります。',
      '導入に前向きな社員は、育児や介護と両立しやすくなることや、学び直しの時間を持てることに期待しています。通勤日数が減れば、移動に使っていた時間を生活に戻せるかもしれません。',
      '一方、店舗や医療・介護など、誰かが現場を支える仕事では、シフトをどう組むかが課題になります。休む人の仕事をほかの社員が引き受けるだけでは、負担が偏るおそれがあります。',
      '給与の扱いも欠かせません。休日が増えても収入が減れば、制度を選びたくても選べない人が出てきます。時間の自由と生活の安心を、同時に考える必要があります。',
      '今回の架空の検討例では、まず小さな部署で試し、残業時間、仕事の成果、社員の満足度を確認する案が出ています。合わない場合に元の働き方へ戻れることも、参加する人の安心につながります。',
      'あなたが重視するのは、自由な時間でしょうか。それとも、収入や現場の安定でしょうか。どちらか一方を選ぶだけでなく、両方を実現する条件を考えてみてください。'
    ] },
    { id: 'ai', category: 'テクノロジー', title: '教室に生成AIがやってきた。学びの相棒か、考える力の近道か', summary: '答えをもらう道具から、問いを深める相棒へ。学校での使い方を考える。', date: '2026/10/27 08:30', tag: 'AIと教育', color: '#e8eaf6', accent: '#535da4', art: 'ai', caption: '学びの道具としての生成AI（イメージイラスト）', stances: ['自分で悩み、考える時間を大事にしよう', 'AIと対話して、学びの可能性を広げよう'], paragraphs: [
      '授業でわからないことを、いつでも聞ける相手がいたら。生成AIを学習に取り入れる架空の学校を舞台に、便利さと学びの深さの両立を考えます。実際の学校での出来事を報じた記事ではありません。',
      'この学校の検討案では、AIに作文を完成させてもらうのではなく、自分が書いた文章への質問や、別の視点を出してもらいます。答えを写すより、自分の考えを説明する時間を増やすことが狙いです。',
      '生徒にとっては、何度聞いても待ってくれる相手がいる安心感があります。一人ひとりの理解に合わせて例を変えたり、問題に取り組むヒントを受け取ったりする使い方も考えられます。',
      'ただし、AIの回答はいつも正しいとは限りません。もっともらしい説明を、そのまま信じてしまう危険があります。教科書や資料と照らし合わせる作業を、授業に組み込む必要があります。',
      '家庭の端末や通信環境によって、使える機会に差が出ることも課題です。また、氏名や成績などの個人情報を入力しないルールや、年齢に応じた利用条件の確認も欠かせません。',
      '評価の方法も変わりそうです。完成した答えだけでなく、どんな問いを立て、どの情報を確かめ、どう考え直したか。学びの過程を共有することが大切になります。',
      'AIを使わずに考える時間と、AIと一緒に考える時間。あなたなら、教室の中でどのように組み合わせますか。'
    ] },
    { id: 'city', category: '暮らし', title: '駅前の道路を、人が集まる広場に。便利さとにぎわいをどう両立する？', summary: '歩きたくなる街づくり。車で訪れる人や、地域のお店の声は。', date: '2026/10/27 08:00', tag: 'まちづくり', color: '#f5eadc', accent: '#a66a3f', art: 'city', caption: '歩く人が主役になる駅前広場（イメージイラスト）', stances: ['車が必要な人のアクセスも守ろう', '歩いて過ごせる街に、にぎわいを育てよう'], paragraphs: [
      '駅を出ると、ベンチと木陰があり、ゆっくり話せる場所がある。そんな駅前を目指す架空のまちづくり計画を題材に、公共空間の使い方を考えます。',
      '計画案では、週末だけ道路の一部を歩行者向けに開き、移動販売や小さなイベントを行います。まず期間を区切って試し、人の流れや周辺の交通への影響を調べる想定です。',
      '賛成する人は、通り過ぎるだけだった駅前が、立ち寄れる場所になることに期待しています。地域の店を知る機会や、世代を超えた交流につながる可能性もあります。',
      '一方で、車での送迎が必要な人や、商品の搬入を行う店からは心配の声も考えられます。歩行者の快適さを高める一方で、移動が難しくなる人を置き去りにはできません。',
      '乗降場所の確保、迂回路の案内、緊急車両の通行など、具体的な設計が重要です。ベンチや通路にも、車いすやベビーカーを利用する人への配慮が必要になります。',
      'にぎわいは、来場者数だけでは測れません。周辺の店での買い物や、騒音、清掃の負担も合わせて確かめることで、地域に合う形を探せます。',
      'あなたが駅前に欲しいのは、移動の便利さですか。それとも、ゆっくり過ごせる居場所ですか。両方を支える工夫を考えてみましょう。'
    ] },
    { id: 'energy', category: '経済', title: '地域でつくる再生可能エネルギー。未来への投資と、いまの負担を考える', summary: '電気を使う街から、つくる街へ。地域で取り組む意味を読み解く。', date: '2026/10/26 18:00', tag: 'エネルギー', color: '#e3edf3', accent: '#327590', art: 'energy', caption: '地域で電気をつくる未来（イメージイラスト）', stances: ['導入費用と住民の納得を大切にしよう', '長い目で、地域のエネルギーに投資しよう'], paragraphs: [
      '学校や公共施設の屋根で発電し、地域で電気を使う。この記事では、太陽光発電と蓄電池の導入を検討する架空の自治体を例に、地域のエネルギーのあり方を考えます。',
      '計画の狙いは、日中につくった電気を施設で使い、余った分を蓄えることです。災害時の電源として役立てるには、停電中にも使える設備や運用の準備が必要です。',
      '前向きな立場からは、長い目で電気の調達方法を増やし、地域で使うエネルギーを自分たちで考えるきっかけになるとの期待があります。環境について学ぶ教材としての活用も考えられます。',
      '一方、設備の購入や工事には費用がかかり、設置後も点検や修理が必要です。将来の更新や廃棄まで見込まなければ、後の世代に負担を残しかねません。',
      '発電量は天候や設置場所によって変わります。いつ、どれだけ電気を使う施設なのかを調べ、設備の大きさや蓄電池の必要性を判断することが大切です。',
      '住民への説明では、導入費だけでなく、維持費、見込める効果、不確かな条件を分けて示す必要があります。複数の案を比べ、実績を公開しながら進めることが信頼につながります。',
      'いまの負担を抑えることと、未来に備えること。地域の予算を使うなら、あなたはどんな条件を大切にしますか。'
    ] }
  ];
  D.newsRepository = { async list() { return articles; } };
  function artwork(a) {
    a = { ...a, color: '#07101d', accent: a.id === 'city' ? '#b94650' : '#2767ce' };
    const scenes = {
      work: '<rect x="170" y="75" width="270" height="240" rx="12" fill="white"/><path d="M170 125h270" stroke="'+a.accent+'" stroke-width="30"/><g fill="'+a.accent+'">'+[0,1,2,3,4,5,6,7,8].map(i=>'<rect x="'+(202+i%3*76)+'" y="'+(161+Math.floor(i/3)*49)+'" width="35" height="24" rx="5" opacity="'+(i>5?'1':'.2')+'"/>').join('')+'</g><circle cx="465" cy="273" r="64" fill="'+a.accent+'"/><path d="M465 235v40l27 14" fill="none" stroke="white" stroke-width="8" stroke-linecap="round"/>',
      ai: '<rect x="134" y="92" width="350" height="213" rx="17" fill="white"/><rect x="154" y="111" width="310" height="173" rx="7" fill="'+a.accent+'"/><path d="M111 320h395l-25 18H135z" fill="'+a.accent+'"/><rect x="240" y="151" width="135" height="98" rx="24" fill="white"/><g fill="'+a.accent+'"><circle cx="278" cy="195" r="10"/><circle cx="337" cy="195" r="10"/></g><path d="M288 225h39M308 132v19" stroke="'+a.accent+'" stroke-width="7"/><circle cx="494" cy="106" r="35" fill="#c7cdee"/><path d="M480 106h28m-14-14v28" stroke="white" stroke-width="5"/>',
      city: '<path d="M230 400l53-180h74l89 180" fill="#d4baa0"/><g fill="white"><rect x="80" y="111" width="110" height="181"/><rect x="420" y="85" width="110" height="207"/></g><path d="M99 145h72m-72 35h72m-72 35h72m268-85h72m-72 35h72m-72 35h72" stroke="'+a.accent+'" stroke-width="12" opacity=".5"/><path d="M205 290v-88m207 88v-88" stroke="'+a.accent+'" stroke-width="12"/><g fill="'+a.accent+'"><circle cx="205" cy="176" r="47"/><circle cx="412" cy="176" r="47"/></g><path d="M269 295h76m-66 21v18m55-18v18" stroke="#6e5746" stroke-width="10"/>',
      energy: '<circle cx="450" cy="99" r="44" fill="#edc66b"/><path d="M0 310q160-110 320 0t320-10v100H0" fill="#adcdbe"/><path d="M101 279l26-115h242l-26 115z" fill="'+a.accent+'"/><path d="M145 220h207m-151-55-26 114m104-114-26 114" stroke="#c9e3eb" stroke-width="5"/><path d="M164 279v34m128-34v34M459 175v143m0-143-48-30m48 30 50-31m-50 31v-55" stroke="white" stroke-width="10" stroke-linecap="round"/>'
    };
    const scene = scenes[a.art].replaceAll('fill="white"', 'fill="#b9c9df"').replaceAll('#c7cdee', '#293e65').replaceAll('#d4baa0', '#28334a').replaceAll('#6e5746', '#93a5bd').replaceAll('#adcdbe', '#1b3542');
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><defs><radialGradient id="glow"><stop stop-color="'+a.accent+'" stop-opacity=".2"/><stop offset="1" stop-color="'+a.color+'" stop-opacity="0"/></radialGradient></defs><rect width="640" height="400" fill="'+a.color+'"/><ellipse cx="250" cy="160" rx="400" ry="280" fill="url(#glow)"/>'+scene+'</svg>');
  }
  const escape = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  global.addEventListener('DOMContentLoaded', async () => {
    const items = await D.newsRepository.list();
    const content = document.getElementById('news-content');
    const screen = document.getElementById('news-screen');
    const back = document.getElementById('news-back');
    const bar = document.getElementById('news-battle-bar');
    const returnBtn = document.getElementById('return-to-news');
    let finishCutin = null;
    let enteringBattle = false;
    function showBattleCutin(article) {
      return new Promise(resolve => {
        const overlay = document.createElement('section');
        overlay.className = 'news-versus-cutin';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'MCバトル 対立するふたつの立場');
        const portrait = reina => '<div class="cutin-portrait '+(reina?'portrait-reina':'portrait-kenta')+'" aria-hidden="true"></div>';
        const stanceHtml = index => escape(article.stances[index]);
        overlay.innerHTML = '<div class="cutin-topic"><span>NEWS MC BATTLE</span><h2>'+escape(article.title)+'</h2></div><div class="cutin-matchup"><div class="cutin-side cutin-kenta"><div class="cutin-stance"><span>立場 A / MC KENTA</span><h3>'+stanceHtml(0)+'</h3></div>'+portrait(false)+'</div><div class="cutin-side cutin-reina"><div class="cutin-stance"><span>立場 B / MC REINA</span><h3>'+stanceHtml(1)+'</h3></div>'+portrait(true)+'</div><button type="button" class="cutin-vs" aria-label="VSを押してMCバトル開始"><span class="cutin-vs-letters">VS</span><span class="cutin-vs-hint">タップしてバトル開始</span></button></div>';
        document.body.appendChild(overlay);
        screen.inert = true;
        const startButton = overlay.querySelector('button');
        startButton.focus({preventScroll:true});

        const onKey = event => { if (event.key === 'Escape') { finish(false); document.getElementById('news-start-battle').focus({preventScroll:true}); } };
        let launchTimer;
        const finish = proceed => {
          clearTimeout(launchTimer);

          document.removeEventListener('keydown', onKey);
          overlay.remove(); screen.inert = false; finishCutin = null;
          resolve(proceed);
        };
        finishCutin = finish;
        startButton.addEventListener('click', () => {
          startButton.disabled = true;
          overlay.classList.add('cutin-launching');
          const reducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
          launchTimer = setTimeout(() => finish(true), reducedMotion ? 0 : 520);
        }, {once:true});
        document.addEventListener('keydown', onKey);

      });
    }
    let category = '主要', selected = null, listScroll = 0, articleScroll = 0;
    const meta = a => '<span class="news-category">'+a.category+'</span><span>'+a.date+'</span>';
    function list() {
      selected = null; back.hidden = true; bar.hidden = true;
      const filtered = items.filter(a => category === '主要' || a.category === category);
      content.innerHTML = '<nav class="news-tabs" aria-label="ニュースのカテゴリー">'+['主要','経済','テクノロジー','働き方','暮らし'].map(c=>'<button type="button" data-category="'+c+'" aria-pressed="'+(category===c)+'" class="'+(category===c?'active':'')+'">'+c+'</button>').join('')+'</nav><div class="news-section-label"><h2>注目ニュース</h2><span>編集部セレクト</span></div><p class="news-sample-note">体験用のオリジナル記事です。実際の報道ではありません。</p><div class="news-grid">'+filtered.map((a,i)=>'<button type="button" class="news-card '+(i===0?'news-featured':'')+'" data-article="'+a.id+'"><img src="'+artwork(a)+'" alt="'+a.caption+'"/><div class="news-card-copy"><div class="news-meta">'+meta(a)+'</div><h3>'+a.title+'</h3><p>'+a.summary+'</p><div class="news-card-bottom"><span>#'+a.tag+'</span><span>記事を読む ↗</span></div></div></button>').join('')+'</div><p class="news-bottom-note">ひとつのニュースに、ひとつじゃない見方を。<br><b>DOPA<span>NEWS</span></b></p>';
    }
    function detail(a) {
      selected = a; back.hidden = false; bar.hidden = false;
      content.innerHTML = '<article class="news-article"><div class="news-meta"><span class="news-category">'+a.category+'</span><span>サンプル記事</span><span>約3分で読めます</span></div><h1 tabindex="-1">'+a.title+'</h1><div class="news-byline"><span>DOPANEWS 編集部</span><time datetime="'+a.date.replaceAll('/','-').replace(' ','T')+'+09:00">'+a.date+'</time></div><figure><img src="'+artwork(a)+'" alt="'+a.caption+'"/><figcaption>'+a.caption+'</figcaption></figure><p class="news-disclaimer">この記事は体験用に作成した架空のサンプルです。実在の報道・発表ではありません。</p><div class="news-article-body">'+a.paragraphs.map(p=>'<p>'+escape(p)+'</p>').join('')+'</div><aside class="news-perspectives"><span class="news-eyebrow">TWO SIDES, ONE TOPIC</span><h2>このニュース、あなたはどう考える？</h2><p><b>KENTA</b>'+a.stances[0]+'</p><p><b>REINA</b>'+a.stances[1]+'</p></aside><p class="news-end">ここまで読んだら、次はふたつの視点を聴いてみよう。</p></article>';
      screen.scrollTop = 0; content.querySelector('h1').focus({preventScroll:true});
    }
    content.addEventListener('click', e => {
      const tab = e.target.closest('[data-category]');
      if (tab) { category = tab.dataset.category; list(); return; }
      const card = e.target.closest('[data-article]');
      if (card) { listScroll = screen.scrollTop; location.hash = 'news/'+card.dataset.article; }
    });
    function route() {
      if (finishCutin) finishCutin(false);
      const a = items.find(a => '#news/'+a.id === location.hash);
      if (a) detail(a); else { list(); screen.scrollTop = listScroll; }
    }
    global.addEventListener('hashchange', route);
    back.addEventListener('click', () => { location.hash = ''; });
    document.getElementById('news-start-battle').addEventListener('click', async () => {
      const app = global.dopaNewsApp;
      if (!selected || app.isGenerating || enteringBattle) return;
      enteringBattle = true;
      articleScroll = screen.scrollTop;
      const a = selected;
      // Initialize audio within the original user gesture before the animation delay.
      app.audioController._ensureAudioContext();
      const proceed = await showBattleCutin(a);
      enteringBattle = false;
      if (!proceed) return;
      app._stopCurrentBattle();
      app.newsUrlInputEl.value = ''; app.lastFetchedUrl = '';
      app.articleInputEl.value = a.title+'\n\n'+a.paragraphs.join('\n\n');
      app.currentArticleText = app.articleInputEl.value;
      app.currentSynthDuration = 64;
      const lines = a.stances.map((stance,i) => [stance, i ? '選べる未来を ここから描こう' : 'その理想の前に 現場を見よう', a.summary, i ? '期待だけじゃない 課題も確かめる' : 'その負担は誰が 引き受ける', a.paragraphs[i+2].split('。')[0], i ? '小さく試して 改善重ねよう' : '取り残される声にも 応えよう', '違う視点を 重ねてみよう', 'このニュースから 明日を考えよう']);
      app._applyBattleData(D.normalizeBattleData({title:a.title, topic_summary:'サンプル台本｜'+a.summary, kenta_stance:a.stances[0], reina_stance:a.stances[1], verses:[0,1,0,1].map((n,i)=>({speaker:n?'REINA':'KENTA',lyric:(i<2?lines[n]:[...lines[n].slice(4),...lines[n].slice(0,4)]).join('\n'),point_summary:a.stances[n],rhyme_words:'未来 × 期待 / 視点 × 起点',start_time_sec:i*16}))}));
      document.body.classList.remove('news-mode'); returnBtn.hidden = false;
      returnBtn.focus({preventScroll:true});
      app._setStepState(3); app._setLog('選択した記事のサンプル台本とデモビートを再生中です（音声ラップはAPI連携後に生成できます）。');
      app.audioController.startSynthBattle(64);
    });
    returnBtn.addEventListener('click', () => {
      if (global.dopaNewsApp.isGenerating) return;
      global.dopaNewsApp._stopCurrentBattle();
      document.body.classList.add('news-mode'); returnBtn.hidden = true; screen.scrollTop = articleScroll;
    });
    route();
  });
})(window);
