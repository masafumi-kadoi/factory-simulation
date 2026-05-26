# 設計書

## アーキテクチャ概要

```
[外部工場DB]──1秒ポーリング──→[factory-poller]──INSERT──→[PostgreSQL]
                                                              │
[factory-visualizer]←──WebSocket NOTIFY──[realtime-gateway]──┘
        │                                        │
        │──POST /poller/start ────────────────────┤
        │──GET  /poller/status ───────────────────┤
        │──POST /poller/stop ─────────────────────┘
```

新サービス `factory-poller` を追加し、外部工場DBのポーリングを担当させる。
`realtime-gateway` は poller の制御 API のみを持ち、実際のポーリング処理は委譲する。
フロントエンド側は3ゾーンタイムラインに対応するよう `timeline.js` と `app.js` を改修する。

## コンポーネント設計

### 1. realtime-gateway（修正）

**変更点①: source_type バグ修正**

`internal/api/handler.go` の `handleFactoryExecutions`（line ~916）:

```go
// 修正前
ds, dsErr = h.repo.CreateRealtimeDataSource(body.FactoryID, friendlyName)

// 修正後
ds, dsErr = h.repo.CreateDataSource("simulation", body.ScenarioID, friendlyName, nil)
```

注意: `body.ScenarioID` が空の場合を考慮する（既存コードを確認して適切に対処）。

**変更点②: poller 制御 API 追加**

```
POST /api/factories/{id}/poller/start
  → factory-poller に対して HTTP リクエストを送り、ポーリング開始を指示
  → 既に起動中の場合は 409 Conflict
  → 成功時: { "dataSourceId": "uuid", "status": "started" }

POST /api/factories/{id}/poller/stop
  → factory-poller に停止を指示
  → data_source.ended_at = NOW() を設定
  → 成功時: { "status": "stopped" }

GET /api/factories/{id}/poller/status
  → { "running": bool, "dataSourceId": "uuid" | null }
```

realtime-gateway は `FACTORY_POLLER_URL` 環境変数で factory-poller のアドレスを知る。

**変更点③: factory datasource フィルタリング API**

```
GET /api/factories/{id}/datasources?type=realtime
GET /api/factories/{id}/datasources?type=simulation
GET /api/factories/{id}/datasources        ← 全件
```

現状の `GET /api/data-sources` はフロントエンド側でフィルタしているが、
factory_id で絞り込む API エンドポイントを追加する。
`data_sources` テーブルの `factory_id` カラムを参照する（`CreateRealtimeDataSource` が既に設定済み）。

### 2. factory-poller（新規 Go サービス）

**責務**:
- realtime-gateway からの HTTP 命令（start/stop）を受け付ける
- 外部工場DBに対して1秒間隔でポーリングする
- 前回ポーリング時刻以降の新規 `item_movement` イベントを取得
- 内部DBに INSERT し、`notify_new_event()` トリガーを発火させる

**ディレクトリ構造**:
```
factory-poller/
├── Dockerfile
├── go.mod
├── go.sum
├── main.go
└── internal/
    ├── api/
    │   └── handler.go     # HTTP API (start/stop/status)
    ├── poller/
    │   └── poller.go      # ポーリングループ
    └── database/
        └── db.go          # 内部DB接続・INSERT
```

**API**:
```
POST /poller/start
  Body: { factoryId, dbHost, dbPort, dbName, dbUser, dbPass, dataSourceId }
  → ポーリングgoroutineを起動
  → 成功: 200 OK

POST /poller/stop
  Body: { factoryId }
  → goroutineを停止
  → 成功: 200 OK

GET /poller/status
  → { "running": bool, "factoryId": str, "dataSourceId": str }
```

**ポーリングループ**:
```go
for range time.NewTicker(1 * time.Second).C {
    rows := queryExternalDB("SELECT * FROM item_movement WHERE event_time > $1", lastPollTime)
    insertInternalDB(rows, dataSourceId, locationMapping)
    lastPollTime = time.Now()
}
```

**重要**: 外部DBの `item_movement` のロケーション ID は外部DB側のもの。
内部DBの `location_master` エントリと紐付けるためのマッピングが必要。
→ ポーリング開始時に外部DBの `location_master` を取得し、内部DBへ登録する。
   以降のポーリングでは `from_location_id` / `to_location_id` を内部IDに変換してINSERT。

**環境変数**:
```
PORT=8091
INTERNAL_DB_DSN=postgres://postgres:postgres@postgres:5432/factory_simulation
```

### 3. factory-visualizer フロントエンド

