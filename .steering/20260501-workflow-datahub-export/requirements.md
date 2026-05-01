# 要求内容

## 概要

シミュレーション完了後、その結果をWorkflowDataHubテーブル定義に準拠したPostgreSQLデータベースへエクスポートする機能を追加する。1シミュレーションに対して1つの専用DBが作成される。

## 背景

工場の実データはWorkflowDataHubというDBスキーマに格納されている。シミュレーション結果を同じスキーマで格納することで、実データ用の分析ツールやダッシュボードをそのままシミュレーション結果にも適用できる。これにより、シミュレーションと実運用データの比較分析が容易になる。

## 実装対象の機能

### 1. WorkflowDataHub DBの自動作成

- シミュレーション完了時に、専用のPostgreSQLデータベースを自動作成する
- DB名は `wdh_{simulation_id_short}` の形式（例: `wdh_a1b2c3d4`）
- WorkflowDataHubテーブル定義に準拠した全10テーブルを作成する
- 作成したDB接続情報をシミュレーション結果に記録する

### 2. マスターテーブルの生成

- **LocationMaster**: シナリオのstationsから地点情報を生成する
  - bigserial連番IDを振り、station ID（文字列）を`name`カラムに格納する
  - `max_capacity`はステーションのバッファ容量から取得（デフォルト1）
- **ProcMaster**: connections の前後関係から工程情報を生成する
  - 各stationに工程IDを割り当て、接続関係から前工程・後工程を設定する
  - `location_id`はLocationMasterのIDを参照する
- **MachineMaster**: stationを設備として登録する
  - `machine_id`はstation IDベース、`machine_name`にフレンドリーネームを設定する
  - `location_id`でLocationMasterと紐づける
  - `andonlog_table`はプレースホルダー値を設定する

### 3. イベントデータの変換・格納

- **ActionInfo**: WorkArrived/WorkDepartedイベントを到着・出発レコードに変換する
  - シミュレーション開始日時を基準とした絶対時刻（timestamp型）として記録する
  - station IDからLocationMaster IDへのマッピングを適用する
- **ItemIDInfo**: 生成されたワーク一覧をアイテム情報として登録する
  - `item_type`はワーク種別（work.Typeフィールド）から設定する
- **ItemConstructionMapping**: Merge/Splitイベントからワーク紐づけ情報を生成する
  - WorkLineageLogの parent/child 関係から投入・取出アイテムIDを設定する
- **ItemStatus**: inspectionステーションでの品質判定結果を格納する
  - WorkInspectedイベントからOK/NG情報を変換する（OK=1, NG=2, 未判定=null）

### 4. 将来対応テーブルの空作成

- **ExpiryTimeInfo**: テーブルのみ作成（データなし）
- **MachineStatus**: テーブルのみ作成（データなし）
- **InvalidInputRecords**: テーブルのみ作成（データなし）

### 5. エクスポートAPIエンドポイント

- `POST /api/simulations/{id}/export-wdh`: シミュレーション結果をWorkflowDataHub形式でエクスポートする
- エクスポート済みのDB名を返却する
- 既にエクスポート済みの場合はエラーまたは上書き選択を返す

## 受け入れ条件

### DB作成・スキーマ

- [ ] シミュレーション完了後、APIを呼ぶと専用DBが自動作成される
- [ ] 作成されたDBにWorkflowDataHub定義の全10テーブルが存在する
- [ ] テーブルのカラム定義・制約・インデックスがテーブル定義書と一致する

### マスターテーブル

- [ ] LocationMasterに全stationが連番IDで登録される
- [ ] ProcMasterにconnectionsの順序関係が正しく反映される
- [ ] MachineMasterにstation情報が設備として登録され、LocationMasterとlocation_idで紐づく

### イベントデータ

- [ ] ActionInfoにworkのarrived/departedイベントが正しいtimestamp・location_idで格納される
- [ ] タイムスタンプはシミュレーション開始日時を基準とした絶対時刻である
- [ ] ItemIDInfoに全ワークが登録される
- [ ] ItemConstructionMappingにMerge/Splitの紐づけ情報が格納される
- [ ] ItemStatusにinspection結果が格納される

### API

- [ ] `POST /api/simulations/{id}/export-wdh` でエクスポートが実行できる
- [ ] レスポンスにDB名と接続情報が含まれる

## 成功指標

- Source → Processing → Inspection → Drain のシナリオで、全テーブルにデータが正しく格納される
- Merge/Splitを含むシナリオで、ItemConstructionMappingに正しい紐づけが記録される
- エクスポート後のDBに対して、実データ用のSQLクエリ（例: アイテムの移動履歴取得）がそのまま動作する

## スコープ外

以下はこのフェーズでは実装しない:

- ExpiryTimeInfoへのデータ格納（消費期限機能のシミュレーション対応が先に必要）
- MachineStatusへのデータ格納（Andonビットレベルの設備状態モデリングが先に必要）
- フロントエンド（エクスポートボタンUI等）
- エクスポート済みDBの自動削除・クリーンアップ

## 参照ドキュメント

- `docs/WorkflowDataHub_テーブル定義書.xlsx` - WorkflowDataHubテーブル定義書
