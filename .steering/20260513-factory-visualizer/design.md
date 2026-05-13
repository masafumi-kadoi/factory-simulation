# factory-visualizer 設計書

## アーキテクチャ概要

```
factory-visualizer/
├── Dockerfile              (nginx:alpine, shared/ をCOPY)
├── nginx.conf              (SPA フォールバック + キャッシュ無効化)
└── html/
    ├── index.html          (メインHTML + importmap)
    ├── css/
    │   └── style.css       (全UIスタイル - ダークネイビーテーマ)
    └── js/
        ├── api.js          (APIクライアント)
        ├── scene3d.js      (Three.js 3Dシーン管理)
        ├── timeline.js     (タイムライン制御)
        ├── panels.js       (カメラ吹き出し・AIエージェントパネル)
        ├── ui.js           (左パネル・フローティング情報パネル・視点)
        └── app.js          (メインオーケストレーター)
```

---

## DBアーキテクチャ決定事項（パターンC）

### 方針

`scenarios` / `scenario_stations` / `scenario_connections` を**廃止**し、
`factories` / `factory_stations` / `factory_connections` に統合。

**factory_stations がそのままシミュレーション入力になる。**

### 統合後スキーマ

```sql
-- factories（scenarios を吸収）
factories
  id UUID PK
  name TEXT
  description TEXT
  db_host, db_port, db_name, db_user, db_password  ← SimDB接続情報
  created_at, updated_at

-- factory_stations（scenario_stations を吸収）
factory_stations
  id SERIAL PK
  factory_id UUID FK
  station_id TEXT          ← factory内でユニーク。形式: {equipment_id}.{local_id}
  equipment_id TEXT        ← 物理設備ID（station_idの最後の.より前）
  parent_id TEXT           ← ★追加: Machineの内部ステーション用（同factory内のstation_id参照）
  name TEXT
  station_type TEXT        ← source/processing/drain/merge/split/entry/exit/machine
                           --   ※ "moduler" は将来追加（今回スコープ外）
  position_x DOUBLE PRECISION  ← REAL→DOUBLE PRECISIONに変更
  position_y DOUBLE PRECISION
  position_z DOUBLE PRECISION  ← ★追加
  config JSONB             ← processingTime/workCount/model3DGrid等すべて
  UNIQUE(factory_id, station_id)
  FOREIGN KEY (factory_id, parent_id) REFERENCES factory_stations(factory_id, station_id)

-- factory_connections（scenario_connections を吸収）
factory_connections
  id SERIAL PK
  factory_id UUID FK
  from_station TEXT
  to_station TEXT
  condition TEXT DEFAULT 'default'
  from_port_index INT DEFAULT -1   ← デフォルトを-1に変更
  to_port_index INT DEFAULT -1
```

### station_type 一覧（今回確定版）

| タイプ | 意味 | 今回スコープ |
|-------|------|------------|
| `machine` | 物理設備（旧 `moduler`） | ✅ |
| `processing` | 処理ステーション | ✅ |
| `source` | ワーク発生源 | ✅ |
| `drain` | ワーク廃棄 | ✅ |
| `merge` | 合流 | ✅ |
| `split` | 分岐 | ✅ |
| `switch` | 切替 | ✅ |
| `inspection` | 検査 | ✅ |
| `discharge` | 排出 | ✅ |
| `entry` | エイリアス（飾り） | ✅ |
| `exit` | エイリアス（飾り） | ✅ |
| `moduler` | Machine の論理グルーピング | 🔜 将来 |

### config JSONB の3Dモデルデータ（既存パターン踏襲）

```json
{
  "model3DGrid": {
    "gridSize": 20,
    "cells": [[0,0], [1,0]],
    "height": 40
  },
  "model3DOriginX": 0,
  "model3DOriginY": 0,
  "model3DOriginZ": 0,
  "rotationY": 0
}
```

または glTF/GLB:
```json
{
  "model3DGltf": { ... },
  "model3DGlb": "<base64>"
}
```

