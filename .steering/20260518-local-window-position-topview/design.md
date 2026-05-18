# 設計書

## 機能1: 設備モデル編集画面の位置編集

### ファイル変更
- `factory-visualizer/html/local-window.html` — propsパネルに positionX/Y フィールド追加
- `factory-visualizer/html/js/local-window.js` — ロジックタブを SVG ベースに全面書き直し

### HTML 変更
`#props-fields` 内に以下を追加（processingTime フィールドの前）:
```html
<div class="props-field">
    <label>位置 X</label>
    <input type="number" id="props-pos-x" step="1">
</div>
<div class="props-field">
    <label>位置 Y</label>
    <input type="number" id="props-pos-y" step="1">
</div>
```

左パレット（`.logic-palette`）に位置セクション追加（ツールボタン下）:
```html
<div class="palette-section">位置</div>
<div id="palette-pos" style="font-size:10px;color:var(--text-muted);padding:2px 4px;line-height:1.6">
    X: —<br>Y: —
</div>
```

### JS 変更 (local-window.js)

#### SVG 座標系
- viewBox を動的に計算（全ステーションの bounding box + padding 40）
- デフォルト viewBox: `-160 -160 320 320`
- 座標: station.positionX → SVG x、station.positionY → SVG y（そのまま1:1）

#### `populateLogicTab()`
- SVG の viewBox を更新
- グリッド描画（20単位ごと）
- 接続線描画
- ステーション円描画（半径16）

#### ツールモード
- `select`（デフォルト）: ステーションをドラッグして positionX/Y を更新
- `connect`: ステーションをクリックしてソースを選択、次のクリックで接続作成
- `delete`: ステーションクリックで削除（接続も削除）、接続クリックで接続削除

#### ドラッグ実装
```javascript
// SVG座標変換
function svgPoint(svg, e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}
// mousedown → mousemove で station.positionX/Y 更新 → SVG再描画
```

#### 右プロパティパネル更新
- ステーション選択時: name, type, processingTime, locationId, positionX, positionY を表示・編集
- positionX/Y 変更時: `childStations` 内のデータを更新 + SVG再描画

#### 左パレット位置表示
- ステーション選択時: `#palette-pos` に X/Y を表示

#### 保存
- `childStations`（positionX/Y 含む）と `childConnections` は既存の `API.saveMachineLogic()` で保存

## 機能2: グローバルビューの上面視（直交投影）

### ファイル変更
- `factory-visualizer/html/js/scene3d.js`
- `factory-visualizer/html/js/app.js`

### scene3d.js 変更

#### コンストラクタ
```javascript
this._orthoCamera = null;
this._useOrtho = false;
```

#### `setTopView()`（修正）
```javascript
setTopView() {
    const target = this.controls.target.clone();
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const aspect = w / (h || 1);
    const dist = this.camera.position.distanceTo(target);
    const halfH = dist * 0.5;

    this._orthoCamera = new THREE.OrthographicCamera(
        -halfH * aspect, halfH * aspect, halfH, -halfH, 1, 5000
    );
    this._orthoCamera.position.set(target.x, dist, target.z);
    this._orthoCamera.lookAt(target);
    this._orthoCamera.updateProjectionMatrix();

    this._useOrtho = true;
    this.controls.object = this._orthoCamera;
    this.controls.enableRotate = false;
    this.controls.target.copy(target);
    this.controls.update();
}
```

#### `setPerspView()`（新規追加）
```javascript
setPerspView() {
    this._useOrtho = false;
    this._orthoCamera = null;
    this.controls.object = this.camera;
    this.controls.enableRotate = true;
    this.controls.update();
}
```

#### `_animate()` 修正
```javascript
const cam = this._useOrtho ? this._orthoCamera : this.camera;
this.renderer && this.renderer.render(this.scene, cam);
```

#### `_onResize()` 修正
```javascript
if (this._orthoCamera) {
    const aspect = w / h;
    const halfH = (this._orthoCamera.top);
    this._orthoCamera.left = -halfH * aspect;
    this._orthoCamera.right = halfH * aspect;
    this._orthoCamera.updateProjectionMatrix();
}
```

#### `_handleClick()` 修正
```javascript
const cam = this._useOrtho ? this._orthoCamera : this.camera;
this._raycaster.setFromCamera(this._mouse, cam);
```

### app.js 変更
btn-top クリックで setTopView/setPerspView をトグル:
```javascript
let _topViewActive = false;
document.getElementById('btn-top').addEventListener('click', () => {
    if (!scene3d) return;
    if (_topViewActive) {
        scene3d.setPerspView();
        _topViewActive = false;
        btn.classList.remove('active');
    } else {
        scene3d.setTopView();
        _topViewActive = true;
        btn.classList.add('active');
    }
});
```
