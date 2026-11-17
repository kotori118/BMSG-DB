# BMSG Universe — DB最適化・サイト経由管理移行計画（開発版）

状態：**設計＋開発ブランチ実装のみ**。本番DBの移行／シート保護／デプロイは未実施。
対象：Core DB（25タブ）＋Log DB（22タブ）。サイト用共通Writerを唯一の更新入口にする。
正本：Google Driveの現行仕様書、PHASE 3デザイン仕様書、GAS一括実装仕様書。既存機能の動作優先。

## 絶対に守る不変条件

1. 既存の GroupID / MemberID / SongID とLyricsPartsの SongID+PartOrder / Singerフォーマットは変更しない。
2. ReleaseDate（初回音源リリース日）の正本は06_Songs。Form/CDTitle/IsTitleTrackも当面維持する。
3. 曲名の正本は06_Songs.Title。07_SongCredits.Titleは旧互換キャッシュとして残し、Writerが整合更新。利用者が編集する対象にしない。
4. 登録・編集・削除はUniverseのサイト → API → BMSG-DB共通Writer → Core DB。IDRegistryは必ず維持し、削除後のID再利用を認めない。
5. 10_PerformanceMetricsの2行ヘッダー／6メンバー固定列、05_Profilesの横持ちPnnn列は既存読取コードを保護するため当面維持。
6. Google Sheetsへ入力する旧ルートはサイト側の代替機能と権限検証が完成するまで廃止しない。旧ルートを残した状態で「サイト専用が完成した」とは言わない。
7. 主体のコラボ相手（ATEEZ/SB19等）の独立アーティスト管理は行わない。ソロ曲だけSongType=SOLOとSoloMemberIDで識別する。
8. データの手動一括修正や過去履歴破棄は不可。スキーマ追加はバックアップ＋明示承認後の段階的マイグレーションのみ。

## Core DB 25タブの扱い

| タブ | 役割 | 方針 |
| --- | --- | --- |
| 00_管理ガイド | 旧Sheets操作説明 | サイト管理案内に置換後、歴史資料として扱う。先に消さない |
| 入力_歌詞 | 旧手入力UI | サイト歌詞登録と比較検証後に引退 |
| 入力_プロフィール | 旧プロフィール／項目追加UI | サイトでプロフィール項目の追加・非表示まで可能になった後に引退 |
| 入力_所属 | 旧グループ／所属編集UI | サイトで既存ユニットのメンバー除外・並べ替えまで対応した後に引退 |
| 01_Groups | グループ・ユニット正本 | GroupKind, RecordStatusを末尾追加予定。現在のGroupID不変 |
| 02_Members | メンバー正本と主所属 | RecordStatusを末尾追加予定。主所属GroupID不変 |
| 03_Guests | 歌詞／ゲスト正本 | 既存サイト登録を維持 |
| 04_GroupMembers | 所属多対多 | 表の一括再構築を禁止し行単位で変更 |
| 05_Profiles | メンバー横持ちプロフィール | Pnnn列と既存APIを維持。追加項目はサイト操作にする |
| 06_Songs | 楽曲唯一の正本 | SongType, SoloMemberIDを末尾追加。アーカイブ用RecordStatusは不要 |
| 07_SongCredits | 作詞作曲／振付 | Titleは冗長だが旧互換維持。後日参照コードを全部移してから検討 |
| 08_LyricsParts | 歌詞と歌唱者 | 4列の現行仕様とハモリsuffixを維持。歌詞なし新曲を許可 |
| 09_Images | アートワーク／カード画像 | 既存サイト画像管理から編集 |
| 10_PerformanceMetrics | BE:FIRST秒数分析 | 2行ヘッダーを維持。新曲は新規1行のみ追加（開発版で修正） |
| 11_PartTransfers | 旧パート移行履歴 | **廃止確定**。現行サイトの参照撤去後に本番DBのバックアップを取得してシート削除。復元可否の確認前に物理削除しない |
| 移行_旧ID対応 | 正規化前のID対応履歴 | 履歴として保存。削除不可 |
| 削除予定_06_MemberProfileValues_NEW | 過去のプロフィール検討 | 現行05_Profilesと照合後に整理判断 |
| 削除予定_05_ProfileFields_NEW | 過去のプロフィール検討 | 上に同じ |
| 削除予定_確認_プロフィール差分 | 旧確認UI | 現行コード参照の有無を再監査してから整理 |
| 削除予定_05_MemberProfiles | 旧プロフィール形式 | 参照・移行履歴の突合後に整理 |
| 削除予定_移行_要確認 | 過去の移行台帳 | 未解決案件が0件か確認してから整理 |
| 削除予定_確認_カード同期 | 旧画像同期UI | 現行カード実装の参照を確認してから整理 |
| 削除予定_06_MemberTags | 旧タグ表 | 現行プロフィール項目と差分を照合してから整理 |
| 12_Videos | 映像出演分析・動画状態 | 既存機能・保存仕様維持 |
| 13_VideoSegments | 出演区間 | 既存機能・保存仕様維持 |

Log DB 22タブはUsers/IDRegistry/ProfileSettings/各サービスの操作ログを保持。
**CATALOG_Auditだけ新規追加予定**。既存ログを上書きしない。

## スキーマ追加（将来の移行時のみ）

