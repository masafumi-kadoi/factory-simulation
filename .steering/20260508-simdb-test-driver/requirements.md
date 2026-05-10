# 要求内容: SimDB テストドライバー

## 概要

WDH スキーマの外部 SimDB を模倣するテスト用スタンドアロンサービス。
複数のデータソース（ライブ DB・ディレクトリ・ZIP）から WDH イベントを読み込み、
`event_time` を基準とした仮想時計で任意速度で順次再生し、テスト用 DB に INSERT する。

## 背景

「順次追記される SimDB（WDH）と接続してリアルタイム表示する機能」を開発中だが、
本番 SimDB の準備が遅れており、Visualizer のリアルタイム機能を単独でテストできない。

テストドライバーを用意することで：
- 本番 SimDB 到着前から Visualizer リアルタイム機能の開発・検証が可能になる
- 過去の本番データをそのまま再生できるため、リアルな動作確認ができる
- 挿入速度を制御できるため、バッファ溢れ・遅延・高速再生など多様なテストケースに対応できる
- 別 PC で起動して Gateway と接続することで、本番に近いネットワーク構成でもテストできる

## 実装対象の機能

### 1. スタンドアロン Docker Compose

- `simdb-postgres`: WDH スキーマを持つ独立した PostgreSQL コンテナ
  - 起動時に DDL（WDH 全テーブル）と NOTIFY トリガーを自動適用
  - 外部ポート公開（Gateway から接続可能）
- `simdb-driver`: シナリオ再生を制御する Go サービス
  - 設定された Data Source からイベントを読み込む
  - `event_time` 基準の仮想時計でイベントを順次 INSERT
  - HTTP API でシナリオの制御（再生/一時停止/リセット/速度変更/ソース切替）

### 2. データソース

イベントの読み込み元として以下の 3 種類をサポートする。

| 種別 | 説明 |
|---|---|
| `builtin` | ドライバーに同梱されたデフォルトシナリオ（Go `embed` で内蔵した ZIP） |
| `zip` | ホストからマウントした `.zip` ファイル（CSV ファイルを ZIP したもの） |
| `directory` | ホストからマウントしたディレクトリ（CSV ファイルを直接配置） |
| `db` | 既存の PostgreSQL（WDH スキーマ）に直接接続してデータを読み込む |

**CSV ファイル形式（zip / directory 共通）:**

- ファイル名: `{テーブル名}.csv`（例: `item_movement.csv`）
- フォーマット: ヘッダー行あり、PostgreSQL の `COPY ... TO ... WITH CSV HEADER` 形式
- 文字コード: UTF-8
- 対象テーブル:
  - マスタ（起動時に一括 INSERT）: `location_master`, `connection_master`, `machine_master`, `item_master`
  - ログ（再生時に順次 INSERT）: `item_movement`, `machine_signal`, `item_status`, `item_lineage`, `item_expiry`
- ZIP / ディレクトリ内にないテーブルは空として扱う（エラーにしない）

**PostgreSQL からのエクスポート方法（参考）:**

```bash
psql -U {user} -d {dbname} -c "\COPY item_movement TO 'item_movement.csv' WITH CSV HEADER"
```

### 3. デフォルトシナリオ（Linear-3）

ソースなしで起動した場合に使用する組み込みシナリオ（`builtin`）。
`scenario/default.zip` として Go の `embed` パッケージで同梱する。

**ライン構成:**

```
source → proc_01 → proc_02 → drain
           (5s)      (8s)
```

| テーブル | レコード数 | 内容 |
|---|---|---|
| location_master | 4 | source, proc_01, proc_02, drain |
| connection_master | 3 | source→proc_01, proc_01→proc_02, proc_02→drain |
| machine_master | 2 | M-PROC01（@proc_01, cycle_time=5s）, M-PROC02（@proc_02, cycle_time=8s） |
| item_master | 3 | item-001, item-002, item-003（全て workA 種別） |
| item_movement | 〜24 件 | 3 ワーク × 4 ステーション × arrived/departed |
| machine_signal | 〜16 件 | 2 設備 × inputReady 変化 |

### 4. 仮想時計による再生