### 廃止するテーブル・カラム

| 対象 | 対応 |
|------|------|
| `scenarios` テーブル | **DROP**（既存データは破棄・移行スクリプト不要） |
| `scenario_stations` テーブル | **DROP**（同上） |
| `scenario_connections` テーブル | **DROP**（同上） |
| `factory_stations.seq_number` | **DROP** → station_id から導出可能、未使用 |
| `station_type = "moduler"` 既存データ | `"machine"` に UPDATE して改名 |

### data_sources の変更

- `data_sources.scenario_id` → `data_sources.factory_id` 使用（既にカラム存在）

### 設備定義の複製

- 各工場に固有（複数工場間での共有なし）
- 複製して編集することは可能（API でコピーエンドポイントを実装）

---

## マイグレーション計画

### 新規マイグレーションファイル

`database/migrations/015_unified_factory_schema.sql`

内容:
1. `factory_stations` に `parent_id`, `position_z` 追加、座標を DOUBLE PRECISION に変更
2. `factory_connections` の `from/to_port_index` デフォルトを -1 に変更
3. `scenarios` / `scenario_stations` / `scenario_connections` を DROP（or RENAME して互換保持）
4. 既存 `scenarios` データを `factories` に移行
5. 既存 `scenario_stations` データを `factory_stations` に移行
6. 既存 `scenario_connections` データを `factory_connections` に移行

---

## バックエンド変更計画

### realtime-gateway (Go)

- `/api/scenarios` → `/api/factories` に統合（または互換レイヤー維持）
- `FactoryStation` 構造体に `ParentID`, `PositionZ` 追加
- シナリオ生成ロジック削除（直接 factory_stations を使用）

### simulation-core (Go)

- シナリオ読み込みを `factory_stations` + `factory_connections` から行うよう変更
- Entry/Exit をエイリアス（飾り）として扱う変更

---

## フロントエンド設計

### カラーパレット

```css
--bg-primary:    #0f1629;
--bg-panel:      #1a2744;
--bg-panel-hdr:  #162035;
--bg-surface:    #1e3355;
--border-color:  #2a4070;
--text-primary:  #e8edf5;
--text-secondary:#8fa3c8;
--accent-blue:   #4a9eff;
--status-normal: #4caf50;
--status-warn:   #ff9800;
--status-error:  #f44336;
--status-offline:#9e9e9e;
```

### Three.js 3Dシーン設計

- Three.js 0.160.0 (CDN)
- OrbitControls（既存 shared/js/mouse-config.js 流用）

#### 設備モデル描画優先順位

```
model3DGrid あり     → ボクセルグリッドシェル（半透明）
model3DGltf/Glb あり → GLTF/GLB モデル
どちらもなし         → 円柱フォールバック
```

#### 内部ステーション

- 平たい円柱（CylinderGeometry）
- 半径は `internalStationRadius`（スライダーで可変）
- `setShowInternal()` で一括表示/非表示

#### ワーク

- 赤いスフィア（既存 sim-visualizer と同様）
- WebSocket リアルタイム更新でワーク位置を更新

#### シーンテーマ

```javascript
const THEMES = {
    dark: {
        background: 0x0f1629,
        fog: [0x0f1629, 500, 2000],
        ground: 0x101828,
        gridCenter: 0x2a4070,
        gridLines: 0x1a2744,
    },
    light: {
        background: 0xf0f4f8,
        fog: [0xf0f4f8, 500, 2000],
        ground: 0xdde3ec,
        gridCenter: 0x9aacbf,
        gridLines: 0xc5d0dc,
    },
};
// 'auto' = prefers-color-scheme に応じて dark/light を自動選択
```

- `applyTheme(theme: 'auto' | 'dark' | 'light')` メソッドで切り替え
- `matchMedia('(prefers-color-scheme: dark)')` を監視し auto 時に自動再適用

#### カメラパネル

