# BMSG-DB

BMSG Universe の Core DB 管理・移行用 Apps Script。

## 現行方針

- Core DB 正本: `BMSG _Universe_DB`
- Log DB: `BMSG_ Universe_Log`
- `00_Config` は既に削除済み。ID採番は Log DB の `IDRegistry` を使用し、旧カウンタ方式は復活させない。
- 一度発行したIDは `RESERVED / COMMITTED / ABORTED` を問わず再利用しない。
- Song / Lyrics / Guest の書込責務は BMSG-DB の共通Writerへ集約する。
- Universeの新規楽曲保存は `UniverseService.gs` の `saveNewSongLyricsForUniverse()` を唯一のWriter入口とし、ignoredGuestCandidates も同関数で処理する。Override/Fix専用Runtime層は残さない。
- BMSG-PJ は BMSG-DB をApps Scriptライブラリとして呼び出し、Song / Lyrics / Guest を直接採番・書込しない。
- 旧 `11_PartTransfers` シートと対応する分析は廃止済み。現行Coreに再作成しない。`10_PerformanceMetrics` は維持する。
- 画像の通常登録・ImageID発行は BMSG-PJ の `SETTINGS → MANAGEMENT → メンバー画像` が正規入口。BMSG-DBの画像処理は既存行の修復に限定する。
- Apps Scriptとして実行するソースは必ず `.gs` 拡張子で管理する。`scripts/validate-gas-sources.mjs` と `node --test tests/source-contract.test.mjs` をdeploy前に実行し、拡張子漏れ・構文エラー・公開関数名重複・主要管理入口の配置を検証する。

## 仕様正本と現行データ構造

- Universeの唯一の仕様正本は [04_BMSG Universe_統合仕様書](https://docs.google.com/document/d/1pgttqIlZ8pZtBNBpKt90U_nr4ZVZyeCtJyYvBhu8QFk/edit)。変更時はこの既存文書の該当章を直接修正し、分冊の変更履歴を再作成しない。
- 現行Core DBは11シート、Log DBは21シート。プロフィール項目定義の `ProfileSettings` はCore、利用者の `Users` と `CATALOG_Audit` はLogに置く。
- `06_Songs` のC列は `ArtistID`（G＝グループ、U＝ユニット、M＝個人）。`07_SongCredits` は `SongID / Lyricists / Composers / Choreographers` の4列。旧 `Artist / SongType / SoloMemberID / ArtistRef` の列構成を復活させない。
- 実際の実装・DB構造が統合仕様書と一致しないときは、現物を調査し不一致を明示する。仕様としての決定、実装状態、実機・保存の検証状態は区別する。
- 技術的な変更履歴はGitコミット／PRとGoogle Docsの版履歴、運用操作履歴はLogの `CATALOG_Audit` に残す。

## IDRegistry

列:

`EntityType / Scope / IssuedID / NumericValue / Status / RequestID / Source / IssuedAt / UpdatedAt / Note`

旧管理画面の既存処理は互換関数 `issueNumber_()` を通して同じ Registry を使用する。

## GitHub Actions

`main` への push で clasp により指定Apps Scriptへ push し、BMSG-PJ から参照するライブラリ用バージョンを作成する。
GitHub Actions の clasp 認証は BMSG-PJ と同じ `CLASPRC_JSON_KEY` Secret 名を使用する。
workflow summaryに作成されたライブラリ番号を出力する。BMSG-PJの`appsscript.json`でその番号へ固定更新し、BMSG-PJ側のdeployが成功するまでは新しいWriterが本番利用されるとは扱わない。

対象 Script ID:

`1NiJ94p1UVFGxd3DrNXz0x3MFC1haPopa11LQy593-3ft4exsoJM4huwZ`
