/** 03_Guests / 06_Songs / 07_SongCredits の直接入力補助 */
function confirmAndSyncDirectMasters() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  withDocumentLock_('Guest・楽曲同期', function () {
    const errors = [], guests = readTable_(requireSheet_(ss, BU1.SHEETS.GUESTS));
    requireColumns_(guests, ['GuestID', 'DisplayName']);
    const newGuests = guests.rows.filter(r => !id_(r.values[guests.map.GuestID]) && clean_(r.values[guests.map.DisplayName]));
    const songs = readTable_(requireSheet_(ss, BU1.SHEETS.SONGS));
    requireColumns_(songs, ['SongID', 'Title', 'Artist', 'ReleaseDate', 'Form', 'CDTitle', 'IsTitleTrack']);
    const newSongs = songs.rows.filter(r => !id_(r.values[songs.map.SongID]) && r.values.some(v => clean_(v)));
    newSongs.forEach(r => {
      const title = clean_(r.values[songs.map.Title]), artist = clean_(r.values[songs.map.Artist]);
      if (!title || !artist || !clean_(r.values[songs.map.ReleaseDate])) errors.push(r.rowNumber + '行目: 新規曲はTitle・Artist・ReleaseDateが必須です');
      validateSongReleaseFields_(r, songs, errors);
    });
    if (errors.length) { alert_('登録を中止しました', errors.join('\n')); return; }
    if (!confirm_('Guest・楽曲の登録確認', '新規Guest: ' + newGuests.length + '件\n新規楽曲: ' + newSongs.length + '件\n\n登録しますか？')) return;
    newGuests.forEach(r => guests.sheet.getRange(r.rowNumber, guests.map.GuestID + 1).setValue(issueNumber_(ss, 'NEXT_GUEST_ID')));
    newSongs.forEach(r => {
      const artist = clean_(r.values[songs.map.Artist]); const band = BU1.SONG_BANDS[artist] || BU1.SONG_BANDS.DEFAULT;
      const songId = issueNumber_(ss, 'NEXT_SONG_ID_' + band);
      songs.sheet.getRange(r.rowNumber, songs.map.SongID + 1).setValue(songId);
      ensureSongCreditRow_(ss, songId, clean_(r.values[songs.map.Title]), artist);
    });
    syncPerformanceMetricRows(ss, true);
    alert_('登録完了', 'IDを採番し、関連行を作成しました。');
  });
}

function validateSongReleaseFields_(row, table, errors) {
  const form = clean_(row.values[table.map.Form]); const cd = clean_(row.values[table.map.CDTitle]);
  if (form && ['シングル', 'アルバム', 'デジタルリリース', 'その他'].indexOf(form) < 0) errors.push(row.rowNumber + '行目: Formが不正です');
  if ((form === 'デジタルリリース' || form === 'その他') && cd) errors.push(row.rowNumber + '行目: デジタルリリース／その他ではCDTitleを空欄にしてください');
}

function ensureSongCreditRow_(ss, songId, title, artist) {
  if (artist !== 'BE:FIRST') return;
  const sheet = requireSheet_(ss, BU1.SHEETS.SONG_CREDITS), table = readTable_(sheet);
  if (!table.rows.some(r => id_(r.values[table.map.SongID]) === String(songId))) appendStyledRow_(sheet, [songId, title, '', '', '']);
}
