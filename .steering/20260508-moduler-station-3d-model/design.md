# 設計書

## アーキテクチャ概要

グリッドエディタの編集状態（`model3DGrid`）を source of truth とし、glTF はエクスポート時のみ生成する。インポートした外部モデル（`model3DGltf`/`model3DGlb`）とグリッドモデルは排他的な関係で、同時には存在しない。

```
[編集フロー]
  グリッド操作
    → model3DGrid { gridSize, height, cols, rows, cells } に保存
    → Visualizer: cells から BoxGeometry で描画
    → エクスポート時のみ GLTFExporter で glTF を生成しダウンロード

[インポートフロー]
  .gltf / .glb 選択
    → model3DGltf / model3DGlb に保存 + model3DGrid を削除
    → Visualizer: GLTFLoader で描画
    → エクスポート: 保存済みデータをそのままダウンロード

[排他ルール]
  model3DGrid が存在 → model3DGltf/model3DGlb は存在しない
  model3DGltf/model3DGlb が存在 → model3DGrid は存在しない
```

## データ設計

### 保存フィールド（`station.config` JSONB）

| フィールド | 型 | 出所 | 内容 |
|---|---|---|---|
| `model3DGrid` | object | グリッドエディタ「モデル決定」 | 編集状態の source of truth |
| `model3DGltf` | object | .gltf インポート | glTF 2.0 JSON（そのまま格納） |
| `model3DGlb` | string | .glb インポート | GLB バイナリの Base64 |

**3フィールドは同時には存在しない。**  
インポート時は `model3DGrid` を削除し、リセット時は `model3DGltf`/`model3DGlb` を削除する。

### model3DGrid の構造

```json
{
  "model3DGrid": {
    "gridSize": 20,
    "height": 40,
    "cols": 20,
    "rows": 20,
    "cells": [[0,0],[1,0],[2,0],[0,1],[1,1]]
  }
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `gridSize` | number | 1セルの一辺（Visualizer単位）。デフォルト 20 |
| `height` | number | ブロックの高さ（同単位）。デフォルト 40 |
| `cols` | number | グリッドの列数（X方向）。デフォルト 20 |
| `rows` | number | グリッドの行数（Z方向）。デフォルト 20 |
| `cells` | `[number, number][]` | 選択セルの `[col, row]` 配列 |

## 親ステーションへのアクセス

`drillDown()` 実行後、`this.scenario._parentStation` が直接親の ModularStation を参照する（editor.js 行 1460）。  
`_editStack` を辿る必要はない。

```javascript
_saveModel3DGrid(grid) {
    const parent = this.scenario._parentStation;
    if (!parent) return;
    parent.config = parent.config || {};
    // 排他ルール: 外部モデルを削除してからグリッドを保存
    delete parent.config.model3DGltf;
    delete parent.config.model3DGlb;
    if (grid) {
        parent.config.model3DGrid = grid;
    } else {
        delete parent.config.model3DGrid;
    }
    this._markDirty();
}

_saveModel3DGltf(gltfJson) {
    const parent = this.scenario._parentStation;
    if (!parent) return;
    parent.config = parent.config || {};
    // 排他ルール: グリッドを削除してから外部モデルを保存
    delete parent.config.model3DGrid;
    delete parent.config.model3DGlb;
    parent.config.model3DGltf = gltfJson;
    this._markDirty();
}

_saveModel3DGlb(base64) {
    const parent = this.scenario._parentStation;
    if (!parent) return;
    parent.config = parent.config || {};
    delete parent.config.model3DGrid;
    delete parent.config.model3DGltf;
    parent.config.model3DGlb = base64;
    this._markDirty();
}

_resetModel3D() {
    const parent = this.scenario._parentStation;
    if (!parent) return;
    delete parent.config?.model3DGrid;
    delete parent.config?.model3DGltf;
    delete parent.config?.model3DGlb;
    this._markDirty();
}

