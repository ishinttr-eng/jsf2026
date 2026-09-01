# JSF Navi 2026

定禅寺ストリートジャズフェスティバル2026 非公式ナビアプリ。
静的ファイルのみで動作（サーバーサイド処理・APIキー不要）。

## 機能

- **いま**: 現在時刻の「演奏中」「30分以内に開始」を一覧表示。現在地取得で各会場への徒歩時間と「間に合う/間に合わない」判定。開催日前は時刻シミュレーションでプレビュー可
- **出演者**: 日別タイムテーブル。出演者名・かな・ジャンルで検索（カタカナ/ひらがな同一視）、会場・ジャンル絞り込み、☆でお気に入り登録
- **マップ**: 全50会場をピン表示（Leaflet + OpenStreetMap）。ピンから演奏中/次の出演者・徒歩時間を確認、「ここへ行く」でGoogleマップの徒歩ナビに引き渡し
- **マイ**: お気に入りから自分のタイムテーブルを生成。時間被り・移動時間不足を自動警告
- PWA対応（ホーム画面追加・タイムテーブルのオフライン閲覧）

## デプロイ

このディレクトリの中身（`tools/` は不要）をWebサーバーの任意のディレクトリにアップロードするだけ。
例: `/jazzfes/` に置けば `https://example.com/jazzfes/` で動く。

## データ更新（出演者変更が発表されたとき）

```sh
cd tools/raw
curl -sS -o performers-data.js "https://jsf-performer-data.morning-salad-c7ab.workers.dev/performers-data.js?v=1"
cd ..
python3 build_data.py   # data/*.json を再生成
```

その後 `sw.js` の `VERSION` を上げてから `data/` と `sw.js` を再アップロードすると、
利用者のキャッシュも更新される。

## 構成

- `index.html` / `css/` / `js/` — アプリ本体（ビルド不要のvanilla JS）
- `data/venues.json` — 50会場（座標・開催日）
- `data/performances.json` — 演奏スケジュール（897件）
- `data/walktimes.json` — 全会場ペアの徒歩分数（直線距離×1.3 ÷ 80m/分で事前計算)
- `tools/build_data.py` — 公式データ→アプリ用JSON変換
- `sw.js` / `manifest.webmanifest` / `icon.svg` — PWA関連

## クレジット

- 出演情報: [定禅寺ストリートジャズフェスティバル公式サイト](https://www.j-streetjazz.com/) の公開データに基づく（非公式・ファンメイド）
- 地図: © OpenStreetMap contributors / Leaflet
