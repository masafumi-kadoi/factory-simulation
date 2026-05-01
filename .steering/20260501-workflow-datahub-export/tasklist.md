# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### 実装可能なタスクのみを計画
- 計画段階で「実装可能なタスク」のみをリストアップ
- 「将来やるかもしれないタスク」は含めない
- 「検討中のタスク」は含めない

### タスクスキップが許可される唯一のケース
以下の技術的理由に該当する場合のみスキップ可能:
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:
```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

### タスクが大きすぎる場合
- タスクを小さなサブタスクに分割
- 分割したサブタスクをこのファイルに追加
- サブタスクを1つずつ完了させる

---

## フェーズ1: エンジン側の最小変更

- [x] WorkEventLogにQualityStatusフィールドを追加する
  - [x] `simulation/engine.go`: WorkEventLog構造体にQualityStatus string フィールドを追加（既に存在）
  - [x] `simulation/engine.go`: logWorkEventでwork.QualityStatusを記録するよう変更
  - [x] `database/repository.go`: SaveWorkEvents/GetWorkEventsでQualityStatusを含める
  - [x] 既存テストが通ることを確認（`go test ./internal/simulation/...`）

## フェーズ2: DDL・スキーマ定義

- [x] `internal/wdhexport/` パッケージを新規作成する
- [x] `wdhexport/schema.go`: WorkflowDataHubスキーマのDDLを定義する
  - [x] action_status ENUM型の定義
  - [x] LocationMaster テーブル定義（bigserial PK, name, max_capacity）
  - [x] ProcMaster テーブル定義（id, no, pre_proc_id, post_proc_id, location_id, traceabi_table）
  - [x] MachineMaster テーブル定義（machine_id UNIQUE, machine_name, andonlog_table, location_id, machine_cycle_time）
  - [x] ActionInfo テーブル定義（event_timestamp, item_id, origin/destination_location_id, action_status）
  - [x] ItemIDInfo テーブル定義（item_id UNIQUE, item_type）
  - [x] ItemConstructionMapping テーブル定義
  - [x] ItemStatus テーブル定義
  - [x] ExpiryTimeInfo テーブル定義（空テーブル）
  - [x] MachineStatus テーブル定義（空テーブル）
  - [x] InvalidInputRecords テーブル定義（空テーブル）
  - [x] `CreateSchema(db *sql.DB) error` 関数を実装する

## フェーズ3: Exporter骨格

- [x] `wdhexport/exporter.go`: Exporter構造体を定義する
  - [x] ExportConfig構造体（Host, Port, User, Password, BaseTime）
  - [x] ExportResult構造体（DatabaseName, Host, Port, User, RecordCounts）
  - [x] Exporter構造体（adminDB, targetDB, dbName, locationMap, procMap, config）
- [x] `wdhexport/exporter.go`: NewExporter(config ExportConfig) を実装する
- [x] `wdhexport/exporter.go`: CreateDatabase() を実装する
  - [x] DB名の生成: `wdh_` + simulationIDの先頭8文字
  - [x] 既存DBがあればDROP
  - [x] CREATE DATABASEの実行
  - [x] 新DBへの接続確立
- [x] `wdhexport/exporter.go`: Export()メインメソッドを実装する
  - [x] CreateDatabase → CreateSchema → ExportMasters → ExportEvents の順序で呼び出し
  - [x] エラー時のクリーンアップ（作成途中のDBをDROP）
  - [x] ExportResult の構築と返却
- [x] ~~`wdhexport/exporter.go`: Close() でDB接続クローズ~~（実装方針変更により不要: Export()内でdefer Close()するため、外部からのClose()は不要）

## フェーズ4: マスターテーブル生成

- [x] `wdhexport/masters.go`: ExportLocationMaster() を実装する
  - [x] フラット展開済みシナリオの全stationsをINSERT
  - [x] RETURNING id で連番IDを取得しlocationMapに記録
  - [x] max_capacityの設定（デフォルト1）
- [x] `wdhexport/masters.go`: ExportProcMaster() を実装する
  - [x] 各stationに工程ID（1000番台連番）を割り当て
  - [x] connectionsから前工程・後工程を設定
  - [x] location_idをlocationMapから取得
- [x] `wdhexport/masters.go`: ExportMachineMaster() を実装する
  - [x] source/drain以外のstationを設備として登録
  - [x] machine_id = station.ID, machine_name = station.Name or station.ID
  - [x] andonlog_table = "sim_" + station.ID
  - [x] location_idをlocationMapから取得
  - [x] machine_cycle_time = processingTimeがあれば設定

## フェーズ5: イベントデータ変換

- [x] `wdhexport/events.go`: simTimeToTimestamp() ヘルパーを実装する
  - [x] BaseTime + simTime秒 → time.Time
- [x] `wdhexport/events.go`: ExportItemIDInfo() を実装する
  - [x] WorkCreatedイベントからワーク一覧を抽出
  - [x] item_type = WorkType（空なら "work"）
  - [x] 重複排除してINSERT
- [x] `wdhexport/events.go`: ExportActionInfo() を実装する
  - [x] WorkArrivedイベント → arrived レコード
  - [x] WorkDepartedイベント → departed レコード
  - [x] locationMapでstation ID → location_idに変換
  - [x] origin/destination_location_idの設定（前後のイベントから取得）
  - [x] バッチINSERT（トランザクション + Prepared Statement）
- [x] `wdhexport/events.go`: ExportItemConstructionMapping() を実装する
  - [x] WorkLineageLogからmerge/split紐づけ情報を生成
  - [x] input_item_id, output_item_id, construction_mapping_location_id, event_timestampの設定
- [x] `wdhexport/events.go`: ExportItemStatus() を実装する
  - [x] ProcessingCompletedイベントからステータス変化を抽出（WorkInspectedは現在未発行のため）
  - [x] QualityStatus → item_status変換（OK=1, NG=2, 未判定=スキップ, その他=99）

## フェーズ6: API統合

- [x] `api/export.go`: HandleExportWDH() を実装する
  - [x] パスからシミュレーションIDを取得
  - [x] シミュレーション結果の取得（simulation, scenario, workEvents, lineage）
  - [x] FlattenScenarioの実行
  - [x] ExportConfig構築（baseTimeはリクエストパラメータまたはsimulation.CreatedAt）
  - [x] Exporter生成・Export実行
  - [x] ExportResult をJSONで返却
- [x] `cmd/server/main.go`: エクスポートAPIルートを追加する
  - [x] `POST /api/simulations/{id}/export-wdh` のルーティング追加
- [x] work_eventsテーブルにquality_statusカラムを追加するマイグレーション
  - [x] `cmd/server/main.go`のDB初期化SQLに `ALTER TABLE IF EXISTS` を追加

## フェーズ7: テスト

- [x] `wdhexport/exporter_test.go`: テストを実装する
  - [x] TestCreateSchemaAndTables: 全10テーブルが作成されることを確認
  - [x] TestExportLocationMaster: stationsが正しくLocationMasterに変換されること
  - [x] TestExportActionInfo: WorkEventLogが正しくActionInfoに変換されること（同一タイムスタンプのorigin解決バグも修正）
  - [x] TestTimestampConversion: simTimeToTimestampの正確性
  - [x] TestFullExport: 基本シナリオでの統合テスト（Source→Processing→Drain）
- [x] 既存テストが全て通ることを確認する
  - [x] `go test ./internal/simulation/...`
  - [x] `go test ./internal/wdhexport/...`

## フェーズ8: 動作確認

- [x] Dockerコンテナを再ビルドして起動する
- [x] シミュレーションを実行し、エクスポートAPIを呼び出す
  - [x] `POST /api/simulations/0a18ff10-.../export-wdh` → 成功（6 locations, 24 actions, 3 items）
  - [x] 大規模シナリオ（103 stations）でも成功（380 actions, 8 construction mappings）
- [x] 作成されたDBに接続し、テーブルとデータを確認する
  - [x] LocationMasterに全stationが登録されていること
  - [x] ActionInfoにarrived/departedレコードが正しいtimestampで格納されていること（GetSimulationにcreated_at追加で修正）
  - [x] ItemIDInfoに全ワークが登録されていること

## フェーズ9: ドキュメント更新

- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日
2026-05-01

### 計画と実績の差分

**計画と異なった点**:
- `api/handler.go` ではなく `api/export.go` に分離して実装（handler.goの肥大化を避けるため）
- `GetSimulation()` のSELECTに `created_at` が含まれておらず、BaseTimeがゼロ値になるバグを発見・修正
- `exportActionInfo()` のorigin/destination解決で、同一タイムスタンプのdeparted→arrivedペアが正しくマッチしないバグをテストで発見し修正（`<` → `<=` + 異なるstation条件を追加）
- `WorkInspected` イベントが未実装のため、`ProcessingCompleted` イベントからQualityStatusを取得する方式に変更

**新たに必要になったタスク**:
- `repository.go` の `GetSimulation()` に `created_at` カラムの追加（BaseTime計算に必要）
- `Exporter.Close()` は `Export()` 内でdefer Closeするため外部公開不要と判断

**技術的理由でスキップしたタスク**:
- `Exporter.Close()` — Export()メソッド内でdefer Close()しているため、外部からのClose()呼び出しは不要

### 学んだこと

**技術的な学び**:
- DESのイベントは同一タイムスタンプで発生することが多く、origin/destination解決には `<=`/`>=` と station ID の区別が必要
- PostgreSQLの `CREATE DATABASE` は他のDB接続がアクティブだと失敗するため、`pg_terminate_backend` でのクリーンアップが必要
- `RETURNING id` によるbigserial値の取得パターンが、IDマッピング構築に有効

**プロセス上の改善点**:
- テストが実装の品質担保に直結（ActionInfoのtimestamp比較バグをテストで即発見）
- フェーズ分割により各段階の動作確認が容易だった

### 次回への改善提案
- 既存のリポジトリメソッドで取得する列を事前確認する（CreatedAtの欠落のようなバグを防ぐ）
- DB依存テストにはスキップ機構を入れてCIでの柔軟な実行を可能にする
- ExpiryTimeInfo / MachineStatus テーブルは空で作成済み。将来シミュレーションエンジンに対応イベントを追加すれば、エクスポーターの拡張は容易
