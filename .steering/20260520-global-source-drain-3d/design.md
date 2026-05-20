# 実装設計: グローバルビュー Source/Drain 3Dモデル対応

## 変更ファイル

1. `factory-visualizer/html/js/scene3d.js`
2. `factory-visualizer/html/js/app.js`

---

## scene3d.js の変更

### A. `loadFactory()` の変更

```javascript
// 変更前（line 205）
const machines = stations.filter(s => s.stationType === 'machine' && s.positionX != null);

// 変更後
const machines = stations.filter(s => s.stationType === 'machine' && s.positionX != null);
const sourceDrainNodes = stations.filter(
    s => (s.stationType === 'source' || s.stationType === 'drain')
      && s.positionX != null
      && s.parentId == null  // トップレベルのみ（Machine内部のものは除外）
);
```

`internals` の算出も変更し、parentId ありの source/drain は引き続き Tetris ブロックとして描画する（変更なし）。

### B. 新メソッド `_addSourceDrainNode(station)`

```javascript
_addSourceDrainNode(station) {
    const px = station.positionX || 0;
    const pz = station.positionY || 0;
    const color = STATION_COLORS[station.stationType] || 0x888888;

    const group = new THREE.Group();
    group.userData.equipmentName = station.stationId;
    group.userData.isEquipment = true;

    // 円柱メッシュ（hitbox 兼 visual）
    const RADIUS = 50, HEIGHT = 80;
    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 32);
    const mat = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.75,
        roughness: 0.4,
        metalness: 0.2,
        emissive: color,
        emissiveIntensity: 0.2,
    });
    const cylinderMesh = new THREE.Mesh(geo, mat);
    cylinderMesh.position.set(px, HEIGHT / 2, pz);
    cylinderMesh.userData.equipmentName = station.stationId;  // raycaster 用
    cylinderMesh.castShadow = true;
    group.add(cylinderMesh);

    // エッジライン（Machineシェルと視覚的に統一感を出す）
    const edgeGeo = new THREE.EdgesGeometry(geo, 15);
    const edgeColor = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5).getHex();
    const edgeMat = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.9 });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    edges.position.copy(cylinderMesh.position);
    group.add(edges);

    // ラベル（stationId を表示）
    const label = this._makeLabel(station.stationId);
    label.position.set(px, HEIGHT + 20, pz);
    group.add(label);

    this.scene.add(group);
    this._equipmentGroups.set(station.stationId, {
        group,
        shellMesh: cylinderMesh,  // placement mode の drag hitbox
        centroid: { x: px, z: pz },
        machines: [station],
    });
}
```

### C. `_clearAll()` への追加（不要かも）

`_equipmentGroups` は `_clearAll()` 内で `this._equipmentGroups.forEach(eg => this.scene.remove(eg.group))` でクリアされるため、Source/Drain も自動的にクリアされる。**変更不要**。

### D. `loadFactory()` での呼び出し追加

```javascript
// Equipment groups（Machine）
const groups = this._groupByEquipment(machines);
groups.forEach((mList, equipName) => this._addEquipmentGroup(equipName, mList));

// Source/Drain 独立ノード
sourceDrainNodes.forEach(s => this._addSourceDrainNode(s));
```

---

## app.js の変更

### A. `renderG3DUnplacedList()` の変更（line 1071）

```javascript
// 変更前
(state.stations || []).filter(s => s.stationType === 'machine').forEach(s => { ... });

// 変更後
(state.stations || []).filter(s =>
    (s.stationType === 'machine' || s.stationType === 'source' || s.stationType === 'drain')
    && s.parentId == null  // トップレベルのみ
).forEach(s => { ... });
```

### B. `placeEquipmentFromSidebar()` の occupiedCentroids 算出変更（line 1142）

```javascript
// 変更前
(state.stations || []).filter(s => s.stationType === 'machine' && s.positionX != null).forEach(s => { ... });

// 変更後
(state.stations || []).filter(s =>
    (s.stationType === 'machine' || s.stationType === 'source' || s.stationType === 'drain')
    && s.parentId == null
    && s.positionX != null
).forEach(s => { ... });
```

### C. ダブルクリックハンドラ（変更不要）

`setOnEquipmentDoubleClick` コールバック（line 72-84）は内部で
`filter(s => s.stationType !== 'machine')` を除外しているため、
source/drain が equipment group として追加されても `members.length === 0` になり、早期リターンする。
**変更不要**。

---

## 視覚デザイン

| ノード | 形状 | 色 | 高さ | 半径 |
|--------|------|-----|------|------|
| Source | 円柱 | 緑 (#28a745) | 80 | 50 |
| Drain  | 円柱 | グレー (#6c757d) | 80 | 50 |

- Machine のシェル（半透明ブルーの直方体）との差別化により、一目で Source/Drain とわかる
- エッジラインで輪郭を強調
- ラベルは stationId を表示（Machine と同様）

---

## 注意事項

- `parentId == null` のフィルタにより、Machine 内部の source/drain（サブステーション）には影響しない
- `_addEquipmentGroup` の `machines` 配列は Machine 専用なので、source/drain では `_addSourceDrainNode` を使う
- `_onEquipmentMove` コールバックは equipment group の drag で発火するため、source/drain の drag 移動も同じ仕組みで動作する
