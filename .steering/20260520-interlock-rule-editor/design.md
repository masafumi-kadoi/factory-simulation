# 設計書

## アーキテクチャ概要

フロントエンドのみの変更。バックエンドは `config["interlockRules"]` を既に読み取る仕組みを持つため、変更不要。

```
ローカルビュー (local-window.html / local-window.js)
  └── ロジック編集タブ
        └── [新規] インターロックルールエディタセクション
              ├── ルール一覧テーブル（編集・追加・削除）
              └── 「デフォルトに戻す」ボタン
                        ↓ 保存時
              config.interlockRules に書き込み
                        ↓
              既存の updateStation() API 呼び出し
                        ↓
              simulation-core: InitializeInterlockRulesFromConfig() で読み取り
```

## コンポーネント設計

### 1. デフォルトルール定数（JS側）

**責務**: バックエンドのデフォルト定義を JS 側にミラーし、「デフォルト表示」と「リセット」に使用

**実装の要点**:
- `local-window.js` の先頭付近に `INTERLOCK_DEFAULTS` 定数として定義
- ステーション種別をキーとした Map 形式
- バックエンドの `interlock.go` と同じ構造 (`signals`, `rules`)

```javascript
const INTERLOCK_DEFAULTS = {
  processing: {
    signals: [ /* 10信号 */ ],
    rules: [
      { id: 'R1', description: '空きステーション → 搬入可ON',
        target: 'inputReady', value: true,
        conditions: [{ signal: 'inputWorkPresent', value: false }] },
      // ... R2〜R6
    ]
  },
  merge: { /* ... */ },
  split: { /* ... */ },
  switch: { /* ... */ },
};
```

### 2. 選択可能信号リスト定数

**責務**: ドロップダウンに表示する信号名をステーション種別ごとに定義

```javascript
const INTERLOCK_SIGNALS = {
  base: [
    'inputWorkPresent', 'processingWorkPresent', 'outputWorkPresent',
    'running', 'complete', 'processReady',
    'inputReady', 'outputReady', 'workFull', 'workEmpty',
  ],
  merge:  [...base, 'allPortsFull'],
  split:  [...base, 'allPortsEmpty'],
  switch: [...base],
};
```

### 3. ルールエディタ描画関数

**責務**: ステーションの現在ルールを HTML として描画

**実装の要点**:
- `_buildInterlockEditorHtml(station)` 関数を追加
- `station.config.interlockRules` があればそれを使用、なければ `INTERLOCK_DEFAULTS[type]` を使用
- 対象外ステーション（source, drain, entry, exit, moduler）は空文字を返す
- 各ルール行は `data-rule-index` 属性で識別
- 各条件行は `data-rule-index` + `data-cond-index` で識別

**HTML構造**:
```html
<div class="props-section-header">
  インターロックルール
  <button id="props-interlock-reset">デフォルトに戻す</button>
</div>
<div id="props-interlock-rules">
  <!-- ルール行 -->
  <div class="interlock-rule-row" data-rule-index="0">
    <div class="interlock-rule-header">
      <span>R1</span>
      <input type="text" class="interlock-desc" value="空きステーション → 搬入可ON">
      <select class="interlock-target"> ... </select>
      <label><input type="checkbox" class="interlock-value"> ON</label>
      <button class="interlock-rule-delete">削除</button>
    </div>
    <div class="interlock-conditions">
      <!-- 条件行 -->
      <div class="interlock-cond-row" data-cond-index="0">
        <select class="interlock-cond-signal"> ... </select>
        <label><input type="checkbox" class="interlock-cond-value"> ON</label>
        <button class="interlock-cond-delete">−</button>
      </div>
      <button class="interlock-cond-add">＋ 条件追加</button>
    </div>
  </div>
  <!-- ... -->
  <button id="props-interlock-add">＋ ルール追加</button>
</div>
```

### 4. イベントリスナー

**責務**: ルールエディタの全インタラクションを `s.config.interlockRules` に反映

**実装の要点**:
- `_attachInterlockListeners(s)` 関数を追加
- `_attachPropsListeners()` から呼び出す
- 変更のたびに `s.config.interlockRules` を更新（既存の config フィールドパターンと同じ）
- 「デフォルトに戻す」: `delete s.config.interlockRules` → `_buildInterlockEditorHtml` で再描画

**ルール追加**: 空ルールをリストに追加、IDを `R{n+1}` で自動採番

**削除**: そのインデックスのルール/条件を配列から取り除いて再描画

## データフロー

### ルール編集→保存

```
1. ユーザーがローカルビューでステーションを選択
2. _buildTypeConfigHtml() → _buildInterlockEditorHtml() でエディタ描画
3. ユーザーがルール編集（変更のたびに s.config.interlockRules を更新）
4. ユーザーが保存ボタン押下
5. 既存の saveLocalWindow() が s.config ごと updateStation() に渡す
6. simulation-core が config["interlockRules"] を読み取り、デフォルト上書き
```

### デフォルトに戻す

```
1. 「デフォルトに戻す」押下
2. delete s.config.interlockRules
3. _buildInterlockEditorHtml(s) で再描画 → INTERLOCK_DEFAULTS[type] が表示される
4. 保存時は interlockRules なし → バックエンドがデフォルトを適用
```

### 未変更時の保存動作

```
- ユーザーがルールを一切変更しなかった場合 → s.config.interlockRules は undefined のまま
- 保存時も interlockRules は config に含まれない → バックエンドがデフォルトを適用
- ルールを1つでも変更・追加・削除した時点で s.config.interlockRules に書き込む
```

**実装方針**: エディタ上の変更操作（signal変更・value変更・削除・追加）が発火したときに初めて `s.config.interlockRules` をセットする。デフォルト表示は「読み取り専用の初期値表示」であり、保存に影響しない。

## テスト戦略

手動確認項目:

1. processing ステーションを開く → デフォルト6ルールが表示される
2. ルール説明を編集 → 保存 → 再度開く → 編集内容が保持されている
3. ルール追加・削除が正しく動作する
4. 条件追加・削除が正しく動作する
5. 「デフォルトに戻す」でデフォルトルールに戻る
6. source ステーションではエディタセクションが表示されない
7. merge ステーションで allPortsFull がドロップダウンに含まれる

## ディレクトリ構造（変更ファイル）

```
factory-visualizer/html/
├── js/
│   └── local-window.js   ← メイン変更（定数追加・関数追加・既存関数呼び出し追加）
└── local-window.html     ← CSSスタイル追加（必要に応じて）
```

## 実装の順序

1. `INTERLOCK_DEFAULTS` 定数と `INTERLOCK_SIGNALS` 定数を追加
2. `_buildInterlockEditorHtml(s)` 関数を実装
3. `_buildTypeConfigHtml(s)` の末尾でインターロックエディタを呼び出すよう修正
4. `_attachInterlockListeners(s)` 関数を実装
5. `_attachPropsListeners(s)` から `_attachInterlockListeners` を呼び出す
6. 手動確認（受け入れ条件チェック）

## セキュリティ考慮事項

- 信号名はドロップダウンの選択肢に限定するため、任意文字列インジェクションはない
- 説明フィールドは `_escapeHtml()` でエスケープ（既存ユーティリティ使用）

## パフォーマンス考慮事項

- ルール数は通常10件以下なので再描画コストは無視できる
- 変更のたびに DOM を全再構築する必要はなく、オブジェクトを更新するのみ
