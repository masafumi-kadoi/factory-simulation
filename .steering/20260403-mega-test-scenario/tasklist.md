# タスクリスト

## フェーズ1: ヘルパー関数の実装

- [x] cMerge3 / cMerge4 ヘルパー関数を追加
- [x] cSplit3 / cSplit4 ヘルパー関数を追加
- [x] modulerMS（内部merge/split付き1in1outモジューラー）を追加
- [x] moduler2in2out（内部merge2+split2付き2in2outモジューラー）を追加
- [x] moduler4in4out（内部merge4+split4付き4in4outモジューラー）を追加

## フェーズ2: 200ステーションシナリオの構築

- [ ] Zone A: 電極製造ライン（4src→merge4→modulerMS→split4→4drains, 30st）
- [ ] Zone B: セル組立ライン（3src→merge3→modulerMS→split3→3lines, 32st）
- [ ] Zone C: モジュール統合ライン（4src→moduler4in4out→4drains, 25st）
- [ ] Zone D: パック組立ライン（cascade merge→modulerMS→split→merge, 38st）
- [ ] Zone E: 品質検査ライン（2src→moduler2in2out→splits→merge→drains, 27st）
- [ ] Zone F: 最終組立ライン（3src→merge3→modulerMS→split4→4drains, 27st）
- [ ] Zone G: リサイクルライン（2src→merge2→split3→merge3→moduler→drain, 21st）
- [ ] テスト関数の作成とステーション数検証

## フェーズ3: テスト実行・検証

- [ ] `go test` でシナリオが正常にパスすることを確認
- [ ] ステーション数が200であることを確認

## フェーズ4: Seedコマンドへの追加

- [ ] seedコマンドにヘルパー関数とシナリオ11を追加

---

## 実装後の振り返り

### 実装完了日
{YYYY-MM-DD}

### 計画と実績の差分

**計画と異なった点**:
- {記録}

### 学んだこと

**技術的な学び**:
- {記録}

### 次回への改善提案
- {記録}
