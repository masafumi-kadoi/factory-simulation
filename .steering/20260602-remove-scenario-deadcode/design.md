# 設計書

## アーキテクチャ概要

純粋なデッドコード撤去 + リンク先パス修正。バックエンド・DB 変更なし（既に migration 020 で撤去済み）。

## 変更内容

### sim-factory-manager/html/factory.html
- `<!-- Scenarios -->` カード全体（card div、New Scenario ボタン、scenarios-tbody テーブル）を削除。

### sim-factory-manager/html/js/factory.js
- `init()` 内の `newScenarioBtn` 取得・href 設定ブロック（18-22行）を削除。
- `Promise.all([loadStations(), loadScenarios(), loadDataSources()])` から `loadScenarios()` を除去。
- `loadScenarios()` 関数定義（64-86行）を削除。
- `loadDataSources()` 内 `const viewerBase = '/visualizer/'`（102行）→ `'__BASE_PREFIX__/factory-visualizer/'`。
- `updateLiveUI()` 内 `viewerBtn.href = '/visualizer/?...'`（128行）→ `'__BASE_PREFIX__/factory-visualizer/?...'`。

### sim-factory-manager/html/js/api.js
- `listScenarios()` メソッド（99-105行付近）を削除。

## テスト戦略

- `docker compose build sim-factory-manager` 成功。
- 成果物 grep: `/editor`、`scenarios`、`/visualizer/`（factory-visualizer でない単独 /visualizer）が残らない。
- `__BASE_PREFIX__` 置換（空ビルド）で `/factory-visualizer/` になる。

## 実装の順序

1. factory.html のカード削除
2. factory.js の関数・呼び出し・リンク修正
3. api.js の listScenarios 削除
4. ビルド + grep 検証
