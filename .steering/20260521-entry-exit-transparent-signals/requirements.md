# 要求内容

## 概要

Entry/Exit ステーションの IR/OR 信号を、内部接続先ステーションの信号に透過させる。
Entry/Exit が「信号インターフェース」として機能し、マシン内部の実態をそのまま外部に露出する。

## 背景

現在 Entry.IR は「自分が空かどうか（IWP=OFF）」で決まるため、マシン内部の Processing が忙しくてもバッファとして外部からワークを受け入れてしまう。これにより搬送制御が実態と乖離する。

Entry/Exit を純粋な信号インターフェースとして扱い、機械境界の信号を内部の実態に一致させることが目的。

## 実装対象の機能

### 1. Entry.IR の透過

- Entry.IR = 内部接続先ステーション（Entry が接続する先）の IR
- ただし Entry 自身がワークを保持中（IWP=ON）の場合は OFF を保つ（キャパシティ制限）
- 接続先が Merge ポートの場合はポートレベルの IR を参照

### 2. Exit.OR の透過

- Exit.OR = 内部接続元ステーション（Exit に接続してくる先）の OR
- Exit 自身がワークを保持中（OWP=ON）の場合も OR=ON を維持する（自分のワーク搬出のため）
- 接続元が Split ポートの場合はポートレベルの OR を参照

### 3. 伝播：内部ステーションの信号変化を Entry/Exit へ反映

- 任意ステーションの信号評価後、そのステーションに隣接する Entry/Exit の IR/OR を再導出する
- 再導出後 checkHandshakes を呼び出し、新たに成立したハンドシェイクを起動する

## 受け入れ条件

### Entry.IR 透過

- [ ] 内部 Processing.IR=OFF のとき、Entry.IR=OFF（外部からワークが来ない）
- [ ] 内部 Processing.IR=ON かつ Entry が空のとき、Entry.IR=ON（外部からワークが来る）
- [ ] Entry にワークが到着中（IWP=ON）は Entry.IR=OFF（二重ロード防止）
- [ ] Processing が完了して IR=ON になったとき、Entry.IR=ON に自動更新される

### Exit.OR 透過

- [ ] 内部 Processing.OR=ON のとき、Exit.OR=ON（外部への搬出が見える）
- [ ] 内部 Processing.OR=OFF かつ Exit にワーク無しのとき、Exit.OR=OFF
- [ ] Exit 自身にワーク有（OWP=ON）なら Exit.OR=ON を維持

### 伝播

- [ ] 内部ステーションの evaluateAndLogSignals 後に隣接 Entry/Exit へ即時伝播する
- [ ] 伝播後の checkHandshakes で正しいハンドシェイクが起動する

## スコープ外

- Entry/Exit のデフォルトインターロックルールの変更（既存ルールは残し、導出で上書き）
- Moduler 信号導出の変更（`deriveModulerSignals` はそのまま）
- フロントエンド（シナリオエディタ）の変更

## 参照ドキュメント

- `SIMULATION-ENGINE.md` - シミュレーションエンジン仕様（更新対象）
- `simulation-core/internal/simulation/engine.go` - 主要実装ファイル
- `simulation-core/internal/domain/interlock.go` - デフォルトルール定義
