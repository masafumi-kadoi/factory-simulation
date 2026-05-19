# 設計: ローカルビュー プロパティパネル拡充

## アプローチ
static HTML から動的レンダリングへ変更。
タイプ選択に応じてタイプ別設定フィールドを動的に表示する。

## 変更ファイル
1. `factory-visualizer/html/local-window.html` — CSS追加 + props-fieldsをスリム化
2. `factory-visualizer/html/js/local-window.js` — プロパティパネル全面書き換え

## HTML変更
- props-fieldsの中身を空にする（動的に書き換えるため）
- 新規CSSクラスを追加:
  - `.props-section-header`: セクション区切りヘッダー
  - `.props-hint`: ヒントテキスト（小さい灰色文字）
  - `.props-checkbox-label`: チェックボックス + ラベルのインライン表示
  - `.props-port-row`: ポート設定行（flex表示）
  - `.props-port-capacity`: ポート容量入力フィールド（細め）

## JS変更

### 削除
- `initPropsPanel()` 内の静的ID別イベントリスナー（props-name, props-type等）
- `updatePropsPanel()` 内の静的setValue処理

### 追加関数
- `_escapeHtml(str)`: XSS対策エスケープ
- `_getConfigFields(type)`: タイプ別フィールド定義を返す
- `_buildMergePortsHtml(s)`: mergeポート行HTML生成
- `_buildSplitPortsHtml(s)`: splitポート行HTML生成
- `_buildTypeConfigHtml(s)`: タイプ別設定HTML生成
- `_buildPropsHtml(s)`: プロパティパネル全体HTML生成
- `_attachPropsListeners(s)`: レンダリング後のイベントリスナー設定
- `_attachMergePortListeners(s)`: mergeポート用リスナー
- `_attachSplitPortListeners(s)`: splitポート用リスナー

### 書き換え
- `updatePropsPanel()`: innerHTML + _attachPropsListeners()を使うよう全面書き換え
- `initPropsPanel()`: スタブ化（本体はupdatePropsPanelに移動）

## タイプ変更時の挙動
- タイプ変更 → s.config = {} でリセット → updatePropsPanel() で再レンダリング

## ポート数変更時の挙動
- mergeCount/splitCount変更 → ポート行HTMLを再生成してリスナー再設定

## データ保存
- 各フィールドのchangeイベントで即座にchildStationsのconfigに反映