_loadModel3D() {
    const cfg = this.scenario._parentStation?.config;
    if (!cfg) return null;
    if (cfg.model3DGrid) return { type: 'grid', data: cfg.model3DGrid };
    if (cfg.model3DGltf) return { type: 'gltf', data: cfg.model3DGltf };
    if (cfg.model3DGlb)  return { type: 'glb',  data: cfg.model3DGlb };
    return null;
}
```

## フットプリントの描画座標系

`#model-footprint-canvas` は `canvas-container` 内で `position:absolute` で SVG の真上に重なる（`pointer-events:none`）。  
キャンバス中央に固定スケールで描画する（SVG 座標系との整合は不要）。

```javascript
// model-editor.js 内 drawFootprint(ctx, canvasWidth, canvasHeight, model3DInfo)
drawFootprint(ctx, canvasWidth, canvasHeight) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    if (this._mode === 'imported') {
        // 外部モデルのプレースホルダー
        ctx.font = '14px sans-serif';
        ctx.fillStyle = 'rgba(0, 207, 255, 0.6)';
        ctx.textAlign = 'center';
        ctx.fillText('📦 外部モデル設定済み', canvasWidth / 2, canvasHeight / 2);
        return;
    }
    if (this._selectedCells.size === 0) return;

    const colArr = [...this._selectedCells].map(k => parseInt(k));
    const rowArr = [...this._selectedCells].map(k => parseInt(k.split(',')[1]));
    const minC = Math.min(...colArr.map((_, i) => parseInt([...this._selectedCells][i].split(',')[0])));
    const maxC = Math.max(...[...this._selectedCells].map(k => parseInt(k.split(',')[0])));
    const minR = Math.min(...[...this._selectedCells].map(k => parseInt(k.split(',')[1])));
    const maxR = Math.max(...[...this._selectedCells].map(k => parseInt(k.split(',')[1])));
    const spanC = maxC - minC + 1, spanR = maxR - minR + 1;

    const maxPx = Math.min(canvasWidth, canvasHeight) * 0.7;
    const cellPx = Math.min(maxPx / spanC, maxPx / spanR);
    const offsetX = (canvasWidth - spanC * cellPx) / 2;
    const offsetY = (canvasHeight - spanR * cellPx) / 2;

    ctx.fillStyle = 'rgba(0, 207, 255, 0.15)';
    ctx.strokeStyle = 'rgba(0, 207, 255, 0.5)';
    ctx.lineWidth = 1;
    for (const key of this._selectedCells) {
        const [c, r] = key.split(',').map(Number);
        ctx.fillRect(offsetX + (c - minC) * cellPx, offsetY + (r - minR) * cellPx, cellPx, cellPx);
        ctx.strokeRect(offsetX + (c - minC) * cellPx, offsetY + (r - minR) * cellPx, cellPx, cellPx);
    }
}
```

## コンポーネント設計

### 1. ModelEditor クラス (`sim-editor/html/js/model-editor.js`)

**責務**:
- Canvas API によるインタラクティブなグリッド描画とセル選択
- .gltf/.glb ファイルのインポート処理
- glTF エクスポート（`model3DGrid` → GLTFExporter）
- ロジック編集モード用フットプリントの描画

**プロパティ**:

| プロパティ | 型 | 説明 |
|---|---|---|
| `_mode` | `'grid'` \| `'imported'` | 現在のモデル種別 |
| `_gridSize` | number | 1セルのサイズ（デフォルト: 20） |
| `_height` | number | ブロック高さ（デフォルト: 40） |
| `_cols` | number | グリッド列数（デフォルト: 20） |
| `_rows` | number | グリッド行数（デフォルト: 20） |
| `_selectedCells` | `Set<string>` | 選択セル集合（`"col,row"` 形式） |
| `_isDragging` | boolean | ドラッグ選択中フラグ |

**公開メソッド**:

| メソッド | 引数 | 戻り値 | 説明 |
|---|---|---|---|
| `open(model3DInfo)` | `{type, data} \| null` | void | 既存データをロードして表示 |
| `close()` | - | void | イベントリスナー除去・キャンバスクリア |
| `getGridData()` | - | `model3DGrid \| null` | 現在の選択状態を grid オブジェクトとして返す（0セル時は null） |
| `drawFootprint(ctx, w, h)` | - | void | フットプリント描画（ロジック編集モード用） |
| `openGridSizeModal()` | - | void | 格子サイズ変更モーダルを表示 |
| `openHeightModal()` | - | void | 高さ変更モーダルを表示 |
| `importFile(file)` | `File` | `Promise<{type, data}>` | ファイルを読み込んでパース |
| `exportFromGrid()` | - | `Promise<void>` | model3DGrid → GLTFExporter → ダウンロード |
| `exportFromGltf(gltfJson)` | object | void | glTF JSON をそのままダウンロード |
| `exportFromGlb(base64)` | string | void | Base64 GLB をダウンロード |

**`open()` での状態復元**:
```javascript
open(model3DInfo) {
    if (!model3DInfo) {
        // 未設定: グリッドモードで空の状態
        this._mode = 'grid';
        this._selectedCells.clear();
    } else if (model3DInfo.type === 'grid') {
        // グリッドモード: 保存状態を復元
        this._mode = 'grid';
        const d = model3DInfo.data;
        this._gridSize = d.gridSize;
        this._height   = d.height;
        this._cols     = d.cols;
        this._rows     = d.rows;
        this._selectedCells = new Set(d.cells.map(([c, r]) => `${c},${r}`));
    } else {
        // 外部モデルモード: グリッドは非インタラクティブ
        this._mode = 'imported';
        this._selectedCells.clear();
    }
    this._render();
}
```

### 2. editor.js の拡張

**追加インポート**（先頭部分）:
```javascript
import { ModelEditor } from './model-editor.js';
```

**追加プロパティ**（コンストラクタ内）:
```javascript
this._editMode = 'logic';   // 'logic' | 'model'
this._modelEditor = null;   // ModelEditor インスタンス
```

**drillDown() への追記**（行 1474 `_animateDrill()` 呼び出し直前）:
```javascript
this._editMode = 'logic';
this._showSubScenarioToolbar();
```

**drillUp() への追記**（行 1496 `_markDirty()` 直前）:
```javascript
this._hideSubScenarioToolbar();
```

**drillToDepth() への追記**（行 1518 `_markDirty()` 直前）:
```javascript
if (this._editStack.length === 0) this._hideSubScenarioToolbar();
```

**追加メソッド一覧**:

| メソッド | 説明 |
|---|---|
| `_showSubScenarioToolbar()` | ツールバー表示・ModelEditor 初期化・イベントリスナー設定 |
| `_hideSubScenarioToolbar()` | ツールバー非表示・ModelEditor.close() |
| `setEditMode(mode)` | SVG/Canvas 切替・フットプリント更新 |
| `_handleModelConfirm()` | getGridData() → _saveModel3DGrid() |
| `_handleModelImport(file)` async | importFile() → _saveModel3DGltf() または _saveModel3DGlb() |
| `_handleModelExport()` async | _loadModel3D() のtypeに応じて export メソッド呼び分け |
| `_handleModelReset()` | _resetModel3D() → モード切替・UI更新 |
| `_saveModel3DGrid(grid)` | 上記「親ステーションへのアクセス」のコード参照 |
| `_saveModel3DGltf(gltfJson)` | 同上 |
| `_saveModel3DGlb(base64)` | 同上 |
| `_resetModel3D()` | 同上 |
| `_loadModel3D()` | 同上（`{type, data}` を返す） |

### 3. editor.html の変更

**import map の追加**（`<head>` 内 `<link>` タグ直後）:
```html
<script type="importmap">
{
    "imports": {
        "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
        "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
}
</script>
```