- ログテーブルの全レコードを `event_time` 昇順でソートしてキューに積む
- 最初のイベントの `event_time` を **仮想時計の基準時刻（t=0）** とする
- 仮想時計を速度倍率に応じて進め、`event_time <= 仮想現在時刻` になったレコードを INSERT
- 全レコードを INSERT し終えたら再生完了（`completed`）

**速度倍率の仕様:**
- `0.1` 〜 `100.0` の範囲（デフォルト: `1.0`）
- 再生中でもリアルタイムに変更可能
- `100.0` ではほぼ即時全件 INSERT

### 5. 再生制御 API

| メソッド | パス | 説明 |
|---|---|---|
| GET | /status | 再生状態・進捗・速度倍率を返す |
| POST | /load | データソースを指定してロードする |
| POST | /play | 再生開始 / 一時停止から再開 |
| POST | /pause | 一時停止 |
| POST | /reset | テスト DB をクリアして先頭に戻る（マスタは保持） |
| PATCH | /speed | 速度倍率を変更 `{ "multiplier": 2.0 }` |
| GET | /scenario | 現在ロード中のシナリオ情報を返す |

## 配置方針

メインプロジェクトから完全隔離するため、リポジトリルートの `test-tools/` ディレクトリ配下に配置する。
メインの `docker-compose.yml` とは完全に独立した構成とする。

```
test-tools/
└── simdb-test-driver/   ← このサービス一式
```

## 受け入れ条件

### スタンドアロン起動

- [ ] `docker compose up` 一発で起動できる
- [ ] simdb-postgres が起動時に WDH DDL と NOTIFY トリガーを自動適用する
- [ ] simdb-driver が起動時に `builtin` ソースをデフォルトでロードしマスタデータを INSERT する
- [ ] 外部（別 PC）から PostgreSQL に接続できる（ポートが公開されている）

### データソース: builtin

- [ ] `POST /load {"type":"builtin"}` でデフォルトシナリオがロードされる
- [ ] ロード後に `POST /play` で再生が開始される

### データソース: zip / directory

- [ ] `POST /load {"type":"zip","path":"/data/my.zip"}` で ZIP からロードできる
- [ ] `POST /load {"type":"directory","path":"/data/dir"}` でディレクトリからロードできる
- [ ] ZIP とディレクトリどちらでも同じ CSV 形式で動作する
- [ ] 存在しないテーブルの CSV が欠けていてもエラーにならない

### データソース: db

- [ ] `POST /load {"type":"db","dsn":"host=... dbname=..."}` で既存 DB からロードできる
- [ ] WDH スキーマの全ログテーブルを `event_time` 昇順で読み込む

### 仮想時計による再生

- [ ] イベントが `event_time` 昇順で順次 INSERT される
- [ ] 全レコードが INSERT 完了すると status が `completed` になる
- [ ] 速度倍率 `1.0` で実時間通りに再生される（誤差 ±5% 以内）

### 速度制御

- [ ] `PATCH /speed` で倍率を変更できる
- [ ] 倍率変更は再生中にも即時反映される
- [ ] `100.0` 指定で全件が数秒以内に INSERT される

### リセット

- [ ] `POST /reset` でログテーブル（item_movement, machine_signal 等）がクリアされる
- [ ] リセット後に `POST /play` で同じシナリオが最初から再生できる
- [ ] リセット中はマスタデータは削除されない

### Gateway 接続

- [ ] Realtime Gateway がこの simdb-postgres に LISTEN/NOTIFY で接続できる
- [ ] 再生中に Gateway が item_movement の NOTIFY を受信し Visualizer に WebSocket 配信される

## スコープ外

- シナリオの GUI エディタ
- ZIP 以外のアーカイブ形式（tar.gz 等）
- 本番 SimDB の認証・TLS 対応（テスト用のため平文可）
- データ永続化（コンテナ再起動でリセット可）
- 複数シナリオの同時再生

## 参照ドキュメント

- `docs/wdh-schema-definition.md` - WDH テーブル定義・DDL
- `.steering/20260507-visualizer-realtime-enhancement/design.md` - Gateway LISTEN/NOTIFY 設計
- `.steering/20260507-visualizer-realtime-enhancement/requirements.md` - リアルタイム機能要求
