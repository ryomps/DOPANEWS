/* Live headlines and source-backed local news. No paid requests on page load. */
(function (global) {
  const D = global.DOPANEWS;
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
    const heading = el('h2', 'いまの話題から、ニュースを作る');
    const status = el('p', '見出しを取得中…', 'live-news-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const controls = el('div', undefined, 'live-news-actions');
    const body = el('div');
    const budgetStatus = el('p', '', 'live-news-note');
    const refresh = button('一覧を更新', load);
    controls.append(refresh);
    mount.append(heading, el('p', 'Yahoo!ニュースの公式RSSから選択。検索はOpenAI、記事の作成はGeminiを使用します。', 'live-news-note'), controls, status, budgetStatus, body);
    function showUsage(usage) {
      if (!usage) return;
      budgetStatus.textContent = `OpenAI検索${usage.configured ? '' : '（APIキー未設定）'}：本日 ${usage.usedToday}/${usage.limits.daily}回 ／ 試験累計 ${usage.usedTotal}/${usage.limits.total}回。1話題につき1回、失敗・タイムアウトも加算します。日次は日本時間0時に更新します。`;
    }
    function lock(on) {
      busy = on;
      mount.setAttribute('aria-busy', String(on));
      mount.querySelectorAll('button').forEach(b => { b.disabled = on; });
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
      finally { lock(false); }
    }
    function renderList() {
      articleBattleBar?.remove(); articleBattleBar = null;
      body.replaceChildren(); current = null;
      const note = el('p', '検索にOpenAIを最大1回、記事作成にGeminiを最大3回使用します。保存済み検索は再利用します。Murekaは記事作成では使用しません。現在の根拠資料は消費者庁・統計局・文科省のHTMLに対応しています。', 'live-news-note');
      body.append(note);
      const list = el('div', undefined, 'live-news-topics');
      for (const topic of data.headlines.items) {
        const row = el('article', undefined, 'live-news-topic');
        row.append(el('h3', topic.title), el('p', `${topic.provider} ／ 公開 ${date(topic.publishedAt)}`, 'live-news-note'), link('配信元で読む ↗', topic.url));
        const saved = data.articles.find(a => a.id === topic.id);
        const feedback = feedbackBox();
        const action = button(saved ? '保存した原稿を見る' : '根拠を調べて記事を作る', () => open(topic.id, !saved, false, feedback, action));
        row.append(action, feedback);
        list.append(row);
      }
      if (!data.headlines.items.length) list.append(el('p', '見出しを取得できません。一覧を更新して再確認できます。'));
      body.append(list);
      if (data.articles.length) {
        body.append(el('h3', 'このPCに保存したニュース'));
        const saved = el('div', undefined, 'live-news-topics');
        data.articles.forEach(a => {
          const row = el('div', undefined, 'live-news-saved');
          const feedback = feedbackBox();
          const action = button(a.status === 'ready' ? a.title : '作成を完了できなかった記事', () => open(a.id, false, false, feedback, action));
          row.append(action, feedback); saved.append(row);
        });
        body.append(saved);
      }
      const directory = el('details'); directory.append(el('summary', '情報源の対応状況（指定の8サイト）'));
      data.sources.forEach(s => { const p = el('p'); p.append(link(s.name, s.url), el('span', `：${s.description}`)); directory.append(p); });
      body.append(directory);
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
      if (code === 'NEWS_QUOTA_LIMIT') box.append(link('Geminiの利用状況を確認 ↗', 'https://ai.dev/rate-limit'));
      if (code === 'OPENAI_QUOTA_LIMIT') box.append(link('OpenAIの利用状況を確認 ↗', 'https://platform.openai.com/usage'));
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function failureMessage(code) {
      const messages = {
        OPENAI_AUTH: 'OpenAIのAPIキー・プロジェクトの利用権限をローカル設定で確認してください。',
        OPENAI_QUOTA_LIMIT: 'OpenAIの利用枠または残高を確認してください。自動で再試行しません。',
        OPENAI_DAILY_LIMIT: '本日のOpenAI検索上限5回に達しました。日本時間の翌日まで新しい検索は行いません。',
        OPENAI_TOTAL_LIMIT: '試験用のOpenAI検索上限20回に達しました。追加消費を防ぐため検索を停止しました。',
        OPENAI_TOPIC_LIMIT: 'この話題のOpenAI検索は実行済みです。追加消費を防ぐため再検索しません。別の話題を選んでください。',
        OPENAI_BUDGET_INVALID: '検索回数の記録を確認できないため停止しました。ローカル設定・保存データを確認してください。',
        OPENAI_CONNECTION: 'OpenAI検索との接続が完了しませんでした。消費の可能性があるため、この話題は再検索しません。',
        OPENAI_PROVIDER: 'OpenAI検索を完了できませんでした。APIの利用条件・対応モデルを確認してください。',
        NEWS_QUOTA_LIMIT: 'Geminiの利用上限に達しています。利用状況・APIキーのプロジェクト設定を確認してください。',
        NEWS_AUTH: 'GeminiのAPIキーまたはプロジェクトの利用権限を確認してください。',
        NEWS_SOURCES: 'この話題について、対応中の情報源から必要な資料を取得できませんでした。別の話題を選んでください。',
        NEWS_SEARCH: 'この話題の根拠資料を検索で確認できませんでした。別の話題を選ぶか、時間をおいてもう一度お試しください。',
        NEWS_PROVIDER: 'Geminiに接続できませんでした。時間をおいてもう一度お試しください。',
        NEWS_NETWORK: 'サーバーに接続できません。サーバーの起動と接続を確認してください。',
        NEWS_SERVER_OLD: 'ニュース取得に対応したサーバーを再起動してください。',
        NEWS_BUSY: '別の記事を作成中です。完了後に操作してください。',
        NEWS_TOPIC: '話題の一覧を更新してから、もう一度選んでください。'
      };
      return messages[code] || '記事の作成を完了できませんでした。別の話題を選ぶか、時間をおいてもう一度お試しください。';
    }
    async function open(id, generate, retry = false, feedback = null, action = null) {
      if (busy || global.dopaNewsApp?.isGenerating) return;
      const token = ++version; lock(true);
      const label = action?.textContent;
      if (action) action.textContent = generate ? '作成中…' : '読み込み中…';
      showFeedback(feedback, generate ? 'この記事を作成しています。完了まで数分かかる場合があります。' : '保存した記事を読み込み中…');
      try {
        const record = await request(generate ? '/api/news/generate' : `/api/news/articles/${id}`, generate ? { topicId: id, retry } : undefined);
        if (version !== token) return;
        current = record;
        data.articles = [{ id: record.id, title: record.article.title, createdAt: record.createdAt, status: record.status }, ...data.articles.filter(a => a.id !== record.id)];
        if (record.status !== 'ready') {
          showFeedback(feedback, '必要な情報がそろわず、この記事の作成を完了できませんでした。別の話題を選ぶか、作り直してください。', 'NEWS_GENERATION_FAILED');
          if (feedback) feedback.append(button('記事を作り直す', event => open(id, true, true, feedback, event.currentTarget)));
          return;
        }
        renderArticle(record);
        status.textContent = '記事ができました。';
      } catch (e) { showFeedback(feedback, failureMessage(e.code), e.code || 'NEWS_GENERATION_FAILED'); }
      finally {
        lock(false); if (action?.isConnected) action.textContent = label;
        try { const usage = await request('/api/news/search-usage'); if (token === version) showUsage(usage); } catch { /* Preserve the article's result message. */ }
      }
    }
    function renderArticle(record) {
      articleBattleBar?.remove(); articleBattleBar = null;
      body.replaceChildren();
      const a = record.article;
      body.append(button('〈 話題一覧に戻る', () => { renderList(); status.textContent = '話題を選んでください。'; }));
      const article = el('article', undefined, 'live-generated-article');
      article.append(el('h1', a.title), el('p', a.summary), el('p', `DOPANEWSが資料をもとに編集・加工 ／ 作成 ${date(record.createdAt)}`, 'live-news-note'), el('p', record.scope, 'live-news-note'));
      a.paragraphs.forEach(p => { const section = el('p', p.text); section.append(el('small', ` 根拠：${p.factIds.join('・')}`)); article.append(section); });
      if (record.status === 'ready') {
        const start = button('MCバトル', async () => {
          const app = global.dopaNewsApp;
          if (!app || app.isGenerating || busy) return;
          app.newsUrlInputEl.value = ''; app.lastFetchedUrl = '';
          app.articleInputEl.value = record.articleText;
          app.currentArticleText = record.articleText;
          document.body.classList.remove('news-mode');
          const returnBtn = document.getElementById('return-to-news'); returnBtn.hidden = false;
          app.audioController._ensureAudioContext();
          await app.handleFullBattleGeneration({ articleText: record.articleText });
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
      record.sources.forEach(s => { const p = el('p', `${s.name} ／ 取得 ${date(s.fetchedAt)} `); p.append(link('資料', s.url), document.createTextNode(' ／ '), link('利用条件', s.terms)); details.append(p); });
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
      const fixed = location.hash.startsWith('#news/');
      mount.hidden = fixed; curated.hidden = false;
      if (articleBattleBar) articleBattleBar.hidden = fixed;
    }
    global.addEventListener('hashchange', route); route(); load();
  });
})(window);
