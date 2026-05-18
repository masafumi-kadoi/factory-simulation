# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

---

## フェーズ1: scene3d.js — グループ化ロジック追加

- [x] `_getEquipmentName(stationId)` メソッド追加
  - [x] `/^(.+?)[._-]?(\d{3})$/` で末尾 `.NNN` または `NNN` を除去（ドット・アンダーバー・ハイフンありなし両対応）
  - [x] マッチしない場合はそのまま返す

- [x] `_groupByEquipment(machines)` メソッド追加
  - [x] Map<equipName, Machine[]> を返す

- [x] `this._equipmentGroups = new Map()` をコンストラクタに追加

## フェーズ2: scene3d.js — 設備グループ描画

- [x] `_addEquipmentGroup(equipName, machines)` メソッド追加
  - [x] centroid (cx, cz) をバウンディングボックスの中心で計算
  - [x] バウンディングボックス計算（全マシン座標 + PAD=60 の min/max）
  - [x] シェルメッシュ作成（半透明 BoxGeometry、opacity 0.12、DoubleSide）
  - [x] シェルワイヤーフレームエッジ追加
  - [x] 設備名ラベル（_createLabel でシェル上部に配置）
  - [x] 各マシンを `_addMachine` で描画（既存メソッド再利用）
  - [x] `_equipmentGroups` に `{ group, machines, centroid: {x, z} }` を保存

## フェーズ3: scene3d.js — loadFactory 修正

- [x] `loadFactory` を修正してグループ化フローを使用
  - [x] `_groupByEquipment` でグループ化
  - [x] `_addEquipmentGroup` を呼び出す
  - [x] `_fitCamera` に equipment centroid 位置の配列を渡す

- [x] `_clearAll` に `_equipmentGroups` クリア処理を追加
  - [x] グループシェル（group）を scene.remove
  - [x] `_equipmentGroups.clear()`

## フェーズ4: scene3d.js — 内部ステーション親オフセット対応

- [x] `_addInternalStation(station, parentMachine)` にオプション引数を追加
  - [x] `parentMachine` がある場合: px/pz に親の positionX/Y を加算
  - [x] `parentMachine` がない場合: 従来通り絶対座標
  - [x] `effectiveStation` として computed global position を _internalStations に保存（setWorkPosition で正しい位置を使用）

- [x] `loadFactory` 内の `internals.forEach` で `parentMachine` を解決して渡す

## フェーズ5: scene3d.js / app.js — 設備グループのクリック対応

- [x] `setOnEquipmentClick(cb)`, `setOnEquipmentDoubleClick(cb)` メソッドを追加
  - [x] 設備シェルをダブルクリックしたとき `equipName` をコールバックに渡す
  - [x] クリック判定: `obj.userData.equipmentName` を上位まで探索

- [x] `app.js` で `setOnEquipmentDoubleClick` を受け取り
  - [x] グループ内の代表マシン ID（ソート順で最初）を特定
  - [x] `openLocalWindow(primaryMachineId)` を呼ぶ

## フェーズ5b: ui.js — オブジェクトリストを設備名表示に変更

- [x] `getEquipmentName(stationId)` を ui.js に追加（scene3d.js と同じロジック）
- [x] `renderObjectList` の machine セクションで設備グループ化して表示
  - [x] 複数インスタンスある場合: `equipName (×N)` 形式
  - [x] 単一インスタンスの場合: station の name / stationId を表示
- [x] `app.js` の object list click handler を equipment name に対応するよう修正

## フェーズ6: 動作確認

- [x] `docker compose build && docker compose up -d factory-visualizer` でビルド・再起動
- [x] ブラウザで https://localhost/factory-visualizer/ を開き factory-visualizer を確認
- [x] サーバーから新しい ui.js が配信されていることを curl で確認（`getEquipmentName` 存在確認）
- [x] サーバーから新しい scene3d.js が配信されていることを curl で確認
- [x] ブラウザキャッシュ: ユーザーが Cmd+Shift+R でハードリロードすれば反映される

---

## 実装後の振り返り

### 実装完了日
2026-05-18

### 計画と実績の差分

**計画と異なった点**:
- 設計時は `/^(.+)\.(\d{3})$/`（ドット必須）の正規表現を予定していたが、実データが `fuga001`（ドットなし）形式だったため `/^(.+?)[._-]?(\d{3})$/` に変更
- ui.js のオブジェクトリスト更新は当初スコープ外だったが、設備グループ名を表示するために追加実装

**新たに必要になったタスク**:
- ui.js の `renderObjectList` を設備グループ表示に変更（フェーズ5b）
- app.js の object list click handler を equipment name 対応に修正

### 学んだこと

**技術的な学び**:
- 実データの ID 命名規則（`fuga001` = ドットなし）が設計書の例（`hoge.001` = ドットあり）と異なる場合があり、両方に対応する正規表現設計が重要
- Three.js の `userData` を使った階層クリック検出では、子 Mesh から上位 Group への走査で `equipmentName` を発見するパターンが有効
- 内部ステーションの座標を `effectiveStation` として保存することで、`setWorkPosition` 等の後続処理が正しいグローバル座標を参照できる

### 次回への改善提案
- ローカルビューでのマシン位置ドラッグ編集（内部レイアウト設定）は将来フェーズで追加予定
- 設備グループのグローバル位置をドラッグ変更する機能も将来対応