- 01_Groups: `GroupKind` = GROUP / UNIT、`RecordStatus` = ACTIVE / ARCHIVED
- 02_Members: `RecordStatus` = ACTIVE / ARCHIVED
- 06_Songs: `SongType` = NORMAL / SOLO、`SoloMemberID` = ソロ担当MemberIDまたは空
- Log DB: `CATALOG_Audit` = 操作履歴
- 06_SongsのRecordStatusは追加しない。ユーザー方針は「削除のみ」。実装済みの曲削除は関連データ確認＋二重確認＋監査＋IDRegistry温存で段階提供。

※グループ・メンバーのArchiveはサイトUIに現在未実装。RecordStatusの意味・必要性は後日の運用仕様として検証し、不要なら追加前に削る。

## 実装したデプロイ前の安全策

- `CatalogDbAudit.gs` 読み取り専用検査：主キー重複、孤児参照、歌詞PartOrder重複、クレジット名不一致、メトリクス欠落を検出。
- 新曲保存の`syncPerformanceMetricRows`全表再構築を使用せず、`ensurePerformanceMetricRowForSong_`で1行だけ追加。失敗時は作成行をrollback対象にする。
- ステージング管理画面から「DB構造を診断」可能（管理者のみ／feature flag）。
- 旧本番サイトはBMSGDBライブラリv14固定。開発版のコードをmainに取り込まない。

## 読み取り監査の現時点の実績

2026-11-17にCore DBを読み取り確認した値（データは変更していない）:

- GroupID：13種／MemberID：33種／SongID：164種。
- 06_SongsのSongID重複：なし。
- 04_GroupMembersの所属重複／不明GroupID・MemberID：なし。
- 07_SongCreditsの存在しないSongID参照・曲名不一致：なし。
- 08_LyricsParts、10_PerformanceMetrics、11_PartTransfersの存在しないSongID参照：なし（11撤去前の監査記録として保存）。
- BE:FIRST曲の10_PerformanceMetrics行の欠落：なし。
- 10_PerformanceMetricsの同一SongID重複：なし。

これは照合時点の検査。サイト移行直前に再実行して差分を確認する。

## サイト管理への切替スイッチ（開発ブランチで用意済み）

`UNIVERSE_SITE_ONLY_WRITES=true` のとき、旧Sheetsメニューからの書き込み操作を非表示にし、旧プロフィール・所属・Guest／楽曲・歌詞・秒数表再同期・カード修復のGAS経路を拒否する。**初期値はOFF**。

このスイッチだけでは編集権限を持つ利用者の直接セル編集を禁止できない。Sheetsの権限変更とGAS実行主体を別途実証すること。

新規のGroup/Member/Songの採番では、各Band上限を超えた番号は発行確定せず失敗として扱う。IDRegistryと元のデータを維持。

## 2026-11-17 追加変更：11_PartTransfersの廃止（10は存続）

ユーザー指定による正式方針：
- **10_PerformanceMetricsは維持**。歌唱・センター秒数のANALYSIS、SETTINGSの歌唱・ダンス秒数計測、GAS共通Writerの秒数行追加を維持する。
- **11_PartTransfersを廃止**。ANALYSIS > その他 > パート継承分析、パート継承のランキング、パート移行シートの確認・削除操作、Member参照確認、曲削除時の関連子行、DB診断から依存を除去する。
- **08_LyricsPartsは維持**。歌割り情報／歌い出し・歌い終わり／フレーズ／順番・掛け合いは引き続き使用。
- GitHubの開発ブランチに変更し、本番DBの11シートは現行公開サイトの依存を避けるため **まだ削除しない**。本番用のサイト・DBライブラリの対応リリース、参照0件確認、バックアップ検証後に別工程で物理削除する。
- 旧TransferIDのIDRegistry記録があれば過去履歴として保持するが、発行・更新は行わない。
- 新しい歌詞パート移行機能はこの改修で追加しない。

## 本番移行の前提条件

- [ ] DB検査結果の不整合に対処、変更前・変更後件数を記録
- [ ] Core／Logの**別ファイル**バックアップを取得、コピーを開けることを確認
- [ ] テスト用複製DBでスキーマ変更／ロールバック／本番と同等データのCRUD検証
- [ ] 管理者の実行権限とDBの直接編集禁止を両立するApps Scriptの実行主体を確認
- [ ] サイトでプロフィール項目管理、既存ユニットの所属除外・並べ替えを補完
- [ ] 旧BMSG-DBのonOpenメニューと旧入力関数を廃止／機能フラグで拒否し、その後もサイトの各操作が成功
- [ ] YouTube／分析／セットリストの参照を監査、削除SongIDの外部参照を解除
- [ ] iPhoneで管理画面を操作、既存LYRICS・KARAOKE・QUIZ・COVER・ANALYSIS・PROFILEを回帰テスト
- [ ] GitHub PRの差分レビューとDB移行の明示的な承認
- [ ] 段階デプロイ・確認・切り戻し手順を準備

## まだやらないこと

- Core DBへの直接の列追加、既存値の書き換え、入力・旧タブの削除
- 既存シートの行順並べ替え、歌詞・パフォーマンスの値の一括再構築
- mainへのmerge、GASバージョン更新、公開サイトのデプロイ
- サイト機能が不足している状態でのDB保護・編集権限の一括変更

リンク: [Core DB](https://docs.google.com/spreadsheets/d/1-1AY6-BACOaGW3HIgYS0UjFMPSh-cjvYMMnJ_UYoRFY/edit) / [Log DB](https://docs.google.com/spreadsheets/d/10vDKc_Q431iMDTTqB2A16i-Yp28oXSInoKiJXZtonRQ/edit)
