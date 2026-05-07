# WorkflowDataHub テーブル定義書

## 概要

WorkflowDataHub（WDH）は、工場の生産ラインにおけるワークフロー実績・シミュレーション結果を格納するデータベーススキーマである。1シミュレーション（または1生産実行）に対して1つのデータベースが作成される。

DB命名規則: `wdh_{識別子の先頭8文字}`

## 命名規則

- テーブル名: snake_case + 単数形
- カラム名: snake_case
- プレフィックスによるエンティティ分類:
  - `location_*` — 場所（ステーション）関連
  - `connection_*` — 接続関連
  - `machine_*` — 設備関連
  - `item_*` — ワーク関連
  - `system_*` — システム管理

## テーブル分類

| 分類 | テーブル名 | 用途 |
|---|---|---|
| マスタ | location_master | 場所（ステーション）定義 |
| マスタ | connection_master | 接続定義 |
| マスタ | machine_master | 設備定義 |
| マスタ | item_master | ワーク定義 |
| ログ | item_movement | ワーク移動記録 |
| ログ | item_lineage | ワーク構成変化記録 |
| ログ | item_status | ワーク品質判定記録 |
| ログ | item_expiry | ワーク有効期限記録 |
| ログ | machine_signal | 設備インターロック信号記録 |
| ログ | machine_status | 設備ビット状態記録 |
| 管理 | system_error | 不正入力記録 |

---

## マスタテーブル

### location_master — 場所（ステーション）マスタ

工場内の全ステーション（加工・搬送・検査ポイント等）を定義する。

| # | カラム名 | データ型 | NULL | 制約 | 説明 |
|---|---|---|---|---|---|
| 1 | id | bigserial | NO | PRIMARY KEY | 場所ID（自動採番） |
| 2 | name | varchar | NO | | ステーション名 |
| 3 | station_type | varchar | YES | | ステーション種別（source/processing/drain/merge/split/moduler/entry/exit） |
| 4 | parent_location_id | bigint | YES | FK → location_master.id | 親モジュラーのID（NULLならトップレベル） |
| 5 | pos_x | double precision | YES | | 3D表示X座標 |
| 6 | pos_y | double precision | YES | | 3D表示Y座標 |
| 7 | pos_z | double precision | YES | | 3D表示Z座標 |
| 8 | max_capacity | bigint | YES | | バッファ容量 |
| 9 | processing_time | double precision | YES | | 処理時間（秒） |
| 10 | merge_count | smallint | YES | | merge入力ポート数 |
| 11 | split_count | smallint | YES | | split出力ポート数 |

**station_type 値定義:**

| 値 | 説明 |
|---|---|
| source | ワーク投入口 |
| processing | 加工ステーション |
| drain | ワーク排出口 |
| merge | 複数入力合流 |
| split | 複数出力分岐 |
| moduler | モジュラー（内部にサブ構造を持つ） |
| entry | モジュラー入口 |
| exit | モジュラー出口 |

---

### connection_master — 接続定義

ステーション間の接続（ワークの流れ）を定義する。1レコード = 1接続。
merge（多→1）やsplit（1→多）は複数レコードで表現する。

| # | カラム名 | データ型 | NULL | 制約 | 説明 |
|---|---|---|---|---|---|
| 1 | id | bigserial | NO | PRIMARY KEY | 接続ID（自動採番） |
| 2 | from_location_id | bigint | NO | FK → location_master.id | 接続元ステーション |
| 3 | to_location_id | bigint | NO | FK → location_master.id | 接続先ステーション |
| 4 | from_port_index | smallint | YES | | 出力ポート番号（NULLまたは-1 = ポートなし） |
| 5 | to_port_index | smallint | YES | | 入力ポート番号（NULLまたは-1 = ポートなし） |
| 6 | condition | varchar | YES | | ルーティング条件 |

**condition 値定義:**

| 値 | 説明 |
|---|---|
| default | 無条件（デフォルト） |
| quality_ok | 品質OK時のみ通過 |
| quality_ng | 品質NG時のみ通過 |
| workType:{type} | 指定ワーク種別のみ通過 |

---

### machine_master — 設備マスタ

ステーション上に設置される設備を定義する。source/drain以外のステーションが対象。

