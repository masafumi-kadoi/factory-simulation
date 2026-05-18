# 設計書

## アーキテクチャ概要

グローバルビューの `loadFactory` パイプラインを拡張し、
マシンステーションを「設備グループ」に変換してから3Dシーンに追加する。

```
stations (API) 
  └─ filter(stationType === 'machine')
       └─ _groupByEquipment()          ← ★新規: .NNN で分類
            └─ EquipmentGroup[]
                 ├─ _addEquipmentGroup()   ← ★新規: シェル + 内部マシン描画
                 └─ _addMachine()          ← 内部マシンを従来通り描画

  └─ filter(stationType !== 'machine')
       └─ _addInternalStation(s, parentMachine)  ← ★修正: 親オフセットを加算
```

## コンポーネント設計

### 1. scene3d.js の変更

**責務**:
- 設備名抽出ロジック（`_getEquipmentName`）
- マシンのグループ化（`_groupByEquipment`）
- 設備グループ描画（`_addEquipmentGroup`）
- 内部ステーションの相対座標描画修正

**追加フィールド**:
```javascript
this._equipmentGroups = new Map(); // equipName → { group, machines }
```

**`_getEquipmentName(stationId)`**:
- `/^(.+)\.(\d{3})$/` で末尾 `.NNN` を取り除く
- マッチしない場合はそのまま返す

**`_groupByEquipment(machines)`**:
- Map<equipName, Machine[]> を返す

**`_addEquipmentGroup(equipName, machines)`**:
- machines が 1台の場合でも設備シェルを表示
- centroid = 全マシン positionX/positionY の平均
- 各マシンを `_addMachine` で追加（既存ロジック再利用）
- シェル: マシン座標のバウンディングボックス + パディング40単位 の半透明ボックス
- シェル色: テーマに応じた薄い青/グレー（opacity 0.15〜0.2）
- ラベル: 設備名をシェル上部に表示
- `_equipmentGroups` に登録

**`_addInternalStation(station, parentMachine)`**:
- `parentMachine` を受け取り、ある場合は `group.position.set(px + parentX, 0, pz + parentZ)` とする
- `parentMachine` がない場合は従来通り（後方互換）

**`loadFactory` の修正**:
```javascript
loadFactory(stations, connections) {
    this._clearAll();
    
    const machines = stations.filter(s => s.stationType === 'machine');
    const internals = stations.filter(s => s.stationType !== 'machine');
    
    // 設備グループ化 & 描画
    const groups = this._groupByEquipment(machines);
    groups.forEach((mList, equipName) => this._addEquipmentGroup(equipName, mList));
    
    // 内部ステーション: 親マシンのオフセット付きで描画
    internals.forEach(s => {
        const parent = machines.find(m => m.stationId === s.parentId) || null;
        this._addInternalStation(s, parent);
    });
    
    connections.forEach(c => this._addConnectionLine(c, stations));
    
    // fitCamera は equipment centroid ベースで
    const equipmentPositions = [...this._equipmentGroups.values()]
        .map(eg => eg.centroid);
    this._fitCamera(equipmentPositions);
    this._updateVisibility();
}
```

**`_fitCamera` の修正**:
- 引数を `{positionX, positionY}[]` 形式に統一する（centroid オブジェクトでも動くよう）

**`_clearAll` の修正**:
- `_equipmentGroups` のシェルも scene.remove する

### 2. app.js の変更

**ダブルクリックハンドラ修正**:
- `scene3d.setOnMachineDoubleClick` で渡している `sid` は引き続き機械ID
- 設備グループのシェルをダブルクリックした場合も、そのグループの代表機械ID（アルファベット順で最初）でローカルビューを開く
- `scene3d.setOnEquipmentDoubleClick(equipName => { openLocalWindow(groupPrimaryMachineId) })` を追加

**オブジェクトリスト（ui.js）**:
- 'machine' フィルターで設備グループを表示（設備名で表示、IDは代表マシンID）
- 既存の `renderObjectList` は大きく変えず、マシン表示を設備名に変更

## データフロー

### 工場読み込み時
```
1. API.fetchFactoryStations() → stations[]
2. stations を machine / internal に分類
3. machines を equipName でグループ化
4. 各グループの centroid を計算
5. _addEquipmentGroup() でシェル + 個別マシン描画
6. internals を parentId で parent 解決 → 相対座標で描画
7. connections を描画
8. カメラをフィット
```

### ダブルクリック時
```
1. ユーザーが設備シェルまたはマシンをダブルクリック
2. scene3d のクリックハンドラが equipmentName または stationId を返す
3. app.js が代表マシン ID を特定
4. openLocalWindow(factoryId, primaryMachineId) を呼び出す
```

## エラーハンドリング戦略

- machines が空の場合: loadFactory は何も描画しない（既存動作）
- positionX/Y が 0 の場合: centroid = (0,0)、全マシンが重なる（許容）
- parentId が存在しない場合: 従来通り絶対座標で描画

## ディレクトリ構造

```
factory-visualizer/html/js/
  scene3d.js   ← 主要変更（グループ化・設備シェル・内部座標修正）
  app.js       ← ダブルクリックハンドラ修正
  ui.js        ← 設備名表示の微調整（任意）
```

## 実装の順序

1. `scene3d.js`: `_getEquipmentName`, `_groupByEquipment` 追加
2. `scene3d.js`: `_addEquipmentGroup` 追加（シェル描画）
3. `scene3d.js`: `loadFactory` 修正（グループ化フロー）
4. `scene3d.js`: `_addInternalStation` の親オフセット対応
5. `scene3d.js`: `_clearAll` に equipmentGroups クリアを追加
6. `app.js`: 設備グループのダブルクリックハンドラ追加
7. 動作確認

## パフォーマンス考慮事項

- シェルは1グループ1メッシュ（O(equipment count)）、パフォーマンスへの影響は小さい
- バウンディングボックス計算は O(n) でマシン数に比例、問題なし
