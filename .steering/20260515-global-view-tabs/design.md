# グローバルビュー タブ切り替え実装 — 設計

## HTML 構造の変更

```
#app (flex column)
  #menubar
  #toolbar  ← 既存 + 右端にタブボタン追加
  .global-tab-body#gv-view-display.active    ← 既存 #content + #timeline-bar をラップ
    #content (flex: 1)
    #timeline-bar
  .global-tab-body#gv-factory-info            ← 新規: 工場情報
    .gfi-sidebar
    .gfi-detail
  .global-tab-body#gv-3d-edit                 ← 新規: 3Dモデル編集
    .g3d-sidebar
    .g3d-scene  (Three.js renderer を共有)
    #g3d-floating  (フローティングウィンドウ)
  .global-tab-body#gv-logic-edit              ← 新規: ロジック編集
    .gle-sidebar
    .gle-canvas-area
      svg#global-logic-svg
```

## CSS 変更方針

### タブボタン（ツールバー内）
```css
.toolbar-tabs        /* toolbar内の右寄せタブグループ */
.toolbar-tab         /* 各タブボタン */
.toolbar-tab.active  /* アクティブスタイル: accent-blue 下線 */
```

### タブボディ
```css
.global-tab-body           /* display: none; flex: 1; flex-direction: column */
.global-tab-body.active    /* display: flex */
```

## JS 変更方針

### タブ切り替え
`initGlobalTabs()` を `app.js` に追加:
- `.toolbar-tab` のクリックで active を切り替え
- 対応する `.global-tab-body` の active を切り替え
- 「3Dモデル編集」タブに入ったとき Three.js renderer を `.g3d-scene` に移動
- 「ビュー表示」タブに戻ったとき renderer を `#scene-canvas-wrapper` に戻す

### 工場情報タブ (`initFactoryInfoTab()`)
- サイドバークリックで表示グループを切り替え
- `renderFactoryInfoGroup(groupId)`: state.currentFactory / state.stations / state.connections を元にフィールドを描画
- JSON エクスポート: 現在のファクトリデータを blob ダウンロード
- JSON インポート: file input 経由で読み込んで state を更新

グループ定義:
- `basic`   : 工場名, factoryId, 作成日
- `stations`: ステーション一覧（表形式）
- `connections`: 接続一覧（表形式）
- `metadata`: メタデータ JSON エディタ

### 3Dモデル編集タブ (`initGlobal3DEditTab()`)
- `.g3d-sidebar-item` クリックで `openG3DFloating(groupId)` を呼ぶ
- フローティングウィンドウに設定フォームを描画
- フォーム変更時に即座に scene3d のメソッドを呼ぶ（既存設定変更と同じ）
- 確定ボタンで floatingSettings をローカルストレージに保存してウィンドウを閉じる
- Three.js canvas を `.g3d-scene` にアタッチ（`scene3d.attachTo(el)` を追加）

### ロジック編集タブ (`initGlobalLogicEditTab()`)
- `renderGlobalLogicGraph()`: state.stations を SVGノードとして描画
- state.connections を矢印付き線で描画
- ドラッグでノード移動（位置は localStorage にキャッシュ）
- ダブルクリックで `openLocalWindow(sid)` を呼ぶ（既存関数再利用）
- 新規設備ボタン → 仮のステーションオブジェクト作成 → 配置モード（クリックで座標決定）
- 接続ツール: ノードをクリック → 別ノードをクリックで接続

## ファイル変更対象

| ファイル | 変更内容 |
|---|---|
| `index.html` | タブボタン追加、タブボディ要素追加 |
| `css/style.css` | タブ関連スタイル追加 |
| `js/app.js` | タブ初期化, 各タブ機能の実装 |
| `js/scene3d.js` | `attachTo(el)` メソッド追加（3D編集タブ用） |
