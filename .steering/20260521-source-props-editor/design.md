# 設計書

## アーキテクチャ概要

フロントエンドのみの変更。バックエンドはすでに `config` フィールドの PUT に対応済み。

```
ダブルクリック（sourceノード）
  ↓
gleNodeRender の dblclick ハンドラで分岐
  ↓ stationType === 'source'
openSourcePropsModal(stationId)
  ↓
モーダル表示（index.html に追加するダイアログ）
  ↓ 保存ボタン
API.updateStation(factoryId, stationId, { config: mergedConfig })
  ↓
state.stations の in-memory 更新
```

## コンポーネント設計

### 1. HTMLモーダル（index.html）

**追加場所**: `new-machine-modal` の直後

**構成**:
```html
<div id="source-props-modal" class="modal hidden">
  <div class="modal-backdrop"></div>
  <div class="modal-dialog" style="width:340px;">
    <div class="modal-header">
      <h3>ソース設定</h3>
      <button class="modal-close" id="source-props-close">✕</button>
    </div>
    <div class="modal-body">
      <!-- continuous チェックボックス -->
      <!-- workCount 数値入力 -->
      <!-- departureTime 数値入力 -->
      <!-- キャンセル / 保存 ボタン -->
    </div>
  </div>
</div>
```

### 2. openSourcePropsModal(stationId) — app.js

**責務**:
- `state.stations` から stationId に対応するステーションを取得
- `station.config` の現在値でフォームを初期化
- モーダルを表示する（stationId を data 属性で保持）

**実装の要点**:
- `continuous` チェックON → `workCount` を `disabled` にする
- 既存 config はオブジェクト全体を保持し、更新後にマージして送信する

### 3. dblclick ハンドラ分岐（gleNodeRender — app.js）

**変更前**:
```javascript
g.addEventListener('dblclick', e => {
    e.stopPropagation();
    openLocalWindow(repSid);
});
```

**変更後**:
```javascript
g.addEventListener('dblclick', e => {
    e.stopPropagation();
    if (rep?.stationType === 'source') {
        openSourcePropsModal(repSid);
    } else {
        openLocalWindow(repSid);
    }
});
```

### 4. 保存ハンドラ（app.js）

```javascript
async function saveSourceProps() {
    const stationId = document.getElementById('source-props-modal').dataset.stationId;
    const continuous = document.getElementById('source-props-continuous').checked;
    const workCount = parseInt(document.getElementById('source-props-workcount').value, 10) || 0;
    const departureTime = parseFloat(document.getElementById('source-props-departure').value) || 0;

    const st = state.stations.find(s => s.stationId === stationId);
    const newConfig = { ...(st?.config || {}), continuous, workCount, departureTime };

    try {
        await API.updateStation(state.currentFactory, stationId, { config: newConfig });
        if (st) st.config = newConfig;
        document.getElementById('source-props-modal').classList.add('hidden');
        setStatus('ソース設定を保存しました', 'status-ok');
    } catch (err) {
        setStatus('保存失敗: ' + err.message, 'status-error');
    }
}
```

## データフロー

### ソース設定保存
```
1. ユーザーがソースノードをダブルクリック
2. openSourcePropsModal(stationId) が呼ばれる
3. state.stations から現在の config を読み取りフォームに反映
4. ユーザーが値を編集して「保存」をクリック
5. { continuous, workCount, departureTime } を既存 config にマージ
6. PUT /factories/{factoryId}/stations/{stationId} → { config: mergedConfig }
7. state.stations[stationId].config を更新
8. モーダルを閉じる
```

## エラーハンドリング戦略

- API 失敗時は `setStatus('保存失敗: ' + err.message, 'status-error')` を表示し、モーダルは開いたまま

## テスト戦略

手動テスト:
- ソースノードのダブルクリックでモーダルが開くこと
- continuous ON/OFF で workCount フィールドが disabled/enabled 切り替わること
- 保存後に state.stations の config が更新されること
- ページリロード後も保存した値がモーダルに反映されること（DB 永続確認）

## 依存ライブラリ

追加なし

## ディレクトリ構造

```
変更ファイル:
  factory-visualizer/html/index.html  ← ソースモーダル HTML 追加
  factory-visualizer/html/js/app.js   ← dblclick 分岐 + openSourcePropsModal + saveSourceProps
```

## 実装の順序

1. `index.html` にモーダル HTML を追加
2. `app.js` に `openSourcePropsModal` と `saveSourceProps` を追加（`initGlobalLogicEditTab` の近傍）
3. `gleNodeRender` の dblclick ハンドラに分岐を追加

## セキュリティ考慮事項

- `workCount` / `departureTime` は number 型として送信し XSS リスクなし

## パフォーマンス考慮事項

- DOM 操作は最小限（モーダル表示/非表示のみ）
