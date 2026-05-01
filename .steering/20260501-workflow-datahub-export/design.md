# 設計書

## アーキテクチャ概要

シミュレーション完了後のポストプロセスとして、既存のログデータをWorkflowDataHubスキーマに変換・格納する。エクスポーターはsimulation-core内の新パッケージとして実装し、APIエンドポイントから呼び出す。

```
┌─────────────────────────────────────────────────────────────────┐
│  POST /api/simulations/{id}/export-wdh                         │
│                                                                 │
│  api/handler.go                                                 │
│    ├─ Repository: シミュレーション結果取得                        │
│    │   (simulation_runs, work_events, station_status_logs,      │
│    │    work_lineage, scenarios)                                 │
│    │                                                             │
│    └─ wdhexport.Exporter                                        │
│        ├─ 1. CreateDatabase("wdh_{sim_id_short}")               │
│        ├─ 2. CreateSchema() — 全10テーブル作成                   │
│        ├─ 3. ExportMasters() — Location/Proc/Machine            │
│        ├─ 4. ExportEvents() — Action/ItemID/Mapping/Status      │
│        └─ 5. 結果返却（DB名・接続情報）                          │
└─────────────────────────────────────────────────────────────────┘
```

## コンポーネント設計

### 1. wdhexport パッケージ（新規: `internal/wdhexport/`）

**責務**:
- WorkflowDataHub用DBの作成とスキーマ定義
- シミュレーション結果からWorkflowDataHubテーブルへのデータ変換・格納
- IDマッピング（station ID → LocationMaster bigserial ID）の管理

**実装の要点**:

**(a) Exporter構造体**

```go
type Exporter struct {
    adminDB  *sql.DB    // 管理用接続（CREATE DATABASE用、factory_simulationDB経由）
    targetDB *sql.DB    // エクスポート先DB接続
    dbName   string     // 作成したDB名
    
    // IDマッピング
    locationMap map[string]int64  // station ID → LocationMaster.id
    procMap     map[string]int64  // station ID → ProcMaster.id
}
```

**(b) ExportConfig**

```go
type ExportConfig struct {
    Host       string    // PostgreSQL host
    Port       string    // PostgreSQL port
    User       string    // PostgreSQL user
    Password   string    // PostgreSQL password
    BaseTime   time.Time // シミュレーション開始基準時刻
}
```

**(c) ExportResult**

```go
type ExportResult struct {
    DatabaseName string `json:"databaseName"`
    Host         string `json:"host"`
    Port         string `json:"port"`
    User         string `json:"user"`
    RecordCounts map[string]int `json:"recordCounts"` // テーブル名 → 格納件数
}
```

### 2. schema.go — DDL定義

**責務**:
- WorkflowDataHubテーブル定義書に準拠したCREATE TABLE文の管理
- action_status ENUM型の作成

**実装の要点**:

全10テーブルのDDLを定数またはstring sliceとして定義する。テーブル定義書のカラム・制約・インデックスを忠実に再現する。

```go
const schemaSQL = `
-- ENUM型
CREATE TYPE action_status AS ENUM ('arrived', 'departed');

-- LocationMaster
CREATE TABLE "LocationMaster" (
    id bigserial PRIMARY KEY,
    name character varying NOT NULL,
    max_capacity bigint
);

-- ProcMaster
CREATE TABLE "ProcMaster" (
    id bigint NOT NULL UNIQUE,
    no character varying,
    pre_proc_id bigint,
    post_proc_id bigint,
    location_id bigint,
    traceabi_table character varying
);

-- MachineMaster
CREATE TABLE "MachineMaster" (
    machine_id character varying(50) NOT NULL UNIQUE,
    machine_name character varying(50) NOT NULL,
    andonlog_table character varying NOT NULL,
    location_id bigint,
    machine_cycle_time bigint
);

-- ActionInfo
CREATE TABLE "ActionInfo" (
    event_timestamp timestamp without time zone NOT NULL,
    item_id character varying NOT NULL,
    origin_location_id bigint,
    destination_location_id bigint,
    action_status action_status NOT NULL
);

-- ItemIDInfo
CREATE TABLE "ItemIDInfo" (
    item_id character varying NOT NULL UNIQUE,
    item_type character varying NOT NULL
);

