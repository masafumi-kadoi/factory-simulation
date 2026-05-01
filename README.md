# Factory Simulation System

工場シミュレーションシステム - インターロック制御方式による離散イベントシミュレーション

## 概要

Factory Simulationは、工場の生産ラインにおけるワークフローを**インターロック制御方式**でシミュレーションするシステムです。搬入可・搬出可の2信号による制御により、実際の生産ラインに近いリアルな挙動を再現します。

### 主な特徴

- **インターロック機構**: 搬入可・搬出可の2信号による厳密な制御
- **1ステーション1ワーク**: 各ステーションは同時に1つのワークのみ保持
- **逐次処理**: ワークは並列処理されず、1つずつ順番に処理
- **ビジュアルシナリオ設計**: ドラッグ&ドロップによるシナリオエディタ
- **SimDB連携**: 外部生産データベースからの初期条件取得
- **実行管理**: シミュレーション実行の設定・履歴管理
- **3D可視化**: Three.jsによる3Dアニメーション
- **統合ポータル**: 全ツールを一元管理するダッシュボード
- **高速シミュレーション**: Go言語による高性能な離散イベントシミュレーションエンジン
- **データ永続化**: PostgreSQLによる結果の保存・分析

## システム構成

```
factory-simulation/
├── simulation-core/        # シミュレーションエンジン + REST API (Go)
│   ├── cmd/server/         # APIサーバー
│   ├── internal/
│   │   ├── domain/         # ドメインモデル（Station, Work, Simulation）
│   │   ├── simulation/     # シミュレーションエンジン（イベント駆動）
│   │   ├── api/            # REST APIハンドラ
│   │   └── database/       # PostgreSQLリポジトリ
│   └── test/               # テストシナリオ
├── sim-editor/             # シナリオエディタ (HTML/JS)
│   └── html/
│       ├── index.html      # シナリオ一覧
│       ├── editor.html     # ビジュアルエディタ
│       └── js/             # editor, canvas, properties, validation 等
├── sim-executor/           # シミュレーション実行管理
│   ├── html/               # フロントエンド (HTML/JS)
│   │   ├── index.html      # ダッシュボード
│   │   ├── scenario.html   # シナリオ詳細・実行履歴
│   │   └── execution.html  # 実行設定
│   └── backend/            # バックエンド API (Go)
│       ├── cmd/server/
│       └── internal/
│           ├── api/        # REST APIハンドラ
│           ├── database/   # 実行履歴リポジトリ
│           └── simdb/      # SimDB接続クライアント
├── sim-visualizer/         # 3D可視化 (Three.js)
│   └── html/
│       ├── index.html      # 3Dビューア
│       └── index-list.html # シミュレーション一覧
├── sim-portal/             # 統合管理ポータル (HTML/JS)
│   └── html/
│       ├── index.html      # ダッシュボード
│       ├── scenarios.html  # シナリオ管理
│       ├── executions.html # 実行履歴
│       └── status.html     # システムステータス
├── database/
│   └── migrations/         # PostgreSQLマイグレーション (001-010)
└── docker-compose.yml      # コンテナ構成
```

### コンテナ構成

| コンテナ | 役割 | ポート |
|----------|------|--------|
| **postgres** | データベース | 5432 |
| **simulation-core** | シミュレーションエンジン + REST API | 8080 |
| **sim-visualizer** | 3D可視化 (Nginx + Three.js) | 8081 |
| **sim-editor** | シナリオエディタ (Nginx) | 8082 |
| **sim-executor** | 実行管理フロントエンド (Nginx) | 8083 |
| **sim-executor-backend** | 実行管理バックエンド API (Go) | 8084 |
| **sim-portal** | 統合管理ポータル (Nginx) | 8085 |

## クイックスタート

### 前提条件

- Docker
- Docker Compose

### 起動

```bash
cd factory-simulation
docker-compose up -d
```

### 動作確認

```bash
# 全コンテナの状態確認
docker-compose ps

# APIの疎通確認
curl http://localhost:8080/api/scenarios

# ポータル画面の確認
curl -I http://localhost:8085
```

### 各ツールへのアクセス

| ツール | URL | 説明 |
|--------|-----|------|
| sim-portal | http://localhost:8085 | 統合管理ポータル（ここから各ツールへアクセス） |
| sim-editor | http://localhost:8082 | シナリオのビジュアル設計 |
| sim-executor | http://localhost:8083 | シミュレーション実行管理 |
| sim-visualizer | http://localhost:8081 | 結果の3D可視化 |

