# Universe サイト管理・旧シート入力 差分監査

監査日: 2026-11-17 / 対象: Core DB 24タブ・Log DB 22タブ、BMSG-PJ/BMSG-DB の開発ブランチ
状態: **読み取り監査・設計のみ**。Core DB列変更、コードの本番反映、GASデプロイ、旧入力タブ削除は行っていない。
判定: **対応**=サイトに実装、**一部**=機能や対象が限定、**未実装**=旧Sheets側または業務上必要だがサイトにはない。実装済みでも実DB操作・スマホ回帰テストは未実施。

## 操作別の差分

| 対象・操作 | 旧Sheetsで可能 | 現行/開発版サイト | 判定・不足 |
|---|---|---|---|
| グループ・ユニット新規登録 | 入力_所属 | CatalogManagement → createCatalogGroupForUniverse | 対応（開発版・未公開） |
| グループ名・カラー変更 | 入力_所属 | CatalogManagement → updateCatalogGroupForUniverse | 一部：Artistで使用中の改名は禁止 |
| グループ表示順変更 | 入力_所属の列順 | 新サイト操作なし | **未実装** |
| グループ削除 | 旧所属同期は参照がないものを表から除外 | 新サイト操作なし | **未実装**。参照検査・確認が必要 |
| メンバー新規登録 | 入力_プロフィール | CatalogManagement → createCatalogMemberForUniverse | 対応（開発版）。主所属・空プロフィール・所属行を追加 |
| メンバー表示名・カラー変更 | 入力_プロフィール | CatalogManagement → updateCatalogMemberForUniverse | 対応（開発版）。他機能の文字列参照の影響検査が必要 |
| メンバー主所属変更 | 入力_プロフィール | 新サイト操作なし | **未実装**。GroupMembersとの整合更新が必須 |
| メンバー表示順変更 | 入力_プロフィールの行順 | 新サイト操作なし | **未実装** |
| 未参照メンバー削除 | 入力_プロフィールの空欄による削除候補 | 新サイト操作なし | **未実装**。プロフィール、画像、歌詞、ログの参照検査 |
| ユニット所属追加 | 入力_所属 | CatalogManagement → addCatalogUnitMemberForUniverse | 対応（開発版） |
| ユニット所属解除 | 入力_所属から名前を消して同期 | 新サイト操作なし | **未実装、優先度高** |
| ユニット内表示順変更 | 入力_所属の行順 | 新サイト操作なし | **未実装、優先度高** |
| 既存プロフィール値編集 | 入力_プロフィール | ProfileManagement → saveProfileManagementMember | 対応（既存サイト） |
| プロフィール項目追加 | 入力_プロフィールの新列 / ProfileSettings | 新サイト操作なし | **未実装、最優先** |
| プロフィール項目の非表示・再表示 | retireSelectedProfileField / restoreRetiredProfileFields | 新サイト操作なし | **未実装、最優先**。項目値を削除しない |
| プロフィール項目の分類・表示順管理 | 旧入力・ProfileSettings設定 | サイトは値編集のみ | **一部**。現行の値とメタデータを分離して扱う |
| 曲新規登録（歌詞あり） | 入力_歌詞・旧マスター同期 | SongLyricsManagement → saveNewSongLyricsManagement | 対応（既存サイト） |
| 曲新規登録（歌詞なし） | 手動補助・旧マスター同期 | CatalogManagement → createCatalogSongDraftForUniverse | 対応（開発版） |
| 既存曲情報・クレジット編集 | 旧シート側で調整 | SongLyricsManagement → saveSongLyricsManagementInfo / Credits | 対応（既存サイト） |
| 歌詞登録・解析・既存歌詞変更 | 入力_歌詞 | SongLyricsManagement → 解析 / Singer / パート追加・移動・削除 | 対応（既存サイト）。実データ回帰試験が必要 |
| Guestの新規登録 | 歌詞入力中に判断 | SongLyricsManagement → registerSongLyricsGuest | 対応（既存サイト） |
| Guestの直接改名・削除 | 専用UIは確認できず | 専用UIなし | **追加要否を別判断** |
| 曲のソロ分類 | 旧シートに正式列なし | CatalogManagement → saveCatalogSoloForUniverse | 新規機能（開発版）。ソロ担当MemberIDを保持 |
| 曲の完全削除 | 旧シート編集・手順外 | CatalogManagement → deleteCatalogSongForUniverse | 対応（開発版・デフォルト無効）。外部参照は手動確認 |
| 画像登録・差し替え・整合修復 | 旧Driveカード同期 | ImageManagement → saveImageManagementImage / repairImageManagementData | 対応（既存サイト）。画像削除は未実装 |
| 歌唱・センター秒数管理 | 10_PerformanceMetricsに直接値 | PerformanceTimer → savePerformanceTimer | 対応（既存サイト）、**10は維持** |
| パート継承 | 11_PartTransfers | 開発版ANALYSISの参照除去済み | **廃止決定**。本番シートは移行後に削除 |
| 12_Videos / 13_VideoSegments | 12は動画データあり、13は削除済み | 2リポジトリ内に直接参照が見つからない | 映像分析の別実装・参照は要調査 |

