# 要求: 複合テストシナリオ作成・実行・可視化

## 目的

シミュレーションエンジンの全機能を網羅する複合テストシナリオを設計・実行し、visualizerで確認する。

## 対象機能（網羅対象）

| 機能 | ステーション種別 | テストポイント |
|------|----------------|--------------|
| ワーク生成 | Source | workType指定、workCount制御 |
| 逐次処理 | Processing | 複数ステップ、異なる処理時間 |
| ワーク結合 | Merge | 2入力→1出力、outputWorkType設定 |
| ワーク分割 | Split | 1入力→2出力、ポートインデックスルーティング |
| サブシナリオ | Moduler | Entry→Processing→Exit の内部チェーン |
| ワーク廃棄 | Drain | 複数ドレイン |
| インターロック | 全体 | 搬入可/搬出可信号の連鎖検証 |
| 初期条件 | Source | workIds による事前割当て |

## テストシナリオ設計

### シナリオ11: 自動車組立ライン（複合）

**フロー:**
```
src-frame(frame,4個)  → proc-frame-1 → proc-frame-2 ──┐
                                                         ├→ merge-assemble → mod-finish → split-disassemble
src-engine(engine,4個) → proc-engine-1 ─────────────────┘

split-disassemble → port0 → proc-qc-frame  → drain-frame-out
                  → port1 → proc-qc-engine → drain-engine-out
```

**Moduler内部:**
```
entry-1 → proc-paint → proc-inspect → exit-1
```

### シナリオ12: 電子基板実装ライン（Switch付き）

**フロー:**
```
src-base(base,6個) → switch-divert(round-robin)
  → port0 → proc-line-a-1 → proc-line-a-2 → merge-board
  → port1 → proc-line-b-1 → proc-line-b-2 → merge-board
src-chip(chip,6個) → proc-chip-prep → merge-board
merge-board → moduler-smt → drain-ok
```

### シナリオ13: 初期条件テスト

シナリオ11の構成で初期条件（workIds指定）を使用して実行。
シミュレーション開始時にソースのワークIDを事前定義。

## 実行方法

1. `http://localhost:8080/api/scenarios` に POST してシナリオ登録
2. `http://localhost:8080/api/simulations` に POST してシミュレーション実行
3. `https://localhost/visualizer/?sim=<simulationId>` で可視化確認