-- ItemConstructionMapping
CREATE TABLE "ItemConstructionMapping" (
    event_timestamp timestamp without time zone NOT NULL,
    input_item_id character varying,
    output_item_id character varying,
    construction_mapping_location_id bigint NOT NULL
);

-- ItemStatus
CREATE TABLE "ItemStatus" (
    update_timestamp timestamp without time zone NOT NULL,
    item_id character varying NOT NULL,
    location_id bigint,
    item_status smallint
);

-- ExpiryTimeInfo
CREATE TABLE "ExpiryTimeInfo" (
    item_id character varying NOT NULL,
    expiry_enable_timestamp timestamp without time zone NOT NULL,
    destination_location_id bigint NOT NULL,
    expiry_timestamp timestamp without time zone NOT NULL,
    expiry_destination_id bigint NOT NULL
);

-- MachineStatus
CREATE TABLE "MachineStatus" (
    update_timestamp timestamp without time zone NOT NULL,
    machine_id character varying(50) NOT NULL,
    register_index smallint NOT NULL,
    bit_index smallint NOT NULL,
    bit_status bit(1) NOT NULL
);

-- InvalidInputRecords
CREATE TABLE "InvalidInputRecords" (
    id bigserial PRIMARY KEY,
    db_name character varying NOT NULL,
    table_name character varying NOT NULL,
    record_no bigint NOT NULL,
    details text,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notified_at timestamp without time zone,
    UNIQUE (db_name, table_name, record_no)
);
`
```

### 3. masters.go — マスターテーブル生成

**責務**:
- シナリオのstations/connectionsからLocationMaster, ProcMaster, MachineMasterを生成

**実装の要点**:

**(a) LocationMaster生成**

```
入力: scenario.Stations（フラット展開前のトップレベル + moduler内部全て）
処理:
  1. 各stationについて INSERT INTO LocationMaster (name, max_capacity)
  2. RETURNING id で取得した連番IDをlocationMapに記録
  3. max_capacityはstation.Config["bufferCapacity"]から取得（なければ1）
```

ただし、フラット展開済みシナリオ（ドットID付き）ではなく、展開前のシナリオを使うか、フラット展開済みのstationをそのまま使うかを判断する必要がある。

→ **フラット展開済みシナリオを使用する**。理由: WorkEventLogのStationIDはフラット展開後のIDであり、ActionInfoのlocation_idマッピングと整合させる必要があるため。

**(b) ProcMaster生成**

```
入力: scenario.Connections + locationMap
処理:
  1. 各stationに工程ID（1000番台から連番）を割り当て
  2. connectionsから前後工程関係を構築
     - station Aの後工程 = Aからの接続先
     - station Bの前工程 = Bへの接続元
  3. 1つのstationに複数の前工程・後工程がある場合（merge/split）は最初の1つのみ記録
     （ProcMasterは線形順序を想定しているため）
  4. location_id = locationMap[stationID]
```

**(c) MachineMaster生成**

```
入力: scenario.Stations + locationMap
処理:
  1. source/drainを除く全stationについて:
     - machine_id = station.ID
     - machine_name = station.Name（空なら station.ID）
     - andonlog_table = "sim_" + station.ID（プレースホルダー）
     - location_id = locationMap[station.ID]
  2. processing時間がある場合: machine_cycle_time = processingTime（秒）
```

### 4. events.go — イベントデータ変換・格納

**責務**:
- WorkEventLog, WorkLineageLogからActionInfo, ItemIDInfo, ItemConstructionMapping, ItemStatusへの変換

**実装の要点**:

**(a) タイムスタンプ変換**

```go
func (e *Exporter) simTimeToTimestamp(simTime float64) time.Time {
    return e.config.BaseTime.Add(time.Duration(simTime * float64(time.Second)))
}
```

シミュレーション時刻（float64秒）をBaseTimeからの経過時間として絶対時刻に変換する。BaseTimeはAPIリクエストのパラメータまたはシミュレーション作成時刻を使用する。

**(b) ActionInfo生成**

