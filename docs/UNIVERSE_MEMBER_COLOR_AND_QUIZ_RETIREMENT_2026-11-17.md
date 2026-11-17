# Universe メンバー管理・カラー重複防止・プロフィールクイズ廃止

状態：2026-11-17 / **開発ブランチ実装のみ・本番未デプロイ・本番DB無変更**

## カラーコード重複の拒否（ユーザー追加要件）

対象：`01_Groups`（グループ・ユニット）と `02_Members`（メンバー）のカラーを**横断して一意にする**。

- 同一 `#RRGGBB` は、大文字・小文字の違いを無視して同一と判定。形式不正も拒否。
- **新規作成**（グループ・ユニット・メンバー）と**既存カラー変更**のどちらも検査。
- UIは保存前に現在の読み込みデータで確認し、重複相手の名称を表示。
- BMSG-DBは必ず`withSharedWriterLock_`の中で最新版シートを確認する。UIを回避したリクエストでも拒否する。
- 既存データでは**MAZZEL（グループ）とCHIKA（メンバー）の双方が #FF0000**。ユーザーの許可なくどちらも書き換えない。「すでに使っていた色を変更せず保存」する場合だけ既存重複を許容。
- その他のグループ内・メンバー内の重複は、2026-11-17の読み取り確認ではなし。
- 旧Sheetsの直接手入力は本番切替前にはまだ可能。サイト以外からの編集禁止には、別途シート権限移行が必要。

実装：DB `CatalogManagement.gs` の `catalogRequireUniqueColor_`／`catalogValidateChangedColor_`。PJ `CatalogManagement.html` の `cmColorAvailable_` と4保存導線。DBテストは正規化・跨る重複・既存編集例外を含む。

## 入力_プロフィールを廃止するためのメンバー管理

開発版に次を追加。サイト旧メンバー編集・プロフィール値編集は維持。

- 主所属変更：`02_Members.GroupID` と本人の `04_GroupMembers` 主所属行のみ整合変更。MemberID不変、ユニット所属は維持。他人のデータを変更しない。
- 表示順：同じ主所属グループ内の2人の`DisplayOrder`を交換。再読み込み・監査・ロールバック。
- メンバー削除：削除前にCore/Log全表の参照を保守的に検索。入力済プロフィール、ユニット所属、歌詞・画像・ゲーム等の参照があれば削除不可。IDRegistry・Auditは保管。外部の参照チェック、MemberID・名前二重確認、独立したCore/Logバックアップを要求。
- この機能は `UNIVERSE_CATALOG_MEMBER_MAINTENANCE_ENABLED=true` で初めて有効化。完全削除にはさらに `UNIVERSE_CATALOG_MEMBER_DELETE_ENABLED=true`。いずれも**未設定の初期状態では無効**。
- 新しい主所属からプロフィールが正しく見えるよう、`ProfileManagementApi` の明示的なGroupIDを優先するよう修正（ソロMemberID 5xxの旧フォールバックは残す）。
- `ProfileManagementApi` の固定グループ分類やCard等の各種動的表示への移行は、引き続き回帰試験／別修正が必要。**旧入力_プロフィールはまだ削除しない**。

実装：DB `CatalogMemberMaintenance.gs`、PJ `CatalogManagementApi.gs`／`CatalogManagement.html`。新しい機能の実DB・スマホ回帰テストは未実施。

## プロフィールクイズの廃止（ユーザー指定）

- 廃止：`QuizProfileGenerator.gs`、QUIZジャンルPROFILE、プロフィールクイズ専用出題／スコア処理、オンライン／オフラインの専用回答画面、ジャンル選択肢。
- 維持：歌詞クイズ（オンライン／オフライン）、30秒タイマー、歌唱Member回答、クイズランキングとLog DBの**過去の成績**。
- 旧プロフィールクイズのルームはゲーム再開できないようにし、最近のルーム一覧からも除外する。
- `ProfileSettings`の`IsCompareTarget`と`QuizDifficulty`は互換性のため本番に残存。実際のクイズ出題に使用しない。将来のDBスキーマ最適化候補。
- この処理は開発ブランチのみ。本番サイトにはまだプロフィールクイズが残る。歴史成績削除・Logシート削除はしない。

実装：PJ `QuizApi.gs`、`QuizSetup.html`、`QuizPlay.html`、`QuizScripts.html`、`QuizRepository.gs`、削除`QuizProfileGenerator.gs`。CIで歌詞クイズの残存・UI構文・古いルームの遮断を確認する。

## 本番リリース前に必要

1. 複製Core/Log DBで主所属変更・並び順変更・メンバー削除プレビュー／失敗時復旧を動作検証。
2. Profile／Quiz／Card／Karaoke／Coverに追加したMemberIDが正しく現れるか確認。5xxの主所属とGroupID表示の不整合を点検。
3. iPhoneの管理画面でカラー競合の表示とフォーム操作を確認。
4. 管理者のみWriterを実行できること、旧Sheets直接入力を禁止できることを検証。
5. 明示的にリリース判断されるまではDraft PR維持、`main`へ統合せず、本番Apps Scriptも更新しない。
