# Universe 旧「入力_プロフィール」「入力_歌詞」廃止前テスト報告

実施日：2026-11-17（JST）  
対象：BMSG-DB / BMSG-PJ 開発ブランチ `feature/universe-catalog-site-only-20261117`  
**結果：開発版の構造・ロジックテストはPASS。実Apps Script WebアプリからのE2E検証は未実施のため、本番入力タブの削除はまだ不可。**

## テストの実施方法と環境

1. GitHub Actionsで**実際のサイトAPI・Writer関数**をNode.js VM上の擬似 `SpreadsheetApp` / `LockService` に対して実行。単なる関数存在チェックではない。
2. 実際の `Lyrics.gs` 歌唱者行解析と `UniverseService.gs` の公開パーサーを組み合わせ、二人のSingerが2パートに変換されることと括弧内テキストが歌詞として残ることを確認。
3. Core DBの**非共有テスト用コピー** `1OllO1rUQagULEsVyTUvoVmwjBJPQWkes80QuAv1_iM4` で、Sheets APIを用いた仮曲 `SongID=1998` の4表横断登録・編集・読み戻し・消去を実施。IDRegistryはテストによって更新していない（GAS共通Writerの採番テストは別のVMで実施）。
4. 既存の非共有Logテスト用コピー `1vEQsCgG26H94ybOykTizRnrJWTzpIRkm4LKj2mivoH4` を使用したプロフィール項目追加／非表示／復元の検証結果も参照。テスト用データは過去のテスト終了時に消去済み。
5. **本番DBのデータ変更・旧入力シート削除・GAS公開・main統合は実施していない。**

## テスト結果：サイトのプロフィール管理

| ケース | 結果 | 根拠 |
|---|---|---|
| 旧 `入力_プロフィール` なしでメンバー・有効な項目だけを読み込む | PASS | `tests/site-profile-parity.test.mjs`：実ProfileManagementApi関数をVM実行 |
| プロフィール値を保存、非表示項目の値は上書きしない | PASS | 同上 |
| 数値形式の検証・不正なメンバー／グループの拒否 | PASS | 同上 |
| 保存途中エラー時のセル値復元・ロック開放 | PASS | 同上 |
| ProfileSettingsに新しいP016を加えたらサイト編集対象に追加される | PASS | 同上 |
| 別のテスト用Google SheetsでCore P016列、Log ProfileSettings行の登録・非表示→再表示を読み戻す | PASS | 実Sheetsコピーを使用、終了時に元の値へ復元 |
| 実Apps Scriptから行った権限・UI・保存動作 | **未検証** | テスト用GASデプロイなし |

### プロフィール側の注意
- ProfileManagementApiの対象グループは現在固定リスト。新しいグループ・主所属がProfile/Cardなどに全反映されることは未証明。
- `UNIVERSE_CATALOG_MEMBER_MAINTENANCE_ENABLED` / `UNIVERSE_CATALOG_PROFILE_FIELDS_ENABLED` は本番ではOFFのまま。
- 今回のE2Eは実施していないため、`入力_プロフィール` はまだ保持する。

## テスト結果：サイトの楽曲・歌詞管理

| ケース | 結果 | 根拠 |
|---|---|---|
| 旧 `入力_歌詞` なしで新曲・クレジット・歌詞・秒数表の行を生成 | PASS | `tests/site-lyrics-parity.test.mjs`：実 `saveNewSongLyricsForUniverse` をVM実行 |
| Singer行を正しく解析し2パートを生成、括弧内歌詞を保持 | PASS | 同上：`Lyrics.gs` 実パーサーを結合 |
| 同一アーティストの同名曲を重複登録しない | PASS | 同上 |
| 既存曲の曲名・クレジット・歌詞Singer／順番を編集 | PASS | 同上 |
| 不正Singer ID・空歌詞・他アーティストへの変更・不正UserIDを拒否 | PASS | 同上 |
| 新曲のクレジット書込失敗時にSongs側をロールバックしID予約を中止 | PASS | 同上 |
| テスト用Core DBの `06_Songs` / `07_SongCredits` / `08_LyricsParts` / `10_PerformanceMetrics` に仮曲1998を追加、編集、再読込 | PASS | Google Sheets APIを使用。**GAS Writer自体での実Sheet操作ではない** |
| 仮曲1998と関連行を消去し、コピーが元の値・グリッドサイズに戻ったことを比較 | PASS | 4表とも元DBとの値比較一致、Songsグリッド165行に復旧 |
| 実Apps Scriptの歌詞パーサー・保存処理を本物のSheetsに対しE2E実行 | **未検証** | テスト用Web App/ライブラリ未配備 |
| 未登録Guestの追加や再登録による実データ上の動作 | **未検証** | 初期のVMテストは名前既登録のSingerが中心 |

## 旧入力タブなしを模擬した切替検証

- `Code.gs` `UNIVERSE_SITE_ONLY_WRITES=true` で `入力_歌詞`・`入力_プロフィール`・`入力_所属`・`00_管理ガイド` の存在を**必須として扱わない**ことを、VMで実行して検証（`tests/site-only-legacy-input-cutover.test.mjs`）。
- 切替後は旧シート入力メニューが非表示となり、旧書込関数の直接呼出は拒否される。切替フラグは初期状態OFF。
- `false` の場合は旧入力シートが必須のまま。**今回はスイッチを本番で変更していない**。
- 複製DBの旧入力2タブも物理削除していない。サイト本番移行・回帰試験前の保険として残す。

## Actions の最新結果

- **BMSG-DB：39/39 PASS** — https://github.com/kotori118/BMSG-DB/actions/runs/44008148688
- **BMSG-PJ：26/26 PASS** — https://github.com/kotori118/BMSG-PJ/actions/runs/44007326884
- 両者ともDraft PR状態。main未統合。

## 本番削除前の必須条件

1. Core / Logのテスト用コピーを参照する**隔離されたApps Scriptプロジェクト／ライブラリ版／Web App**を準備して、サイトから新規・編集・再読込を操作。現在のPJ `appsscript.json` はBMSGDB v14固定のため、新しいWriter APIをテストするには開発用のライブラリ配線が必要。
2. iPhoneで管理画面の操作性を検証。PROFILE、Quiz（歌詞クイズのみ）、Lyrics、Karaoke、Cover、Analysisに回帰異常がないこと。
3. プロフィールの新規メンバーと主所属変更に伴う動的グループ表示の問題を解決。
4. 権限、利用ユーザー・管理者識別、書込時排他、実DBの失敗時復旧を確認。
5. 本番公開後にサイト経由だけで保存できることを最終確認してから、Core DBをバックアップし旧入力タブを順次削除。

**結論：両旧入力タブの「廃止方針」は合理的だが、物理削除・本番適用の承認条件はまだ揃っていない。**