## コードで確認した重要な不整合

1. **新しいグループが既存の画面に自動出現しない。** ProfileManagementApi.gs の `PROFILE_MGMT_GROUPS_` は固定5分類、CardApi.gs の `CARD_GROUP_NAMES_` も固定。グループをサイトで作れても、プロフィール・トレカなどでは見えない可能性がある。表示対象はGroupID/GroupKindと利用機能の規則で導出すること。
2. **既存グループ13件のGroupKind移行に注意。** CatalogManagement.gs の `BU_CATALOG_MAIN_GROUP_NAMES_` は4グループ名のみで、ShowMinorSavage/BMSG POSSE等をUNITに分類する実装。移行前に既存13件の種別をレビューし、単純な名前推測だけで本番確定しない。
3. **サイトの書き込み主体が分散。** SongLyricsManagementはBMSG-DB共通Writerを使う。一方、ProfileManagementApi、ImageManagementApi、PerformanceTimerApiはBMSG-PJからCore DBへ直接書き込む。いずれもサイト経由ではあるが、単一Writer・共通監査・排他制御は現段階では統一できていない。
4. **管理権限が操作画面ごとに異なる。** 新Catalog管理はGoogleメールと管理者許可リストを確認するが、既存管理APIは同等のポリシーではない。BMSG-PJの`USER_ACCESSING`実行・直接Sheets権限の設計と合わせて検証が必要。利用者がシートを手入力できる状態ではサイト専用とは言えない。
5. **新メンバーの連動確認が必要。** 新Catalog WriterはMember、GroupMembers、空Profileを作成。画像管理は画像アップロード時に不足する09_Images行を遅延補完する。既存Card/PROFILE/クイズに新メンバーが正常出現するか試験する。
6. **曲削除に外部参照の自動遮断がない。** Core内部は削除前プレビューとブロックがあるが、YouTube/セットリスト/Analytics側の参照は手動。参照数が残っている場合の自動削除禁止が必要。
7. **旧入力停止スイッチだけでは不十分。** `UNIVERSE_SITE_ONLY_WRITES`は旧GASの書き込みを拒否するが、直接Google Sheetsの編集権限は変わらない。スキーマとWriterの検証が終わるまで切替ONにしない。

## 実装優先順位と受入基準

| 順位 | 改修 | 最低受入基準 |
|---|---|---|
| P0-1 | プロフィール項目の追加・非表示・再表示 | ProfileIDの採番、05_Profiles列・Log ProfileSettingsを整合更新。既存値は非表示でも保持 |
| P0-2 | ユニット所属解除・順序変更 | 04_GroupMembersだけ更新し他ユニットや主所属に影響しない。再読み込み照合とロールバック |
| P0-3 | 表示グループの動的導出・主所属/表示順管理 | 新グループと新メンバーがPROFILE/CARD/SEARCH等で正しく見える |
| P0-4 | Writer・権限・排他の設計統一 | 全管理APIで本人確認・ID採番・操作ログ・不整合時復旧が揃う |
| P0-5 | 外部参照を含む曲削除検査 | 外部SongID参照が1件でもあれば削除不能。IDRegistry永続 |
| P1 | グループ/メンバーの安全な削除、Guest/画像削除の必要性 | 利用要件と参照関係を整理してから実装。不要なら作らない |
| P2 | 旧手入力タブ・移行資料の引退 | P0がすべて合格し、別ファイルバックアップと本番回帰試験が済んでから |

## P0-1 実装状況（2026-11-17追記）

開発ブランチにプロフィール項目の**追加・非表示・再表示**を実装済み。
- DB側：`ProfileFieldManagement.gs`。共通IDRegistry（NEXT_PROFILE_ID）、Core 05_ProfilesとLog ProfileSettingsの整合チェック、管理者認証、追加時の両DBバックアップ確認、失敗時ロールバック、監査ログ。
- サイト側：`CatalogManagement.html`に「プロフィール項目」タブ、`CatalogManagementApi.gs`にBMSG-DB Writerへの中継APIを追加。既存プロフィールの値編集UIは変更なし。
- 非表示は `ProfileSettings.IsActive` の変更のみで、既存の値・ProfileID・列は保持。`P000`は非表示禁止。
- GASソース検査・Nodeテストの開発版検証を用意。Apps Script実DBでの操作・iPhone Safari・既存クイズ動作は未検証。
- **本番未反映／旧シート未廃止／別の未完了操作は残存**。詳細：`docs/UNIVERSE_PROFILE_FIELD_MANAGEMENT_2026-11-17.md`。

## 作業境界と次のステップ

- P0-1の開発版実装を追加済み。**次は P0-2「ユニット所属解除・表示順変更」**を開発版で対応する。
- 変更前にCore/LogコピーでID採番、列追加、保存失敗時の巻き戻し、非表示→再表示、Quizへの影響をテスト。
- この監査はGitHub開発ブランチの文書のみ。**本番シート操作、main統合、GASデプロイは行わない**。
