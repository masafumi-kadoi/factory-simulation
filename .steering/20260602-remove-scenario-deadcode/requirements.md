# 要求内容

## 概要

sim-factory-manager に残る「廃止済みシナリオ機能」の残骸（デッドコード）を撤去し、併せて `/visualizer/` のルート不一致によるリンク切れを修正する。

## 背景

`database/migrations/020_drop_scenario_tables.sql` のコメント「scenario system replaced by factory-visualizer」が示す通り、シナリオシステムは廃止され factory-visualizer に置き換わった。scenarios テーブルは DROP 済みで、バックエンド（realtime-gateway / simulation-core）に `/api/scenarios` ルートも存在しない。

しかし sim-factory-manager のフロントには廃止機能の残骸が残り、以下の不具合になっている:
- `/editor/editor.html` への「New Scenario」「Edit」リンク → 実体なし・404
- `loadScenarios()` → `/api/scenarios` 呼び出し → バックエンドにルートなく常にエラー表示
- Scenarios カード（一覧テーブル）が常に「Error」を表示

また別系統で、DataSource の View ボタンが `/visualizer/` を指すが、nginx の実ルートは `/factory-visualizer/` でありリンク切れ。

## 実装対象

### 1. シナリオ残骸の撤去
- factory.html: Scenarios カード（New Scenario ボタン + 一覧テーブル）削除
- factory.js: `newScenarioBtn` 設定、`loadScenarios()`、Promise.all からの呼び出し削除
- api.js: `listScenarios()`（`/api/scenarios`）削除

### 2. /visualizer リンク修正
- factory.js: `/visualizer/` → `__BASE_PREFIX__/factory-visualizer/`（2箇所: viewerBase, viewerBtn.href）

## 受け入れ条件

- [ ] factory.html / factory.js / api.js から scenario 関連の参照が消える
- [ ] `/editor` 参照がリポジトリから消える
- [ ] `/visualizer/` が `__BASE_PREFIX__/factory-visualizer/` になる
- [ ] sim-factory-manager がビルド成功、成果物に scenario/editor 残骸が残らない

## スコープ外

- `btn-open-viewer`（factory.html:28）と `btn-open-viewer-ds`（:90）のID重複・別系統の整理（今回の主眼外）
- factory-visualizer 側が `ds`/`live` クエリを読まない件（リンク先到達は直るが自動選択は別途）

## 参照ドキュメント

- `database/migrations/020_drop_scenario_tables.sql`