- 吹き出し型3Dオブジェクトとして空間内配置（今回はUIプレースホルダーのみ）

### API エンドポイント設計

ベースURL: `/api`（nginx-proxy → realtime-gateway:8090/api）

#### 工場 CRUD（既存・変更なし）

| メソッド | パス | 用途 |
|---------|------|------|
| GET | `/api/factories` | 工場一覧 |
| POST | `/api/factories` | 工場作成 |
| GET | `/api/factories/{id}` | 工場詳細 |
| PUT | `/api/factories/{id}` | 工場更新 |
| DELETE | `/api/factories/{id}` | 工場削除 |

#### ステーション管理（一部変更・新規追加）

| メソッド | パス | 変更 | 用途 |
|---------|------|------|------|
| GET | `/api/factories/{id}/stations` | 変更 | 一覧（`parent_id`, `position_z`, `locationId` 追加） |
| POST | `/api/factories/{id}/stations` | 変更 | 追加（`parent_id`, `position_z`, `locationId` 受付、`station_id` パターン緩和） |
| **PUT** | `/api/factories/{id}/stations/{sid}` | **新規** | 更新（position, config, name 等） |
| DELETE | `/api/factories/{id}/stations/{sid}` | 既存 | 削除 |
| POST | `/api/factories/{id}/stations/import-csv` | 既存 | CSV一括インポート |

#### 接続管理（新規追加）

| メソッド | パス | 用途 |
|---------|------|------|
| **GET** | `/api/factories/{id}/connections` | 接続一覧 |
| **POST** | `/api/factories/{id}/connections` | 接続追加 |
| **DELETE** | `/api/factories/{id}/connections/{cid}` | 接続削除 |

#### SimDB 連携（新規追加）

| メソッド | パス | 用途 |
|---------|------|------|
| **GET** | `/api/factories/{id}/simdb/locations` | SimDB の LocationMaster 取得（マッピング候補一覧） |
| **POST** | `/api/factories/{id}/simdb/sync` | location_master を SimDB から同期 |

#### データソース・実行（既存・変更なし）

| メソッド | パス | 用途 |
|---------|------|------|
| GET/POST | `/api/data-sources` | データソース管理 |
| GET/PUT/DELETE | `/api/data-sources/{id}` | データソース詳細 |
| GET | `/api/data-sources/{id}/events` | イベント取得 |
| GET | `/api/data-sources/{id}/layout` | WDH レイアウト取得 |
| GET/POST/DELETE | `/api/executions` | 実行管理 |

#### WebSocket（既存・変更なし）

| パス | 用途 |
|------|------|
| `WS /ws/live` | リアルタイム更新（ワーク位置・インターロック状態） |

#### 廃止

| パス | 対応 |
|------|------|
| `/api/scenarios` | DROP |
| `/api/scenarios/{id}` | DROP |

---

### レスポンス形式（主要なもの）

#### `GET /api/factories/{id}/stations`

```json
[
  {
    "id": 1,
    "factory_id": "uuid",
    "station_id": "ST01.001",
    "equipment_id": "ST01",
    "parent_id": null,
    "name": "入口ステーション",
    "station_type": "machine",
    "position_x": 100.0,
    "position_y": 200.0,
    "position_z": 0.0,
    "config": {
      "locationId": 123,
      "processingTime": 30,
      "model3DGrid": { ... }
    }
  }
]
```

#### `GET /api/factories/{id}/connections`

```json
[
  {
    "id": 1,
    "factory_id": "uuid",
    "from_station": "ST01.001",
    "to_station": "ST02.001",
    "condition": "default",
    "from_port_index": -1,
    "to_port_index": -1
  }
]
```

#### `GET /api/factories/{id}/simdb/locations`

```json
[
  { "id": 123, "name": "組立機-A 投入口" },
  { "id": 124, "name": "組立機-A 排出口" }
]
```
SimDB の `LocationMaster` をそのまま返す。factory_stations の `config.locationId` と突合してマッピングを確認するために使う。