| # | カラム名 | データ型 | NULL | 制約 | 説明 |
|---|---|---|---|---|---|
| 1 | id | varchar(50) | NO | PRIMARY KEY | 設備ID |
| 2 | name | varchar(50) | NO | | 設備名 |
| 3 | location_id | bigint | YES | FK → location_master.id | 設置場所 |
| 4 | cycle_time | double precision | YES | | サイクルタイム（秒） |

---

### item_master — ワーク定義

シミュレーション/生産実行中に存在した全ワークを定義する。

| # | カラム名 | データ型 | NULL | 制約 | 説明 |
|---|---|---|---|---|---|
| 1 | id | varchar | NO | PRIMARY KEY | ワークID |
| 2 | item_type | varchar | NO | | ワーク種別（例: partA, assembly-AB） |

---

## ログテーブル

### item_movement — ワーク移動ログ

ワークがステーションに到着/出発した記録。3Dタイムライン再生の主要データソース。

| # | カラム名 | データ型 | NULL | 制約 | 説明 |
|---|---|---|---|---|---|
| 1 | event_time | timestamp | NO | | イベント発生時刻 |
| 2 | item_id | varchar | NO | | ワークID |
| 3 | from_location_id | bigint | YES | FK → location_master.id | 移動元ステーション |
| 4 | to_location_id | bigint | YES | FK → location_master.id | 移動先ステーション |
| 5 | movement_type | varchar | NO | | イベント種別 |
| 6 | port_index | smallint | YES | | ポートバッファスロット番号（NULLまたは-1 = ポートなし） |

**movement_type 値定義:**

| 値 | 説明 |
|---|---|
| arrived | ステーションに到着 |
| departed | ステーションから出発 |

---

### item_lineage — ワーク構成変化記録

merge（合流）やsplit（分岐）によるワークの構成変化を記録する。

| # | カラム名 | データ型 | NULL | 制約 | 説明 |
|---|---|---|---|---|---|
| 1 | event_time | timestamp | NO | | 発生時刻 |
| 2 | input_item_id | varchar | YES | | 入力ワークID（merge元 / split元） |
| 3 | output_item_id | varchar | YES | | 出力ワークID（merge先 / split先） |
| 4 | location_id | bigint | NO | FK → location_master.id | 発生場所 |

---

### item_status — ワーク品質判定記録

検査工程での品質判定結果を記録する。

| # | カラム名 | データ型 | NULL | 制約 | 説明 |
|---|---|---|---|---|---|
| 1 | event_time | timestamp | NO | | 判定時刻 |
| 2 | item_id | varchar | NO | | ワークID |
| 3 | location_id | bigint | YES | FK → location_master.id | 判定場所 |
| 4 | status | smallint | YES | | 品質ステータス |

**status 値定義:**

| 値 | 説明 |
|---|---|
| 1 | OK（良品） |
| 2 | NG（不良品） |
| 99 | その他 |

---

### item_expiry — ワーク有効期限記録

ワークの滞留時間制限と期限切れ時の処理先を記録する。

| # | カラム名 | データ型 | NULL | 制約 | 説明 |
|---|---|---|---|---|---|
| 1 | item_id | varchar | NO | | ワークID |
| 2 | enabled_at | timestamp | NO | | 期限カウント開始時刻 |
| 3 | destination_location_id | bigint | NO | FK → location_master.id | 本来の行き先 |
| 4 | expires_at | timestamp | NO | | 期限切れ時刻 |
| 5 | expiry_location_id | bigint | NO | FK → location_master.id | 期限切れ時の退避先 |

---

### machine_signal — 設備インターロック信号ログ

設備のインターロック制御信号の変化を記録する。搬入可/搬出可信号の履歴。

| # | カラム名 | データ型 | NULL | 制約 | 説明 |
|---|---|---|---|---|---|
| 1 | event_time | timestamp | NO | | 発生時刻 |
| 2 | machine_id | varchar(50) | NO | FK → machine_master.id | 設備ID |
| 3 | signal_name | varchar | NO | | 信号名 |
| 4 | value | boolean | NO | | 変更後の値 |
| 5 | old_value | boolean | YES | | 変更前の値 |
| 6 | rule_id | varchar | YES | | トリガーしたインターロックルールID |

**signal_name 代表値:**

| 値 | 説明 |
|---|---|
| inputReady | 搬入可信号 |
| outputReady | 搬出可信号 |
| (カスタム名) | ユーザー定義のインターロック信号 |

