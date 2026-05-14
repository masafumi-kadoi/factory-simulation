# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

---

## フェーズ1: Gateway バックエンド

- [x] repository.go: `ListExecutionsByFactory(factoryID string)` メソッドを追加
  - [x] factory_id AND status='completed' でフィルタ
  - [x] createdAt DESC LIMIT 50

- [x] handler.go: `handleFactoryExecutions` メソッドを追加
  - [x] GETのみ許可
  - [x] factory存在チェック（404ガード）
  - [x] JSON配列を返す

- [x] handler.go: `handleFactory()` のルーティングに `"executions"` ケースを追加

## フェーズ2: フロントエンド

- [x] api.js: `fetchFactoryExecutions(factoryId)` 関数を追加

- [x] index.html: シミュレーションパネルに実行履歴セクションを追加
  - [x] `<div id="execution-list">` リスト形式で追加
  - [x] クリック選択可能なアイテムUI

- [x] app.js: 実行履歴ロード・選択ロジックを追加
  - [x] `selectFactory()` で実行履歴を自動ロード（Promise.all並行取得）
  - [x] `setExecutionListClickHandler` でクリック時にWebSocket再購読
  - [x] 新規シミュレーション完了後も履歴リストを更新

## フェーズ3: ビルドと動作確認

- [x] realtime-gatewayをDockerビルド・再起動
  - [x] `docker compose build realtime-gateway`
  - [x] `docker compose up -d realtime-gateway`
- [x] `GET /api/factories/{id}/executions` がブラウザで返ることを確認（3件の完了済み実行を返却確認）

## フェーズ4: 振り返り

- [x] 実装後の振り返りをこのファイルに記録

---

## 実装後の振り返り

### 実装完了日
2026-05-15

### 計画と実績の差分

**計画と異なった点**:
- index.htmlに `<select>` でなくリスト形式 (`<div class="exec-item">`) を採用。クリックで選択状態を視覚的に示しやすいため
- ui.jsに `renderExecutionList` と `setExecutionListClickHandler` を追加（当初はapp.js内で完結させる案もあったが、既存パターン（renderObjectList等）に合わせてui.jsに分離）

**新たに必要になったタスク**:
- style.cssに `.exec-item` / `.exec-start` / `.exec-meta` スタイルを追加（当初計画外だったが必要だった）
- 新規シミュレーション完了後に実行履歴リストを再読み込みするロジックを追加

### 学んだこと

**技術的な学び**:
- `execution_configs` はすでに `factory_id` カラムを持っており、WHERE句1行でfactory別フィルタが完結した
- `data_sources.source_type` と `execution_configs` の対応が明確で、SimDB-only原則の中で複数未来の識別が自然に実現できた

**プロセス上の改善点**:
- フロントエンドのUI追加（HTML/CSS/JS）を同時並行で進められた

### 次回への改善提案
- 実行履歴に「シミュレーション開始日時」を表示しているが、実際には `start_time`（execution作成時刻）と「シナリオ上の開始日時」(startDatetimeパラメータ)が異なる。startDatetimeを `execution_configs` に保存して表示するとより分かりやすい
