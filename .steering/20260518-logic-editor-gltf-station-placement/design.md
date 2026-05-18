# 設計書

## アーキテクチャ概要

既存のロジックタブ（SVG + 左パレット）を拡張し、Three.jsによるGLTF上面投影をバックグラウンドに追加する。
座標系はGLTFモデルのローカル座標（Three.js単位）に統一する。

```
┌─────────────────────────────────────────────────────┐
│ ロジック編集タブ                                      │
│ ┌──────────┐ ┌──────────────────────────────┐ ┌────┐ │
│ │ サイドバー│ │ キャンバスエリア              │ │プ  │ │
│ │          │ │ ┌────────────────────────┐   │ │ロ  │ │
│ │ ツール   │ │ │ canvas (GLTF上面投影)  │   │ │パ  │ │
│ │ [選択]   │ │ │ SVG overlay (stations) │   │ │ティ│ │
│ │ [接続]   │ │ └────────────────────────┘   │ │    │ │
│ │ [削除]   │ │                              │ │    │ │
│ │──────────│ │                              │ │    │ │
│ │ 未配置   │ │                              │ │    │ │
│ │ ステーシ │ │                              │ │    │ │
│ │ ョン一覧 │ │                              │ │    │ │
│ │ [S1]     │ │                              │ │    │ │
│ │ [S2]     │ │                              │ │    │ │
│ │ ──────── │ │                              │ │    │ │
│ │ [+新規]  │ │                              │ │    │ │
│ └──────────┘ └──────────────────────────────┘ └────┘ │
└─────────────────────────────────────────────────────┘
```

## コンポーネント設計

### 1. GLTF上面投影レンダラー (`_initLogicProjection`)

**責務**:
- `_logicProjectionRenderer`: Three.js WebGLRenderer（`#logic-projection-canvas` にアタッチ）
- `_logicProjectionScene`: GLTFモデルを配置するScene
- `_logicProjectionBBox`: モデルのバウンディングボックス（座標変換に使用）
- 1フレームだけ静的にレンダリング（アニメーション不要）

**実装の要点**:
- OrthographicCamera: `camera.position.set(0, 1000, 0); camera.lookAt(0, 0, 0)`
- カメラの left/right/top/bottom をbboxから計算してモデル全体をカバー
- `model3DGlb` がない場合は初期化しない（既存グリッドをそのまま表示）
- レンダラーサイズはキャンバスエリアのサイズに追従（ResizeObserver）

**座標変換**:
```
キャンバスピクセル (px, py) → GLTFローカル座標 (lx, lz)

lx = bbox.min.x + (px / canvasW) * (bbox.max.x - bbox.min.x)
lz = bbox.min.z + (py / canvasH) * (bbox.max.z - bbox.min.z)

SimDB保存値:
  station.positionX = lx  （Three.js X軸、設備原点基準）
  station.positionY = lz  （Three.js Z軸、設備原点基準）
```

### 2. サイドバー: 未配置ステーション一覧

**責務**:
- `renderUnplacedList()`: 未配置ステーション（positionX = null）をリスト表示
- 各リストアイテムはドラッグ開始イベントを持つ
- 「+新規追加」ボタンで種別選択ダイアログ → addStation()

**HTMLの変更**:
- 現在の `.logic-palette` 内の「追加」セクション（station-btn群）を削除
- 代わりに `#unplaced-station-list` コンテナを追加
- ツール系ボタン（選択/接続/削除）は維持

**ドラッグ開始**:
```javascript
item.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/station-id', stationId);
});
```

### 3. ドラッグ＆ドロップ配置

**責務**:
- `.logic-canvas-area` に `dragover` / `drop` イベントをバインド
- ドロップ時にキャンバス座標 → GLTFローカル座標を計算
- station.positionX/Y を更新
- `renderUnplacedList()` + `renderStations()` を再描画

**SVGでのドラッグ移動（既存）**:
- `onStationMouseDown` → `mousemove` → positionX/Y更新 は維持
- ただし座標系がSVGピクセルではなくGLTFローカル座標になる

### 4. SVGオーバーレイの座標系変更

**現状**: SVG viewBox = ステーションのピクセル座標から動的計算  
**変更後**: SVG viewBox = GLTFモデルのbboxに固定

```javascript
// bboxが判明している場合
svg.setAttribute('viewBox', 
  `${bbox.min.x} ${bbox.min.z} ${bbox.max.x - bbox.min.x} ${bbox.max.z - bbox.min.z}`
);
```

これにより、SVGのローカル座標 = GLTFモデルのローカル座標 が一致する。

**model3DGlbがない場合**: 従来のviewBox計算ロジックを維持。

### 5. 座標系の整合性

| | 値の意味 | 単位 |
|---|---|---|
| machine.positionX/Y | グローバルシーン座標 | Three.js units |
| station.positionX | 設備原点からのローカルX | Three.js units |
| station.positionY | 設備原点からのローカルZ | Three.js units |
| station未配置 | positionX = null | — |

グローバル座標への変換（将来のグローバルビュー等で使用）:
```
global_x = machine.positionX + station.positionX
global_z = machine.positionY + station.positionY
```

## データフロー

### 初期ロード
```
1. populateLogicTab() 呼び出し
2. childStations（DB取得済み）を positionX でフィルタリング
   - null → 未配置リスト
   - 非null → SVGキャンバス
3. model3DGlb があれば _initLogicProjection() で上面投影初期化
4. SVG viewBox を bbox に設定
5. renderUnplacedList() + renderStations() + renderConnections()
```

### ドラッグ配置
```
1. サイドバーアイテムをドラッグ開始（stationIdをdataTransfer）
2. .logic-canvas-area にドロップ
3. ドロップ座標(clientX/Y) → キャンバス相対座標 → GLTFローカル座標 変換
4. station.positionX = lx, station.positionY = lz
5. renderUnplacedList() で一覧から消える
6. renderStations() でSVG上に表示
```

### 保存
```
1. saveAndClose() → API.saveMachineLogic()
2. 未配置ステーション: positionX/Y = null で送信（DB上もnullのまま）
3. 配置済みステーション: positionX/Y = GLTFローカル座標（Three.js units）
```

## 修正ファイル

### `factory-visualizer/html/local-window.html`
- `.logic-palette` 内のHTML変更:
  - ツールボタン（選択/接続/削除）は維持
  - 位置表示は維持
  - 「追加」セクション（station-btn群）を削除
  - `#unplaced-station-list` と `#btn-add-station` を追加
- `.logic-canvas-area` に `#logic-projection-canvas` を追加（SVGより前に配置）

### `factory-visualizer/html/js/local-window.js`
- モジュールレベル変数追加:
  - `let _logicProjectionRenderer = null`
  - `let _logicProjectionBBox = null`
- 新関数:
  - `_initLogicProjection()`: Three.js OrthoCam + GLTF読み込み + 1フレームレンダリング
  - `renderUnplacedList()`: 未配置リスト描画 + ドラッグイベント設定
  - `_dropToLogicCanvas(e)`: ドロップ時の座標変換と配置処理
- 変更関数:
  - `populateLogicTab()`: 投影初期化 + 未配置リスト表示
  - `refreshLogicSVGSize()`: bbox使用モードを追加
  - `initToolPalette()`: station-btn群のイベントを削除 → 新規追加ボタンに置き換え

## パフォーマンス考慮事項

- Three.jsレンダラーは1フレームのみ描画し、`requestAnimationFrame` ループは起動しない
- `_logicProjectionRenderer.dispose()` をタブ切り替え時に呼び出さない（再描画不要なため静的保持）
- SVGはDOMネイティブなため大量ステーションでも問題なし