```
入力: WorkEventLog（EventType = WorkArrived, WorkDeparted）
処理:
  WorkArrived → action_status='arrived'
    event_timestamp = simTimeToTimestamp(log.Timestamp)
    item_id = log.WorkID
    destination_location_id = locationMap[log.StationID]
    origin_location_id = 直前のWorkDepartedイベントのstationから取得

  WorkDeparted → action_status='departed'
    event_timestamp = simTimeToTimestamp(log.Timestamp)
    item_id = log.WorkID
    origin_location_id = locationMap[log.StationID]
    destination_location_id = 次のWorkArrivedイベントのstationから取得
```

テーブル定義書の記述:「地点を出発したタイミングで、その地点への到着情報と次の地点への出発情報をそれぞれ別レコードとして同時に記録する」
→ シミュレーションのイベントログはすでにArrived/Departedが個別イベントなので、そのまま1イベント=1レコードとして変換すればよい。

**(c) ItemIDInfo生成**

```
入力: WorkEventLog（EventType = WorkCreated）
処理:
  各WorkCreatedイベントについて:
    item_id = log.WorkID
    item_type = log.WorkType（空なら "work"）
  重複排除してINSERT
```

**(d) ItemConstructionMapping生成**

```
入力: WorkLineageLog
処理:
  merge操作:
    input_item_id = ParentWorkID（投入されたワーク）
    output_item_id = ChildWorkID（合成後のワーク）
    construction_mapping_location_id = locationMap[StationID]
    event_timestamp = simTimeToTimestamp(Timestamp)

  split操作:
    input_item_id = ParentWorkID（分割元のワーク）
    output_item_id = ChildWorkID（分割後のワーク）
    construction_mapping_location_id = locationMap[StationID]
    event_timestamp = simTimeToTimestamp(Timestamp)
```

**(e) ItemStatus生成**

```
入力: WorkEventLog（EventType = WorkInspected）
処理:
  各WorkInspectedイベントについて:
    update_timestamp = simTimeToTimestamp(log.Timestamp)
    item_id = log.WorkID
    location_id = locationMap[log.StationID]
    item_status = WorkのQualityStatusに基づく（OK=1, NG=2, その他=99）

  ※ QualityStatus情報の取得方法:
    WorkInspectedイベント時点のwork状態からQualityStatusを取得する必要がある。
    WorkEventLogにQualityStatusフィールドを追加するか、
    別途inspectionログからステータスを取得する。
```

→ **WorkEventLogにQualityStatusフィールドを追加する**方式を採用。engine.goのWorkInspectedイベント発行時にwork.QualityStatusを記録する。

### 5. API統合（api/handler.go）

**責務**:
- エクスポートAPIエンドポイントの提供

**実装の要点**:

```go
// HandleExportWDH handles POST /api/simulations/{id}/export-wdh
func (h *Handler) HandleExportWDH(w http.ResponseWriter, r *http.Request) {
    // 1. シミュレーションID取得
    // 2. シミュレーション結果取得（simulation, scenario, logs, lineage）
    // 3. ExportConfig構築（DB接続情報 + BaseTime）
    // 4. Exporter生成・実行
    // 5. ExportResult返却
}
```

リクエストボディ（オプション）:
```json
{
    "baseTime": "2026-05-01T09:00:00+09:00"
}
```

baseTimeが省略された場合、シミュレーション作成日時（`simulation.CreatedAt`）を使用する。

## データフロー

### エクスポート処理の流れ

```
1. API受信: POST /api/simulations/{id}/export-wdh
2. データ取得:
   ├─ Repository.GetSimulation(id) → simulation
   ├─ Repository.GetScenarioWithPassword(sim.ScenarioID) → scenario
   ├─ Repository.GetWorkEvents(id) → workEvents
   ├─ Repository.GetStationStatusLogs(id) → statusLogs
   └─ Repository.GetWorkLineage(id) → lineageLogs
3. FlattenScenario(scenario) → flatScenario
4. Exporter.Export():
   a. CREATE DATABASE "wdh_{sim_id_short}"
   b. 新DBに接続
   c. CREATE TYPE + CREATE TABLE × 10
   d. LocationMaster生成 → locationMap構築
   e. ProcMaster生成
   f. MachineMaster生成
   g. ItemIDInfo生成
   h. ActionInfo生成
   i. ItemConstructionMapping生成
   j. ItemStatus生成
5. レスポンス: { databaseName, host, port, recordCounts }
```

