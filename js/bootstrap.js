(function () {
  if (window.location.protocol !== 'file:') {
    // Parser-inserted scripts retain the application's DOMContentLoaded order.
    const scripts = ['types.js', 'fixed-demo.js', 'initial-news.js', 'api.js', 'audioController.js',
      'components/StageView.js', 'components/JudgeModal.js', 'app.js', 'news-search.js', 'character-select.js', 'mirror-ball.js', 'news.js', 'news-live.js', 'dev-workspace.js', 'backing-workspace.js', 'library.js'];
    document.write(scripts.map(src => '<script src="./js/' + src + '"></script>').join(''));
    return;
  }

  const destination = 'http://localhost:8080/' + window.location.hash;
  document.body.className = '';
  document.body.innerHTML = '<main style="max-width:540px;margin:12vh auto;padding:28px;color:#f5f5f5;background:#111827;border:1px solid #374151;border-radius:16px;font-family:sans-serif;line-height:1.9">'
    + '<h1 style="margin-top:0">ドパNEWS</h1>'
    + '<p id="launch-status" role="status">ローカルサーバーへの接続を確認しています…</p>'
    + '<p>サーバーが起動していない場合は、このフォルダーの <strong>start_server.bat</strong> をダブルクリックしてください。起動後、自動でドパNEWSを開きます。</p>'
    + '<p><a id="launch-link" style="color:#93c5fd">ドパNEWSを開く →</a></p>'
    + '<small>音声生成・APIキー保存にはローカルサーバーが必要です。ブラウザーのHTMLからプログラムを直接起動することはできません。</small></main>';
  document.body.style.background = '#090a0f';
  document.getElementById('launch-link').href = destination;
  let pending = false;
  function connect() {
    if (pending) return;
    pending = true;
    const probe = new Image();
    const timeout = setTimeout(() => finish(false), 2500);
    let finished = false;
    function finish(connected) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      pending = false;
      if (connected) window.location.replace(destination);
      else document.getElementById('launch-status').textContent = 'サーバーの起動を待っています。start_server.bat を開いてください。';
    }
    probe.onload = () => finish(true);
    probe.onerror = () => finish(false);
    probe.src = 'http://localhost:8080/css/images/mc-kenta-illustration.png?launch=' + Date.now();
  }
  connect();
  setInterval(connect, 3000);
})();
