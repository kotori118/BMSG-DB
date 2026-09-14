# BMSG-DB

BMSG Universe の Core DB 管理・移行用 Apps Script。

## 現行方針

- Core DB 正本: `BMSG _Universe_DB`
- Log DB: `BMSG_ Universe_Log`
- `00_Config` は廃止対象。ID採番は Log DB の `IDRegistry` を使用する。
- 一度発行したIDは `RESERVED / COMMITTED / ABORTED` を問わず再利用しない。
- Song / Lyrics / Guest の書込責務は BMSG-DB の共通Writerへ集約する。
- BMSG-PJ は BMSG-DB をライブラリとして呼び出し、Song / Lyrics / Guest を直接採番・書込しない。
- `11_PartTransfers` は完全手動管理。Lyrics編集から自動追従・自動削除・自動採番しない。
- 画像の通常登録・ImageID発行は BMSG-PJ `SETTINGS > 画像管理` が正規入口。BMSG-DBの画像処理は既存行の修復のみ。

## IDRegistry

列:

`EntityType / Scope / IssuedID / NumericValue / Status / RequestID / Source / IssuedAt / UpdatedAt / Note`

旧管理画面の既存処理は互換関数 `issueNumber_()` を通して同じ Registry を使用する。

## GitHub Actions

`main` への push で clasp により指定Apps Scriptへ push し、BMSG-PJ から参照するライブラリ用バージョンを作成する。

対象 Script ID:

`1NiJ94p1UVFGxd3DrNXz0x3MFC1haPopa11LQy593-3ft4exsoJM4huwZ`
