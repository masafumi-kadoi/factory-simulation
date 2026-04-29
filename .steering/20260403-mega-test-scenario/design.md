# 設計書

## アーキテクチャ概要

7ゾーン構成の大規模EV電池製造工場シナリオ。各ゾーンが異なるmerge/splitパターンを検証。

```
Zone A (30st): 4src → merge4 → modulerMS → split4 → 4drains
Zone B (32st): 3src → merge3 → modulerMS → split3 → 3 lines with modulers → 3drains
Zone C (25st): 4src → moduler4in4out(内部merge4+split4) → 4drains
Zone D (38st): 4src → cascade merge2×2 → merge2 → modulerMS → split2 → merge2 → drain + independent
Zone E (27st): 2src → moduler2in2out → split2×2 → merge2 → 3drains
Zone F (27st): 3src → merge3 → modulerMS → split4 → 4drains
Zone G (21st): 2src → merge2 → split3 → merge3 → moduler → drain
Total: 200 stations
```

## コンポーネント設計

### 1. ヘルパー関数 (complex_scenarios_test.go に追加)

- `cMerge3(id, procT, outputType)` — 3入力マージ
- `cMerge4(id, procT, outputType)` — 4入力マージ
- `cSplit3(id, procT)` — 3出力スプリット
- `cSplit4(id, procT)` — 4出力スプリット
- `modulerMS(id, procT)` — 1in1out, 内部: entry→p0→p1→split2→(p2→p3, p4→p5)→merge2→p6→p7→exit
- `moduler2in2out(id, procT)` — 2in2out, 内部: entry0/entry1→merge2→chain→split2→exit0/exit1
- `moduler4in4out(id, procT)` — 4in4out, 内部: entry0-3→merge4→chain→split4→exit0-3

### 2. テストファイル

`simulation-core/internal/simulation/mega_scenario_test.go` に新規作成。

### 3. Seedコマンド

`simulation-core/cmd/seed/main.go` にヘルパーとシナリオ11を追加。

## 実装の順序

1. テストファイルにヘルパー関数を追加
2. 200ステーションシナリオを構築
3. テスト実行・検証
4. seedコマンドにも追加