**`canvas-container` 内 `#breadcrumb` 直後に追加**:
```html
<div id="sub-scenario-toolbar" style="display:none;">
  <div class="mode-buttons">
    <button id="logic-mode-btn" class="mode-btn active">ロジック編集</button>
    <button id="model-mode-btn" class="mode-btn">モデル編集</button>
  </div>
  <div id="model-editing-controls" style="display:none;">
    <button id="block-size-btn">ブロックサイズ切替</button>
    <button id="block-height-btn">ブロック高さ切替</button>
    <button id="model-confirm-btn" class="btn-primary">モデル決定</button>
    <button id="model-import-btn">インポート</button>
    <button id="model-reset-btn" style="display:none;">リセット</button>
    <button id="model-export-btn" disabled>エクスポート</button>
  </div>
</div>

<canvas id="model-editor-canvas" style="display:none;"></canvas>
<canvas id="model-footprint-canvas"
        style="display:none; position:absolute; top:0; left:0; pointer-events:none;"></canvas>
<input type="file" id="model-file-input" accept=".gltf,.glb" style="display:none;">
```

**`#model-confirm-btn` と `#model-reset-btn` の表示切替**:
- `_mode === 'grid'`: `model-confirm-btn` 表示、`model-reset-btn` 非表示
- `_mode === 'imported'`: `model-confirm-btn` 非表示または disabled、`model-reset-btn` 表示

### 4. visualizer.js の変更

**追加インポート**:
```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
```

**loadScenario() 内の分岐**（既存の `_createStation()` 呼び出し箇所に追加）:
```javascript
const cfg = stationData.config;
if (stationData.type === 'moduler') {
    if (cfg?.model3DGrid) {
        this._createModulerGridModel(stationId, stationData, pos);
    } else if (cfg?.model3DGltf || cfg?.model3DGlb) {
        await this._createModulerGltfModel(stationId, stationData, pos);
    } else {
        this._createStation(stationId, stationData, pos); // 既存の円柱
    }
} else {
    this._createStation(stationId, stationData, pos);
}
```

**`_createModulerGridModel(stationId, stationData, pos)` 新規追加**:
- `model3DGrid.cells` の各セルに `BoxGeometry(gridSize, height, gridSize)` を生成
- 色: `0x4a148c`（既存 moduler 色）、`MeshStandardMaterial`, `transparent: true, opacity: 0.7`
- セル位置: `x = (cx - (cols-1)/2) * gridSize`, `y = height/2`, `z = (cy - (rows-1)/2) * gridSize`
- `THREE.Group` にまとめてシーンに追加
- `this.stations.set(stationId, { mesh, position, label, stationType: 'moduler', ... })`
- ラベルは `_createLabel()` を流用（`y = height + 15`）
- インターロック指標は `_createInterlockIndicators()` を流用

**`_createModulerGltfModel(stationId, stationData, pos)` async 新規追加**:
```javascript
async _createModulerGltfModel(stationId, stationData, pos) {
    const { model3DGltf, model3DGlb } = stationData.config;
    const loader = new GLTFLoader();
    let url;
    if (model3DGltf) {
        const blob = new Blob([JSON.stringify(model3DGltf)], { type: 'model/gltf+json' });
        url = URL.createObjectURL(blob);
    } else {
        const binary = Uint8Array.from(atob(model3DGlb), c => c.charCodeAt(0));
        const blob = new Blob([binary], { type: 'model/gltf-binary' });
        url = URL.createObjectURL(blob);
    }
    const gltf = await new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
    URL.revokeObjectURL(url);
    gltf.scene.position.set(pos.x, 0, pos.z);
    this.scene.add(gltf.scene);
    this.stations.set(stationId, {
        mesh: gltf.scene, position: pos,
        label: this._createLabel(stationData.name || stationId, pos.x, 50, pos.z),
        stationType: 'moduler', portSlots: [], portConfig: [],
        stationName: stationData.name || stationId
    });
}
```

