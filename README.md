# BMSG-DB

BMSG Universe の共通DBを管理する Google Apps Script 用リポジトリです。

## 使用上の注意

### 1. 正本と編集対象
- このGASが書き込む対象は BMSG Universe の共通DBです。
- 既存サービス用Spreadsheet / GASは移行元・参照元として扱い、原則変更しません。
- DB構造や仕様を変更する前に、BMSG Universe の最新の実務指示書・変更履歴・現行仕様を確認してください。

### 2. GitHubとApps Script本体は別です
- このリポジトリを更新しただけでは、Apps Script本体へ自動反映されるとは限りません。
- 現時点では `.github/workflows` / `.clasp.json` による自動デプロイ構成を前提にしないでください。
- GAS本体へ反映する際は、GitHubの最新版とApps Script側の内容が一致していることを確認してください。

### 3. シート参照は列位置ではなくヘッダー基準
- `05_Profiles` などのデータシートは、可能な限り列番号ではなくヘッダー名で参照します。
- プロフィール項目の追加・列移動で既存項目の列位置が変わっても壊れない構造を維持してください。
- 新しい実装で `B列 = P001` のような固定列依存を追加しないでください。

## プロフィール管理

### 入力_プロフィール
- A〜D列は固定列です。
  - A: アーティスト名
  - B: メイングループ
  - C: MemberID
  - D: ColorHex
- E列以降をプロフィール項目として扱います。
- プロフィール項目は ProfileID / DataType / IsMultiValue / DisplayGroup の設定を持ちます。
- 通常のプロフィール追加は、空きプロフィール列へ入力して `BMSG Universe > プロフィール｜変更を確認・反映` から行います。

### 05_Profiles
- `MemberID` と各 `ProfileID` をヘッダーとして保持します。
- プロフィール同期GASはProfileIDのヘッダー名を使って値を更新します。
- 手動で列を追加・移動する場合もProfileIDヘッダーを崩さないでください。

### ProfileSettings
`BMSG_ Universe_Log` の `ProfileSettings` が、サイト側でのプロフィール項目の扱いを制御します。

主な設定：
- `IsMultiValue`
  - `TRUE`: 1項目に複数値を持つ項目として扱う
  - `FALSE`: 単一値として扱う
- `IsCompareTarget`
  - `TRUE`: SEARCH / CHEMISTRY の比較対象にする
  - `FALSE`: プロフィール表示は可能だが比較対象にはしない
- `DisplayOrder`
  - プロフィール詳細やCHEMISTRY等の表示順に使用する
- `IsActive`
  - サイト上で現在有効なプロフィール項目として扱う

### 新規プロフィール項目の自動登録
新しいプロフィール項目を `プロフィール｜変更を確認・反映` で確定すると、以下を自動実行します。

1. 新しいProfileIDを採番
2. `05_Profiles` にProfileID列を追加
3. `BMSG_ Universe_Log / ProfileSettings` に設定行を追加

ProfileSettingsの初期値：
- `FieldName`: 入力_プロフィールの項目名
- `DataType`: 入力値を継承
- `IsMultiValue`: 入力値を継承
- `DisplayGroup`: 入力値を継承
- `IsCompareTarget`: `FALSE`
- `QuizDifficulty`: 空欄
- `DisplayOrder`: 現在の最大値 + 1
- `IsActive`: `TRUE`

このため、新規項目は基本的にサイトのプロフィールへ自動反映されます。CHEMISTRY / SEARCHの比較対象にしたい場合だけ、ProfileSettingsの `IsCompareTarget` を `TRUE` に変更してください。

### P000「呼ばれ順」
- `P000` は「呼ばれ順」です。
- `05_Profiles` では `MemberID` の直後、`P001` より前に配置します。
- DataTypeは `NUMBER`、IsMultiValueは `FALSE` です。
- ProfileSettingsでは `DisplayOrder = 0`、`IsCompareTarget = TRUE` とし、プロフィール・CHEMISTRYでは先頭に表示します。
- メイングループ所属メンバーは主所属Group内の呼ばれ順を保持します。
- SOLO / その他で呼ばれ順がない場合は空欄とします。

## 安全運用
- 同期前の確認ダイアログを飛ばして直接更新する処理を安易に追加しないでください。
- 新規プロフィール項目追加時は、ProfileSettingsシートと必須ヘッダーを先に検証し、異常時はコアDBを書き始める前に停止します。
- 既存値・既存列・既存ロジックを、別機能の修正に伴って勝手に削除・変更しないでください。
- 仕様変更と単なる不具合修正を区別し、仕様変更時はBMSG Universeの正本文書にも反映してください。
