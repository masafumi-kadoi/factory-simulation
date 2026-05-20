# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

---

## フェーズ1: 定数定義

- [x] `INTERLOCK_DEFAULTS` 定数を `local-window.js` に追加
  - [x] processing（R1〜R6）
  - [x] merge（R1〜R4）
  - [x] split（R1〜R4）
  - [x] switch（entry と同じ R1〜R4）

- [x] `INTERLOCK_SIGNALS` 定数を追加
  - [x] base（10信号）
  - [x] merge 用（base + allPortsFull）
  - [x] split 用（base + allPortsEmpty）
  - [x] switch 用（base と同じ）

## フェーズ2: UI描画

- [x] `_buildInterlockEditorHtml(s)` 関数を実装
  - [x] 対象外種別（source, drain, entry, exit, moduler）は空文字を返す
  - [x] `s.config.interlockRules` があればそれを使用、なければ `INTERLOCK_DEFAULTS[type]` を使用
  - [x] 「デフォルトに戻す」ボタン（`id="props-interlock-reset"`）
  - [x] ルール行ループ（`data-rule-index`）
    - [x] ルールID表示（編集不可）
    - [x] 説明テキスト入力
    - [x] ターゲット信号ドロップダウン（`INTERLOCK_SIGNALS` を使用）
    - [x] 設定値 ON/OFF チェックボックス
    - [x] 「削除」ボタン
    - [x] 条件行ループ（`data-cond-index`）
      - [x] 条件信号ドロップダウン
      - [x] 条件値 ON/OFF チェックボックス
      - [x] 「−」削除ボタン
    - [x] 「＋ 条件追加」ボタン
  - [x] 「＋ ルール追加」ボタン（`id="props-interlock-add"`）

- [x] `_buildTypeConfigHtml(s)` の返り値にインターロックエディタ HTML を追記

## フェーズ3: イベントリスナー

- [x] `_attachInterlockListeners(s)` 関数を実装
  - [x] 「デフォルトに戻す」: `delete s.config.interlockRules` → エディタ再描画
  - [x] 説明変更 → `s.config.interlockRules.rules[i].description` を更新
  - [x] ターゲット信号変更 → `s.config.interlockRules.rules[i].target` を更新
  - [x] 設定値変更 → `s.config.interlockRules.rules[i].value` を更新
  - [x] 条件信号変更 → `s.config.interlockRules.rules[i].conditions[j].signal` を更新
  - [x] 条件値変更 → `s.config.interlockRules.rules[i].conditions[j].value` を更新
  - [x] ルール削除 → 配列から取り除いてエディタ再描画
  - [x] 条件削除 → 配列から取り除いてエディタ再描画
  - [x] 「＋ ルール追加」→ 空ルールを配列に追加・ID自動採番してエディタ再描画
  - [x] 「＋ 条件追加」→ 空条件を対象ルールの conditions に追加して再描画

- [x] `_attachPropsListeners(s)` から `_attachInterlockListeners(s)` を呼び出す

## フェーズ4: 初期化時の config 同期

- [x] 未変更時は `s.config.interlockRules` を書かない動作を確認
  - [x] 初回表示時はデフォルトルールを表示するが `s.config.interlockRules` はセットしない（`??` によるフォールバック表示のみ）
  - [x] ルールを変更せず保存した場合、保存データに `interlockRules` フィールドが含まれないことを確認（フェーズ6で実機確認）
- [x] 変更操作（信号変更・値変更・追加・削除）時に初めて `s.config.interlockRules` がセットされることを確認（`_ensureCustomRules` で実装済み）

## フェーズ5: スタイル調整

- [x] インターロックルール行のCSS追加（`local-window.html` または既存 style ブロック）
  - [x] ルール行の区切り線・背景色
  - [x] 条件行のインデント
  - [x] ボタンのサイズ・色（削除は赤系、追加は青系）

## フェーズ6: 手動動作確認

- [ ] processing ステーションを開く → デフォルト6ルールが表示される
- [ ] ルール説明を編集 → 保存 → 再度開く → 編集内容が保持されている
- [ ] ルール追加 → IDが自動採番される
- [ ] ルール削除 → 削除される
- [ ] 条件追加・削除が正しく動作する
- [ ] 「デフォルトに戻す」でデフォルトルールに戻り、config.interlockRules が消える
- [ ] source ステーションではエディタセクションが表示されない
- [ ] merge ステーションで allPortsFull がドロップダウンに含まれる
- [ ] split ステーションで allPortsEmpty がドロップダウンに含まれる

## 追加フェーズ（要件変更: モーダルUI）

- [ ] ステアリング更新（要件変更を設計書に反映）
- [ ] `_IL_SIGNAL_LABELS` / `_IL_TARGET_TABS` 定数を追加
- [ ] `_buildInterlockEditorHtml` をサマリーボタンのみに変更
- [ ] `_attachInterlockListeners` をモーダル起動のみに変更
- [ ] モーダル関数を追加
  - [ ] `_openInterlockModal(s)`
  - [ ] `_buildInterlockModalHtml(s, rules, activeTab)`
  - [ ] `_buildFlowViewHtml(activeRules)`
  - [ ] `_attachInterlockModalListeners(s, modalRules, overlay)`
- [ ] CSS 更新（インライン削除・モーダル追加）
- [ ] 手動動作確認（モーダル版）

---

## 実装後の振り返り

### 実装完了日
{YYYY-MM-DD}

### 計画と実績の差分

**計画と異なった点**:
-

**新たに必要になったタスク**:
-

### 学んだこと

**技術的な学び**:
-

**プロセス上の改善点**:
-

### 次回への改善提案
-
