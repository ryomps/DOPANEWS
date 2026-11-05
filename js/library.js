/* Consumer library: saved audio plus the listener's own vote. */
(function (global) {
  global.addEventListener('DOMContentLoaded', () => {
    const D = global.DOPANEWS;
    const app = global.dopaNewsApp;
    const screen = document.getElementById('library-screen');
    const cards = document.getElementById('library-cards');
    const feedback = document.getElementById('library-feedback');
    const newsNav = document.querySelector('.app-nav-news');
    const libraryNav = document.querySelector('.app-nav-library');
    const genres = ['テクノロジー','政治','経済','スポーツ','自然','エンタメ','恋愛','その他'];
    let entries = [], filter = 'すべて', version = 0, fromLibrary = false;
    let newsArticles = [];
    const newsScreen = document.getElementById('news-screen');
    // Keep headers outside the scrolling regions so scrollbars start below them.
    [newsScreen, screen].forEach(container => {
      const header = container.querySelector('.news-header');
      header.classList.add('consumer-fixed-header', container === screen ? 'library-fixed-header' : 'news-fixed-header');
      document.body.append(header);
    });
    let lastNews = { hash: '', scrollTop: 0 }, pendingNewsRestore = false;
    function rememberNews(hash = location.hash) {
      if (document.body.classList.contains('library-mode') || fromLibrary || hash === '#library') return;
      const inBattle = !document.body.classList.contains('news-mode');
      lastNews = { hash, scrollTop: newsScreen.scrollTop, inBattle };
      if (inBattle) {
        const fields = ['currentBattleData','currentArticleText','currentSavedId','currentAudioUrl','currentAudioWavBase64','currentSynthDuration','currentMurekaTrack','currentReviews'];
        lastNews.battle = {
          fields: Object.fromEntries(fields.map(key => [key, app[key]])),
          time: app.audioController.getCurrentTime(),
          synth: app.audioController.usingSynthFallback,
          duration: app.audioController.synthDuration,
          displayDuration: app.stageView.lastKnownDuration,
          source: app.audioEl.getAttribute('src'),
          introOffset: app.stageView.manualIntroOffsetSec,
          lyricScroll: app.stageView.lyricBoxEl.scrollTop,
          centerScroll: document.querySelector('.stage-center').scrollTop
        };
      }
    }
    function restoreBattle() {
      const battle = lastNews.battle;
      let waitingForMetadata = false;
      // Library browsing only pauses audio; avoid loading it again unless another battle replaced it.
      if (app.currentBattleData !== battle.fields.currentBattleData || app.audioEl.getAttribute('src') !== battle.source || app.audioController.usingSynthFallback !== battle.synth) {
        app._stopCurrentBattle();
        Object.assign(app, battle.fields);
        app.articleInputEl.value = app.currentArticleText || '';
        app._applyBattleData(app.currentBattleData);
        app.audioController.usingSynthFallback = battle.synth;
        if (battle.synth) {
          app.audioController.synthDuration = battle.duration;
          app.audioController.synthPausedAt = battle.time;
        } else if (battle.source) {
          waitingForMetadata = true;
          app.audioEl.addEventListener('loadedmetadata', () => {
            if (app.currentBattleData === battle.fields.currentBattleData && app.audioEl.getAttribute('src') === battle.source) app.audioController.seekTo(battle.time);
          }, { once: true });
          app.audioEl.src = battle.source;
          app.audioEl.load();
        }
      }
      app.stageView.manualIntroOffsetSec = battle.introOffset;
      if (!waitingForMetadata) app.audioController.seekTo(battle.time);
      app.stageView.syncTime(battle.time, battle.displayDuration);
      app.stageView.setPlaybackState(false);
      document.body.classList.remove('news-mode');
      document.getElementById('return-to-news').hidden = false;
    }
    function restoreNewsScroll() {
      pendingNewsRestore = false;
      if (lastNews.inBattle) restoreBattle();
      requestAnimationFrame(() => {
        if (lastNews.inBattle) {
          app.stageView.lyricBoxEl.scrollTop = lastNews.battle.lyricScroll;
          document.querySelector('.stage-center').scrollTop = lastNews.battle.centerScroll;
        } else newsScreen.scrollTop = lastNews.scrollTop;
      });
    }
    const node = (tag, text, className) => {
      const el = document.createElement(tag);
      if (text !== undefined) el.textContent = text;
      if (className) el.className = className;
      return el;
    };
    const formatDate = value => {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toLocaleDateString('ja-JP') : '';
    };
    function selection(active) {
      newsNav.setAttribute('aria-current', active ? 'false' : 'page');
      libraryNav.setAttribute('aria-current', active ? 'page' : 'false');
    }
    // All saved-track entry points share the same screen and return destination.
    function openBattle() {
      if (document.body.classList.contains('library-mode') || location.hash === '#library') fromLibrary = true;
      version++; // Invalidate a library refresh that may still be in flight.
      screen.hidden = true;
      document.body.classList.remove('library-mode', 'news-mode');
      document.getElementById('return-to-news').hidden = false;
      selection(fromLibrary);
    }
    D.libraryNavigation = { openBattle };
    function empty(message) {
      const panel = node('div', undefined, 'library-empty');
      panel.append(node('span', '◇', 'library-empty-icon'), node('h2', message), node('p', 'ニュースからバトルを作って、あなたの意見を残してみよう。'));
      const button = node('button', 'ニュースを探す →'); button.type = 'button';
      button.addEventListener('click', goNews); panel.append(button); cards.append(panel);
    }
    function render() {
      cards.replaceChildren();
      const shown = entries.filter(entry => filter === 'すべて' || entry.category === filter);
      feedback.textContent = `${filter} · ${shown.length}件のバトル`;
      if (!shown.length) { empty(filter === 'すべて' ? 'バトルはまだありません' : `${filter}のバトルはまだありません`); return; }
      shown.forEach(entry => {
        const data = entry.battleData;
        const card = node('article', undefined, 'library-card');
        const top = node('div', undefined, 'library-card-heading');
        const original = newsArticles.find(article => data.title.includes(article.title) || String(entry.articleText || '').includes(article.title));
        const picture = node('img');
        picture.src = D.newsArtwork(original || { category: entry.category, art: entry.category === '経済' ? 'energy' : entry.category === 'テクノロジー' ? 'ai' : 'people' });
        picture.alt = original?.caption || 'ニュース記事のイメージイラスト'; picture.loading = 'lazy';
        const heading = node('div');
        heading.append(node('span', entry.category, 'library-genre-label'), node('time', formatDate(entry.createdAt || entry.vote?.votedAt)), node('h2', data.title));
        top.append(picture, heading); card.append(top);
        const voted = entry.vote;
        const vote = node('div', undefined, 'library-vote');
        vote.dataset.choice = voted?.choice || 'NONE';
        vote.append(node('span', 'あなたの投票', 'library-vote-label'), node('strong', voted ? (voted.choice === 'UNDECIDED' ? 'どちらともいえない' : (D.getMcName?.(voted.choice, data) || voted.choice) + ' に共感') : '未投票'));
        if (voted) {
          const stance = voted.choice === 'KENTA' ? data.kenta_stance : voted.choice === 'REINA' ? data.reina_stance : '';
          if (stance) vote.append(node('p', stance));
          vote.append(node('small', '投票日 ' + formatDate(voted.votedAt)));
        }
        card.append(vote);
        const bottom = node('div', undefined, 'library-card-actions');
        bottom.append(node('span', entry.saved ? (entry.audioUrl ? '音声保存済み' : '歌詞＋内蔵ビート') : '音声は未保存'));
        if (data.verses?.length) {
          const play = node('button', 'MCバトル'); play.type = 'button';
          play.addEventListener('click', async () => {
            if (app.isGenerating) return;
            play.disabled = true;
            try { await app._playSavedBattle(entry); }
            catch { await showLibrary(); feedback.textContent = '再生できませんでした。もう一度お試しください。'; }
            finally { play.disabled = false; }
          });
          bottom.append(play);
        }
        card.append(bottom); cards.append(card);
      });
    }
    async function showLibrary() {
      if (app.isGenerating) return;
      const token = ++version;
      app.audioController.pause(); app.judgeModal.close();
      document.body.classList.add('news-mode', 'library-mode');
      screen.hidden = false; fromLibrary = false; selection(true);
      document.getElementById('return-to-news').hidden = true;
      feedback.textContent = '保存したバトルを読み込んでいます…'; cards.replaceChildren();
      const votes = D.readBattleVotes();
      newsArticles = await D.newsRepository.list();
      let saved = [], failed = false;
      try { saved = (await D.listSavedBattles()).items || []; }
      catch { failed = true; }
      if (token !== version || !document.body.classList.contains('library-mode')) return;
      const matched = new Set();
      entries = saved.map(item => {
        const key = D.battleReflectionKey(item.battleData); matched.add(key);
        return { ...item, saved: true, vote: votes.find(v => v.key === key) };
      });
      const bundled = [D.FIXED_DEMO, D.FOOD_DEMO, ...Object.values(D.completedNewsBattles || {})].filter(Boolean);
      votes.filter(v => !matched.has(v.key)).forEach(v => {
        const recording = bundled.find(item => D.battleReflectionKey(item.battleData) === v.key);
        entries.push({ ...recording, battleData: v.battleData, audioUrl: v.audioUrl || recording?.audioUrl,
          articleText: v.articleText || recording?.articleText, synthDuration: v.synthDuration || recording?.synthDuration,
          vote: v, createdAt: v.votedAt, saved: Boolean(v.audioUrl || recording?.audioUrl) });
      });
      entries.forEach(entry => {
        const category = entry.category || entry.battleData.category;
        const inferred = D.getNewsCategory?.(entry.articleText || entry.battleData.title) || 'その他';
        entry.category = genres.includes(category) && category !== 'その他' ? category : inferred;
      });
      entries.sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      renderGenres();
      render();
      if (failed) feedback.textContent = '保存音声を読み込めませんでした。サーバーを確認して、フッターのLibraryを押し直してください。';
    }
    function goNews() {
      if (app.isGenerating) return;
      const switchingTab = document.body.classList.contains('library-mode') || fromLibrary || location.hash === '#library';
      const returningFromBattle = !document.body.classList.contains('news-mode');
      version++; fromLibrary = false;
      app.audioController.pause(); app.judgeModal.close();
      screen.hidden = true;
      document.body.classList.remove('library-mode'); document.body.classList.add('news-mode');
      selection(false); document.getElementById('return-to-news').hidden = true;
      if (switchingTab) {
        pendingNewsRestore = true;
        if (location.hash === lastNews.hash) restoreNewsScroll();
        else location.hash = lastNews.hash;
      } else if (returningFromBattle) {
        document.getElementById('return-to-news').click();
      } else {
        D.newsNavigation?.back();
      }
    }
    newsNav.addEventListener('click', goNews);
    libraryNav.addEventListener('click', () => {
      if (app.isGenerating) return;
      rememberNews();
      if (location.hash === '#library') showLibrary(); else location.hash = 'library';
    });
    function renderGenres() {
      const nav = document.getElementById('library-genres');
      const scroll = nav.scrollLeft;
      nav.replaceChildren();
      ['すべて', ...genres].forEach(genre => {
        const button = node('button', genre); button.type = 'button';
        button.style.setProperty('--genre-color', genre === 'すべて' ? '#edf2fa' : D.newsGenreColors?.[genre] || '#94a3b8');
        button.setAttribute('aria-pressed', String(filter === genre));
        button.addEventListener('click', () => {
          filter = genre;
          nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
          render();
        });
        nav.append(button);
      });
      nav.scrollLeft = scroll;
    }
    document.getElementById('return-to-news').addEventListener('click', () => {
      if (fromLibrary && !app.isGenerating) showLibrary();
    });
    global.addEventListener('hashchange', event => {
      if (location.hash === '#library') {
        if (event.oldURL) rememberNews(new URL(event.oldURL).hash);
        showLibrary();
      } else {
        const leavingLibrary = document.body.classList.contains('library-mode');
        version++; screen.hidden = true; document.body.classList.remove('library-mode'); selection(false);
        if (pendingNewsRestore || (leavingLibrary && location.hash === lastNews.hash)) restoreNewsScroll();
      }
    });
    document.getElementById('dev-show-battle')?.addEventListener('click', () => { screen.hidden = true; document.body.classList.remove('library-mode'); });
    document.getElementById('dev-show-news')?.addEventListener('click', goNews);
    if (location.hash === '#library') showLibrary(); else selection(false);
  });
})(window);
