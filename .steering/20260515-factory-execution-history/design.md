# 設計書

## アーキテクチャ概要

SimDB-only原則を維持しながら、factory別実行履歴をgateway経由で取得・選択する。

```
factory-visualizer (browser)
    │
    ├─ GET /api/factories/{id}/executions
    │       ↓
    │   realtime-gateway
    │       ↓ (SQL)
    │   execution_configs WHERE factory_id=$1 AND status='completed'
    │       ↓
    │   [ { executionId, dataSourceId, startDatetime, createdAt } ]
    │
    └─ WS subscribe(dataSourceId)  ← 選択した実行のdataSourceIdを使う
```

## コンポーネント設計

### 1. Repository: ListExecutionsByFactory

**責務**:
- factory_idでフィルタしてexecution_configsを取得
- statusがcompletedのもののみ返す

**実装の要点**:
- 既存の `ListExecutions()` と同じスキャンロジックを流用
- `WHERE factory_id=$1 AND status='completed' ORDER BY created_at DESC LIMIT 50`

### 2. Handler: handleFactoryExecutions

**責務**:
- `GET /api/factories/{fid}/executions` のルーティング追加
- factory_id存在確認（404ガード）
- レスポンスはJSON配列

**実装の要点**:
- `handleFactory()` の switch に `"executions"` ケースを追加
- GETのみ許可

### 3. api.js: fetchFactoryExecutions

**責務**:
- `GET /api/factories/{id}/executions` を呼ぶ関数を追加

### 4. index.html: 実行履歴UIセクション

**責務**:
- シミュレーションパネル内に「実行履歴」セクションを追加
- `<select id="execution-select">` で一覧表示
- 「適用」ボタンで選択を確定

### 5. app.js: 実行履歴のロード・選択

**責務**:
- `selectFactory()` 内で実行履歴をロード
- `execution-select` の選択変更時にWebSocket再購読

## データフロー

### 工場選択時
```
1. selectFactory(factoryId) 呼び出し
2. APIから stations, connections, executions を並行取得
3. execution-select に実行一覧を表示
```

### 実行選択時
```
1. execution-select の change イベント
2. 選択した execution の dataSourceId を取得
3. subscribeWebSocket(dataSourceId) を呼び直す
4. state.liveDataSourceId を更新
```

## 実装の順序

1. repository.go: ListExecutionsByFactory 追加
2. handler.go: handleFactoryExecutions 追加 + ルーティング追加
3. api.js: fetchFactoryExecutions 追加
4. index.html: 実行履歴UIセクション追加
5. app.js: 実行履歴ロード・選択ロジック追加
6. Dockerビルド・再起動

## パフォーマンス考慮事項

- LIMIT 50で件数を制限（execution_configsは大量になりうる）
- 工場選択時に並行取得（Promise.all）
