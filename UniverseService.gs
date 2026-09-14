/**
 * BMSG Universe から利用する共通Writer。
 * Song / Lyrics / Guest の書込、検証、採番、ロールバックをBMSG-DBに集約する。
 * 公開関数はライブラリ経由でBMSG-PJから呼ばれる。
 */
const BU_SERVICE_USERS_ = Object.freeze(['U001','U002','U003']);
const BU_SERVICE_FORMS_ = Object.freeze(['シングル','アルバム','デジタルリリース','その他']);
const BU_SERVICE_ROLES_ = Object.freeze(['MAIN','UP','DOWN','SUB']);

function parseSongLyricsForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const raw = String(payload.rawLyrics || '');
  if (!raw.trim()) throw new Error('歌詞を入力してください。');
  const ss = openCoreSpreadsheet_();
  const masters = loadLyricsSingers_(ss);
  const unknownGuests = findUnknownLyricsGuestCandidates_(raw, { singers: masters });
  const errors = [];
  const parts = parseLyricsParts_(normalizeLineEndings_(raw).split('\n'), masters, errors);
  if (!parts.length) errors.push('歌詞パートを作成できませんでした。');
  const singerById = universeServiceSingerById_(ss);
  return {
    parts: parts.map(function(part, index) {
      const assignments = part.mainSingerIds.map(function(id) {
        const item = singerById[String(id)] || { name: String(id) };
        return { id: String(id), name: item.name, role: 'MAIN' };
      });
      return {
        partOrder: index + 1,
        singer: part.mainSingerIds.join(','),
        singers: assignments,
        lyrics: part.lyrics
      };
    }),
    unknownGuests: unknownGuests,
    errors: errors,
    canRegister: unknownGuests.length === 0 && errors.length === 0
  };
}

function registerSongLyricsGuestForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const name = clean_(payload.name);
  if (!name) throw new Error('Guest名を入力してください。');
  return withSharedWriterLock_('Guest登録', function() {
    const ss = openCoreSpreadsheet_();
    const memberTable = readTable_(requireSheet_(ss, BU1.SHEETS.MEMBERS));
    const guestSheet = requireSheet_(ss, BU1.SHEETS.GUESTS);
    const guestTable = readTable_(guestSheet);
    requireColumns_(memberTable, ['DisplayName']);
    requireColumns_(guestTable, ['GuestID','DisplayName']);
    if (memberTable.rows.some(r => clean_(r.values[memberTable.map.DisplayName]) === name) ||
        guestTable.rows.some(r => clean_(r.values[guestTable.map.DisplayName]) === name)) {
      return { ok:true, alreadyExists:true, name:name };
    }

    const reservation = reserveNumberForKey_(ss, 'NEXT_GUEST_ID', 'BMSG-DB_UNIVERSE', 'Universe Guest登録: ' + name);
    let rowNumber = 0;
    try {
      const values = new Array(guestTable.header.length).fill('');
      values[guestTable.map.GuestID] = reservation.issuedId;
      values[guestTable.map.DisplayName] = name;
      rowNumber = appendStyledRow_(guestSheet, values);
      SpreadsheetApp.flush();
      const verify = readTable_(guestSheet).rows.filter(r =>
        id_(r.values[guestTable.map.GuestID]) === reservation.issuedId &&
        clean_(r.values[guestTable.map.DisplayName]) === name
      );
      if (verify.length !== 1) throw new Error('Guest登録後の照合に失敗しました。');
      finalizeIdReservation_(reservation, true, 'Guest登録完了: ' + name);
      return { ok:true, guestId:reservation.issuedId, name:name };
    } catch (e) {
      if (rowNumber) try { guestSheet.deleteRow(rowNumber); } catch (ignore) {}
      try { finalizeIdReservation_(reservation, false, 'Guest登録失敗: ' + name); } catch (ignore) {}
      throw e;
    }
  });
}

function saveNewSongLyricsForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const song = normalizeUniverseServiceSong_(payload.song || {});
  const credits = normalizeUniverseServiceCredits_(payload.credits || {});
  const rawLyrics = String(payload.rawLyrics || '');
  if (!rawLyrics.trim()) throw new Error('歌詞を入力してください。');

  return withSharedWriterLock_('新規楽曲登録', function() {
    const ss = openCoreSpreadsheet_();
    const songsSheet = requireSheet_(ss, BU1.SHEETS.SONGS);
    const songsTable = readTable_(songsSheet);
    requireColumns_(songsTable, ['SongID','Title','Artist','ReleaseDate','Form','CDTitle','IsTitleTrack']);
    const duplicate = songsTable.rows.find(r =>
      clean_(r.values[songsTable.map.Title]) === song.title &&
      clean_(r.values[songsTable.map.Artist]) === song.artist
    );
    if (duplicate) {
      return { ok:false, duplicate:true, songId:id_(duplicate.values[songsTable.map.SongID]), title:song.title, artist:song.artist };
    }
    assertUniverseServiceArtist_(ss, song.artist);

    const parsed = parseSongLyricsForUniverse({ userId:payload.userId, rawLyrics:rawLyrics });
    if (parsed.unknownGuests.length) throw new Error('未登録のSingerがあります: ' + parsed.unknownGuests.join('、'));
    if (!parsed.canRegister) throw new Error((parsed.errors || ['歌詞を解析できませんでした。']).join('\n'));

    const band = BU1.SONG_BANDS[song.artist] || BU1.SONG_BANDS.DEFAULT;
    const reservation = reserveNumberForKey_(ss, 'NEXT_SONG_ID_' + band, 'BMSG-DB_UNIVERSE', 'Universe 新規曲: ' + song.title);
    const rollback = [];
    try {
      const songValues = new Array(songsTable.header.length).fill('');
      songValues[songsTable.map.SongID] = reservation.issuedId;
      songValues[songsTable.map.Title] = song.title;
      songValues[songsTable.map.Artist] = song.artist;
      songValues[songsTable.map.ReleaseDate] = song.releaseDateValue;
      songValues[songsTable.map.Form] = song.form;
      songValues[songsTable.map.CDTitle] = song.cdTitle;
      songValues[songsTable.map.IsTitleTrack] = song.isTitleTrack;
      const songRow = appendStyledRow_(songsSheet, songValues);
      rollback.push({sheet:songsSheet,row:songRow});

      const creditsSheet = requireSheet_(ss, BU1.SHEETS.SONG_CREDITS);
      const creditsTable = readTable_(creditsSheet);
      requireColumns_(creditsTable, ['SongID','Title','Lyricists','Composers','Choreographers']);
      const creditValues = new Array(creditsTable.header.length).fill('');
      creditValues[creditsTable.map.SongID] = reservation.issuedId;
      creditValues[creditsTable.map.Title] = song.title;
      creditValues[creditsTable.map.Lyricists] = credits.lyricists;
      creditValues[creditsTable.map.Composers] = credits.composers;
      creditValues[creditsTable.map.Choreographers] = credits.choreographers;
      const creditRow = appendStyledRow_(creditsSheet, creditValues);
      rollback.push({sheet:creditsSheet,row:creditRow});

      const partsSheet = requireSheet_(ss, BU1.SHEETS.LYRICS_PARTS);
      const partsTable = readTable_(partsSheet);
      requireColumns_(partsTable, ['SongID','PartOrder','Singer','Lyrics']);
      parsed.parts.forEach(function(part,index) {
        const values = new Array(partsTable.header.length).fill('');
        values[partsTable.map.SongID] = reservation.issuedId;
        values[partsTable.map.PartOrder] = index + 1;
        values[partsTable.map.Singer] = part.singer;
        values[partsTable.map.Lyrics] = part.lyrics;
        rollback.push({sheet:partsSheet,row:appendStyledRow_(partsSheet, values)});
      });

      if (song.artist === 'BE:FIRST') syncPerformanceMetricRows(ss, true);
      SpreadsheetApp.flush();
      const verifySongs = readTable_(songsSheet).rows.filter(r => id_(r.values[songsTable.map.SongID]) === reservation.issuedId);
      const verifyPartsTable = readTable_(partsSheet);
      const verifyParts = verifyPartsTable.rows.filter(r => id_(r.values[verifyPartsTable.map.SongID]) === reservation.issuedId);
      if (verifySongs.length !== 1 || verifyParts.length !== parsed.parts.length) throw new Error('登録後の照合に失敗しました。');
      finalizeIdReservation_(reservation, true, '新規曲登録完了: ' + song.title);
      return { ok:true, songId:reservation.issuedId, title:song.title, artist:song.artist };
    } catch (e) {
      rollback.sort((a,b) => b.row - a.row).forEach(function(item) {
        try { if (item.row >= 2 && item.row <= item.sheet.getLastRow()) item.sheet.deleteRow(item.row); } catch (ignore) {}
      });
      try { finalizeIdReservation_(reservation, false, '新規曲登録失敗: ' + song.title); } catch (ignore) {}
      throw e;
    }
  });
}

function saveSongInfoForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const songId = id_(payload.songId);
  const song = normalizeUniverseServiceSong_(payload.song || {});
  if (!songId) throw new Error('SongIDがありません。');
  return withSharedWriterLock_('楽曲情報保存', function() {
    const ss = openCoreSpreadsheet_();
    const sheet = requireSheet_(ss, BU1.SHEETS.SONGS);
    const table = readTable_(sheet);
    const target = table.rows.filter(r => id_(r.values[table.map.SongID]) === songId);
    if (target.length !== 1) throw new Error('06_SongsでSongIDを一意に確認できません。');
    const currentArtist = clean_(target[0].values[table.map.Artist]);
    if (currentArtist !== song.artist) throw new Error('登録後のARTISTは変更できません。');
    const row = target[0].rowNumber;
    sheet.getRange(row, table.map.Title + 1).setValue(song.title);
    sheet.getRange(row, table.map.ReleaseDate + 1).setValue(song.releaseDateValue);
    sheet.getRange(row, table.map.Form + 1).setValue(song.form);
    sheet.getRange(row, table.map.CDTitle + 1).setValue(song.cdTitle);
    sheet.getRange(row, table.map.IsTitleTrack + 1).setValue(song.isTitleTrack);

    const creditsSheet = requireSheet_(ss, BU1.SHEETS.SONG_CREDITS);
    const creditsTable = readTable_(creditsSheet);
    const creditRows = creditsTable.rows.filter(r => id_(r.values[creditsTable.map.SongID]) === songId);
    if (creditRows.length > 1) throw new Error('07_SongCreditsでSongIDが重複しています。');
    if (creditRows.length && creditsTable.map.Title != null) creditsSheet.getRange(creditRows[0].rowNumber, creditsTable.map.Title + 1).setValue(song.title);
    SpreadsheetApp.flush();
    return { ok:true, songId:songId };
  });
}

function saveSongCreditsForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const songId = id_(payload.songId);
  if (!songId) throw new Error('SongIDがありません。');
  const credits = normalizeUniverseServiceCredits_(payload.credits || {});
  return withSharedWriterLock_('クレジット保存', function() {
    const ss = openCoreSpreadsheet_();
    const songsTable = readTable_(requireSheet_(ss, BU1.SHEETS.SONGS));
    const songRow = songsTable.rows.find(r => id_(r.values[songsTable.map.SongID]) === songId);
    if (!songRow) throw new Error('曲が見つかりません。');
    const sheet = requireSheet_(ss, BU1.SHEETS.SONG_CREDITS);
    const table = readTable_(sheet);
    requireColumns_(table, ['SongID','Title','Lyricists','Composers','Choreographers']);
    let row = table.rows.find(r => id_(r.values[table.map.SongID]) === songId);
    if (!row) {
      const values = new Array(table.header.length).fill('');
      values[table.map.SongID] = songId;
      values[table.map.Title] = clean_(songRow.values[songsTable.map.Title]);
      values[table.map.Lyricists] = credits.lyricists;
      values[table.map.Composers] = credits.composers;
      values[table.map.Choreographers] = credits.choreographers;
      appendStyledRow_(sheet, values);
    } else {
      sheet.getRange(row.rowNumber, table.map.Title + 1).setValue(clean_(songRow.values[songsTable.map.Title]));
      sheet.getRange(row.rowNumber, table.map.Lyricists + 1).setValue(credits.lyricists);
      sheet.getRange(row.rowNumber, table.map.Composers + 1).setValue(credits.composers);
      sheet.getRange(row.rowNumber, table.map.Choreographers + 1).setValue(credits.choreographers);
    }
    SpreadsheetApp.flush();
    return { ok:true, songId:songId };
  });
}

function saveSongPartsForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const songId = id_(payload.songId);
  if (!songId) throw new Error('SongIDがありません。');
  const incoming = Array.isArray(payload.parts) ? payload.parts : [];
  if (!incoming.length) throw new Error('歌詞パートがありません。');
  return withSharedWriterLock_('歌詞保存', function() {
    const ss = openCoreSpreadsheet_();
    const songs = readTable_(requireSheet_(ss, BU1.SHEETS.SONGS));
    if (!songs.rows.some(r => id_(r.values[songs.map.SongID]) === songId)) throw new Error('曲が見つかりません。');
    const singerById = universeServiceSingerById_(ss);
    const normalized = incoming.map(function(part,index) {
      const lyrics = String(part && part.lyrics || '').trim();
      if (!lyrics) throw new Error('Part ' + (index + 1) + ' の歌詞が空です。');
      const singer = encodeUniverseServiceSingerAssignments_(part && part.singers, singerById);
      if (!singer) throw new Error('Part ' + (index + 1) + ' のSingerを選択してください。');
      return { partOrder:index + 1, singer:singer, lyrics:lyrics };
    });

    const sheet = requireSheet_(ss, BU1.SHEETS.LYRICS_PARTS);
    let table = readTable_(sheet);
    requireColumns_(table, ['SongID','PartOrder','Singer','Lyrics']);
    const oldRows = table.rows.filter(r => id_(r.values[table.map.SongID]) === songId)
      .map(r => ({rowNumber:r.rowNumber, values:r.values.slice()}));
    try {
      oldRows.slice().sort((a,b)=>b.rowNumber-a.rowNumber).forEach(r => sheet.deleteRow(r.rowNumber));
      table = readTable_(sheet);
      normalized.forEach(function(part) {
        const values = new Array(table.header.length).fill('');
        values[table.map.SongID] = songId;
        values[table.map.PartOrder] = part.partOrder;
        values[table.map.Singer] = part.singer;
        values[table.map.Lyrics] = part.lyrics;
        appendStyledRow_(sheet, values);
      });
      SpreadsheetApp.flush();
      const verify = readTable_(sheet);
      const rows = verify.rows.filter(r => id_(r.values[verify.map.SongID]) === songId);
      if (rows.length !== normalized.length) throw new Error('歌詞保存後の照合に失敗しました。');
      return { ok:true, songId:songId, parts:normalized };
    } catch (e) {
      const current = readTable_(sheet);
      current.rows.filter(r => id_(r.values[current.map.SongID]) === songId)
        .sort((a,b)=>b.rowNumber-a.rowNumber).forEach(r => { try { sheet.deleteRow(r.rowNumber); } catch(ignore){} });
      const restoredTable = readTable_(sheet);
      oldRows.forEach(function(old) {
        const values = old.values.slice(0, restoredTable.header.length);
        while (values.length < restoredTable.header.length) values.push('');
        appendStyledRow_(sheet, values);
      });
      SpreadsheetApp.flush();
      throw e;
    }
  });
}

function updateLyricsPartForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const songId = id_(payload.songId);
  const partOrder = Number(payload.partOrder);
  const lyrics = String(payload.lyrics || '').trim();
  if (!songId || !Number.isInteger(partOrder) || partOrder < 1) throw new Error('更新対象が不正です。');
  if (!lyrics) throw new Error('歌詞を入力してください。');
  return withSharedWriterLock_('歌詞パート保存', function() {
    const ss = openCoreSpreadsheet_();
    const singerById = universeServiceSingerById_(ss);
    const singer = Array.isArray(payload.singers)
      ? encodeUniverseServiceSingerAssignments_(payload.singers, singerById)
      : validateUniverseServiceSingerString_(String(payload.singer || ''), singerById);
    if (!singer) throw new Error('Singerを選択してください。');
    const sheet = requireSheet_(ss, BU1.SHEETS.LYRICS_PARTS);
    const table = readTable_(sheet);
    const matches = table.rows.filter(r => id_(r.values[table.map.SongID]) === songId && Number(r.values[table.map.PartOrder]) === partOrder);
    if (matches.length !== 1) throw new Error('更新対象の歌詞パートを一意に確認できません。');
    sheet.getRange(matches[0].rowNumber, table.map.Singer + 1).setNumberFormat('@').setValue(singer);
    sheet.getRange(matches[0].rowNumber, table.map.Lyrics + 1).setNumberFormat('@').setValue(lyrics);
    SpreadsheetApp.flush();
    return { ok:true, songId:songId, partOrder:partOrder, singer:singer, lyrics:lyrics };
  });
}

