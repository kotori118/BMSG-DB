# BMSG-DB

BMSG Universe の Core DB 管理・移行用 Apps Script。

## 現行方針

- Core DB 正本: `BMSG _Universe_DB`
- Log DB: `BMSG_ Universe_Log`
- `00_Config` は廃止対象。ID採番は Log DB の `IDRegistry` を使用する。
- 一度発行したIDは `RESERVED / COMMITTED / ABORTED` を問わず再利用しない。
- Song / Lyrics / Guest の書込責務は BMSG-DB の共通Writerへ集約する。
- Universeの新規楽曲保存は `UniverseService.gs` の `saveNewSongLyricsForUniverse()` を唯一のWriter入口とし、ignoredGuestCandidates も同関数で処理する。Override/Fix専用Runtime層は残さない。
- BMSG-PJ は BMSG-DB をApps Scriptライブラリとして呼び出し、Song / Lyrics / Guest を直接採番・書込しない。
- `11_PartTransfers` は完全手動管理。Lyrics編集から自動追従・自動削除・自動採番しない。
- 画像の通常登録・ImageID発行は BMSG-PJ `SETTINGS > 画像管理` が正規入口。BMSG-DBの画像処理は既存行の修復のみ。
- Apps Scriptとして実行するソースは必ず `.gs` 拡張子で管理する。`scripts/validate-gas-sources.mjs` と `node --test tests/source-contract.test.mjs` をdeploy前に実行し、拡張子漏れ・構文エラー・公開関数名重複・主要管理入口の配置を検証する。

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
