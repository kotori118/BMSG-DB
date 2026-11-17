# Universe DB structural audit — 2026-11-17 (47-tab baseline / 45-tab current)

Original audit scope: Core DB 25 tabs, Log DB 22 tabs. By explicit user instruction, the empty 13_VideoSegments was removed after backup; then 12_Videos (83 video records, all not_started) was **backed up and deleted on 2026-11-17**. Current Core=23 and Log=22. No GAS/site deployment. The video analysis workflow moves outside Universe.

## Core DB (25/25)
| Tab | Disposition | Reason |
| --- | --- | --- |
| 00_管理ガイド | Sunset after site cutover | Old manual-sheet usage guide |
| 入力_歌詞 | Sunset after site parity | Legacy lyric entry; DB Lyrics.gs |
| 入力_プロフィール | Sunset after site parity | Legacy member and profile field editing; DB Profiles.gs |
| 入力_所属 | Sunset after site parity | Legacy group and membership editing; DB Groups.gs |
| 01_Groups | KEEP | Group and unit canonical keys; multiple PJ APIs |
| 02_Members | KEEP | Member primary keys and home group; multiple PJ APIs |
| 03_Guests | KEEP | Guest labels and singer support |
| 04_GroupMembers | KEEP | Multiple memberships; profile, karaoke, quiz, cover |
| 05_Profiles | KEEP | P000+ fields; profile, quiz, search |
| 06_Songs | KEEP | SongID, title, artist, release date; canonical songs |
| 07_SongCredits | KEEP / normalize later | Credit fields; Title duplicates 06_Songs |
| 08_LyricsParts | KEEP | Lyrics and song parts; Analysis, quiz, cover, karaoke |
| 09_Images | KEEP | Profile/card image records |
| 10_PerformanceMetrics | **KEEP, do not remove** | Singing/center seconds; Analysis and timer |
| 11_PartTransfers | **RETIRE after cutover** | Old transfer analysis disabled in development code; 65 records in production |
| 移行_旧ID対応 | KEEP HISTORY | Legacy-to-Universe ID mapping, 135 first-column data IDs |
| 削除予定_06_MemberProfileValues_NEW | REVIEW | Historical profile values, 293 first-column records |
| 削除予定_05_ProfileFields_NEW | REVIEW | Alternate field schema, 14 records |
| 削除予定_確認_プロフィール差分 | REVIEW | Legacy diff screen, 3 explanatory rows |
| 削除予定_05_MemberProfiles | REVIEW | Historical member profiles, 33 records |
| 削除予定_移行_要確認 | RETIRE CANDIDATE | Header only; verify no outstanding issues elsewhere |
| 削除予定_確認_カード同期 | REVIEW | Legacy card sync screen, 3 explanatory rows |
| 削除予定_06_MemberTags | REVIEW | Historical tags, 92 first-column records |
| 12_Videos | **DELETED 2026-11-17 at user request** | 83 records (not_started); full Core DB backup with all 83 rows: 1Zupx1sdRGe6kW4oTKPfzJ9Wf47P_2ZFXo-xq_Q59UOA; video analysis will be managed separately |
| 13_VideoSegments | **DELETED 2026-11-17 at user request** | Header-only (0 data rows); no direct BMSG-PJ/BMSG-DB code references found. Backup: 1P9WmojQTZjHSgaiAZ7x0_QxKWmFWxAa12ixNiBoaOtw |

Baseline = Core 25 / Log 22. **Current Core=23**, after deleting 13_VideoSegments and 12_Videos; Log=22. 10_PerformanceMetrics and 3 legacy input tabs retained.

## Log DB (22/22)
| Tabs | Disposition | Code or purpose |
| --- | --- | --- |
| Users, ProfileSettings | KEEP | User preferences and profile field schema |
| KARAOKE_Rooms, KARAOKE_ShuffleResults, KARAOKE_FavoriteSets | KEEP | KaraokeApi and favorites |
| QuizRooms, QuizQuestions, QuizRoomResults, QuizScores | KEEP | QuizRepository |
| CardCollections | KEEP | CardApi |
| PokerRooms, PokerPlayers, PokerVotes, PokerHighlights | KEEP | PokerApi |
| Topics | RETIRE CANDIDATE | Header only, absent from current Config and direct references |
| UserFavorites, RecentActivities | KEEP | UserState and service activity |
| COVER_Projects, COVER_Assignments, COVER_SourceSnapshots, COVER_ProjectMembers | KEEP | CoverApi |
| IDRegistry | KEEP HISTORY | Issuance ledger; never recycle issued IDs |