### IDマッピングの流れ

```
scenario.Stations → LocationMaster INSERT RETURNING id
                     ↓
               locationMap: map[string]int64
               "source-1" → 1
               "proc-1"   → 2
               "proc-2"   → 3
               "drain-1"  → 4
                     ↓
WorkEventLog.StationID → locationMap → ActionInfo.origin_location_id / destination_location_id
```

## エラーハンドリング戦略

### エラーパターン

| エラー | 対処 |
|--------|------|
| DB作成権限なし | 明確なエラーメッセージで返却 |
| 既存DB名と衝突 | DROP IF EXISTS で再作成（上書き） |
| シミュレーション未完了 | status != "completed" の場合はエラー |
| 空のシナリオ | stations が 0 の場合はエラー |
| トランザクション失敗 | ロールバック後にDB自体をDROPしてクリーンアップ |

### クリーンアップ

エクスポート途中でエラーが発生した場合、作成途中のDBをDROPして不完全な状態を残さない。

## テスト戦略

### ユニットテスト

- `TestCreateSchema`: DDLが正しく実行され全テーブルが作成されること
- `TestExportLocationMaster`: stationsが正しくLocationMasterに変換されること
- `TestExportProcMaster`: connectionsの前後関係が正しく反映されること
- `TestExportActionInfo`: WorkEventLogが正しいtimestamp・location_idでActionInfoに変換されること
- `TestExportItemConstructionMapping`: WorkLineageLogが正しく変換されること
- `TestTimestampConversion`: シミュレーション時刻→絶対時刻変換の正確性

### 統合テスト

- Source → Processing → Drain の基本シナリオでエクスポートし、全テーブルのデータを検証
- Merge/Splitを含むシナリオで ItemConstructionMapping の正確性を検証
- Inspectionを含むシナリオで ItemStatus の正確性を検証

## 依存ライブラリ

新規追加なし。既存の `github.com/lib/pq` を使用する。

## ディレクトリ構造

```
simulation-core/internal/
├── wdhexport/           # 新規パッケージ
│   ├── exporter.go      # Exporter構造体、Export()メインロジック
│   ├── schema.go        # DDL定義、CreateSchema()
│   ├── masters.go       # LocationMaster/ProcMaster/MachineMaster生成
│   ├── events.go        # ActionInfo/ItemIDInfo/ItemConstructionMapping/ItemStatus生成
│   └── exporter_test.go # テスト
├── simulation/
│   └── engine.go        # WorkEventLogにQualityStatusフィールド追加
├── api/
│   └── handler.go       # HandleExportWDH追加
│   └── simulation.go    # エクスポートAPI統合
└── domain/
    └── simulation.go    # WDHExportInfo追加（エクスポート済みDB情報）
```

## 実装の順序

1. WorkEventLogにQualityStatusフィールドを追加（engine.goの最小変更）
2. `wdhexport/schema.go` — DDL定義
3. `wdhexport/exporter.go` — Exporter骨格（DB作成・スキーマ適用・クリーンアップ）
4. `wdhexport/masters.go` — マスターテーブル生成
5. `wdhexport/events.go` — イベントデータ変換
6. `wdhexport/exporter_test.go` — テスト
7. `api/handler.go` — エクスポートAPIエンドポイント追加
8. 統合テスト・動作確認

## パフォーマンス考慮事項

- マスターテーブルは件数が少ない（ステーション数程度）ため、個別INSERTで十分
- ActionInfoは大量になる可能性があるため、バッチINSERT（1000件ずつ）を使用する
- DB作成はPostgreSQLのCREATE DATABASEコマンドで実行するため、トランザクション外で行う必要がある

## 将来の拡張性

- ExpiryTimeInfo: シミュレーションに消費期限制約を追加した際、events.goに変換ロジックを追加
- MachineStatus: シミュレーションにAndonレベルの設備状態モデリングを追加した際、events.goに変換ロジックを追加
- フロントエンドUI: sim-executorにエクスポートボタンを追加し、このAPIを呼ぶ
- エクスポート済みDBの一覧取得・削除API
