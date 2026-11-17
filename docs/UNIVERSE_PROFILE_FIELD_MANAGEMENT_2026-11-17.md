# Universe プロフィール項目管理（開発ブランチ実装記録）

2026-11-17 / 種別: 開発中 / **本番未デプロイ、本番の Core/Log シートは未変更**

## 対象

旧 `入力_プロフィール` だけにあった**プロフィール項目そのものの追加・非表示・再表示**を、Universeサイトの「SETTINGS → 管理 → データ管理 → プロフィール項目」に移す。

- 既存の「プロフィール管理」（各メンバーの**値の編集**）は変更・廃止しない。
- 項目定義の正本：Log DB `ProfileSettings`（9列）。
- 値の正本：Core DB `05_Profiles`（MemberID + P000…の横持ち列）。
- `P000〜P015`、既存プロフィール値、Quizでの出題設定を維持。
- ProfileIDは `NEXT_PROFILE_ID` → `IDRegistry` から発行。再利用しない。

## 実装済みのAPI（開発ブランチ）

- BMSG-DB `getCatalogProfileFieldsForUniverse(payload)`：ログインした管理者に項目定義を返す、読取専用。
- BMSG-DB `createCatalogProfileFieldForUniverse(payload)`：名前、TEXT/NUMBER/DATE、複数値フラグ、表示分類を検証し、05_Profilesの新規Pnnn列とProfileSettingsの新規行を追加。
- BMSG-DB `setCatalogProfileFieldActiveForUniverse(payload)`：`ProfileSettings.IsActive`のみ変更。値／列は削除しない。`expectedActive`で並行変更を検出、P000（呼ばれ順）非表示は禁止。
- BMSG-PJ `getCatalogManagementProfileFields`、`catalogManagementCreateProfileField`、`catalogManagementSetProfileFieldActive`：管理者認証→BMSG-DB共通Writer呼出→プロフィール系キャッシュのクリア。
- BMSG-PJ `CatalogManagement.html`：5番目の「プロフィール項目」タブ、項目追加フォーム、非表示・再表示の確認UI。iPhone向けタブを3列×複数行へ変更。

## 保存の流れと安全条件

1. 管理画面は既存と同じ `UNIVERSE_CATALOG_ENABLED=true` および両GASプロジェクトの管理者Googleメール許可リストが必要。
2. 項目の**書き込み**にはさらにBMSG-DB側 `UNIVERSE_CATALOG_PROFILE_FIELDS_ENABLED=true` が必要。初期状態はOFF。
3. 新規項目追加には**別ファイル**のCore/LogバックアップID（`UNIVERSE_CATALOG_BACKUP_ID` と `UNIVERSE_CATALOG_LOG_BACKUP_ID`）の設定・アクセス確認・対応タブ確認を必須とする。
4. `withSharedWriterLock_` で更新を排他制御。登録前に重複項目名、ProfileIDの一意性、05_Profiles列とProfileSettingsの1対1関係を確認。
5. ProfileID予約 → 新規列（見た目の書式だけをコピーし、旧列の型別バリデーションはコピーしない） → Log行 → 再読込照合 → `CATALOG_Audit`記録 → IDRegistry確定。
6. 途中失敗時は**この操作で追加した列と行のみ**を戻し、IDRegistry予約はABORTED（再利用しない）。既存値を上書きしない。
7. 非表示は`IsActive=false`のみ。再表示で同じProfileID・保存済みの値を再利用する。
8. `IsCompareTarget=false`、`QuizDifficulty=普通`を新項目の初期値とし、意図せずクイズ問題を増やさない。

## 既存サービスとの互換

- ProfileManagementApiは`ProfileSettings.IsActive`を見て表示項目を決め、`05_Profiles`の同名Pnnn列を使用。表示中の新項目はプロフィール編集画面に現れる想定。
- Profile閲覧、検索、Quizの現行ロジックは今まで通り。**ステージング上の実動作検証は未実施**なので、正式な互換判定ではない。
- データ型はTEXT / NUMBER / DATE。複数値は現行プロフィール画面に合わせてTEXTのみ対応。
- 項目の名前変更・型変更・表示順変更・クイズ対象への変更は今回の追加スコープ外。必要性が確認できた場合だけ別設計。

## 検証・未着手

- 開発用CI: GASソース構文検査＋Node契約テスト＋プロフィール項目のVMテスト（項目検証、非表示／再表示、Core+Log追加／ロールバック）。
- **未実施**: 複製DB上でのApps Script実行、iPhone Safari画面試験、Quiz/プロフィール編集の回帰テスト。
- **未実施**: 本番列追加、Core/Logの書き換え、mainへのmerge、GASライブラリの版更新、本番デプロイ。
- **旧シートの廃止はまだ不可**。ユニット所属解除・順序変更、主所属・表示順、アクセス権限など次段階の不足機能が残る。

## 次段階

P0-2: ユニットの所属解除・表示順変更を `04_GroupMembers` の**対象ユニット内の行だけ**で実装（他グループやメイン所属は触らない）。その前に既存所属のテストケース・対象ユニットIDを確定。
