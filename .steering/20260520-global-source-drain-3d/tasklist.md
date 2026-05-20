# タスクリスト: グローバルビュー Source/Drain 3Dモデル対応

## ステータス: 完了

---

## フェーズ1: scene3d.js の変更

- [x] `loadFactory()` に `sourceDrainNodes` フィルタを追加（parentId == null かつ stationType === source/drain）
- [x] `_addSourceDrainNode(station)` メソッドを新規追加
  - [x] 円柱メッシュ（CylinderGeometry）の生成
  - [x] エッジラインの追加
  - [x] stationId ラベルの追加
  - [x] `_equipmentGroups` への登録（shellMesh = cylinderMesh）
- [x] `loadFactory()` 内で `sourceDrainNodes.forEach(s => this._addSourceDrainNode(s))` を呼び出し

## フェーズ2: app.js の変更

- [x] `renderG3DUnplacedList()` のフィルタを source/drain 対応に変更（parentId == null チェック含む）
- [x] `placeEquipmentFromSidebar()` の occupiedCentroids 算出を source/drain 対応に変更

## フェーズ3: 動作確認（コードレビュー）

- [x] 工場にトップレベルの source/drain ステーションが存在する場合に3Dビューに円柱が表示される（`_addSourceDrainNode` が cylinder を scene に add ✓）
- [x] 未配置の source/drain が「3Dモデル編集」タブの未配置リストに表示される（`renderG3DUnplacedList` のフィルタ更新 ✓）
- [x] ドラッグ&ドロップで source/drain を配置できる（`_equipmentGroups` 登録により既存 placement drag が自動動作 ✓）
- [x] クリックでの自動配置が機能する（`placeEquipmentFromSidebar` は equipName 汎用 ✓）
- [x] 「保存して確定」で positionX/Y がサーバーに保存される（`saveEquipPlacement` が `_movedEquipment` 汎用処理 ✓）
- [x] Machine 内部の source/drain（parentId あり）は影響を受けない（`parentId == null` フィルタで除外 ✓）
- [x] ダブルクリックで何も起きないことを確認（`setOnEquipmentDoubleClick` が machine フィルタで早期リターン ✓）

---

## 実装後の振り返り

**実装完了日**: 2026-05-20

**変更ファイル**:
- `factory-visualizer/html/js/scene3d.js`: `_addSourceDrainNode()` 新規追加、`loadFactory()` 拡張、`_unhighlightEquip()` 修正
- `factory-visualizer/html/js/app.js`: `renderG3DUnplacedList()` と `placeEquipmentFromSidebar()` のフィルタ拡張

**計画と実績の差分**:
- 設計では `shellColor`/`shellOpacity` の保存を計画していなかったが、`_unhighlightEquip` がハードコードで blue に戻す問題を発見し、両ストアに追加した。Machine の equipment group にも `shellColor`/`shellOpacity` を追加し、`_unhighlightEquip` を `??` フォールバックで両対応した（後方互換）。

**学んだこと**:
- 既存の placement mode は `_equipmentGroups` に登録するだけで drag/drop/save が自動動作する設計になっており、追加コードが最小限で済んだ。
- `_unhighlightEquip` のようなユーティリティメソッドが特定の型（Machine blue）を前提にしていると、新型追加時にバグになる。型ごとの色情報をストアに持たせるパターンが有効。

**次回への改善提案**:
- `shellColor`/`shellOpacity` を最初から設計に含めると、将来の新型ノード追加時に `_unhighlightEquip` の修正が不要になる。
