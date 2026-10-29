(function () {
  window.addEventListener('DOMContentLoaded', () => {
    if (new URLSearchParams(window.location.search).get('studio') === 'backing') {
      document.body.classList.remove('news-mode');
      document.getElementById('control-drawer')?.classList.add('drawer-open');
      document.getElementById('return-to-news').hidden = false;
      document.getElementById('backing-panel')?.scrollIntoView({ block: 'start' });
    }
  });
  const form = document.getElementById('backing-form');
  if (!form) return;
  const fileInput = document.getElementById('backing-file');
  const uploadButton = document.getElementById('backing-upload');
  const generateButton = document.getElementById('backing-generate');
  const status = document.getElementById('backing-status');
  const preview = document.getElementById('backing-preview');
  const start = document.getElementById('backing-start');
  const end = document.getElementById('backing-end');
  const speaker = document.getElementById('backing-speaker');
  const lyric = document.getElementById('backing-lyric');
  const reading = document.getElementById('backing-reading');
  let backing = null, busy = false;

  function lock(value) {
    busy = value;
    form.querySelectorAll('input, select, textarea, button').forEach(element => { element.disabled = value; });
    generateButton.disabled = value || !backing;
  }
  async function request(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = data.report ? '\n' + data.report.summary + '\n' + (data.report.issues || []).map(issue => issue.quote + '：' + issue.reason + '／修正案：' + issue.suggestion).join('\n') : '';
      throw new Error((response.status === 404 ? 'サーバーを再起動してから再試行してください。' : data.error || '通信エラー (' + response.status + ')') + details);
    }
    return data;
  }
  function duration(file) {
    return new Promise((resolve, reject) => {
      const audio = new Audio(), url = URL.createObjectURL(file);
      const timeout = setTimeout(() => finish(new Error('音声の長さを取得できませんでした。')), 10000);
      function finish(error) {
        clearTimeout(timeout); URL.revokeObjectURL(url); audio.removeAttribute('src');
        error ? reject(error) : resolve(audio.duration);
      }
      audio.onloadedmetadata = () => {
        const seconds = audio.duration;
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) { finish(new Error('10分以内の伴奏ファイルを選択してください。')); return; }
        clearTimeout(timeout); URL.revokeObjectURL(url); audio.removeAttribute('src'); resolve(seconds);
      };
      audio.onerror = () => finish(new Error('音声を読み込めません。MP3／M4A／16bit PCM WAVを選んでください。'));
      audio.src = url;
    });
  }
  fileInput.addEventListener('change', () => {
    backing = null; generateButton.disabled = true;
    preview.removeAttribute('src'); preview.hidden = true;
    status.textContent = fileInput.files[0] ? fileInput.files[0].name + ' を選択しました。「伴奏をアップロード」を押してください。' : '伴奏ファイルを選択してください。';
  });
  uploadButton.addEventListener('click', async () => {
    if (busy || window.dopaNewsApp?.isGenerating) return;
    const file = fileInput.files[0];
    if (!file) { status.textContent = '先に伴奏ファイルを選択してください。'; return; }
    if (!/\.(mp3|m4a|wav)$/i.test(file.name) || file.size > (/\.wav$/i.test(file.name) ? 40000000 : 10000000)) {
      status.textContent = 'MP3／M4Aは10MB以内、WAVは16bit PCM・40MB以内にしてください。'; return;
    }
    lock(true);
    try {
      const seconds = await duration(file);
      status.textContent = '伴奏をアップロード中です。WAVはMP3に変換してからMurekaへ送ります。';
      backing = await request('/api/backing/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name), 'X-Audio-Duration': String(seconds) }, body: file });
      preview.src = backing.audioUrl; preview.hidden = false;
      start.max = String(backing.duration); end.max = String(backing.duration);
      end.value = String(Math.min(20, backing.duration));
      status.textContent = 'アップロード済み：' + backing.filename + '（' + backing.duration.toFixed(1) + '秒）。区間と歌詞を指定できます。';
    } catch (error) { backing = null; status.textContent = error.message; }
    finally { lock(false); }
  });
  document.getElementById('backing-use-verse').addEventListener('click', () => {
    const app = window.dopaNewsApp;
    const index = Number(document.getElementById('backing-verse').value);
    const verse = app?.currentBattleData?.verses[index];
    if (!verse) { status.textContent = '先に「Gemini作詞のみ実行」で歌詞を作ってください。'; return; }
    speaker.value = verse.speaker;
    lyric.value = verse.lyric || ''; reading.value = verse.lyric_reading || '';
    start.value = String(index * 20); end.value = String((index + 1) * 20);
    status.textContent = 'V' + (index + 1) + 'の歌詞をセットしました。区間・担当MC・音声用の読みを確認して生成してください。';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const app = window.dopaNewsApp;
    if (busy || app?.isGenerating || !backing) return;
    const from = Number(start.value), to = Number(end.value);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > backing.duration || to - from > 120) {
      status.textContent = '伴奏の長さ以内で、開始秒より終了秒を後にしてください（最大120秒）。'; return;
    }
    const articleText = app.articleInputEl.value.trim();
    const input = { backingId: backing.id, startSec: from, endSec: to, speaker: speaker.value,
      lyric: lyric.value, lyricReading: reading.value, articleText, title: (app.currentBattleData?.title || '伴奏ラップ') + '／' + speaker.value };
    lock(true); app._setGenerating(true);
    try {
      status.textContent = 'AI審判が歌詞を確認中。問題がなければMurekaで指定区間のラップを1回生成します。';
      const task = await request('/api/backing/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      let result;
      for (let attempt = 0; attempt < 150; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 4000));
        status.textContent = input.speaker + ' のラップを生成中（' + from + '〜' + to + '秒）。経過 ' + ((attempt + 1) * 4) + '秒';
        const poll = await request('/api/mureka/v1/song/query/' + encodeURIComponent(task.taskId));
        const data = poll.data || poll;
        if (['failed', 'timeouted', 'cancelled'].includes(data.status)) throw new Error('Murekaの生成に失敗しました。自動で再生成は行いません。');
        if (data.status === 'succeeded') {
          result = data.choices?.[0]; break;
        }
      }
      const audioUrl = result?.url || result?.audio_url || result?.wav_url || result?.flac_url;
      if (!audioUrl) throw new Error('生成音声を取得できませんでした。自動で再生成は行いません。');
      app._stopCurrentBattle();
      const battle = window.DOPANEWS.normalizeBattleData(task.battleData);
      window.DOPANEWS.applyMurekaTimestamps(battle, result);
      result.backing_request = task.requestInfo;
      app.currentArticleText = articleText;
      app.currentReviews = { script: task.report };
      app.currentAudioUrl = audioUrl; app.currentMurekaTrack = result;
      app._applyBattleData(battle);
      await app._autoSaveBattle();
      app._setStepState(3);
      app._setLog('伴奏へのラップ追加が完了しました。Murekaが返した音源を再生します。');
      showBattlePreview();
      await app.audioController.loadAndPlayUrl(app.currentAudioUrl || audioUrl);
      app.audioReviewPromise = app._startAudioReview();
      status.textContent = '生成完了：' + input.speaker + '／指定区間 ' + from + '〜' + to + '秒。保存結果は「保存したニュースラップ」で確認できます。';
    } catch (error) { status.textContent = error.message; }
    finally { lock(false); app._setGenerating(false); }
  });
})();
