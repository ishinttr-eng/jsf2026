# JSF Navi 2026

定禅寺ストリートジャズフェスティバル2026 非公式ナビアプリ。
静的ファイルのみで動作（サーバーサイド処理・APIキー不要）。GitHub Pagesで公開中。

## 機能

- **演奏中**: 現在時刻の「演奏中」「30分以内に開始」を一覧表示。現在地取得で各会場への徒歩時間と「間に合う/間に合わない」判定。時刻シミュレーションで開催日前でも当日の見え方をプレビュー可
- **出演者**: 日付タブ（すべて/9・12/9・13、「すべて」選択時は両日横断で検索・一覧）。出演者名・かな・ジャンルで検索（カタカナ/ひらがな同一視）、会場・ジャンル絞り込み、☆でお気に入り登録。カードタップでアーティスト詳細（紹介文・ジャンル・地域・U-25・部門エントリー等）を表示
- **マップ**: 全50会場＋タイアップステージ（T1〜T15・未来応援ステージJ、レギュラーとは色・形を分けて表示）をLeaflet + OpenStreetMapのピンで表示。ホバーで会場名ツールチップ、ピンタップで演奏中/次の出演者・徒歩時間を確認。会場間・現在地からのルートを地図上に描画（事前計算済みの実測ルートがあれば実線、無ければ直線の概算を破線で表示。いずれも白フチ＋高彩度カラーでタイル配色に埋もれないように）。「マイルートモード」では現在時刻に応じて次に向かうべきお気に入り会場への経路を自動表示。Googleマップの徒歩ナビへのリンクも常に併記（APIキー不使用）
- **マイタイムテーブル**: お気に入りから自分のタイムテーブルを生成。表示日は演奏中の時刻シミュレーションに自動追従。演奏中/次はここを自動でハイライト＆スクロール。会場間の移動時間・時間重複を警告し、タップで地図上のルート表示に飛べる
- **出演者変更の通知**: 自動更新で公式データに差分（出演者交代・追加・削除・時刻/会場/ジャンル変更）が見つかると、ヘッダーに「📢 変更あり」バッジを表示。タップで変更履歴（交代は「旧→新」で表示）を確認できる
- PWA対応（ホーム画面追加・タイムテーブルのオフライン閲覧）

## データの自動更新

`.github/workflows/update-data.yml` が3時間ごとに公式の出演者フィードを再取得し、変化があれば
`data/venues.json`・`data/performances.json`・`data/changes.json`（変更履歴）を自動生成してmainへ
コミット・プッシュする。プッシュされると`deploy-pages.yml`が連動してサイトに反映される。
差分の有無に関わらず`data/checked.json`（直近チェック日時）は毎回更新されるので、アプリ右上の
「確認: …」表示は常に最新のチェック時刻を示す（バージョン番号は`sw.js`を変更しない限り動かない）。

手動でチェックを走らせたい場合はGitHubのActionsタブから該当ワークフローを`workflow_dispatch`で実行できる。
リポジトリの Settings → Actions → General → Workflow permissions が **Read and write permissions**
になっている必要がある。

## デプロイ

pushすれば`deploy-pages.yml`がGitHub Pagesへ自動デプロイする（`tools/`を除外して公開）。
別のWebサーバーに置く場合は、このディレクトリの中身（`tools/`は不要）をアップロードするだけでよい。
例: `/jazzfes/` に置けば `https://example.com/jazzfes/` で動く。

## データを手動で再生成する

```sh
cd tools/raw
curl -sS -o performers-data.js "https://jsf-performer-data.morning-salad-c7ab.workers.dev/performers-data.js?v=$(date +%s)"
cd ..
python3 build_data.py   # data/venues.json, performances.json, changes.json, checked.json を再生成
```

`walktimes.json`がすでに実測ルート由来（`source`に"OSRM"を含む）の場合、`build_data.py`は
直線距離ベースの概算に巻き戻さないようスキップする。

会場間の徒歩ルート（`data/routes.json`）を作り直す・追加会場分を補うときは:

```sh
python3 tools/build_routes.py   # 全会場ペア分、無料のOSRM(FOSSGIS)へ問い合わせ。数分〜十数分かかる
```

中断しても再実行すれば取得済みペアをスキップして続きから取得できる。完走すると
`walktimes.json`の徒歩分数も実測値で上書きされる。

再生成後は`sw.js`の`VERSION`を上げてからアップロードすると、利用者のキャッシュも確実に更新される
（GitHub Pages経由でも、SW更新の反映には1回多くページを開き直す必要がある場合がある）。

## 構成

- `index.html` / `css/` / `js/` — アプリ本体（ビルド不要のvanilla JS）
- `data/venues.json` — 50会場（座標・開催日）
- `data/performances.json` — 演奏スケジュール
- `data/walktimes.json` — 全会場ペアの徒歩分数（実測ルート優先、未取得分のみ直線距離概算）
- `data/routes.json` — 会場ペアごとの実測徒歩ルート（ポリライン・距離・所要時間、OSRM/FOSSGIS）
- `data/tieup.json` — タイアップステージ（T1〜T15・J）の名称・主催・座標。出演スケジュールは公式フィードに含まれないため未掲載
- `data/checked.json` — 自動更新ワークフローが直近にチェックした時刻
- `data/changes.json` — 出演者変更の検出履歴（直近20件）
- `tools/build_data.py` — 公式データ→アプリ用JSON変換、新旧比較による変更検出
- `tools/build_routes.py` — 全会場ペアの徒歩ルートを取得（無料・APIキー不要のOSRM）
- `.github/workflows/update-data.yml` — 出演者データの自動更新（3時間ごと）
- `.github/workflows/deploy-pages.yml` — GitHub Pagesへの自動デプロイ
- `sw.js` / `manifest.webmanifest` / `icon.svg` — PWA関連

## クレジット

- 出演情報: [定禅寺ストリートジャズフェスティバル公式サイト](https://www.j-streetjazz.com/) の公開データに基づく（非公式・ファンメイド）
- 地図: © OpenStreetMap contributors / Leaflet
- 徒歩ルート: OSRM ([FOSSGIS](https://routing.openstreetmap.de/) ホスティング)