---

### machine_status — 設備ビット状態記録

設備のレジスタ/ビット単位の状態変化を記録する。実機連携時に使用。
将来的にビット定義マスタと組み合わせてmachine_signalに変換するロジックを追加予定。

| # | カラム名 | データ型 | NULL | 制約 | 説明 |
|---|---|---|---|---|---|
| 1 | event_time | timestamp | NO | | 更新時刻 |
| 2 | machine_id | varchar(50) | NO | FK → machine_master.id | 設備ID |
| 3 | register_index | smallint | NO | | レジスタ番号 |
| 4 | bit_index | smallint | NO | | ビット番号 |
| 5 | bit_value | bit(1) | NO | | ビット値 |

---

## 管理テーブル

### system_error — 不正入力記録

データ取り込み時の不正レコードを記録する。

| # | カラム名 | データ型 | NULL | 制約 | 説明 |
|---|---|---|---|---|---|
| 1 | id | bigserial | NO | PRIMARY KEY | |
| 2 | db_name | varchar | NO | | 対象DB名 |
| 3 | table_name | varchar | NO | | 対象テーブル名 |
| 4 | record_no | bigint | NO | | レコード番号 |
| 5 | details | text | YES | | エラー詳細 |
| 6 | created_at | timestamp | NO | DEFAULT now() | 検出日時 |
| 7 | notified_at | timestamp | YES | | 通知日時 |

**制約:** UNIQUE (db_name, table_name, record_no)

---

## DDL

```sql
CREATE TABLE location_master (
    id                 bigserial PRIMARY KEY,
    name               varchar NOT NULL,
    station_type       varchar,
    parent_location_id bigint,
    pos_x              double precision,
    pos_y              double precision,
    pos_z              double precision,
    max_capacity       bigint,
    processing_time    double precision,
    merge_count        smallint,
    split_count        smallint
);

CREATE TABLE connection_master (
    id                bigserial PRIMARY KEY,
    from_location_id  bigint NOT NULL,
    to_location_id    bigint NOT NULL,
    from_port_index   smallint,
    to_port_index     smallint,
    condition         varchar
);

CREATE TABLE machine_master (
    id          varchar(50) PRIMARY KEY,
    name        varchar(50) NOT NULL,
    location_id bigint,
    cycle_time  double precision
);

CREATE TABLE item_master (
    id        varchar PRIMARY KEY,
    item_type varchar NOT NULL
);

CREATE TABLE item_movement (
    event_time       timestamp NOT NULL,
    item_id          varchar NOT NULL,
    from_location_id bigint,
    to_location_id   bigint,
    movement_type    varchar NOT NULL,
    port_index       smallint
);

CREATE TABLE item_lineage (
    event_time     timestamp NOT NULL,
    input_item_id  varchar,
    output_item_id varchar,
    location_id    bigint NOT NULL
);

CREATE TABLE item_status (
    event_time  timestamp NOT NULL,
    item_id     varchar NOT NULL,
    location_id bigint,
    status      smallint
);

CREATE TABLE item_expiry (
    item_id                 varchar NOT NULL,
    enabled_at              timestamp NOT NULL,
    destination_location_id bigint NOT NULL,
    expires_at              timestamp NOT NULL,
    expiry_location_id      bigint NOT NULL
);

CREATE TABLE machine_signal (
    event_time  timestamp NOT NULL,
    machine_id  varchar(50) NOT NULL,
    signal_name varchar NOT NULL,
    value       boolean NOT NULL,
    old_value   boolean,
    rule_id     varchar
);

CREATE TABLE machine_status (
    event_time     timestamp NOT NULL,
    machine_id     varchar(50) NOT NULL,
    register_index smallint NOT NULL,
    bit_index      smallint NOT NULL,
    bit_value      bit(1) NOT NULL
);

CREATE TABLE system_error (
    id          bigserial PRIMARY KEY,
    db_name     varchar NOT NULL,
    table_name  varchar NOT NULL,
    record_no   bigint NOT NULL,
    details     text,
    created_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notified_at timestamp,
    UNIQUE (db_name, table_name, record_no)
);
```

---

## 改版履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-05-02 | 1.0 | 初版作成（旧PascalCaseスキーマからの全面再設計） |
