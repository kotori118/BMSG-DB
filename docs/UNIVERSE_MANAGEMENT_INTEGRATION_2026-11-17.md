# MANAGEMENT連携（2026-11-17・開発版）

PJ Draft PR #64の全画面管理ページと接続するため、既存 `createCatalogSongDraftForUniverse` に任意の `includeLyrics:true`／`rawLyrics` を追加した。歌詞は既存parserで検証し、曲・クレジット・パート・PerformanceMetrics・ソロ分類を既存 `createSongWithPartsCore_` の一度のWriter呼出しへ渡す。歌詞登録後の別分類保存による部分成功を避ける。

既存の歌詞なし呼出しは `includeLyrics` 未指定で互換維持。管理者allowlist・feature flag・schema・採番・writer lock・rollbackは既存のまま。解析不正／BE:FIRST以外のソロ指定はWriter実行前に拒否。Auditの操作名は歌詞あり `CREATE_WITH_LYRICS`／なし `CREATE_NO_LYRICS`。

検証：GAS13静的検査・Node49試験合格。追加3試験は歌詞付きソロとクレジットの1回登録、解析不正・Artist不正の書込前拒否、従来歌詞なし互換を確認。実Apps Script／実DB保存は未実施。

本番・テストDB・バックアップへの書込なし。schema・列・ID形式・既存入力タブ・10_PerformanceMetricsを変更しない。PJの固定library version14を変更せず、版発行／GAS push／デプロイ／main mergeはしない。Draft PR #3を維持する。

公開・復旧手順はPJ `docs/UNIVERSE_MANAGEMENT_IMPLEMENTATION_QA_2026-11-17.md` を参照。独立検証用Core／LogとGASで権限・保存・iPhoneを確認した後、別途明示承認のある公開作業でのみ固定版更新を行う。
