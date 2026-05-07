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

## フェーズ1: スキーマDDL書き換え

- [x] `wdhexport/schema.go`: 新DDLに全面書き換え
  - [x] action_status ENUM型を削除
  - [x] location_master: pos_x, pos_y, pos_z, station_type, parent_location_id, processing_time, merge_count, split_count追加
  - [x] connection_master: 旧ProcMasterを完全置換（from_location_id, to_location_id, from_port_index, to_port_index, condition）
  - [x] machine_master: id, name, location_id, cycle_time
  - [x] item_master: id, item_type
  - [x] item_movement: event_time, item_id, from_location_id, to_location_id, movement_type, port_index
  - [x] item_lineage: event_time, input_item_id, output_item_id, location_id
  - [x] item_status: event_time, item_id, location_id, status
  - [x] item_expiry: 定義
  - [x] machine_signal: event_time, machine_id, signal_name, value, old_value, rule_id
  - [x] machine_status: event_time, machine_id, register_index, bit_index, bit_value
  - [x] system_error: id, db_name, table_name, record_no, details, created_at, notified_at

## フェーズ2: エクスポーター構造体更新

- [x] `wdhexport/exporter.go`: Exporter構造体とExport()フローを更新
  - [x] procMapフィールドを削除
  - [x] ExportResult.RecordCountsのキーを新テーブル名に変更
  - [x] Export()内の呼び出し順序を更新（exportConnectionMaster, exportMachineSignal追加）
  - [x] ExportInput にStationStatusLogs []simulation.StationStatusLogを追加

## フェーズ3: マスタエクスポート更新

- [x] `wdhexport/masters.go`: exportLocationMaster()を更新
  - [x] pos_x, pos_y, pos_z の書き込み追加（station.Configまたはstation.PositionX/Y）
  - [x] station_type の書き込み追加
  - [x] parent_location_id の書き込み追加（StationModulerMapから親を解決）
  - [x] processing_time の書き込み追加
  - [x] merge_count, split_count の書き込み追加
- [x] `wdhexport/masters.go`: exportProcMaster()をexportConnectionMaster()にリネーム・書き換え
  - [x] scenarioのConnectionsをそのまま変換
  - [x] from_location_id, to_location_id をlocationMapで解決
  - [x] from_port_index, to_port_index を書き込み
  - [x] condition を書き込み
- [x] `wdhexport/masters.go`: exportMachineMaster()を更新
  - [x] INSERT文のカラム名を新スキーマに合わせる（id, name, location_id, cycle_time）

## フェーズ4: イベントエクスポート更新

- [x] `wdhexport/events.go`: exportItemIDInfo()をexportItemMaster()にリネーム
  - [x] INSERT文のカラム名を新スキーマに合わせる
- [x] `wdhexport/events.go`: exportActionInfo()をexportItemMovement()にリネーム・書き換え
  - [x] from_location_id, to_location_id方式に変更
  - [x] movement_type（arrived/departed）を文字列で書き込み
  - [x] port_indexの書き込み追加（WorkEventLog.PortIndex）
- [x] `wdhexport/events.go`: exportItemConstructionMapping()をexportItemLineage()にリネーム
  - [x] INSERT文のカラム名を新スキーマに合わせる
- [x] `wdhexport/events.go`: exportItemStatus()を更新
  - [x] INSERT文のカラム名を新スキーマに合わせる（event_time, item_id, location_id, status）
- [x] `wdhexport/events.go`: exportMachineSignal()を新規実装
  - [x] StationStatusLogからsignal_changeイベントを抽出
  - [x] stationID → machine_idマッピング（locationMapからmachine_masterに登録したステーションのIDを使用）
  - [x] event_time, machine_id, signal_name, value, old_value, rule_idを書き込み

## フェーズ5: APIハンドラ更新

- [x] `api/export.go`: HandleExportWDH()を更新
  - [x] StationStatusLogsの取得を追加
  - [x] ExportInputにStationStatusLogsを渡す

## フェーズ6: テスト

- [x] `wdhexport/exporter_test.go`: テストを更新
  - [x] TestCreateSchemaAndTables: 新テーブル名（11テーブル）で確認
  - [x] TestExportLocationMaster: 新カラム（pos_x/y/z, station_type等）の検証追加
  - [x] TestExportActionInfo → TestExportItemMovement: 新カラム検証
  - [x] TestFullExport: 新スキーマ・machine_signal含む統合テスト
- [x] 既存テストが全て通ることを確認
  - [x] `go test ./internal/simulation/...`
  - [x] `go test ./internal/wdhexport/...`

## フェーズ7: 動作確認

- [x] Dockerコンテナを再ビルドして起動する
- [x] エクスポートAPIを呼び出して新スキーマでDB作成を確認
- [x] 作成されたDBの全テーブルとデータを確認する
  - [x] location_masterに座標・タイプが格納されていること
  - [x] connection_masterに接続情報が正しく格納されていること
  - [x] machine_signalにインターロック信号ログが格納されていること

## フェーズ8: 振り返り

- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日
2026-05-07

### 計画と実績の差分

**計画と異なった点**:
- exportItemMovementのfrom/to_location_id解決ロジックが当初想定より複雑だった（WorkHistoryを構築し前後のDeparted/Arrivedイベントから推定する方式を採用）
- machine_signalのmachine_idはstation.IDをそのまま使用（machine_masterと同じIDを使用することで結合可能にした）

**新たに必要になったタスク**:
- TestExportMachineSignalテストの追加（signal_changeフィルタリングの検証が必要だった）
- exportItemMovementのport_index対応（WorkEventLog.PortIndexを使用）

**技術的理由でスキップしたタスク**: なし

### 学んだこと

**技術的な学び**:
- DESのイベント→RDBのfrom/to変換は「前のDepartedイベント元」から推定するのが安定する
- StationModulerMapを使ったparent_location_id解決は、locationMapにまだIDが登録されていない場合があるためFlattenScenarioの順序（親→子）が重要

**プロセス上の改善点**:
- ドキュメント設計→定義書作成→実装の順序が明確で、テーブル設計の議論が実装前に収束できた

### 次回への改善提案
- machine_statusテーブルは将来のビット信号変換実装時に使用する（今回はスキーマ定義のみ、データ投入なし）
- ResultVisualizerがWDH DBから読み取る際は、location_masterのpos_x/pos_yとitem_movementのevent_timeが3D表示の主要データソースになる