### シンプルなシミュレーションを実行

```bash
# 1. シナリオ登録
SCENARIO_ID=$(curl -s -X POST http://localhost:8080/api/scenarios \
  -H "Content-Type: application/json" \
  -d '{
    "name": "シンプルテスト",
    "stations": [
      {"id": "source-1", "type": "source", "config": {"workCount": 3, "departureTime": 2.0}},
      {"id": "processing-1", "type": "processing", "config": {"processingTime": 1.0, "arrivalTime": 0.5, "departureTime": 0.5}},
      {"id": "drain-1", "type": "drain", "config": {"arrivalTime": 0.5}}
    ],
    "connections": [
      {"from": "source-1", "to": "processing-1"},
      {"from": "processing-1", "to": "drain-1"}
    ]
  }' | jq -r '.scenarioId')

echo "Scenario ID: $SCENARIO_ID"

# 2. シミュレーション実行
SIM_ID=$(curl -s -X POST http://localhost:8080/api/simulations \
  -H "Content-Type: application/json" \
  -d "{\"scenarioId\": \"$SCENARIO_ID\", \"simulationTime\": 100.0, \"initialConditions\": {}}" \
  | jq -r '.simulationId')

echo "Simulation ID: $SIM_ID"

# 3. 結果確認
curl -s "http://localhost:8080/api/simulations/$SIM_ID" | jq

# 4. 3D可視化で確認
echo "Open: http://localhost:8081?sim=$SIM_ID"
```

または、GUIでシナリオを作成する場合:

1. http://localhost:8082 でsim-editorを開く
2. ステーションをドラッグ&ドロップで配置
3. ステーション間を接続
4. 保存後、http://localhost:8083 でsim-executorから実行

## アーキテクチャ

### インターロック機構

各ステーションは2つの信号を持ちます：

各ステーションは**10信号インターロックモデル**を持ちます（IWP/PWP/OWP/RUN/CPL/PR/IR/OR/WF/WE）。

| 信号 | 意味 |
|------|------|
| **搬入可 (InputReady=IR)** | インターロックルールにより導出。ワークを受け入れ可能 |
| **搬出可 (OutputReady=OR)** | インターロックルールにより導出。ワークを送出可能 |

**ワーク移動の条件（ハンドシェイク方式）:**
- 送出側の `OR=ON` **かつ** 受入側の `IR=ON` の時のみワークが移動
- Merge/Splitは2層インターロック（ステーションレベル + ポートレベル）

詳細は [SIMULATION-ENGINE.md](SIMULATION-ENGINE.md) を参照。

### ステーション種別

| 種別 | 役割 | 特徴 |
|------|------|------|
| **Source** | ワーク生成 | 指定個数のワークを逐次生成 |
| **Processing** | 加工処理 | 1ワークを受け取り、処理して送出 |
| **Drain** | ワーク消滅 | ワークを破棄して終了 |
| **Merge** | ワーク結合 | 複数入力ポートからワークを受け取り1つに結合 |
| **Split** | ワーク分割 | 1つのワークを複数出力ポートに分割 |
| **Entry** | モジュラー入口 | Moduler内部の透過入口（加工時間なし） |
| **Exit** | モジュラー出口 | Moduler内部の透過出口（加工時間なし） |
| **Moduler** | 複合ステーション | 内部にサブシナリオを持ち、実行時にフラット展開 |

### 状態遷移

Processingステーションの状態遷移:

```
Idle (搬入可=ON, 搬出可=OFF)
  ↓ ワーク到着
Receiving (搬入可=OFF, 搬出可=OFF)
  ↓ 処理開始
Processing (搬入可=OFF, 搬出可=OFF)
  ↓ 処理完了
Completed (搬入可=OFF, 搬出可=ON)
  ↓ ワーク出発
Idle (搬入可=ON, 搬出可=OFF)
```

### SimDB連携

外部の生産データベース(SimDB)と連携し、実際の製造ラインの状態をシミュレーションの初期条件として取得できます。

- **LocationMaster**: 製造ライン上の場所定義
- **ActionInfo**: 各場所での作業情報
- **ItemStatus**: アイテムの品質ステータス

シナリオのステーションにLocationIDを紐付け、SimDBから現在のワーク配置や品質状態を取得してシミュレーションに反映します。

## API仕様

### simulation-core API (ポート 8080)

#### シナリオ登録

```
POST /api/scenarios
```