**`loadScenario()` の async 化**: 既存の `app.js` での呼び出し箇所に `await` が必要かどうかを確認する。

## グリッド選択のハイライト描画

```javascript
// 選択セルの描画（_drawCells()内）
ctx.fillStyle = 'rgba(0, 207, 255, 0.35)';
ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
ctx.strokeStyle = '#00cfff';
ctx.lineWidth = 2;
ctx.shadowColor = '#00cfff';
ctx.shadowBlur = 12;
ctx.strokeRect(x * cellPx + 1, y * cellPx + 1, cellPx - 2, cellPx - 2);
ctx.shadowBlur = 0;
```

## モーダル設計

### ブロックサイズ切替モーダル

```
+-----------------------------------+
| 格子設定                      [×] |
|-----------------------------------|
|  格子サイズ: [  20  ]             |
|  列数:       [  20  ]             |
|  行数:       [  20  ]             |
|-----------------------------------|
|           [キャンセル] [決定]     |
+-----------------------------------+
```
- 格子サイズ: min=1, max=200
- 列数・行数: min=1, max=50
- 決定時: 範囲外セルを `_selectedCells` から除去 → `_render()`

### ブロック高さ切替モーダル

```
+-----------------------------------+
| ブロック高さ設定              [×] |
|-----------------------------------|
|  高さ:  [  40  ]                  |
|-----------------------------------|
|           [キャンセル] [決定]     |
+-----------------------------------+
```
- 高さ: min=1, max=500

両モーダルとも既存の `.modal-overlay` / `.modal` CSS クラスを流用。

## ディレクトリ構造

```
sim-editor/html/
├── editor.html          ← 変更: importmap追加、canvas/input追加
├── css/
│   └── style.css        ← 変更: ツールバー・グリッドエディタスタイル追加
└── js/
    ├── editor.js        ← 変更: import ModelEditor、drillDown/drillUp、各ハンドラ追加
    ├── model-editor.js  ← 新規作成: ModelEditor クラス（ES Module）
    └── (他は変更なし)

sim-visualizer/html/
└── js/
    └── visualizer.js    ← 変更: import GLTFLoader、_createModulerGridModel/_createModulerGltfModel 追加
```

## 実装の順序

1. **editor.html**: import map、canvas要素、ファイル入力要素の追加
2. **style.css**: ツールバー・グリッドエディタのスタイル追加
3. **model-editor.js**: ModelEditor クラス全体
4. **editor.js**: `import { ModelEditor }` 追加、各メソッドの追加
5. **visualizer.js**: GLTFLoader 追加、2パスのモデル描画追加

## セキュリティ考慮事項

- `.gltf` インポート時: `gltfJson.asset?.version` の存在チェックで最低限の形式検証
- グリッドサイズ・高さの input には min/max を設定し異常値を防止
- `cells` 配列の保存前に `col < 0 || col >= cols || row < 0 || row >= rows` の範囲チェック

## パフォーマンス考慮事項

- `exportFromGrid()` の GLTFExporter はメインスレッドをブロックするが、エクスポートはユーザーアクション起点なので許容範囲
- `_createModulerGltfModel()` は async。`loadScenario()` の async 化が必要
- Blob URL は `URL.revokeObjectURL()` で確実に解放する
- グリッドの再描画はドラッグ中の mousemove で毎回発生するため `requestAnimationFrame` で間引く

## 将来の拡張性

- `_createModulerGridModel()` と `_createModulerGltfModel()` の分離設計により、将来的なモデル種別追加が容易
- グリッドエディタに3Dプレビューを追加する場合、`model-editor.js` に `THREE.WebGLRenderer` を追加するだけで対応可能
- `model3DGrid` のセル単位マテリアル設定を将来追加する場合、`cells` を `[[col, row, materialId], ...]` に拡張できる
