# sim-portal 通信フロー

## 概要

sim-portalは統合管理ポータルとして、simulation-core APIとsim-executor-backend APIの両方を呼び出し、全サービスのヘルスチェックも行います。バックエンドを持たないフロントエンド専用サービスです。

## 接続先

| 接続先 | ベースURL | 用途 |
|--------|----------|------|
| simulation-core | `http://localhost:8080/api` | シナリオ詳細取得 |
| sim-executor-backend | `http://localhost:8084/api/executor` | シナリオ一覧・実行履歴 |
| 各サービス | 各ポート | ヘルスチェック |

## ページ別通信フロー

### ダッシュボード (index.html / dashboard.js)

```
ページロード時:

1. シナリオ一覧取得
   GET http://localhost:8084/api/executor/scenarios
   → シナリオ数・実行件数の統計表示
   → 各シナリオのscenarioIdを取得

2. 実行履歴取得（全シナリオ分を並列実行）
   GET http://localhost:8084/api/executor/executions?scenarioId={id}
   × シナリオ数分
   → 全実行を時系列ソートし、最新5件を表示

3. サービスヘルスチェック（並列実行）
   → status.jsと同じロジック（下記参照）
   → オンラインサービス数を統計に表示
```

### シナリオ管理 (scenarios.html / scenarios.js)

```
ページロード時:

1. シナリオ一覧取得
   GET http://localhost:8084/api/executor/scenarios
   → テーブル描画: 名前, ステーション数, 接続数, SimDB状態, 実行件数
   → アクションボタン生成
```

**アクションリンク:**

| ボタン | リンク先 | パラメータ |
|--------|---------|-----------|
| Edit | sim-editor | `http://localhost:8082/editor.html?scenarioId={id}` |
| Execute | sim-executor | `http://localhost:8083/scenario.html?id={id}` |
| History | sim-executor | `http://localhost:8083/scenario.html?id={id}` |

### 実行履歴 (executions.html / executions.js)

```
ページロード時:

1. シナリオ一覧取得
   GET http://localhost:8084/api/executor/scenarios
   → 各シナリオ名を取得（表示用）

2. 実行履歴取得（全シナリオ分を並列実行）
   GET http://localhost:8084/api/executor/executions?scenarioId={id}
   × シナリオ数分
   → 全実行をマージ・時系列ソート
   → ステータスフィルタ（All / Completed / Running / Error）で絞り込み

フィルタ変更時:
   → クライアントサイドでフィルタリング（API再呼出しなし）
```

**Viewリンク (completedの場合):**
- sim-visualizer: `http://localhost:8081/?simulationId={simulationId}`

### システムステータス (status.html / status.js)

```
ページロード時 / Refreshボタン押下時:

1. 全サービスのヘルスチェック（並列実行、タイムアウト3秒）

   http://localhost:8080    → simulation-core
   http://localhost:8084    → sim-executor-backend
   http://localhost:8082    → sim-editor
   http://localhost:8083    → sim-executor
   http://localhost:8081    → sim-visualizer
   (PostgreSQLはHTTPなし)   → 常にUnknown

   mode: 'no-cors' で到達確認のみ
   → Online / Offline / Unknown を表示
```

## 通信シーケンス図

```
Browser (sim-portal)
  │
  ├──[Dashboard Load]──────────────────────────────────────┐
  │   GET /api/executor/scenarios ──────────────────────> sim-executor-backend
  │   GET /api/executor/executions?scenarioId=A ────────> sim-executor-backend
  │   GET /api/executor/executions?scenarioId=B ────────> sim-executor-backend
  │   fetch(http://localhost:8080) ─────────────────────> simulation-core (health)
  │   fetch(http://localhost:8084) ─────────────────────> sim-executor-backend (health)
  │   fetch(http://localhost:8082) ─────────────────────> sim-editor (health)
  │   fetch(http://localhost:8083) ─────────────────────> sim-executor (health)
  │   fetch(http://localhost:8081) ─────────────────────> sim-visualizer (health)
  │
  ├──[User clicks "Edit"]──────────────────────────────────┐
  │   window.open → http://localhost:8082/editor.html?scenarioId={id}
  │
  ├──[User clicks "Execute"]───────────────────────────────┐
  │   window.open → http://localhost:8083/scenario.html?id={id}
  │
  └──[User clicks "View" on execution]────────────────────┐
      window.open → http://localhost:8081/?simulationId={id}
```
