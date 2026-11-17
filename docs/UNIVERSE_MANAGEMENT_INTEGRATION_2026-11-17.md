# MANAGEMENT連携（2026-11-17・開発版）

PJ Draft PR #64の全画面管理ページと接続するため、既存 `createCatalogSongDraftForUniverse` に任意の `includeLyrics:true`／`rawLyrics` を追加した。歌詞は既存parserで検証し、曲・クレジット・パート・PerformanceMetrics・ソロ分類を既存 `createSongWithPartsCore_` の一度のWriter呼出しへ渡す。歌詞登録後の別分類保存による部分成功を避ける。

既存の歌詞なし呼出しは `includeLyrics` 未指定で互換維持。管理者allowlist・feature flag・schema・採番・writer lock・rollbackは既存のまま。解析不正／BE:FIRST以外のソロ指定はWriter実行前に拒否。Auditの操作名は歌詞あり `CREATE_WITH_LYRICS`／なし `CREATE_NO_LYRICS`。

検証：GAS13静的検査・Node49試験合格。追加3試験は歌詞付きソロとクレジットの1回登録、解析不正・Artist不正の書込前拒否、従来歌詞なし互換を確認。実Apps Script／実DB保存は未実施。

本番・テストDB・バックアップへの書込なし。schema・列・ID形式・既存入力タブ・10_PerformanceMetricsを変更しない。PJの固定library version14を変更せず、版発行／GAS push／デプロイ／main mergeはしない。Draft PR #3を維持する。

公開・復旧手順はPJ `docs/UNIVERSE_MANAGEMENT_IMPLEMENTATION_QA_2026-11-17.md` を参照。独立検証用Core／LogとGASで権限・保存・iPhoneを確認した後、別途明示承認のある公開作業でのみ固定版更新を行う。

## サイト完結化の追加実装（2026-11-17）

CatalogMaintenance.gsに管理者限定のGuest訂正／参照統合／安全な削除、プロフィール項目名／分類／順番、グループ種別／順番／安全な削除、Songs.Artist訂正、画像メイン／順番／未参照登録行削除、Audit閲覧、指定フォルダへのバックアップ、初期整備・廃止ロゴ登録行整理、不足プロフィール／主所属行補完、限定flag設定、Core01〜10とProfileSettingsの対象限定復元を追加した。自動起動処理なし、すべて明示操作。既存lock・admin gate・カラー重複拒否・採番を再利用し、revision照合と検証・rollbackで保護する。

復元はpreview、再確認、実行直前バックアップ、current/target照合必須。旧schema・ID重複・孤立Core参照・履歴参照欠落・クイズCourse名不整合を拒否する。IDRegistry／Audit／ゲーム・取得履歴は復元しない。グループ名変更時は曲Artist・クイズCourseも同じcell transactionで更新し、スコアやIDは維持する。削除済み画像ファイルは再修復で自動復活させず、正規復元時のみ再び有効にする。

CatalogMemberMaintenance.gsで02_Membersの順番と主所属04_GroupMembersの順番を同時更新、他ユニットは保持。ShowMinorSavageはGROUPの確定仕様を維持。

新規25試験を含むNode74件・GAS14ファイル静的検査が成功。実Core／Log／Driveは変更せず、メモリ上fixtureで保存と途中失敗復旧を検証。本番／テストDB書込、既存Driveロゴ物理削除、GAS更新、library版発行、main merge、deployなし。PJ固定版14のため、このブランチだけで公開環境から新APIを呼べるとは扱わない。実GAS＋複製DB・iPhone確認は未実施。詳細と公開前・切り戻し手順はPJの既存QA第9節。