function requireUniverseServiceUser_(userId) {
  const id = clean_(userId);
  if (BU_SERVICE_USERS_.indexOf(id) < 0) throw new Error('利用ユーザーを選択してください。');
  return id;
}

function normalizeUniverseServiceSong_(input) {
  const title = clean_(input.title), artist = clean_(input.artist), form = clean_(input.form), cdTitle = clean_(input.cdTitle);
  const releaseDate = clean_(input.releaseDate);
  if (!title) throw new Error('TITLEを入力してください。');
  if (!artist) throw new Error('ARTISTを選択してください。');
  if (form && BU_SERVICE_FORMS_.indexOf(form) < 0) throw new Error('FORMを確認してください。');
  if ((form === 'デジタルリリース' || form === 'その他') && cdTitle) throw new Error('デジタルリリース／その他ではCD TITLEを空欄にしてください。');
  let releaseDateValue = '';
  if (releaseDate) releaseDateValue = normalizeDateForSheet_(releaseDate);
  return { title:title, artist:artist, releaseDate:releaseDate, releaseDateValue:releaseDateValue, form:form, cdTitle:cdTitle,
    isTitleTrack: input.isTitleTrack === true || String(input.isTitleTrack || '').toUpperCase() === 'TRUE' };
}

function normalizeUniverseServiceCredits_(input) {
  return { lyricists:clean_(input.lyricists), composers:clean_(input.composers), choreographers:clean_(input.choreographers) };
}

function assertUniverseServiceArtist_(ss, artist) {
  if (artist === 'UNIT') return;
  const groups = readTable_(requireSheet_(ss, BU1.SHEETS.GROUPS));
  const members = readTable_(requireSheet_(ss, BU1.SHEETS.MEMBERS));
  const groupOk = groups.rows.some(r => clean_(r.values[groups.map.GroupName]) === artist);
  const memberOk = members.rows.some(r => clean_(r.values[members.map.DisplayName]) === artist);
  if (!groupOk && !memberOk) throw new Error('ARTISTが登録済み候補にありません。');
}


function universeServiceSingerById_(ss) {
  const result = { '99':{id:'99',name:'ALL'}, '109':{id:'109',name:'その他'} };
  const members = readTable_(requireSheet_(ss, BU1.SHEETS.MEMBERS));
  const guests = readTable_(requireSheet_(ss, BU1.SHEETS.GUESTS));
  members.rows.forEach(function(r) {
    const id = id_(r.values[members.map.MemberID]), name = clean_(r.values[members.map.DisplayName]);
    if (id && name) result[id] = {id:id,name:name};
  });
  guests.rows.forEach(function(r) {
    const id = id_(r.values[guests.map.GuestID]), name = clean_(r.values[guests.map.DisplayName]);
    if (id && name) result[id] = {id:id,name:name};
  });
  return result;
}

function encodeUniverseServiceSingerAssignments_(items, singerById) {
  if (!Array.isArray(items) || !items.length) return '';
  return items.map(function(item) {
    const id = clean_(item && item.id), role = clean_(item && item.role || 'MAIN').toUpperCase() || 'MAIN';
    if (!singerById[id]) throw new Error('未登録のSinger IDです: ' + id);
    if (BU_SERVICE_ROLES_.indexOf(role) < 0) throw new Error('Singer roleが不正です: ' + role);
    return id + (role === 'MAIN' ? '' : '_' + role.toLowerCase());
  }).join(',');
}

function validateUniverseServiceSingerString_(raw, singerById) {
  const tokens = String(raw || '').split(',').map(clean_).filter(Boolean);
  if (!tokens.length) return '';
  tokens.forEach(function(token) {
    const m = token.match(/_(up|down|sub)$/i);
    const id = m ? token.slice(0, -m[0].length) : token;
    if (!singerById[id]) throw new Error('未登録のSinger IDです: ' + id);
  });
  return tokens.join(',');
}