---

### `station_id` パターン変更

```go
// 変更前（3桁数字強制）
var stationIDPattern = regexp.MustCompile(`^.+\.\d{3}$`)

// 変更後（任意サフィックス許可）
var stationIDPattern = regexp.MustCompile(`^[^.]+\..+$`)
```

`parent_id` を持つ内部ステーション（例: `"ST01.proc-1"`）の数字以外サフィックスを許容する。

---

### APIクライアント（フロントエンド api.js）

```javascript
fetchFactories()
fetchFactory(id)
fetchFactoryStations(factoryId)
fetchFactoryConnections(factoryId)
createConnection(factoryId, from, to, condition, fromPort, toPort)
deleteConnection(factoryId, connId)
updateStation(factoryId, stationId, fields)
fetchSimDBLocations(factoryId)
syncSimDB(factoryId)
fetchDataSources(factoryId)
fetchEvents(dataSourceId, from, to)
```

### nginx-proxy ルーティング

```nginx
location /factory-visualizer/ {
    proxy_pass http://factory-visualizer:80/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

---

### WebSocket 設計

サーバー側は**変更なし**。既存 `realtime-gateway` の `/ws/live` をそのまま使用。

#### クライアント → サーバー

```json
{ "type": "subscribe",   "data_source_id": "uuid" }
{ "type": "unsubscribe" }
```

#### サーバー → クライアント

```json
// ハートビート（30秒ごと）
{ "type": "heartbeat", "server_time": "2026-05-14T10:00:00Z" }

// ワーク移動イベント
{
  "type": "event",
  "data": {
    "table": "item_movement",
    "event_time": "2026-05-14T10:00:00Z",
    "item_id": "WORK-001",
    "from_location_id": 123,
    "to_location_id": 124,
    "movement_type": "arrived | departed",
    "port_index": -1
  }
}

// インターロック信号イベント
{
  "type": "event",
  "data": {
    "table": "machine_signal",
    "event_time": "2026-05-14T10:00:00Z",
    "machine_id": "ST01",
    "signal_name": "inputReady | outputReady",
    "value": true,
    "old_value": false
  }
}
```

#### factory-visualizer クライアント側の変更点

- `locationMap`（`Map<location_id: number, station_id: string>`）の構築元を  
  `scenario_stations` → `factory_stations.config.locationId` に変更
- それ以外は sim-visualizer の `live-client.js` / `wdhEventToInternal()` をそのまま流用

---

### ローカル表示部 保存/API仕様

ローカル表示部（Machine ダブルクリックで開く別ウィンドウ）の3タブの保存設計。

#### タブ別 保存対象と API

| タブ | 保存対象 | API |
|------|---------|-----|
| モデル情報編集 | `name`, `config.metadata` | `PUT /api/factories/{fid}/stations/{sid}` |
| 3Dモデル編集 | `config.model3DGrid` or `config.model3DGlb`, `config.model3DOriginX/Y/Z` | `PUT /api/factories/{fid}/stations/{sid}` |
| ロジック編集 | 内部ステーション一覧 + 接続一覧 | `PUT /api/factories/{fid}/machines/{sid}/logic` |

#### ロジック編集 バッチ保存エンドポイント

「保存して閉じる」ボタン押下時に一括送信。サーバー側でトランザクション内に全置換。

```
PUT /api/factories/{factoryId}/machines/{machineStationId}/logic
```

リクエスト:
```json
{
  "stations": [
    {
      "station_id": "ST01.proc-1",
      "name": "処理工程A",
      "station_type": "processing",
      "position_x": 10.0,
      "position_y": 20.0,
      "position_z": 0.0,
      "config": { "processingTime": 30, "locationId": 123 }
    }
  ],
  "connections": [
    {
      "from_station": "ST01.proc-1",
      "to_station": "ST01.proc-2",
      "condition": "default",
      "from_port_index": -1,
      "to_port_index": -1
    }
  ]
}
```

レスポンス:
```json
{ "status": "ok", "stations": 3, "connections": 2 }
```

サーバー処理（トランザクション内）:
1. `parent_id = machineStationId` の既存 factory_stations を全 DELETE
2. `from_station` or `to_station` が上記 station_id に含まれる factory_connections を全 DELETE
3. `stations` を全件 INSERT（`parent_id = machineStationId` を自動付与）
4. `connections` を全件 INSERT

#### ローカル表示部の動作フロー

```
Machine ダブルクリック
  → 別ウィンドウ open
  → GET /api/factories/{fid}/stations?parent_id={machineId} で内部ステーション取得
  → GET /api/factories/{fid}/connections で接続取得（内部ステーション間のみフィルタ）
  → 3タブで編集（変更はメモリ内に保持）
  → 「保存して閉じる」
      → Tab1/2: PUT /api/factories/{fid}/stations/{sid}
      → Tab3:   PUT /api/factories/{fid}/machines/{sid}/logic
  → ウィンドウ close → グローバルビューに反映（再ロード）
