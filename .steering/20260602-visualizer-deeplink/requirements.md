# 要求内容

## 概要

factory-visualizer に「URLクエリ（`ds`/`live`/`factoryId`/`kind`）で指定されたデータソースを起動時に自動選択・表示する」ディープリンク機能を追加する。

## 背景

sim-factory-manager の Data Sources 一覧「View」ボタン／ライブ監視「Open Viewer」ボタンは `factory-visualizer/?ds=<id>&live=1` 等のURLを生成するが、factory-visualizer は起動時にURLクエリを読まないため、開いても工場未選択の初期画面になり手動で選び直しが必要だった（リンク先到達はするが目的データソースが開かない）。

## 実装対象

### 1. manager側のURL情報付与
- View URL に `factoryId` と `kind`(realtime|sim) を付与。

### 2. visualizer側のディープリンク
- 起動時に `ds`/`live`/`factoryId`/`kind` を読取。
- factoryId/kind があれば即利用、無ければ `/data-sources` 全件から `ds` を逆引きで factoryId/sourceType を解決。
- 工場を自動選択し、指定 ds を realtime/sim 正しいゾーンで開く。

## 受け入れ条件

- [ ] realtime ds の View → 工場選択＋リアルタイム監視で開く
- [ ] simulation ds の View → 工場選択＋simゾーンに表示・simモード切替
- [ ] factoryId/kind なし旧リンク（`?ds=` のみ）→ 逆引きで同じ結果
- [ ] 不正 ds → クラッシュせず warn・初期状態にフォールバック
- [ ] `ds` 無し起動 → 従来通り（後方互換）
- [ ] 起動直後にプルダウン変更 → 古いモード切替が発火しない（レース安全）

## スコープ外

- factory-visualizer 側の `ds`→factoryId 逆引きAPIの新設（既存 `/data-sources` 全件で代替）
- realtime/sim 以外のデータソース種別

## 参照

- `.claude/plans/precious-snacking-tiger.md`（承認済みプラン）
