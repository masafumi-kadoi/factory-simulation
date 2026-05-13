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
  station_id TEXT          ← factory内でユニーク
  parent_id TEXT           ← ★追加: モジュラー内部ステーション用
  name TEXT
  station_type TEXT        ← source/processing/drain/merge/split/entry/exit/moduler
  position_x DOUBLE PRECISION  ← REAL→DOUBLE PRECISIONに変更
  position_y DOUBLE PRECISION
  position_z DOUBLE PRECISION  ← ★追加
  config JSONB             ← processingTime/workCount/model3DGrid等すべて
  UNIQUE(factory_id, station_id)

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

### 廃止するテーブル

| テーブル | 対応 |
|---------|------|
| `scenarios` | 廃止 → `factories` に統合 |
| `scenario_stations` | 廃止 → `factory_stations` に統合 |
| `scenario_connections` | 廃止 → `factory_connections` に統合 |

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

### Three.js 3Dシーン設計（暫定 - 詳細は次回確定）

- Three.js 0.160.0 (CDN)
- OrbitControls（既存 shared/js/mouse-config.js 流用）
- グローバル表示: モジュラーステーション（設備）を配置
- ローカル表示: 設備内部ステーションを平たい円柱で表示
- カメラパネル: 吹き出し型3Dオブジェクトとして空間内配置

### APIクライアント

ベースURL: `/api`（nginx-proxy → realtime-gateway:8090/api）

```javascript
fetchFactories()                    // 工場一覧
fetchFactory(id)                    // 工場詳細
fetchFactoryStations(factoryId)     // ステーション一覧
fetchFactoryConnections(factoryId)  // 接続一覧
fetchDataSources(factoryId)         // データソース一覧
fetchEvents(dataSourceId, from, to) // イベント取得
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

## 未決定事項

- **3Dの見え方の詳細** ← 次回確定予定（データフローに影響）
- ツールリボンのボタン詳細
- ローカル表示部の保存/API仕様
