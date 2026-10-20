# Xバー統語解析器 MeCab搭載HTML版
React不使用。HTML/CSS/JavaScriptとブラウザ内MeCab/WASM + UniDicです。入力は外部APIへ送りません。

```bash
npm install
npm run setup:dictionary
npm run dev
```

GitHub Pagesでは全ファイルをpushし、Settings > PagesでGitHub Actionsを選択します。mainへのpushで自動公開されます。`THIRD_PARTY_NOTICES.txt`と`THIRD_PARTY_LICENSES`を削除しないでください。