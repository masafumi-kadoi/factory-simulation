# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

---

## フェーズ1: HTMLモーダル追加

- [x] `factory-visualizer/html/index.html` にソースプロパティモーダルを追加
  - [x] `new-machine-modal` の直後に `source-props-modal` を配置
  - [x] `continuous` チェックボックス
  - [x] `workCount` 数値入力フィールド
  - [x] `departureTime` 数値入力フィールド
  - [x] キャンセル・保存ボタン

## フェーズ2: JavaScript実装

- [x] `app.js` に `openSourcePropsModal(stationId)` 関数を追加
  - [x] `state.stations` から現在の config を読み取りフォームを初期化
  - [x] `continuous` チェック状態に応じて `workCount` を disabled/enabled 切り替え
  - [x] モーダルに `data-station-id` を設定して表示

- [x] `app.js` に `saveSourceProps()` 関数を追加
  - [x] フォーム値を取得して既存 config にマージ
  - [x] `API.updateStation` を呼び出して DB 保存
  - [x] 保存成功後に `state.stations` のインメモリを更新
  - [x] 保存成功後にモーダルを閉じてステータスを表示
  - [x] 保存失敗時にエラーステータスを表示

- [x] `initGlobalLogicEditTab` 内でモーダルのイベントリスナーを登録
  - [x] 閉じるボタン（✕）のクリックでモーダルを hidden
  - [x] キャンセルボタンのクリックでモーダルを hidden
  - [x] 保存ボタンのクリックで `saveSourceProps()` を呼ぶ
  - [x] `continuous` チェックボックスの change で `workCount` の disabled を切り替え

- [x] `gleNodeRender` の dblclick ハンドラに stationType 分岐を追加
  - [x] `source` タイプ → `openSourcePropsModal(repSid)`
  - [x] それ以外 → 従来通り `openLocalWindow(repSid)`

## フェーズ3: 品質チェック

- [x] ブラウザで動作確認
  - [x] ソースノードダブルクリックでモーダルが開く
  - [x] 既存 config 値がフォームに反映される
  - [x] continuous ON/OFF で workCount disabled/enabled が切り替わる
  - [x] 保存後に state.stations.config が更新される
  - [x] ページリロード後も保存値が反映される（DB 永続確認）
  - [x] マシンノードダブルクリックは従来通り localWindow が開く

---

## 実装後の振り返り

### 実装完了日
2026-05-21

### 計画と実績の差分

**計画と異なった点**:
- 計画通り実装完了。バックエンド変更不要の想定通り。

**新たに必要になったタスク**:
- なし

### 学んだこと

**技術的な学び**:
- `gleNodeRender` の `dblclick` ハンドラで `rep?.stationType` を参照することで、ノードタイプ別の分岐が簡潔に書ける
- `initGlobalLogicEditTab` にイベント登録を集約することで初期化が一元管理できる

**プロセス上の改善点**:
- 特になし

### 次回への改善提案
- drainノードにも同様の設定UIが必要になった場合、`openSourcePropsModal` を汎用化すると再利用しやすい
