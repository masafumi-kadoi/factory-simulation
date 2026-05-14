# 要求内容

## 概要

factory-visualizerで複数のシミュレーション実行履歴を選択・再生できるようにする。
同じ工場・同じ開始日時でも複数の実行結果（異なる未来）が存在するため、どの実行結果を表示するかを選択できる仕組みが必要。

## 背景

factory-visualizerはSimDB-only原則（全情報をgateway/SimDB経由で取得）に従って設計されている。
シミュレーションは複数回実行可能であり、同じ開始条件でも異なる結果が生まれる。
現状は直前の実行結果のみWebSocket経由で受信できるが、過去に実行した複数の結果を選択・再生する手段がない。

## 実装対象の機能

### 1. Gateway API: factory別の実行履歴取得エンドポイント

- `GET /api/factories/{id}/executions` を追加
- factory_idでフィルタしたexecution_configs一覧を返す
- createdAt降順、最大50件
- 各レコードに executionId, dataSourceId, startDatetime (simの開始日時), status, createdAt を含む

### 2. factory-visualizer: 実行履歴選択UI

- シミュレーションパネルに「過去の実行履歴」セクションを追加
- 工場選択時に実行履歴一覧を自動ロード
- 実行結果を選択すると、そのdataSourceIdでWebSocket再購読＋タイムライン更新

## 受け入れ条件

### Gateway API
- [ ] `GET /api/factories/{fid}/executions` が200とJSON配列を返す
- [ ] factory_idでフィルタされた結果のみ返す
- [ ] completedのみ返す（pending/errorは除外）
- [ ] createdAt降順で最大50件

### factory-visualizer UI
- [ ] 工場選択時に実行履歴が自動ロードされる
- [ ] 実行履歴一覧にstart時刻・作成日時・statusが表示される
- [ ] 実行を選択するとWebSocket再購読が切り替わる
- [ ] 実行を選択するとタイムラインが更新される

## スコープ外

- 実行結果の削除機能
- 実行結果の詳細表示（ログ・エラー詳細）
- ページネーション（50件で十分）

## 参照ドキュメント

- `realtime-gateway/internal/api/handler.go` - 既存のAPIハンドラ
- `realtime-gateway/internal/database/repository.go` - 既存のRepository
- `factory-visualizer/html/js/api.js` - フロントエンドAPIクライアント
- `factory-visualizer/html/js/app.js` - メインアプリロジック
- `factory-visualizer/html/index.html` - UI HTML
