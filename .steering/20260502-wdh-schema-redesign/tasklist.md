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

- [ ] `wdhexport/schema.go`: 新DDLに全面書き換え
  - [ ] action_status ENUM型を削除
  - [ ] location_master: pos_x, pos_y, pos_z, station_type, parent_location_id, processing_time, merge_count, split_count追加
  - [ ] connection_master: 旧ProcMasterを完全置換（from_location_id, to_location_id, from_port_index, to_port_index, condition）
  - [ ] machine_master: id, name, location_id, cycle_time
  - [ ] item_master: id, item_type
  - [ ] item_movement: event_time, item_id, from_location_id, to_location_id, movement_type, port_index
  - [ ] item_lineage: event_time, input_item_id, output_item_id, location_id
  - [ ] item_status: event_time, item_id, location_id, status
  - [ ] item_expiry: 定義
  - [ ] machine_signal: event_time, machine_id, signal_name, value, old_value, rule_id
  - [ ] machine_status: event_time, machine_id, register_index, bit_index, bit_value
  - [ ] system_error: id, db_name, table_name, record_no, details, created_at, notified_at

## フェーズ2: エクスポーター構造体更新

- [ ] `wdhexport/exporter.go`: Exporter構造体とExport()フローを更新
  - [ ] procMapフィールドを削除
  - [ ] ExportResult.RecordCountsのキーを新テーブル名に変更
  - [ ] Export()内の呼び出し順序を更新（exportConnectionMaster, exportMachineSignal追加）
  - [ ] ExportInput にStationStatusLogs []simulation.StationStatusLogを追加

## フェーズ3: マスタエクスポート更新

- [ ] `wdhexport/masters.go`: exportLocationMaster()を更新
  - [ ] pos_x, pos_y, pos_z の書き込み追加（station.Configまたはstation.PositionX/Y）
  - [ ] station_type の書き込み追加
  - [ ] parent_location_id の書き込み追加（StationModulerMapから親を解決）
  - [ ] processing_time の書き込み追加
  - [ ] merge_count, split_count の書き込み追加
- [ ] `wdhexport/masters.go`: exportProcMaster()をexportConnectionMaster()にリネーム・書き換え
  - [ ] scenarioのConnectionsをそのまま変換
  - [ ] from_location_id, to_location_id をlocationMapで解決
  - [ ] from_port_index, to_port_index を書き込み
  - [ ] condition を書き込み
- [ ] `wdhexport/masters.go`: exportMachineMaster()を更新
  - [ ] INSERT文のカラム名を新スキーマに合わせる（id, name, location_id, cycle_time）

## フェーズ4: イベントエクスポート更新

- [ ] `wdhexport/events.go`: exportItemIDInfo()をexportItemMaster()にリネーム
  - [ ] INSERT文のカラム名を新スキーマに合わせる
- [ ] `wdhexport/events.go`: exportActionInfo()をexportItemMovement()にリネーム・書き換え
  - [ ] from_location_id, to_location_id方式に変更
  - [ ] movement_type（arrived/departed）を文字列で書き込み
  - [ ] port_indexの書き込み追加（WorkEventLog.PortIndex）
- [ ] `wdhexport/events.go`: exportItemConstructionMapping()をexportItemLineage()にリネーム
  - [ ] INSERT文のカラム名を新スキーマに合わせる
- [ ] `wdhexport/events.go`: exportItemStatus()を更新
  - [ ] INSERT文のカラム名を新スキーマに合わせる（event_time, item_id, location_id, status）
- [ ] `wdhexport/events.go`: exportMachineSignal()を新規実装
  - [ ] StationStatusLogからsignal_changeイベントを抽出
  - [ ] stationID → machine_idマッピング（locationMapからmachine_masterに登録したステーションのIDを使用）
  - [ ] event_time, machine_id, signal_name, value, old_value, rule_idを書き込み

## フェーズ5: APIハンドラ更新

- [ ] `api/export.go`: HandleExportWDH()を更新
  - [ ] StationStatusLogsの取得を追加
  - [ ] ExportInputにStationStatusLogsを渡す

## フェーズ6: テスト

- [ ] `wdhexport/exporter_test.go`: テストを更新
  - [ ] TestCreateSchemaAndTables: 新テーブル名（11テーブル）で確認
  - [ ] TestExportLocationMaster: 新カラム（pos_x/y/z, station_type等）の検証追加
  - [ ] TestExportActionInfo → TestExportItemMovement: 新カラム検証
  - [ ] TestFullExport: 新スキーマ・machine_signal含む統合テスト
- [ ] 既存テストが全て通ることを確認
  - [ ] `go test ./internal/simulation/...`
  - [ ] `go test ./internal/wdhexport/...`

## フェーズ7: 動作確認

- [ ] Dockerコンテナを再ビルドして起動する
- [ ] エクスポートAPIを呼び出して新スキーマでDB作成を確認
- [ ] 作成されたDBの全テーブルとデータを確認する
  - [ ] location_masterに座標・タイプが格納されていること
  - [ ] connection_masterに接続情報が正しく格納されていること
  - [ ] machine_signalにインターロック信号ログが格納されていること

## フェーズ8: 振り返り

- [ ] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日
{YYYY-MM-DD}

### 計画と実績の差分

**計画と異なった点**:
- {計画時には想定していなかった技術的な変更点}
- {実装方針の変更とその理由}

**新たに必要になったタスク**:
- {実装中に追加したタスク}
- {なぜ追加が必要だったか}

**技術的理由でスキップしたタスク**（該当する場合のみ）:
- {タスク名}
  - スキップ理由: {具体的な技術的理由}
  - 代替実装: {何に置き換わったか}

### 学んだこと

**技術的な学び**:
- {実装を通じて学んだ技術的な知見}

**プロセス上の改善点**:
- {タスク管理で良かった点}

### 次回への改善提案
- {次回の機能追加で気をつけること}
