# Xバー統語解析器 HTML版

React、外部API、CDN、ビルドツールを使わない静的サイトです。

## 起動

ES Modulesを使うため、ローカル確認時はHTTPサーバーで開きます。

```bash
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開きます。

## GitHub Pages

このフォルダの中身をリポジトリのルートへ置き、Settings > Pages でブランチ公開を選択します。ビルドは不要です。

## ファイル

- `index.html`: 画面
- `style.css`: デザイン
- `js/app.js`: 画面制御
- `js/tokenizer.js`: 現在の内蔵形態素層
- `js/parser.js`: Xバー構造生成
- `js/lexicon.js`: 語彙・動詞フレーム

## 重要

現在の形態素層は、完全同梱できる小型の規則辞書です。MeCabそのものではありません。今後 `tokenize()` の返却形式を維持したまま、同梱するMeCab/WASMと辞書へ交換できます。句構造解析層はそのまま利用できます。
