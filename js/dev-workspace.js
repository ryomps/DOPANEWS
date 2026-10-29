function showBattlePreview() {
  document.body.classList.remove('news-mode');
  document.getElementById('return-to-news').hidden = false;
}
document.getElementById('dev-show-battle').addEventListener('click', showBattlePreview);
document.getElementById('dev-show-news').addEventListener('click', () => {
  if (window.dopaNewsApp?.isGenerating) return;
  window.dopaNewsApp?._stopCurrentBattle();
  document.body.classList.add('news-mode');
  document.getElementById('return-to-news').hidden = true;
});
for (const id of ['btn-start-battle', 'btn-gemini-only', 'btn-load-preset']) {
  document.getElementById(id).addEventListener('click', showBattlePreview);
}
document.getElementById('dev-api-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const status = document.getElementById('api-config-status');
  const gemini = document.getElementById('dev-gemini-key');
  const mureka = document.getElementById('dev-mureka-key');
  const openai = document.getElementById('dev-openai-key');
  button.disabled = true;
  try {
    const response = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ GeminiApiKey: gemini.value, MurekaApiKey: mureka.value, OpenAIApiKey: openai.value }) });
    if (!response.ok) throw new Error('設定を保存できませんでした。ローカルサーバーの接続を確認してください。');
    const config = await response.json();
    status.textContent = `保存しました。OpenAI検索：${config.openaiConfigured ? '設定済み' : '未設定'} ／ Gemini：${config.geminiConfigured ? '設定済み' : '未設定'} ／ Mureka：${config.murekaConfigured ? '設定済み' : '未設定'}`;
  } catch (error) { status.textContent = error.message; }
  finally { gemini.value = ''; mureka.value = ''; openai.value = ''; button.disabled = false; }
});
