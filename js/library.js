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
    let entries = [], filter = null, version = 0, fromLibrary = false;
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
    function empty(message) {
      const panel = node('div', undefined, 'library-empty');
      panel.append(node('span', '◇', 'library-empty-icon'), node('h2', message), node('p', 'ニュースからバトルを作って、あなたの意見を残してみよう。'));
      const button = node('button', 'ニュースを探す →'); button.type = 'button';
      button.addEventListener('click', goNews); panel.append(button); cards.append(panel);
    }
    function render() {
      cards.replaceChildren();
      const shown = entries.filter(entry => entry.category === filter);
      feedback.textContent = `${filter} · ${shown.length}件のバトル`;
      if (!shown.length) { empty(`${filter}のバトルはまだありません`); return; }
      shown.forEach(entry => {
        const data = entry.battleData;
        const card = node('article', undefined, 'library-card');
        const top = node('div', undefined, 'library-card-heading');
        const picture = node('img'); picture.src = './css/images/mc-faceoff.png'; picture.alt = ''; picture.loading = 'lazy';
        const heading = node('div');
        heading.append(node('span', entry.category, 'library-genre-label'), node('time', formatDate(entry.createdAt || entry.vote?.votedAt)), node('h2', data.title));
        top.append(picture, heading); card.append(top);
        const voted = entry.vote;
        const vote = node('div', undefined, 'library-vote');
        vote.dataset.choice = voted?.choice || 'NONE';
        vote.append(node('span', 'あなたの投票', 'library-vote-label'), node('strong', voted ? (voted.choice === 'UNDECIDED' ? 'どちらともいえない' : voted.choice + ' に共感') : '未投票'));
        if (voted) {
          const stance = voted.choice === 'KENTA' ? data.kenta_stance : voted.choice === 'REINA' ? data.reina_stance : '';
          if (stance) vote.append(node('p', stance));
          vote.append(node('small', '投票日 ' + formatDate(voted.votedAt)));
        }
        card.append(vote);
        const bottom = node('div', undefined, 'library-card-actions');
        bottom.append(node('span', entry.saved ? (entry.audioUrl ? '音声保存済み' : '歌詞＋デモビート') : '音声は未保存'));
        if (entry.saved) {
          const play = node('button', entry.audioUrl ? '▶ 聴き返す' : '▶ デモを聴く'); play.type = 'button';
          play.addEventListener('click', async () => {
            if (app.isGenerating) return;
            play.disabled = true; fromLibrary = true;
            screen.hidden = true;
            document.body.classList.remove('library-mode', 'news-mode');
            document.getElementById('return-to-news').hidden = false;
            selection(true);
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
      let saved = [], failed = false;
      try { saved = (await D.listSavedBattles()).items || []; }
      catch { failed = true; }
      if (token !== version || !document.body.classList.contains('library-mode')) return;
      const matched = new Set();
      entries = saved.map(item => {
        const key = D.battleReflectionKey(item.battleData); matched.add(key);
        return { ...item, saved: true, vote: votes.find(v => v.key === key) };
      });
      votes.filter(v => !matched.has(v.key)).forEach(v => entries.push({ battleData: v.battleData, vote: v, createdAt: v.votedAt, saved: false }));
      entries.forEach(entry => {
        const category = entry.category || entry.battleData.category;
        const inferred = D.getNewsCategory?.(entry.articleText || entry.battleData.title) || 'その他';
        entry.category = genres.includes(category) && category !== 'その他' ? category : inferred;
      });
      entries.sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      if (!filter) filter = genres.find(genre => entries.some(entry => entry.category === genre)) || genres[0];
      renderGenres();
      render();
      if (failed) feedback.textContent = '保存音声を読み込めませんでした。サーバーを確認して「更新」を押してください。投票はこのブラウザーの保存分を表示しています。';
    }
    function goNews() {
      if (app.isGenerating) return;
      version++; fromLibrary = false;
      app.audioController.pause(); app.judgeModal.close();
      screen.hidden = true;
      document.body.classList.remove('library-mode'); document.body.classList.add('news-mode');
      selection(false); document.getElementById('return-to-news').hidden = true;
      location.hash = '';
    }
    newsNav.addEventListener('click', goNews);
    libraryNav.addEventListener('click', () => {
      if (app.isGenerating) return;
      if (location.hash === '#library') showLibrary(); else location.hash = 'library';
    });
    document.getElementById('library-refresh').addEventListener('click', showLibrary);
    function renderGenres() {
      const nav = document.getElementById('library-genres');
      const scroll = nav.scrollLeft;
      nav.replaceChildren();
      genres.forEach(genre => {
        const button = node('button', genre); button.type = 'button';
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
    global.addEventListener('hashchange', () => {
      if (location.hash === '#library') showLibrary();
      else { version++; screen.hidden = true; document.body.classList.remove('library-mode'); selection(false); }
    });
    document.getElementById('dev-show-battle')?.addEventListener('click', () => { screen.hidden = true; document.body.classList.remove('library-mode'); });
    document.getElementById('dev-show-news')?.addEventListener('click', goNews);
    if (location.hash === '#library') showLibrary(); else selection(false);
  });
})(window);
