# 鶴ヶ峰駅周辺 熱中症情報サイネージ GitHub Actions版

GitHub PagesとGitHub Actionsだけで運用します。Cloudflare、Azure、外部CORSプロキシ、APIキーは使いません。

## データ経路

`環境省公式CSV → GitHub Actions → data/current.json → GitHub Pages → サイネージ`

- 対象地域: 神奈川県
- WBGT地点: 横浜、地点コード46106
- 画面は初回直ちにJSONを読み、その後300秒ごとに確認
- ActionsはJSTの毎時12、27、42、57分に実行を要求
- GitHub Actionsのscheduleは遅延する場合があり、正確な15分間隔を保証しない
- Action失敗時はJSONを上書きせず、前回成功データを残す

## GitHubへの設置

1. 新しいPublicリポジトリを作る。
2. このフォルダの中身をリポジトリ直下へアップロードする。`.github`、`scripts`、`data`も必要。
3. `Settings > Actions > General > Workflow permissions`で`Read and write permissions`を選び保存する。
4. `Actions > Update official WBGT data > Run workflow`で初回実行する。
5. 緑色で完了し、`data/current.json`が更新されたことを確認する。
6. `Settings > Pages`で`Deploy from a branch`、`main`、`/(root)`を選び保存する。
7. 表示されたPages URLを開き、通信正常、神奈川県、横浜46106を確認する。
8. `Enforce HTTPS`を有効にし、Pages URLをサイネージへ登録する。

## ファイル構成

```text
.github/workflows/update-wbgt.yml
scripts/update_wbgt.py
data/current.json
index.html
style.css
script.js
config.js
test.html
404.html
.nojekyll
README.md
```

## 公式情報

- 環境省熱中症予防情報サイト
- 暑さ指数（WBGT）予測値等電子情報提供サービス
- 予測CSV: `https://www.wbgt.env.go.jp/prev15WG/dl/yohou_46106.csv`
- 実況CSV: `https://www.wbgt.env.go.jp/est15WG/dl/wbgt_46106_YYYYMM.csv`
- アラートCSV: `https://www.wbgt.env.go.jp/alert/dl/YYYY/alert_YYYYMMDD_HH.csv`

## 障害確認

- Actionが赤い: 実行ログの`Fetch and validate official data`を確認する。
- Actionが緑で画面が古い: GitHub上の`data/current.json`更新時刻を確認し、ブラウザを強制再読み込みする。
- 15分超は「最新情報を取得できていません」、30分超は強調表示する。
- GitHub Pagesは公開サイトなので、会社名、工事名、個人情報、秘密情報を置かない。
- WBGTは横浜公式地点の値で、現場内実測値ではない。現場計測器、責任者の指示、会社基準を優先する。