21 Log tabs remain operational or historical; Topics requires further checks. Empty game room tables remain because code uses them.

## Dependencies and safety
- 10_PerformanceMetrics is used by site AnalysisApi.gs and PerformanceTimerApi.gs, and DB song-creation metrics initialization. Preserve two-row header. Confirmed still present after deleting 13_VideoSegments.
- 08_LyricsParts drives song lyrics, first/last singer, singer sequence, karaoke, quiz and cover. Never conflate with retired 11_PartTransfers.
- 11_PartTransfers was disconnected only in development branches. Production site and DB library are still old; **do not delete the live sheet first**. Back up, deploy compatible code when separately authorized, test, then delete.
- 07_SongCredits.Title is redundant but remains for compatibility until all readers are migrated.
- Hidden profile tables contain historical data: do full field-by-field reconciliation with 05_Profiles and Log ProfileSettings before any deletion.
- 12_Videos (83 records) and 13_VideoSegments (0 data rows) have both been deleted on explicit instruction after separate full-Core backups. Original video records remain in the backup listed above. Video analytics should use a separate, future approved storage project; do not recreate Universe video tabs.
- Check external Google Sheet formulas, YouTube analytics and setlists before schema or deletion changes.

## Next work item: site capability gap audit
Compare every existing legacy spreadsheet write operation against site actions: group/member/unit CRUD, membership add/remove/reorder, profile field create/retire/restore, song/credits/lyrics editing, guest and image management, safe song delete, and audit/permissions. Prioritize the smallest missing operations first.

**No merge, no GAS schema migration, and no site deployment.** The only Core edits on 2026-11-17 were explicitly authorized deletions of 13_VideoSegments and 12_Videos after backups.


## 2026-11-17 再監査・削除準備（公開版28／library16以降）

利用者の「検査後に不要シートを全て削除」「非表示の削除対象も削除」指示に基づく。検査時Core23／Log23。現行schemaとCATALOG_Audit作成済みを確認し、利用者自身による初期整備・実操作の履歴がある。前段の開発版／未移行表記は過去の経緯として扱う。

削除候補13：Coreの00_管理ガイド・入力_歌詞・入力_プロフィール・入力_所属・11_PartTransfers・削除予定_06_MemberProfileValues_NEW・削除予定_05_ProfileFields_NEW・削除予定_確認_プロフィール差分・削除予定_05_MemberProfiles・削除予定_移行_要確認・削除予定_確認_カード同期・削除予定_06_MemberTags、およびLog Topics。正本01〜10、移行_旧ID対応、Users／ProfileSettings／IDRegistry／CATALOG_Audit／ゲーム・利用履歴は保持する。

照合：旧プロフィール値293件、旧基本情報198項目、旧タグ92件は現行05_Profilesに包含。旧DATE文字列とSheets日付serialの32件は日付を正規化して一致。旧入力プロフィール286項目も同様に一致し、未知メンバー・名前／色の差分なし。旧歌詞入力に曲名・アーティスト・発売日・本文なし。旧所属入力61リンクのうち2リンクは現行正本と異なる古い内容で、正本へ復活させずバックアップに保存。グループ名・色は一致。旧プロフィール差分の実データ・チェック済み行0、旧移行要確認とTopicsはheaderのみ。旧カード同期確認も説明とheaderのみ。

Core／Log全46シートの51矩形をuserEnteredValue.formulaValue・errorValue・validation限定で検査（13batch）。数式1件、エラー0、削除候補へのformula／validation参照0。両repoの本番コードで削除予定7／11／Topicsを読む直接参照なし（監査分類文字列は除外）。旧入力だけlegacyメニュー・validator／自動レイアウトに依存が残るため、先に旧入力モードを永久停止し旧設定UI／Writerを撤去する。

削除前に指定バックアップフォルダへCore／Log全体の新規コピーを作成し、ファイルIDが本番と異なること・全タブ保持を確認する。既存バックアップを変更しない。コード反映・backup確認・直前再読込の後にdeleteSheetだけを実行し、保持対象sheetId・正本と履歴・エラーを再確認する。実施成否と新backup IDsはDrive正本／PRの最終記録で確認する。
