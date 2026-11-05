/* Live headlines and source-backed local news. No paid requests on page load. */
(function (global) {
  const D = global.DOPANEWS;
  const imageRequests = new Map();
  const imageQueue = []; let activeImages = 0;
  function pumpImages() {
    while (activeImages < 3 && imageQueue.length) {
      const job = imageQueue.shift(); activeImages++;
      request('/api/news/images/' + job.id).catch(() => ({imageUrl:null})).then(job.resolve).finally(() => { activeImages--; pumpImages(); });
    }
  }
  function sourceImage(image, id, onLoaded) {
    const fallback = image.src;
    image.referrerPolicy = 'no-referrer';
    const load = () => {
      if (!imageRequests.has(id)) imageRequests.set(id, new Promise(resolve => { imageQueue.push({id,resolve}); pumpImages(); }));
      imageRequests.get(id).then(result => {
        let url; try { url = new URL(result.imageUrl); } catch { return; }
        if (url.protocol !== 'https:' || !/(^|\.)(yimg\.jp|yimg\.com|yahoo\.co\.jp)$/.test(url.hostname)) return;
        image.onerror = () => { image.onerror = null; image.src = fallback; };
        image.onload = () => { image.onload = null; image.alt = '配信元記事の画像'; onLoaded?.(); };
        image.src = url.href;
      });
    };
    if (!('IntersectionObserver' in global)) { load(); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
      else if (!image.isConnected) observer.disconnect();
    }, {rootMargin:'150px'});
    observer.observe(image);
  }
  async function request(url, body) {
    let response;
    try { response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw Object.assign(new Error('サーバーに接続できません。接続を確認してください。'), { code: 'NEWS_NETWORK' }); }
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(response.status === 404 ? 'ニュース取得に対応したサーバーを再起動してください。' : data.error || 'ニュースを読み込めませんでした。'), { code: data.code || (response.status === 404 ? 'NEWS_SERVER_OLD' : 'NEWS_GENERATION_FAILED') });
    return data;
  }
  // Keep this text-only: titles, facts and model output are all untrusted input.
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function link(label, url) {
    const a = el('a', label);
    try { const u = new URL(url); if (u.protocol !== 'https:') return el('span', label); a.href = u.href; }
    catch { return el('span', label); }
    a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  function button(text, action) {
    const b = el('button', text); b.type = 'button'; b.addEventListener('click', action); return b;
  }
  function date(value) { return value ? new Date(value).toLocaleString('ja-JP') : '未取得'; }
  global.addEventListener('DOMContentLoaded', () => {
    const mount = document.getElementById('news-live-panel');
    const curated = document.getElementById('news-content');
    let data, busy = false, current = null, version = 0;
    let articleBattleBar = null;

    const status = el('p', '見出しを取得中…', 'live-news-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const controls = el('div', undefined, 'live-news-actions');
    const body = el('div');
    const budgetStatus = el('p', '', 'live-news-note');
    const refresh = button('一覧を更新', load);
    controls.append(refresh);
    mount.append(status, body);
    const developer = el('section', undefined, 'panel-section');
    developer.append(el('h2', 'ニュース取得', 'section-title'), controls, budgetStatus);
    document.getElementById('control-drawer').append(developer);
    function showUsage(usage) {
      if (!usage) return;
      budgetStatus.textContent = `OpenAI検索${usage.configured ? '' : '（APIキー未設定）'}：開発中は回数上限なし。本日 ${usage.usedToday}回。失敗・タイムアウトも記録します。自動再検索は行いません。`;
    }
    function lock(on) {
      busy = on;
      mount.setAttribute('aria-busy', String(on));
      mount.querySelectorAll('button').forEach(b => { b.disabled = on; });
      curated.querySelectorAll('.live-feed-card').forEach(b => { b.disabled = on; });
      refresh.disabled = on;
    }
    async function load() {
      if (busy) return;
      const token = ++version; lock(true); status.textContent = '見出しを取得中…';
      try {
        data = await request('/api/news');
        showUsage(data.searchUsage);
        if (version !== token) return;
        current = null; renderList();
        const h = data.headlines;
        status.textContent = `${h.items.length}件 ／ 取得：${date(h.fetchedAt)}${h.stale ? ' ／ 更新失敗：保存済みの見出しです' : ''}${h.errors.length && !h.stale ? ' ／ 一部カテゴリを取得できませんでした' : ''}`;
      } catch (e) { status.textContent = e.message; }
      finally {
        lock(false);
        D.newsFeedStatus = status.textContent;
        D.newsNavigation?.refresh();
      }
    }
    function topicGenre(topic) {
      const title = topic?.title || topic?.article?.title || '';
      if (/選挙|開票|当選|落選|上院|下院|大統領|首相|総理|政権|国会|閣僚|衆院|参院|知事|市長|外交|防衛|停戦|トランプ|民主|共和/.test(title)) return '政治';
      if (/野球|サッカー|スポーツ|五輪|オリンピック|選手|球団|監督|優勝|決勝|大谷|プロ野球|FA行使|相撲|テニス|ゴルフ|W杯|リーグ|巨人|中日|阪神|開幕戦/.test(title)) return 'スポーツ';
      if (/動物|野生|生物|生態|水族館|動物園|ラッコ|パンダ|ペンギン|イルカ|クジラ|ウナギ|天気|天候|気象|気温|猛暑|寒波|台風|大雨|豪雨|降雪|積雪|梅雨|桜の開花/.test(title)) return '自然';
      if (/芸能|俳優|女優|歌手|アイドル|映画|ドラマ|アニメ|漫画|ライブ|紅白|お笑い|タレント|声優/.test(title)) return 'エンタメ';
      if (/結婚|離婚|婚活|恋愛|交際|出会い|夫婦/.test(title)) return '恋愛';
      if (topic?.feed === 'business') return '経済';
      if (/株価|日経平均|円安|円高|物価|賃金|企業|決算|銀行|経済|景気|税|食品ロス|値上げ|自販機/.test(title)) return '経済';
      if (topic?.feed === 'science') return 'テクノロジー';
      if (/生成AI|人工知能|AI|IT|半導体|ロボット|アプリ|SNS|ネット|宇宙|研究|技術|システム/.test(title)) return 'テクノロジー';
      return 'その他';
    }
    D.appendLiveNewsCards = (list, category, searchQuery = '') => {
      if (!data) return 0;
      const topics = data.headlines.items.map(topic => ({ ...topic, saved: data.articles.find(a => a.id === topic.id) }));
      const ids = new Set(topics.map(t => t.id));
      data.articles.filter(a => !ids.has(a.id)).forEach(saved => topics.push({ ...saved, saved, provider: 'ドパNEWS', publishedAt: saved.createdAt }));
      // Editorial top picks stay first, independently of their content genre.
      topics.sort((a, b) => Number(b.feed === 'top-picks') - Number(a.feed === 'top-picks'));
      const filtered = topics.filter(topic => (category === 'トップ' || topicGenre(topic) === category)
        && D.matchesNewsSearch({ ...topic, category: topicGenre(topic) }, searchQuery));
      const anchor = list.firstChild;
      filtered.forEach(topic => {
        const genre = topicGenre(topic);
        const color = D.newsGenreColors[genre] || '#94a3b8';
        const row = el('div', undefined, 'live-feed-item');
        row.dataset.genre = genre;
        if (topic.feed === 'top-picks') row.dataset.topPick = 'true';
        const feedback = feedbackBox();
        const action = button('', () => open(topic.id, !topic.saved, false, feedback, action));
        action.className = 'news-card live-feed-card';
        action.title = topic.saved ? '保存した記事を開く' : '初回はOpenAIを使用して記事を作成します';
        action.style.setProperty('--genre-color', color);
        action.disabled = busy;
        const image = el('img');
        image.src = D.newsArtwork({ category: genre, art: genre === '経済' ? 'energy' : genre === 'テクノロジー' ? 'ai' : 'people' });
        image.alt = 'ジャンルのイメージイラスト'; image.loading = 'lazy';
        sourceImage(image, topic.id);
        const copy = el('div', undefined, 'news-card-copy');
        const meta = el('div', undefined, 'news-meta');
        const badge = el('span', genre === 'トップ' ? '話題' : genre, 'news-category');
        meta.append(badge);
        if (topic.feed === 'top-picks') meta.append(el('span', '注目', 'news-pick-label'));
        meta.append(el('span', date(topic.publishedAt)));
        const bottom = el('div', undefined, 'news-card-bottom');
        bottom.append(el('span', topic.provider || 'ドパNEWS'), el('span', topic.saved?.status === 'ready' ? '保存済み記事' : '記事を作成', 'live-card-action'));
        copy.append(meta, el('h3', topic.title), bottom);
        action.append(image, copy); row.append(action, feedback);
        list.insertBefore(row, anchor);
      });
      return filtered.length;
    };
    function renderList() {
      articleBattleBar?.remove(); articleBattleBar = null;
      body.replaceChildren(); current = null;
      mount.hidden = true; curated.hidden = false;
      if (!location.hash.startsWith('#news/')) document.getElementById('news-back').hidden = true;
      D.newsNavigation?.refresh();
    }
    function feedbackBox() {
      const box = el('div', undefined, 'live-news-feedback'); box.hidden = true;
      box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
      return box;
    }
    function showFeedback(box, message, code = '') {
      if (!box) { status.textContent = message; return; }
      box.hidden = false; box.dataset.state = code ? 'error' : 'working';
      box.replaceChildren(el('p', message));
      if (code === 'NEWS_QUOTA_LIMIT') box.append(link('OpenAIの利用状況を確認 ↗', 'https://ai.dev/rate-limit'));
      if (code === 'OPENAI_QUOTA_LIMIT') box.append(link('OpenAIの利用状況を確認 ↗', 'https://platform.openai.com/usage'));
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function failureMessage(code) {
      const messages = {
        OPENAI_AUTH: 'OpenAIのAPIキー・プロジェクトの利用権限をローカル設定で確認してください。',
        OPENAI_QUOTA_LIMIT: 'OpenAIの利用枠または残高を確認してください。自動で再試行しません。',
        OPENAI_BUDGET_INVALID: '検索回数の記録を確認できないため停止しました。ローカル設定・保存データを確認してください。',
        OPENAI_CONNECTION: 'OpenAI検索との接続が完了しませんでした。失敗も回数に含めます。再検索はボタン操作時のみ行います。',
        OPENAI_PROVIDER: 'OpenAI検索を完了できませんでした。APIの利用条件・対応モデルを確認してください。',
        NEWS_QUOTA_LIMIT: 'OpenAIの利用上限に達しています。利用状況・APIキーのプロジェクト設定を確認してください。',
        NEWS_AUTH: 'OpenAIのAPIキーまたはプロジェクトの利用権限を確認してください。',
        NEWS_SOURCES: '検索先の本文を取得できませんでした。「別の情報源で再検索」から探し直せます。',
        NEWS_FORMAT: '記事データの形式を確認できませんでした。音源は生成していません。',
        NEWS_EVIDENCE: '取得本文で記事の根拠を確認できませんでした。音源は生成していません。',
        NEWS_SEARCH: 'この話題の根拠資料を検索で確認できませんでした。別の話題を選ぶか、時間をおいてもう一度お試しください。',
        NEWS_PROVIDER: 'OpenAIに接続できませんでした。時間をおいてもう一度お試しください。',
        NEWS_UNAVAILABLE: 'OpenAIが一時的に利用できません（503）。時間をおいてから再度操作してください。自動で再試行しません。',
        NEWS_NETWORK: 'サーバーに接続できません。サーバーの起動と接続を確認してください。',
        NEWS_SERVER_OLD: 'ニュース取得に対応したサーバーを再起動してください。',
        NEWS_BUSY: '別の記事を作成中です。完了後に操作してください。',
        NEWS_TOPIC: '話題の一覧を更新してから、もう一度選んでください。'
      };
      return messages[code] || '記事の作成を完了できませんでした。別の話題を選ぶか、時間をおいてもう一度お試しください。';
    }
    async function open(id, generate, retry = false, feedback = null, action = null, refreshSearch = false) {
      if (busy || global.dopaNewsApp?.isGenerating) return;
      const token = ++version; lock(true);
      const labelTarget = action?.querySelector('.live-card-action') || action;
      const label = labelTarget?.textContent;
      if (labelTarget) labelTarget.textContent = generate ? '作成中…' : '読み込み中…';
      showFeedback(feedback, generate ? 'この記事を作成しています。完了まで数分かかる場合があります。' : '保存した記事を読み込み中…');
      try {
        const record = await request(generate ? '/api/news/generate' : `/api/news/articles/${id}`, generate ? { topicId: id, retry, refreshSearch } : undefined);
        if (version !== token) return;
        data.articles = [{ id: record.id, title: record.article.title, createdAt: record.createdAt, status: record.status }, ...data.articles.filter(a => a.id !== record.id)];
        if (record.status !== 'ready') {
          showFeedback(feedback, '必要な情報がそろわず、この記事の作成を完了できませんでした。別の話題を選ぶか、作り直してください。', 'NEWS_GENERATION_FAILED');
          if (feedback) feedback.append(button('記事を作り直す', event => open(id, true, true, feedback, event.currentTarget)));
          return;
        }
        current = record;
        renderArticle(record);
        status.textContent = '記事ができました。';
      } catch (e) {
        showFeedback(feedback, failureMessage(e.code), e.code || 'NEWS_GENERATION_FAILED');
        if (feedback && ['NEWS_SOURCES', 'NEWS_SEARCH'].includes(e.code)) feedback.append(button('別の情報源で再検索（OpenAIを使用）', event => open(id, true, retry, feedback, event.currentTarget, true)));
      }
      finally {
        lock(false); if (labelTarget?.isConnected) labelTarget.textContent = label;
        try { const usage = await request('/api/news/search-usage'); if (token === version) showUsage(usage); } catch { /* Preserve the article's result message. */ }
      }
    }
    function renderArticle(record) {
      document.getElementById('news-screen').dataset.view = 'article';
      articleBattleBar?.remove(); articleBattleBar = null;
      body.replaceChildren();
      mount.hidden = false; curated.hidden = true;
      document.getElementById('news-back').hidden = false;
      const a = record.article;

      const genre = topicGenre(data.headlines.items.find(topic => topic.id === record.id));
      const article = el('article', undefined, 'news-article live-generated-article');
      article.style.setProperty('--genre-color', D.newsGenreColors[genre] || '#94a3b8');
      const meta = el('div', undefined, 'news-meta');
      meta.append(el('span', genre === 'トップ' ? '話題' : genre, 'news-category'), el('span', '資料に基づく解説'));
      const byline = el('div', undefined, 'news-byline');
      byline.append(el('span', 'ドパNEWS 編集部'), el('time', date(record.createdAt)));
      const figure = el('figure');
      const image = el('img'); image.src = D.newsArtwork({ category: genre, art: genre === '経済' ? 'energy' : genre === 'テクノロジー' ? 'ai' : 'people' });
      image.alt = '本アプリ制作のジャンル別イメージイラスト';
      figure.append(image, el('figcaption', '本アプリ制作のイメージイラスト'));
      sourceImage(image, record.id, () => {
        const caption = figure.querySelector('figcaption'); caption.replaceChildren();
        const topic = data.headlines.items.find(item => item.id === record.id);
        caption.append(link('画像：配信元記事（Yahoo!ニュース）', topic?.url || record.topic?.url || 'https://news.yahoo.co.jp/'));
      });
      article.append(meta, el('h1', a.title), byline, figure, el('p', a.summary), el('p', record.scope, 'live-news-note'));
      a.paragraphs.forEach(p => { const section = el('p', p.text); section.append(el('small', ` 根拠：${p.factIds.join('・')}`)); article.append(section); });
      if (record.status === 'ready') {
        const start = button('MCバトル', async () => {
          const app = global.dopaNewsApp;
          if (!app || app.isGenerating || busy) return;
          if (!await D.showCharacterSelect({title:record.article.title})) return;
          await app.handleArticleBattleGeneration({ articleText: record.articleText, title: record.article.title });
        });
        articleBattleBar = el('footer', undefined, 'news-battle-bar live-article-battle-bar');
        const barContent = el('div');
        barContent.append(start);
        articleBattleBar.append(barContent);
        document.body.append(articleBattleBar);
      }
      const details = el('details'); details.append(el('summary', '事実一覧・根拠資料を確認する'));
      record.facts.forEach(f => {
        details.append(el('h4', `${f.id}：${f.statement}`), el('p', `日時：${f.when || '記載なし'} ／ 主体：${f.who || '記載なし'} ／ 数値：${f.numbers || '記載なし'}`));
        if (f.uncertainty) details.append(el('p', f.uncertainty));
        f.evidence.forEach(e => {
          const s = record.sources.find(s => s.id === e.sourceId);
          details.append(link(`${s.name}：根拠原文`, s.url), el('blockquote', e.quote));
        });
      });
      record.sources.forEach(s => { const p = el('p', `${s.name} ／ 取得 ${date(s.fetchedAt)} `); p.append(link('資料', s.url), document.createTextNode(' ／ '), link(s.discovered ? '配信元サイト' : '利用条件', s.terms)); details.append(p); });
      if (record.unresolved.length) { details.append(el('h4', '未確定事項（歌詞の事実には使いません）')); record.unresolved.forEach(text => details.append(el('p', text))); }
      record.excluded.forEach(s => { const p = el('p', `未取得：${s.reason} `); p.append(link('対象URL', s.url)); details.append(p); });
      if (record.search.provider === 'openai' && record.search.sources?.length) {
        details.append(el('h4', '検索で参照した資料'));
        record.search.sources.forEach(source => { const p = el('p'); p.append(link(source.title, source.url)); details.append(p); });
      }
      article.append(details);
      if (record.search.renderedContent) {
        const frame = el('iframe'); frame.title = 'Google検索の関連候補';
        frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
        frame.srcdoc = record.search.renderedContent; article.append(frame);
      }
      body.append(article);
      document.getElementById('news-screen').scrollTop = 0;
    }
    D.liveNewsNavigation = {
      back() {
        if (!current || mount.hidden) return false;
        renderList(); status.textContent = '話題を選んでください。';
        document.getElementById('news-screen').scrollTop = 0;
        return true;
      }
    };
    // Fixed articles retain their own detail routing. Avoid showing two articles at once.
    function route() {
      if (location.hash === '#library') return;
      const fixed = location.hash.startsWith('#news/') || location.hash === '#search';
      mount.hidden = fixed || !current; curated.hidden = !fixed && Boolean(current);
      if (articleBattleBar) articleBattleBar.hidden = fixed;
    }
    document.getElementById('news-back').addEventListener('click', event => {
      if (!current || mount.hidden) return;
      event.stopImmediatePropagation();
      renderList(); document.getElementById('news-screen').scrollTop = 0;
    }, true);
    global.addEventListener('hashchange', route); route(); load();
  });
})(window);
