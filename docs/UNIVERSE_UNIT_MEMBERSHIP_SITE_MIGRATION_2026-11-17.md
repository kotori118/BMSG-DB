# Universe ユニット所属管理のサイト移行（2026-11-17）

## 状態と作業範囲

- **開発ブランチに実装完了／自動テスト成功。**
- **未実施：本番DBの編集、GASライブラリ版の切り替え、mainマージ、サイトデプロイ、旧 `入力_所属` タブの削除。**
- 本番Core DB `04_GroupMembers` を**読み取りのみ**で確認：2026-11-17時点で83所属、既存の各ユニット内で表示順の重複を検出しなかった。ユニット内の欠番・壊れた行は実行時にも停止。
- 対象：GroupKind=`UNIT` の所属のみ。GroupKind=`GROUP` の主所属管理とは分離。

## 実装

| 操作 | 実装 | 注意 |
|---|---|---|
| ユニットにメンバー追加 | 既存 `addCatalogUnitMemberForUniverse` | 既存所属を拒否、主所属は変更しない |
| 現在の所属一覧 | `CatalogManagement.html` | 選択ユニットのMemberIDと表示順だけを表示 |
| ユニット内の上下並べ替え | 新 `moveCatalogUnitMemberForUniverse` | **対象ユニット**の隣接2人のDisplayOrderを交換。他ユニット・02_Membersを変更しない |
| ユニットから所属解除 | 新 `removeCatalogUnitMemberForUniverse` | 04_GroupMembersの1行を空にして、**そのユニット内**の後続DisplayOrderだけを詰める。物理行削除による他行の移動は行わない |
| サイトAPI | `catalogManagementMoveUnitMember` / `catalogManagementRemoveUnitMember` | 既存のGoogleアカウント管理者認証→BMSG-DB共通Writer→関連キャッシュ消去 |
| サイトUI | `cmRenderUnitRoster_` / `cmMoveUnitMember_` / `cmRemoveUnitMember_` | ユニット選択、所属一覧、上下、除外の確認ダイアログ。スマホ幅は既存の共通管理画面に合わせる |

## 安全性

1. 更新開始時に `catalogRequireAdmin_` を通し、`withSharedWriterLock_` の排他中にスキーマ・対象ユニット・対象メンバーを再読み込み。
2. `GroupKind=UNIT` 以外は必ず拒否。主所属の変更やメンバー本体の削除はしない。
3. ターゲットの `DisplayOrder` をクライアントの `expectedOrder` と比較し、古い画面の情報では変更拒否。
4. 対象ユニットのMemberIDの重複、表示順の重複・欠番・空欄を検出したら変更せずDB監査を要求。
5. 所属解除前にメンバーの `02_Members.GroupID` を確認。誤って主所属まで解除する構造の不整合があれば変更を拒否。
6. 更新後に読み戻して整合確認。監査ログ `CATALOG_Audit` 保存に失敗したら所属・並び順を元に戻す。元の所属行に数式がある場合も安全のため変更を拒否。
7. 既存の `入力_所属` の同期コードは残す。本番切り替え前に停止条件とユーザー権限を別途検証し、旧入力処理が新しい所属情報を上書きしないようにする。

## 自動テスト

- DB: `tests/catalog-unit-membership.test.mjs` で7ケース。上/下入替、途中の所属解除・順番の詰め直し、他ユニット／GROUP／Memberマスターの不変性、古い順番からの更新拒否、重複データ拒否、監査失敗時のロールバック、非管理者拒否。
- サイト: `tests/catalog-management.test.mjs` に実行型UIテスト。所属一覧とソート、追加APIを壊さないこと、上下移動・除外のpayload、`expectedOrder`、確認導線。
- CI確認：BMSG-DB 46/46成功、BMSG-PJ 27/27成功（開発版GitHub Actions）。

## 本番反映前のゲート

- BMSG-DBとBMSG-PJを本番とは**独立したApps Scriptテスト環境**で連携し、管理者だけ操作可能か確かめる。
- **コピーのCore/Logで**実際にユニット所属追加→入替→解除→再追加を行い、Profile／Quiz／Card／Cover表示を回帰チェック。
- iPhoneの管理画面でユニット選択・所属一覧・確認表示・操作後更新を確認。
- 旧 `入力_所属` の同期メニューを停止し、サイトと旧シートの二重更新を遮断する。なお `UNIVERSE_SITE_ONLY_WRITES` は旧GAS書き込みの停止であり、直接シート編集権限とは別。
- バックアップを確認してからリリース。**この段階では `入力_所属` は削除しない**。
