# DOPANEWS

ニュース記事をラップバトルに変換し、聴いた後に自分の考えを振り返るローカルWebアプリです。

## 起動とAPIキー設定

1. `config.example.json` を `config.local.json` にコピーします（既にある場合はそのまま使用）。
2. `GeminiApiKey` と `MurekaApiKey` に発行済みのキーを一度だけ設定します。
3. Windowsで `start_server.bat` を実行し、`http://localhost:8080/` を開きます。

APIキーを画面で入力する必要はありません。ローカルサーバーが設定を読み込み、Gemini・Murekaへ送信します。ブラウザにキーを返しません。設定変更は次のAPI呼び出しから反映されます。環境変数 `GEMINI_API_KEY` / `MUREKA_API_KEY` も使用でき、ファイル設定を優先します。

`config.local.json` と `.local/` はGit管理対象外です。ブラウザの以前のlocalStorageに保存されたキーは、この方式では使用しません。`index.html` の直接起動や別の静的サーバーでは生成・保存機能は使えません。

Geminiだけ設定した場合は歌詞＋内蔵ビートで再生します。キーなしでもプリセットデモを体験できます。

## 保存・再生

- 新しく生成したラップは自動保存します。「今のラップを保存」でプリセットを保存したり、保存失敗を再試行できます。
- `.local/library/` に元記事・歌詞・同期情報をJSONで保存し、Mureka音声はMP3としてダウンロードします。音声URLだけの保存ではないため、生成元のURLが期限切れになっても再生できます。
- 起動時に「保存したニュースラップ」一覧を読み込みます。「このラップを聴く」で元記事・歌詞・音声を復元できます。
- 再生ボタンは「一時停止」「再生・再開」に切り替わります。途中からの再開、各バースへの移動、終了後の聴き直しに対応します。
- 保存前にページを閉じて失われた過去の生成曲を、自動的に取り戻す機能はありません。手元のMP3読み込みは再生用で、履歴への取り込みは未対応です。
- 振り返りの選択・メモは従来どおりページ内で保持され、履歴JSONには保存しません。

## 検証

```powershell
node --test tests/regressions.test.cjs tests/server.test.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File server.ps1 -NoBrowser
```

追加依存パッケージはありません。Node.js 22以降が必要です。Windowsの起動用バッチからNode.js製ローカルサーバーを起動します。
