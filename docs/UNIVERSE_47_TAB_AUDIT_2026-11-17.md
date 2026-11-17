# Universe 47-tab structural audit — 2026-11-17

Scope: Core DB 25 tabs, Log DB 22 tabs. Read-only inspection of tab metadata and header rows, plus static reference scan of BMSG-DB and BMSG-PJ development branches. No production changes or deployment. Static reference absence does NOT establish that deleting a tab is safe.

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
| 12_Videos | KEEP pending implementation review | 83 video records; direct references not detected in two scanned repos |
| 13_VideoSegments | KEEP pending implementation review | Header only; planned video segment storage |

Core categories: 12 operational KEEP, 1 history KEEP, 4 site-parity sunset, 1 retired-after-cutover, 6 REVIEW, 1 retire candidate = 25.

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
- 10_PerformanceMetrics is used by site AnalysisApi.gs and PerformanceTimerApi.gs, and DB song-creation metrics initialization. Preserve two-row header.
- 08_LyricsParts drives song lyrics, first/last singer, singer sequence, karaoke, quiz and cover. Never conflate with retired 11_PartTransfers.
- 11_PartTransfers was disconnected only in development branches. Production site and DB library are still old; **do not delete the live sheet first**. Back up, deploy compatible code when separately authorized, test, then delete.
- 07_SongCredits.Title is redundant but remains for compatibility until all readers are migrated.
- Hidden profile tables contain historical data: do full field-by-field reconciliation with 05_Profiles and Log ProfileSettings before any deletion.
- 12_Videos and 13_VideoSegments were not directly referenced by scanned BMSG-DB/BMSG-PJ code. Confirm planned video-analysis implementation and any external code before migration.
- Check external Google Sheet formulas, YouTube analytics and setlists before schema or deletion changes.

## Next work item: site capability gap audit
Compare every existing legacy spreadsheet write operation against site actions: group/member/unit CRUD, membership add/remove/reorder, profile field create/retire/restore, song/credits/lyrics editing, guest and image management, safe song delete, and audit/permissions. Prioritize the smallest missing operations first.

**No merge, no schema migration, no production Sheet editing, no deployment in this audit.**