```

---

### シミュレーション実行フロー

#### サービス構成変更

| サービス | 変更 |
|---------|------|
| `sim-executor` (frontend, 8083) | **廃止** |
| `sim-executor-backend` (8084) | **廃止** → ロジックを realtime-gateway に統合 |
| `factory-visualizer` | **新設** |
| `realtime-gateway` | sim-executor-backend の SimDB ロジックを吸収 |
| `simulation-core` | factory_stations/connections を直接 DB から読むよう変更（案A） |

#### realtime-gateway に統合するエンドポイント

| 旧（sim-executor-backend） | 新（realtime-gateway） |
|--------------------------|----------------------|
| `POST /api/executor/execute` | `POST /api/executions`（factoryId 対応を追加） |
| `POST /api/executor/initial-conditions` | `POST /api/factories/{id}/simdb/initial-conditions` |
| `GET /api/executor/simdb/test-connection` | `POST /api/factories/{id}/simdb/test-connection` |
| `GET /api/executor/executions` | `GET /api/executions`（既存） |

#### 実行フロー全体

```
factory-visualizer          realtime-gateway              simulation-core
      │                            │                             │
      │ ① SimDB初期条件取得         │                             │
      │ POST /api/factories        │                             │
      │   /{id}/simdb              │ factories.db_host 等で      │
      │   /initial-conditions      │ SimDB に接続                │
      │ { startDatetime }          │ LocationMaster + ActionInfo │
      │───────────────────────────>│ config.locationId でマッピング
      │<── { initialConditions } ──│                             │
      │                            │                             │
      │ ② シミュレーション実行       │                             │
      │ POST /api/executions       │                             │
      │ { factoryId,               │ data_source 作成            │
      │   startDatetime,           │ execution_config 作成       │
      │   simulationTime,          │                             │
      │   initialConditions }      │ POST /run（非同期）          │
      │───────────────────────────>│ { factoryId, dataSourceId,  │
      │                            │   simulationTime, ... }     │
      │ 202 { executionId,         │────────────────────────────>│
      │       dataSourceId }       │                 factory_stations/
      │<───────────────────────────│                 connections を DB から直接読む
      │                            │                 WDH テーブルに書き込み
      │ ③ WebSocket 購読           │                 pg_notify 発火
      │ subscribe(dataSourceId)    │<────────────────────────────│
      │───────────────────────────>│                             │
      │<── リアルタイムイベント ─────│                             │
```

#### execution_configs テーブルの変更

```sql
-- scenario_id → factory_id に変更
ALTER TABLE execution_configs
    ADD COLUMN factory_id UUID REFERENCES factories(id),
    ALTER COLUMN scenario_id DROP NOT NULL;
```

---

## 未決定事項

- ツールリボンのボタン詳細（後回し・画面を見ながら調整）
