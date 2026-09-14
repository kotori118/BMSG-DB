/** Single-part quick edit used by the normal LYRICS screen. */
function updateSongPartForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const songId = id_(payload.songId);
  const partOrder = Number(payload.partOrder);
  const lyrics = String(payload.lyrics || '').trim();
  if (!songId || !Number.isInteger(partOrder) || partOrder < 1) throw new Error('更新対象が不正です。');
  if (!lyrics) throw new Error('歌詞を入力してください。');

  return withSharedWriterLock_('歌詞クイック編集', function() {
    const ss = openCoreSpreadsheet_();
    const sheet = requireSheet_(ss, BU1.SHEETS.LYRICS_PARTS);
    const table = readTable_(sheet);
    requireColumns_(table, ['SongID','PartOrder','Singer','Lyrics']);
    const matches = table.rows.filter(function(row) {
      return id_(row.values[table.map.SongID]) === songId && Number(row.values[table.map.PartOrder]) === partOrder;
    });
    if (matches.length !== 1) throw new Error('更新対象の歌詞パートを一意に確認できません。');

    const singerById = universeServiceSingerById_(ss);
    const singer = encodeUniverseServiceSingerAssignments_(payload.singers, singerById);
    if (!singer) throw new Error('Singerを選択してください。');

    const row = matches[0].rowNumber;
    const singerCell = sheet.getRange(row, table.map.Singer + 1);
    const lyricsCell = sheet.getRange(row, table.map.Lyrics + 1);
    const oldSinger = singerCell.getValue();
    const oldLyrics = lyricsCell.getValue();
    try {
      singerCell.setNumberFormat('@').setValue(singer);
      lyricsCell.setNumberFormat('@').setValue(lyrics);
      SpreadsheetApp.flush();
      if (singerCell.getDisplayValue() !== singer || lyricsCell.getDisplayValue() !== lyrics) {
        throw new Error('保存内容を確認できませんでした。');
      }
      return {
        ok: true,
        songId: songId,
        partOrder: partOrder,
        singer: singer,
        singers: decodeUniverseServiceSinger_(singer, singerById),
        lyrics: lyrics
      };
    } catch (error) {
      try {
        singerCell.setValue(oldSinger);
        lyricsCell.setValue(oldLyrics);
        SpreadsheetApp.flush();
      } catch (ignore) {}
      throw error;
    }
  });
}
