# タスクリスト: ローカルビュー プロパティパネル拡充

## フェーズ1: HTML更新

- [x] local-window.html: `.props-section-header` CSSクラスを追加
- [x] local-window.html: `.props-hint` CSSクラスを追加
- [x] local-window.html: `.props-checkbox-label` CSSクラスを追加
- [x] local-window.html: `.props-port-row`, `.props-port-capacity`, `.props-port-label`, `.props-port-unit` CSSを追加
- [x] local-window.html: `props-fields` の中身を空にする（JSで動的生成するため）

## フェーズ2: JS基盤関数追加

- [x] local-window.js: `_escapeHtml(str)` 関数を追加
- [x] local-window.js: `_getConfigFields(type)` 関数を追加（タイプ別フィールド定義）
- [x] local-window.js: `_buildMergePortsHtml(s)` 関数を追加
- [x] local-window.js: `_buildSplitPortsHtml(s)` 関数を追加
- [x] local-window.js: `_buildTypeConfigHtml(s)` 関数を追加（タイプ別設定HTML）
- [x] local-window.js: `_buildPropsHtml(s)` 関数を追加（全体HTML生成）

## フェーズ3: リスナー関数追加

- [x] local-window.js: `_attachMergePortListeners(s)` 関数を追加
- [x] local-window.js: `_attachSplitPortListeners(s)` 関数を追加
- [x] local-window.js: `_attachPropsListeners(s)` 関数を追加（全フィールド対応）

## フェーズ4: 既存関数書き換え

- [x] local-window.js: `updatePropsPanel()` を動的レンダリング方式に書き換え
- [x] local-window.js: `initPropsPanel()` をスタブ化（本体はupdatePropsPanelへ移動）

## 実装後の振り返り

- 実装完了日: 2026-05-20
- 計画との差分: なし。設計通りに実装完了。
- 学んだこと: static HTMLパネルを動的レンダリングに切り替えると、タイプ別フィールドの表示/非表示ロジックがシンプルになる。
- 次回への改善提案: インターロック条件編集モーダルも追加すると、ScenarioEditorとの機能差がさらに縮まる。
