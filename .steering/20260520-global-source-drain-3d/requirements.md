# 要求仕様: グローバルビュー Source/Drain 3Dモデル対応

## 作成日
2026-05-20

## 概要
グローバル3Dビューに Source/Drain ノードを配置可能な独立エンティティとして追加する。
現状は Machine のみが3Dビューに表示されているが、Source/Drain も同様に配置・表示できるようにする。

## 背景・現状

### 現状の制約
- `scene3d.js` の `loadFactory()` は `stationType === 'machine'` のみを3Dシーンに表示
- 「3Dモデル編集」タブの未配置リストも `stationType === 'machine'` のみ対象
- Source/Drain はロジックエディタ（GLE）ではすでにトップレベルエンティティとして扱われているが、3Dビューでは非表示
- Source/Drain の内部ステーション（parentId あり）は Machine シェル内の Tetris ブロックとして描画されている（この挙動は変更しない）

### ロジックエディタの現状
`app.js` lines 1543, 1570 でGLEはすでに source/drain を含めてフィルタしており、
トップレベル（parentId == null）の source/drain が存在することが前提となっている。

## ユーザー要求（確認済み）

| 項目 | 決定内容 |
|------|---------|
| デフォルト3D形状 | 円柱形状（Source: 緑、Drain: グレー） |
| GLBカスタムモデルアップロード | 非対応（デフォルト形状のみ） |
| ダブルクリック時の挙動 | 何もしない（配置のみ対応） |

## 要求機能

### F1: グローバル3Dビューへの表示
- `positionX != null` かつ `parentId == null` の Source/Drain ノードを3Dシーンに表示
- 円柱形状で表示（Source: 緑 #28a745、Drain: グレー #6c757d）
- stationId をラベルとして表示（Machine の設備名ラベルと同様）

### F2: 3Dモデル編集タブへの追加
- 未配置リストに Source/Drain を追加（Machine と同様の UI）
- ドラッグ&ドロップによる配置（既存の実装を再利用）
- クリックによる自動配置（既存の実装を再利用）
- 「保存して確定」で API 保存（既存の saveEquipPlacement を再利用）

### F3: 配置モードでのドラッグ移動
- 配置済みの Source/Drain を3Dビュー上でドラッグして移動可能
- Machine と同様の drag hitbox（円柱メッシュ自体を hitbox として使用）

## スコープ外（変更しない）

- GLBカスタムモデルのアップロード
- ダブルクリック時のローカルウィンドウ表示
- Machine シェル内の内部ステーション（Tetrisブロック）描画
- バックエンドAPI（既存の updateStation API で positionX/Y を保存可能）
- local-window.js