#### 3-1. timeline.js 再設計

**新しい状態**:
```javascript
this._nowMs = null;          // Date.now() (固定中心)
this._realtimeEvents = [];   // 左ゾーンのイベント時刻 (ms)
this._simEvents = [];         // 右ゾーンのイベント時刻 (ms)
this._realtimeRange = null;  // { start, end } 実データの時間範囲
this._simRanges = [];         // [{ start, end, dsId }] シミュレーション群
```

**新しいメソッド**:
```javascript
setNow(nowMs)                        // 現在時刻を設定（ウィンドウ再計算）
setRealtimeData(events, range)       // 左ゾーンのデータを設定
addSimulationData(events, range, dsId)  // 右ゾーンにシミュレーションデータを追加
clearSimulationData()
```

**描画ロジック**:
- ウィンドウ幅: 48時間固定
- `startMs = nowMs - 24 * 3600 * 1000`
- `endMs   = nowMs + 24 * 3600 * 1000`
- 左ゾーン（startMs〜nowMs）: 青みがかった背景
- 中央線（nowMs）: 緑の縦線＋"NOW"ラベル
- 右ゾーン（nowMs〜endMs）: 橙みがかった背景
- イベントドット: 左ゾーンは青、右ゾーンはオレンジ

#### 3-2. app.js 修正

**工場選択時の処理**:
```javascript
async function onFactorySelected(factoryId) {
    // 1. ポーリング開始要求
    await API.startPoller(factoryId);

    // 2. リアルタイムデータソース取得
    const realtimeSources = await API.fetchFactoryDataSources(factoryId, 'realtime');
    const latestRealtime = realtimeSources[0]; // ended_at=null の最新1件

    // 3. リアルタイムイベント取得（過去24h）
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const events = await API.fetchDataSourceEvents(latestRealtime.id, from);

    // 4. WebSocket 購読
    await subscribeWebSocket(latestRealtime.id);

    // 5. タイムラインに設定
    timeline.setNow(Date.now());
    timeline.setRealtimeData(events, { start: from, end: Date.now() });

    // 6. シミュレーション結果も読み込む
    await loadSimulationResults(factoryId);
}
```

**シーク時の処理**:
```javascript
function onSeek(ms, seeking) {
    // シーク位置が左（実績）か右（シミュレーション）かで使うデータソースを切り替える
    if (ms <= Date.now()) {
        applyHistoryAtTime(ms, realtimeEvents, realtimeLayout, seeking);
    } else {
        applyHistoryAtTime(ms, simEvents, simLayout, seeking);
    }
}
```

#### 3-3. シミュレーションスケジューリングUI

**UIパネル構成**:
```
[シミュレーション実行]
  開始日時: [DateTimePicker]
  実行時間: [input] 時間
  [今すぐ実行] [スケジュール登録]

[実行履歴]
  ○ 2026-05-27 00:00 〜 24h  [selected]
  ○ 2026-05-26 00:00 〜 24h
  ...
  ← 右ゾーンタイムラインに反映 →
```

**app.js のスケジューリング関数**:
```javascript
async function runSimulation(startDatetime, simulationHours) {
    const exec = await API.createExecution(factoryId, startDatetime, simulationHours * 3600);
    await pollExecution(exec.executionId, exec.dataSourceId);
    await loadSimulationResult(exec.dataSourceId, startDatetime, simulationHours * 3600);
}

async function selectSimulationResult(dataSourceId) {
    // 右ゾーンに選択したシミュレーション結果を表示
    const layout = await API.fetchDataSourceLayout(dataSourceId);
    const events = await API.fetchDataSourceEvents(dataSourceId);
    timeline.clearSimulationData();
    timeline.addSimulationData(events, { start, end }, dataSourceId);
    state.simDataSourceId = dataSourceId;
    state.simLayout = layout;
}
```

#### 3-4. api.js 追加

```javascript
// ポーラー制御
export async function startPoller(factoryId)
export async function stopPoller(factoryId)
export async function fetchPollerStatus(factoryId)

// ファクトリー別データソース
export async function fetchFactoryDataSources(factoryId, type = null)
```

### 4. docker-compose.yml（修正）

```yaml
factory-poller:
  build:
    context: ./factory-poller
  container_name: factory-poller
  environment:
    PORT: "8091"
    INTERNAL_DB_DSN: "host=postgres port=5432 dbname=factory_simulation user=postgres password=postgres"
  depends_on:
    - postgres
  networks:
    - factory-net

realtime-gateway:
  environment:
    FACTORY_POLLER_URL: "http://factory-poller:8091"  # 追加
```

