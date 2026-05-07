# 要求定義: WDHスキーマ再設計

## 背景

WDH（WorkflowDataHub）DBをResultVisualizerのデータソースとして使用するため、3Dタイムライン再生に必要な全情報をWDH DBに格納できるようスキーマを再設計する。

## 要求

### R1: スキーマ命名規則の統一
- テーブル名: snake_case + 単数形
- カラム名: snake_case
- ダブルクォート不要なPostgreSQL標準形式

### R2: 3D可視化に必要な情報の格納
- ステーション座標（pos_x, pos_y, pos_z）
- ステーションタイプ
- モジュラー階層構造（parent_location_id）
- 接続情報（ポートインデックス、ルーティング条件含む）

### R3: インターロック信号ログの格納
- machine_signalテーブル新設
- 信号名、値、変更前の値、トリガールールIDを記録

### R4: テーブル名の意味明確化
- 所属エンティティが一目で分かるプレフィックス
  - item_*: ワーク関連
  - machine_*: 設備関連
  - system_*: システム管理
- 旧名で意味不明だったものをリネーム
  - ProcMaster → connection_master
  - ActionInfo → item_movement
  - ItemIDInfo → item_master
  - ItemConstructionMapping → item_lineage
  - ExpiryTimeInfo → item_expiry
  - InvalidInputRecords → system_error

### R5: エクスポーター（wdhexport）の対応更新
- 新スキーマに合わせてDDLと全エクスポートロジックを更新
- 新規カラム（座標、station_type、port_index等）のエクスポート追加
- signal_logエクスポート追加

### R6: テスト
- 既存テストを新スキーマに対応更新
- signal_logのエクスポートテストを追加