```json
{
  "name": "シナリオ名",
  "simdbConfig": {
    "host": "db-host", "port": 5432,
    "database": "db-name", "user": "user", "password": "pass"
  },
  "stations": [
    {
      "id": "station-id",
      "type": "source|processing|drain|merge|split|entry|exit|moduler",
      "locationId": 123,
      "config": {
        "workCount": 3,
        "departureTime": 2.0,
        "processingTime": 1.0,
        "arrivalTime": 0.5
      }
    }
  ],
  "connections": [
    {"from": "station-id-1", "to": "station-id-2", "condition": "default", "fromPortIndex": -1, "toPortIndex": -1}
  ]
}
```

#### シナリオ一覧取得

```
GET /api/scenarios
```

#### シナリオ詳細取得

```
GET /api/scenarios/{scenarioId}
```

#### シミュレーション実行

```
POST /api/simulations
```

```json
{
  "scenarioId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "simulationTime": 100.0,
  "initialConditions": {}
}
```

#### シミュレーション結果取得

```
GET /api/simulations/{simulationId}
```

#### シミュレーションログ取得

```
GET /api/simulations/{simulationId}/logs
```

### sim-executor-backend API (ポート 8084)

| エンドポイント | メソッド | 説明 |
|---------------|---------|------|
| `/api/executor/scenarios` | GET | シナリオ一覧（実行回数付き） |
| `/api/executor/executions?scenarioId=...` | GET | 実行履歴取得 |
| `/api/executor/execute` | POST | シミュレーション実行 |
| `/api/executor/initial-conditions` | POST | SimDBから初期条件取得 |
| `/api/executor/simdb/test-connection` | POST | SimDB接続テスト |

## テスト

### 自動テストの実行

```bash
cd simulation-core/test
bash run_all_tests.sh
```

**テストケース:**
- `01_basic_test.json`: Source → Drain（基本動作）
- `02_processing_test.json`: Source → Processing → Drain（処理ステーション）
- `07_stress_test.json`: 20ワークの負荷テスト

詳細は [TESTING.md](TESTING.md) を参照してください。

## 開発

### ローカル開発環境

```bash
# Go環境が必要（Go 1.21以上）
cd simulation-core
go run cmd/server/main.go
```

### ログの確認

```bash
# 特定サービスのログ
docker-compose logs -f simulation-core
docker-compose logs -f sim-executor-backend

# 全サービスのログ
docker-compose logs -f
```

### データベースのリセット

```bash
# ボリュームごと削除して再作成
docker-compose down -v
docker-compose up -d
```

### コードの再ビルド

```bash
# 特定サービスを再ビルド
docker-compose build simulation-core
docker-compose up -d simulation-core

# 全サービスを再ビルド
docker-compose build --no-cache
docker-compose up -d
```

## トラブルシューティング

### ポートが既に使用されている

```bash
# 使用中のポートを確認
lsof -i :8080  # simulation-core
lsof -i :8081  # sim-visualizer
lsof -i :8082  # sim-editor
lsof -i :8083  # sim-executor
lsof -i :8084  # sim-executor-backend
lsof -i :8085  # sim-portal
lsof -i :5432  # PostgreSQL
```

### コンテナが起動しない

```bash
# ログを確認
docker-compose logs

# イメージを再ビルド
docker-compose build --no-cache
docker-compose up -d
```

### インターロック違反エラー

```
Simulation failed: interlock violation: next station ... InputReady=OFF
```

**原因**: Source の `departureTime` が短すぎる

**対処**: 次ステーションの処理サイクル時間より長く設定

```
サイクル時間 = arrivalTime + processingTime + departureTime
```

## パフォーマンス

### ベンチマーク（参考値）

| 項目 | 値 |
|------|-----|
| 最大ワーク数 | 10,000+ |
| シミュレーション速度 | リアルタイムの100倍以上 |
| メモリ使用量 | 100ワークあたり約10MB |
| API応答時間 | 平均50ms以下 |

## ライセンス

MIT

## 関連ドキュメント

- [TESTING.md](TESTING.md) - 詳細なテスト・動作確認ガイド
- [DATA-FLOW.md](DATA-FLOW.md) - データ構成・通信フロー
- [ARCHITECTURE.md](ARCHITECTURE.md) - アーキテクチャ設計書
- [simulation-core/internal/domain/station.go](simulation-core/internal/domain/station.go) - ステーション実装
- [simulation-core/internal/simulation/engine.go](simulation-core/internal/simulation/engine.go) - シミュレーションエンジン実装