## データフロー

### リアルタイムポーリングフロー

```
1. ユーザーが工場選択
2. app.js: POST /api/factories/{id}/poller/start
3. realtime-gateway → POST http://factory-poller:8091/poller/start (DB接続情報付き)
4. factory-poller: goroutine起動、外部DBへ1秒ごとポーリング
5. 新規イベント発見 → 内部DB INSERT → PostgreSQL NOTIFY 発火
6. realtime-gateway: NOTIFY受信 → WebSocket で factory-visualizer に配信
7. factory-visualizer: 左ゾーンタイムラインのイベントドットを更新
```

### シミュレーション実行フロー（修正後）

```
1. ユーザーが開始日時・実行時間を設定して「今すぐ実行」
2. app.js: POST /api/executions { factoryId, startDatetime, simulationTime }
3. realtime-gateway: CreateDataSource("simulation", ...) で data_source 作成  ← BUG FIX
4. realtime-gateway → simulation-core でシミュレーション実行
5. 結果が item_movement に保存される
6. app.js: 右ゾーンタイムラインにシミュレーション結果を表示
```

### シーク再生フロー

```
1. ユーザーがタイムラインをシーク（左ゾーン or 右ゾーン）
2. timeline.js: onSeek(ms) コールバック
3. app.js: ms < nowMs → realtimeEvents を applyHistoryAtTime に渡す
          ms ≥ nowMs → simEvents を applyHistoryAtTime に渡す
4. 3Dビューのワーク位置が更新される
```

## エラーハンドリング戦略

- **外部工場DB接続失敗**: factory-poller がリトライ（最大3回、1秒間隔）、失敗時は realtime-gateway に通知
- **ポーリング途中の接続断**: factory-poller がエラーログを記録し、次のティックで再試行
- **シミュレーション実行失敗**: 既存の `pollExecution` ポーリングで status='failed' を検出してUIに表示

## テスト戦略

### 動作確認（手動）
- Test Factory を選択 → 左ゾーンにイベントが表示されることを確認
- タイムラインをシーク → ワーク位置が変化することを確認
- シミュレーションを実行 → 右ゾーンに結果が表示されることを確認
- 左右をまたいでシーク → データソースの切り替えが正しく行われることを確認

## 依存ライブラリ

新規追加なし（factory-poller は `lib/pq` のみ使用、既に realtime-gateway で使用済み）

## ディレクトリ構造（変更・追加ファイル）

```
factory-poller/              ← 新規サービス
├── Dockerfile
├── go.mod
├── main.go
└── internal/
    ├── api/handler.go
    ├── poller/poller.go
    └── database/db.go

realtime-gateway/internal/api/handler.go   ← source_type バグ修正 + poller API 追加
realtime-gateway/internal/database/repository.go  ← fetchFactoryDataSources 追加（必要に応じて）

factory-visualizer/html/js/timeline.js     ← 3ゾーン再設計
factory-visualizer/html/js/app.js          ← ポーリング統合 + スケジューリングUI
factory-visualizer/html/js/api.js          ← poller API クライアント追加

docker-compose.yml                          ← factory-poller サービス追加
```

## 実装の順序

1. source_type バグ修正（最小変更・影響範囲小）
2. factory-poller サービス構築（Go）
3. realtime-gateway に poller 制御 API 追加
4. realtime-gateway に factory datasource フィルタリング API 追加
5. docker-compose に factory-poller 追加
6. api.js に新 API クライアント追加
7. timeline.js 3ゾーン再設計
8. app.js ポーリング統合・シーク切り替えロジック
9. シミュレーションスケジューリングUI
10. コンテナ再ビルド・動作確認

## セキュリティ考慮事項

- 外部工場DBのパスワードは `factories` テーブルに平文保存（既存仕様）、本フェーズでは変更しない
- factory-poller は Docker 内部ネットワーク経由でのみアクセス可能（外部公開しない）

## パフォーマンス考慮事項

- ポーリング間隔 1 秒は PostgreSQL の接続数に影響する。1 工場あたり接続を 1 本に制限する
- タイムラインのイベントドット描画: イベント数が多い場合（1万件超）はダウンサンプリングを検討
- `applyHistoryAtTime` は全イベントを線形スキャンするため、左・右ゾーンのイベントを分離して保持する

## 将来の拡張性

- 複数シミュレーション結果を右ゾーンに重ねて比較表示
- ポーリング間隔のUI設定
- 実際のcronスケジュール実行（現フェーズはUIのみ）
