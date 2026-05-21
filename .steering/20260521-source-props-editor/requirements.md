# 要求内容

## 概要

グローバルビューのロジック編集画面でソースノードをダブルクリックしたとき、ワーク生成設定（`continuous` / `workCount` / `departureTime`）を編集できるモーダルダイアログを表示する。

## 背景

シミュレーションエンジンのソースノードはワーク生成挙動を以下のconfig値で制御している:

- `continuous` (bool): `true` の場合は `timeLimit` まで無限生成、`false` の場合は `workCount` 個生成して停止
- `workCount` (int): 生成するワーク数（`continuous=false` 時のみ有効）
- `departureTime` (float): ソースからワークが出るまでの時間（秒）

これらの値はシナリオエディタからしか設定できず、グローバルビューのロジック編集画面からは設定不可。  
`workCount` 未設定時のデフォルトが `0` のため、設定を忘れるとワークが1個も生成されないという問題が生じている。

## 実装対象の機能

### 1. ソースノードプロパティモーダル

- グローバルビューのロジック編集タブでソースノードをダブルクリックするとモーダルが開く
- 現在の `config` 値をフォームに反映して表示する
- 編集後「保存」ボタンで `API.updateStation` を呼び出し DB に永続化する
- 保存後は `state.stations` のインメモリを更新する

### 2. フォーム項目

| 項目 | 型 | 説明 |
|---|---|---|
| 連続生産（continuous） | チェックボックス | ON = 無限生産、OFF = workCount 個で停止 |
| 生産数（workCount） | 数値入力 | continuous=OFF のときのみ有効 |
| 出発時間（departureTime） | 数値入力（秒） | ソースからワークが出るまでの時間 |

## 受け入れ条件

### モーダルの表示
- [ ] ロジック編集タブでソースノードをダブルクリックするとモーダルが開く
- [ ] マシンノードのダブルクリックは従来通り `openLocalWindow` を呼ぶ（変更なし）
- [ ] ドレインノードのダブルクリックは従来通り `openLocalWindow` を呼ぶ（変更なし）
- [ ] モーダルに現在の `config` 値が反映されている

### フォームの挙動
- [ ] `continuous` チェックをONにすると `workCount` 入力フィールドが無効化（disabled）される
- [ ] `continuous` チェックをOFFにすると `workCount` 入力フィールドが有効化される
- [ ] 「キャンセル」でモーダルが閉じて変更が破棄される

### 保存
- [ ] 「保存」ボタンで `PUT /factories/{id}/stations/{stationId}` に `config` を送信する
- [ ] 保存成功後に `state.stations` のインメモリが更新される
- [ ] 保存失敗時にエラーステータスを表示する

## スコープ外

以下はこのフェーズでは実装しません:

- drainノード固有のプロパティ編集
- 既存のシナリオエディタの変更
- 入力値のバリデーションエラーメッセージ（最低限のHTML5バリデーションのみ）

## 参照ドキュメント

- `docs/architecture.md` - アーキテクチャ設計書
- `factory-visualizer/html/js/app.js` - ロジック編集タブの実装
- `factory-visualizer/html/index.html` - HTML / モーダルテンプレート
- `factory-visualizer/html/js/api.js` - `updateStation` API
- `simulation-core/internal/domain/station.go` - `GetIntConfig` / `GetBoolConfig` 実装
- `realtime-gateway/internal/api/handler.go` - PUT /stations/:id ハンドラ
