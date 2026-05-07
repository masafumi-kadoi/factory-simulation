# 設計書: WDHスキーマ再設計

## 概要

WDH DBの全テーブルをsnake_case単数形に統一し、3Dビジュアライザ再生に必要な全情報（座標・接続・信号ログ）を格納できるよう再設計する。

## テーブル設計

### マスタ系（定義・構造データ）

#### location_master — 場所（ステーション）マスタ

| カラム名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| id | bigserial | NO | PRIMARY KEY | |
| name | varchar | NO | | ステーション名 |
| station_type | varchar | YES | | source/processing/drain/merge/split/moduler/entry/exit |
| parent_location_id | bigint | YES | FK → location_master.id | 親モジュラーのid（NULLならトップレベル） |
| pos_x | double precision | YES | | 3D表示X座標 |
| pos_y | double precision | YES | | 3D表示Y座標 |
| pos_z | double precision | YES | | 3D表示Z座標 |
| max_capacity | bigint | YES | | バッファ容量 |
| processing_time | double precision | YES | | 処理時間（秒） |
| merge_count | smallint | YES | | merge入力ポート数 |
| split_count | smallint | YES | | split出力ポート数 |

#### connection_master — 接続定義

| カラム名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| id | bigserial | NO | PRIMARY KEY | |
| from_location_id | bigint | NO | FK → location_master.id | 接続元 |
| to_location_id | bigint | NO | FK → location_master.id | 接続先 |
| from_port_index | smallint | YES | | 出力ポート番号（NULLまたは-1=なし） |
| to_port_index | smallint | YES | | 入力ポート番号（NULLまたは-1=なし） |
| condition | varchar | YES | | ルーティング条件 |

#### machine_master — 設備マスタ

| カラム名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| id | varchar(50) | NO | PRIMARY KEY | 設備ID |
| name | varchar(50) | NO | | 設備名 |
| location_id | bigint | YES | FK → location_master.id | 設置場所 |
| cycle_time | double precision | YES | | サイクルタイム（秒） |

#### item_master — ワーク定義

| カラム名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| id | varchar | NO | PRIMARY KEY | ワークID |
| item_type | varchar | NO | | ワーク種別 |

### ログ系（実行時イベントデータ）

#### item_movement — ワーク移動ログ

| カラム名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| event_time | timestamp | NO | | イベント発生時刻 |
| item_id | varchar | NO | | ワークID |
| from_location_id | bigint | YES | | 移動元location |
| to_location_id | bigint | YES | | 移動先location |
| movement_type | varchar | NO | | arrived / departed |
| port_index | smallint | YES | | ポートスロット（NULLまたは-1=なし） |

#### item_lineage — ワーク構成履歴

| カラム名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| event_time | timestamp | NO | | 発生時刻 |
| input_item_id | varchar | YES | | 入力ワークID |
| output_item_id | varchar | YES | | 出力ワークID |
| location_id | bigint | NO | | 発生場所 |

#### item_status — ワーク品質ステータス

| カラム名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| event_time | timestamp | NO | | 判定時刻 |
| item_id | varchar | NO | | ワークID |
| location_id | bigint | YES | | 判定場所 |
| status | smallint | YES | | 1=OK, 2=NG, 99=その他 |

#### item_expiry — ワーク有効期限

| カラム名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| item_id | varchar | NO | | ワークID |
| enabled_at | timestamp | NO | | 期限カウント開始時刻 |
| destination_location_id | bigint | NO | | 本来の行き先 |
| expires_at | timestamp | NO | | 期限切れ時刻 |
| expiry_location_id | bigint | NO | | 期限切れ時の退避先 |

#### machine_signal — 設備インターロック信号ログ

| カラム名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| event_time | timestamp | NO | | 発生時刻 |
| machine_id | varchar(50) | NO | | 設備ID |
| signal_name | varchar | NO | | inputReady/outputReady/カスタム名 |
| value | boolean | NO | | 変更後の値 |
| old_value | boolean | YES | | 変更前の値 |
| rule_id | varchar | YES | | トリガーしたルールID |

#### machine_status — 設備ビット状態

| カラム名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| event_time | timestamp | NO | | 更新時刻 |
| machine_id | varchar(50) | NO | | 設備ID |
| register_index | smallint | NO | | レジスタ番号 |
| bit_index | smallint | NO | | ビット番号 |
| bit_value | bit(1) | NO | | 値 |

#### system_error — 不正入力記録

| カラム名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| id | bigserial | NO | PRIMARY KEY | |
| db_name | varchar | NO | | 対象DB名 |
| table_name | varchar | NO | | 対象テーブル名 |
| record_no | bigint | NO | | レコード番号 |
| details | text | YES | | 詳細 |
| created_at | timestamp | NO | DEFAULT now() | 作成日時 |
| notified_at | timestamp | YES | | 通知日時 |
| UNIQUE | | | (db_name, table_name, record_no) | |

## 旧スキーマとの対応

| 旧テーブル名 | 新テーブル名 | 主な変更 |
|---|---|---|
| LocationMaster | location_master | pos_x/y/z, station_type, parent_location_id, processing_time, merge/split_count追加 |
| ProcMaster | connection_master | 用途変更（接続テーブル化）、from/to_location_id, port_index, condition |
| MachineMaster | machine_master | カラム名簡素化（machine_id→id, machine_name→name, machine_cycle_time→cycle_time） |
| ItemIDInfo | item_master | リネームのみ（item_id→id） |
| ActionInfo | item_movement | from/to_location_id方式に変更、port_index追加、action_status→movement_type |
| ItemConstructionMapping | item_lineage | カラム名簡素化 |
| ItemStatus | item_status | カラム名簡素化（update_timestamp→event_time, item_status→status） |
| (新設) | machine_signal | インターロック信号ログ |
| ExpiryTimeInfo | item_expiry | カラム名簡素化 |
| MachineStatus | machine_status | bit_status→bit_value |
| InvalidInputRecords | system_error | リネーム+簡素化 |

## エクスポーター改修方針

### schema.go
- 旧DDLを全て新テーブル定義に置き換え
- action_status ENUM型は削除（varchar化）

### exporter.go
- locationMap, procMap → locationMap のみに整理
- ExportResult.RecordCounts のキーを新テーブル名に変更

### masters.go
- exportLocationMaster(): pos_x, pos_y, pos_z, station_type, parent_location_id, processing_time, merge_count, split_count を追加
- exportProcMaster() → exportConnectionMaster(): from/to_location_id, from/to_port_index, condition を書き込み
- exportMachineMaster(): カラム名変更に対応

### events.go
- exportItemIDInfo() → exportItemMaster(): カラム名変更
- exportActionInfo() → exportItemMovement(): from/to_location_id方式 + port_index追加
- exportItemConstructionMapping() → exportItemLineage(): カラム名変更
- exportItemStatus(): カラム名変更
- exportMachineSignal(): 新規追加（StationStatusLogからsignal_changeイベントをエクスポート）

## データフロー

```
FlattenScenario
  ├─ Stations → location_master (座標・タイプ含む)
  ├─ Connections → connection_master (ポート・条件含む)
  └─ Source/Processing/Drain (非source/drain) → machine_master

WorkEventLog
  ├─ WorkCreated → item_master
  ├─ WorkArrived/Departed → item_movement (port_index含む)
  ├─ ProcessingCompleted (QualityStatus≠空) → item_status
  └─ WorkLineageLog → item_lineage

StationStatusLog (signal_change)
  └─ → machine_signal (machine_idはlocationMap経由で解決)
```
