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
    return registerGuestCore_(openCoreSpreadsheet_(), name, {
      source:'BMSG-DB_UNIVERSE',
      notePrefix:'Universe Guest登録'
    });
  });
}


function saveNewSongLyricsForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const song = normalizeUniverseServiceSong_(payload.song || {});
  const credits = normalizeUniverseServiceCredits_(payload.credits || {});
  const rawLyrics = String(payload.rawLyrics || '');
  if (!rawLyrics.trim()) throw new Error('歌詞を入力してください。');

  const parsed = parseSongLyricsForUniverse({ userId:payload.userId, rawLyrics:rawLyrics });
  if (parsed.unknownGuests.length) throw new Error('未登録のSingerがあります: ' + parsed.unknownGuests.join('、'));
  if (!parsed.canRegister) throw new Error((parsed.errors || ['歌詞を解析できませんでした。']).join('\n'));

  return withSharedWriterLock_('新規楽曲登録', function() {
    return createSongWithPartsCore_(openCoreSpreadsheet_(), song, credits, parsed.parts, {
      source:'BMSG-DB_UNIVERSE',
      notePrefix:'Universe 新規曲'
    });
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
    return replaceSongPartsCore_(openCoreSpreadsheet_(), songId, incoming);
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
/**
 * Shared writer internals.
 * Universe UI and legacy spreadsheet routes both mutate DB only through
 * these helpers / wrappers. Feature files may collect input and confirm,
 * but must not write Song / Lyrics / Guest master rows directly.
 */
function registerGuestCore_(ss, name, context) {
  context = context || {};
  name = clean_(name);
  if (!name) throw new Error('Guest名を入力してください。');
  const memberTable = readTable_(requireSheet_(ss, BU1.SHEETS.MEMBERS));
  const guestSheet = requireSheet_(ss, BU1.SHEETS.GUESTS);
  const guestTable = readTable_(guestSheet);
  requireColumns_(memberTable, ['DisplayName']);
  requireColumns_(guestTable, ['GuestID','DisplayName']);
  const existingRowNumber = Number(context.existingRowNumber || 0);
  if (memberTable.rows.some(function(r){ return clean_(r.values[memberTable.map.DisplayName]) === name; })) {
    return {ok:true, alreadyExists:true, name:name};
  }
  const duplicateGuests = guestTable.rows.filter(function(r){
    return clean_(r.values[guestTable.map.DisplayName]) === name && r.rowNumber !== existingRowNumber;
  });
  if (duplicateGuests.length) {
    const committed = duplicateGuests.find(function(r){ return !!id_(r.values[guestTable.map.GuestID]); });
    if (committed) return {ok:true, alreadyExists:true, guestId:id_(committed.values[guestTable.map.GuestID]), name:name};
    throw new Error('Guest名が複数行に入力されています: ' + name);
  }

  const reservation = reserveNumberForKey_(ss, 'NEXT_GUEST_ID', context.source || 'BMSG-DB', (context.notePrefix || 'Guest登録') + ': ' + name);
  let appendedRow = 0;
  try {
    if (existingRowNumber) {
      const fresh = readTable_(guestSheet);
      const row = fresh.rows.find(function(r){ return r.rowNumber === existingRowNumber; });
      if (!row || id_(row.values[fresh.map.GuestID]) || clean_(row.values[fresh.map.DisplayName]) !== name) throw new Error('Guest入力行が変更されています。もう一度確認してください。');
      guestSheet.getRange(existingRowNumber, fresh.map.GuestID + 1).setValue(reservation.issuedId);
    } else {
      const values = new Array(guestTable.header.length).fill('');
      values[guestTable.map.GuestID] = reservation.issuedId;
      values[guestTable.map.DisplayName] = name;
      appendedRow = appendStyledRow_(guestSheet, values);
    }
    SpreadsheetApp.flush();
    const verify = readTable_(guestSheet).rows.filter(function(r){
      return id_(r.values[guestTable.map.GuestID]) === reservation.issuedId && clean_(r.values[guestTable.map.DisplayName]) === name;
    });
    if (verify.length !== 1) throw new Error('Guest登録後の照合に失敗しました。');
    finalizeIdReservation_(reservation, true, 'Guest登録完了: ' + name);
    return {ok:true, guestId:reservation.issuedId, name:name};
  } catch (e) {
    if (existingRowNumber) {
      try {
        const current = guestSheet.getRange(existingRowNumber, guestTable.map.GuestID + 1);
        if (id_(current.getValue()) === reservation.issuedId) current.clearContent();
      } catch (ignore) {}
    } else if (appendedRow) {
      try { guestSheet.deleteRow(appendedRow); } catch (ignore) {}
    }
    try { finalizeIdReservation_(reservation, false, 'Guest登録失敗: ' + name); } catch (ignore) {}
    throw e;
  }
}

function createSongWithPartsCore_(ss, song, credits, parsedParts, context) {
  context = context || {};
  const songsSheet = requireSheet_(ss, BU1.SHEETS.SONGS);
  const songsTable = readTable_(songsSheet);
  requireColumns_(songsTable, ['SongID','Title','Artist','ReleaseDate','Form','CDTitle','IsTitleTrack']);
  const duplicate = songsTable.rows.find(function(r){
    return clean_(r.values[songsTable.map.Title]) === song.title && clean_(r.values[songsTable.map.Artist]) === song.artist;
  });
  if (duplicate) return {ok:false, duplicate:true, songId:id_(duplicate.values[songsTable.map.SongID]), title:song.title, artist:song.artist};
  assertUniverseServiceArtist_(ss, song.artist);
  const parts = Array.isArray(parsedParts) ? parsedParts : [];
  if (!parts.length) throw new Error('歌詞パートがありません。');

  const band = BU1.SONG_BANDS[song.artist] || BU1.SONG_BANDS.DEFAULT;
  const reservation = reserveNumberForKey_(ss, 'NEXT_SONG_ID_' + band, context.source || 'BMSG-DB', (context.notePrefix || '新規曲') + ': ' + song.title);
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
    rollback.push({sheet:songsSheet,row:appendStyledRow_(songsSheet, songValues)});

    const creditsSheet = requireSheet_(ss, BU1.SHEETS.SONG_CREDITS);
    const creditsTable = readTable_(creditsSheet);
    requireColumns_(creditsTable, ['SongID','Title','Lyricists','Composers','Choreographers']);
    const creditValues = new Array(creditsTable.header.length).fill('');
    creditValues[creditsTable.map.SongID] = reservation.issuedId;
    creditValues[creditsTable.map.Title] = song.title;
    creditValues[creditsTable.map.Lyricists] = credits.lyricists;
    creditValues[creditsTable.map.Composers] = credits.composers;
    creditValues[creditsTable.map.Choreographers] = credits.choreographers;
    rollback.push({sheet:creditsSheet,row:appendStyledRow_(creditsSheet, creditValues)});

    const partsSheet = requireSheet_(ss, BU1.SHEETS.LYRICS_PARTS);
    const partsTable = readTable_(partsSheet);
    requireColumns_(partsTable, ['SongID','PartOrder','Singer','Lyrics']);
    parts.forEach(function(part,index){
      const singer = clean_(part.singer || (part.mainSingerIds || []).join(','));
      const lyrics = String(part.lyrics || '').trim();
      if (!singer || !lyrics) throw new Error('Part ' + (index + 1) + ' のSingerまたは歌詞が空です。');
      const values = new Array(partsTable.header.length).fill('');
      values[partsTable.map.SongID] = reservation.issuedId;
      values[partsTable.map.PartOrder] = index + 1;
      values[partsTable.map.Singer] = singer;
      values[partsTable.map.Lyrics] = lyrics;
      rollback.push({sheet:partsSheet,row:appendStyledRow_(partsSheet, values)});
    });

    if (song.artist === 'BE:FIRST') syncPerformanceMetricRows(ss, true);
    SpreadsheetApp.flush();
    const verifySongs = readTable_(songsSheet).rows.filter(function(r){ return id_(r.values[songsTable.map.SongID]) === reservation.issuedId; });
    const verifyPartsTable = readTable_(partsSheet);
    const verifyParts = verifyPartsTable.rows.filter(function(r){ return id_(r.values[verifyPartsTable.map.SongID]) === reservation.issuedId; });
    if (verifySongs.length !== 1 || verifyParts.length !== parts.length) throw new Error('登録後の照合に失敗しました。');
    finalizeIdReservation_(reservation, true, '新規曲登録完了: ' + song.title);
    return {ok:true, songId:reservation.issuedId, title:song.title, artist:song.artist};
  } catch (e) {
    rollback.sort(function(a,b){ return b.row-a.row; }).forEach(function(item){
      try { if (item.row >= 2 && item.row <= item.sheet.getLastRow()) item.sheet.deleteRow(item.row); } catch (ignore) {}
    });
    try { finalizeIdReservation_(reservation, false, '新規曲登録失敗: ' + song.title); } catch (ignore) {}
    throw e;
  }
}

function replaceSongPartsCore_(ss, songId, incoming) {
  const songs = readTable_(requireSheet_(ss, BU1.SHEETS.SONGS));
  if (!songs.rows.some(function(r){ return id_(r.values[songs.map.SongID]) === songId; })) throw new Error('曲が見つかりません。');
  const singerById = universeServiceSingerById_(ss);
  const normalized = incoming.map(function(part,index){
    const lyrics = String(part && part.lyrics || '').trim();
    if (!lyrics) throw new Error('Part ' + (index + 1) + ' の歌詞が空です。');
    const singer = Array.isArray(part && part.singers)
      ? encodeUniverseServiceSingerAssignments_(part.singers, singerById)
      : validateUniverseServiceSingerString_(String(part && part.singer || ''), singerById);
    if (!singer) throw new Error('Part ' + (index + 1) + ' のSingerを選択してください。');
    return {partOrder:index + 1, singer:singer, lyrics:lyrics};
  });
  const sheet = requireSheet_(ss, BU1.SHEETS.LYRICS_PARTS);
  let table = readTable_(sheet);
  requireColumns_(table, ['SongID','PartOrder','Singer','Lyrics']);
  const oldRows = table.rows.filter(function(r){ return id_(r.values[table.map.SongID]) === songId; }).map(function(r){ return {rowNumber:r.rowNumber, values:r.values.slice()}; });
  try {
    oldRows.slice().sort(function(a,b){return b.rowNumber-a.rowNumber;}).forEach(function(r){sheet.deleteRow(r.rowNumber);});
    table = readTable_(sheet);
    normalized.forEach(function(part){
      const values = new Array(table.header.length).fill('');
      values[table.map.SongID] = songId;
      values[table.map.PartOrder] = part.partOrder;
      values[table.map.Singer] = part.singer;
      values[table.map.Lyrics] = part.lyrics;
      appendStyledRow_(sheet, values);
    });
    SpreadsheetApp.flush();
    const verify = readTable_(sheet);
    const rows = verify.rows.filter(function(r){ return id_(r.values[verify.map.SongID]) === songId; });
    if (rows.length !== normalized.length) throw new Error('歌詞保存後の照合に失敗しました。');
    return {ok:true, songId:songId, parts:normalized};
  } catch (e) {
    const current = readTable_(sheet);
    current.rows.filter(function(r){ return id_(r.values[current.map.SongID]) === songId; }).sort(function(a,b){return b.rowNumber-a.rowNumber;}).forEach(function(r){try{sheet.deleteRow(r.rowNumber);}catch(ignore){}});
    const restoredTable = readTable_(sheet);
    oldRows.forEach(function(old){
      const values = old.values.slice(0, restoredTable.header.length);
      while (values.length < restoredTable.header.length) values.push('');
      appendStyledRow_(sheet, values);
    });
    SpreadsheetApp.flush();
    throw e;
  }
}

function getLegacyDirectMastersPlan_() {
  const ss = openCoreSpreadsheet_();
  const errors = [];
  const members = readTable_(requireSheet_(ss, BU1.SHEETS.MEMBERS));
  const guests = readTable_(requireSheet_(ss, BU1.SHEETS.GUESTS));
  const songs = readTable_(requireSheet_(ss, BU1.SHEETS.SONGS));
  requireColumns_(members, ['DisplayName']);
  requireColumns_(guests, ['GuestID','DisplayName']);
  requireColumns_(songs, ['SongID','Title','Artist','ReleaseDate','Form','CDTitle','IsTitleTrack']);

  const memberNames = {};
  members.rows.forEach(function(r){ const name=clean_(r.values[members.map.DisplayName]); if(name) memberNames[name]=true; });
  const committedGuestNames = {};
  guests.rows.forEach(function(r){ const name=clean_(r.values[guests.map.DisplayName]); if(name && id_(r.values[guests.map.GuestID])) committedGuestNames[name]=true; });
  const guestRows = guests.rows.filter(function(r){ return !id_(r.values[guests.map.GuestID]) && clean_(r.values[guests.map.DisplayName]); });
  const guestNames = {};
  guestRows.forEach(function(r){
    const name = clean_(r.values[guests.map.DisplayName]);
    if (memberNames[name]) errors.push(r.rowNumber + '行目: 同名のメンバーが登録済みです: ' + name);
    if (committedGuestNames[name]) errors.push(r.rowNumber + '行目: 同名のGuestが登録済みです: ' + name);
    if (guestNames[name]) errors.push('Guest名が未採番行で重複しています: ' + name);
    guestNames[name] = true;
  });

  const songRows = songs.rows.filter(function(r){ return !id_(r.values[songs.map.SongID]) && r.values.some(function(v){return !!clean_(v);}); });
  const committedSongKeys = {};
  songs.rows.forEach(function(r){
    if (!id_(r.values[songs.map.SongID])) return;
    const title=clean_(r.values[songs.map.Title]), artist=clean_(r.values[songs.map.Artist]);
    if(title && artist) committedSongKeys[title+'\u0000'+artist]=true;
  });
  const pendingSongKeys = {};
  songRows.forEach(function(r){
    try {
      if (!clean_(r.values[songs.map.ReleaseDate])) throw new Error('ReleaseDateが必須です');
      const song = normalizeUniverseServiceSong_({
        title:r.values[songs.map.Title], artist:r.values[songs.map.Artist], releaseDate:r.values[songs.map.ReleaseDate],
        form:r.values[songs.map.Form], cdTitle:r.values[songs.map.CDTitle], isTitleTrack:r.values[songs.map.IsTitleTrack]
      });
      assertUniverseServiceArtist_(ss, song.artist);
      const key=song.title+'\u0000'+song.artist;
      if (committedSongKeys[key]) throw new Error('同じTitle＋Artistの曲が登録済みです');
      if (pendingSongKeys[key]) throw new Error('同じTitle＋Artistが未採番行で重複しています');
      pendingSongKeys[key]=true;
    } catch (e) { errors.push(r.rowNumber + '行目: ' + e.message); }
  });
  return {
    guestCount:guestRows.length,
    songCount:songRows.length,
    guestRows:guestRows.map(function(r){return {rowNumber:r.rowNumber,name:clean_(r.values[guests.map.DisplayName])};}),
    songRows:songRows.map(function(r){return {rowNumber:r.rowNumber};}),
    errors:errors
  };
}


function commitLegacyDirectMasters_() {
  return withSharedWriterLock_('Guest・楽曲同期', function(){
    const ss = openCoreSpreadsheet_();
    const plan = getLegacyDirectMastersPlan_();
    if (plan.errors.length) throw new Error(plan.errors.join('\n'));
    let guests = 0, songs = 0;
    plan.guestRows.forEach(function(item){
      const result = registerGuestCore_(ss, item.name, {source:'BMSG-DB_LEGACY',notePrefix:'Spreadsheet Guest登録',existingRowNumber:item.rowNumber});
      if (result && !result.alreadyExists) guests++;
    });
    plan.songRows.forEach(function(item){
      assignSongIdToExistingRowCore_(ss, item.rowNumber, {source:'BMSG-DB_LEGACY',notePrefix:'Spreadsheet 楽曲登録'});
      songs++;
    });
    if (songs) syncPerformanceMetricRows(ss, true);
    return {ok:true, guests:guests, songs:songs};
  });
}

function assignSongIdToExistingRowCore_(ss, rowNumber, context) {
  context = context || {};
  const sheet = requireSheet_(ss, BU1.SHEETS.SONGS);
  let table = readTable_(sheet);
  const row = table.rows.find(function(r){ return r.rowNumber === Number(rowNumber); });
  if (!row || id_(row.values[table.map.SongID])) throw new Error('楽曲入力行が変更されています。もう一度確認してください。');
  if (!clean_(row.values[table.map.ReleaseDate])) throw new Error(rowNumber + '行目: ReleaseDateが必須です');
  const song = normalizeUniverseServiceSong_({
    title:row.values[table.map.Title], artist:row.values[table.map.Artist], releaseDate:row.values[table.map.ReleaseDate],
    form:row.values[table.map.Form], cdTitle:row.values[table.map.CDTitle], isTitleTrack:row.values[table.map.IsTitleTrack]
  });
  assertUniverseServiceArtist_(ss, song.artist);
  const duplicate = table.rows.find(function(r){
    return r.rowNumber !== row.rowNumber && clean_(r.values[table.map.Title]) === song.title && clean_(r.values[table.map.Artist]) === song.artist;
  });
  if (duplicate) throw new Error('同じTitle＋Artistの行が既にあります: ' + song.title + ' / ' + song.artist);
  const band = BU1.SONG_BANDS[song.artist] || BU1.SONG_BANDS.DEFAULT;
  const reservation = reserveNumberForKey_(ss, 'NEXT_SONG_ID_' + band, context.source || 'BMSG-DB_LEGACY', (context.notePrefix || 'Spreadsheet 楽曲登録') + ': ' + song.title);
  let creditRow = 0;
  try {
    sheet.getRange(row.rowNumber, table.map.SongID + 1).setValue(reservation.issuedId);
    const creditsSheet = requireSheet_(ss, BU1.SHEETS.SONG_CREDITS);
    const creditsTable = readTable_(creditsSheet);
    requireColumns_(creditsTable, ['SongID','Title','Lyricists','Composers','Choreographers']);
    if (!creditsTable.rows.some(function(r){return id_(r.values[creditsTable.map.SongID]) === reservation.issuedId;})) {
      const values = new Array(creditsTable.header.length).fill('');
      values[creditsTable.map.SongID] = reservation.issuedId;
      values[creditsTable.map.Title] = song.title;
      creditRow = appendStyledRow_(creditsSheet, values);
    }
    SpreadsheetApp.flush();
    table = readTable_(sheet);
    const verify = table.rows.filter(function(r){return id_(r.values[table.map.SongID]) === reservation.issuedId;});
    if (verify.length !== 1) throw new Error('楽曲登録後の照合に失敗しました。');
    finalizeIdReservation_(reservation, true, '楽曲登録完了: ' + song.title);
    return {ok:true,songId:reservation.issuedId,title:song.title,artist:song.artist};
  } catch (e) {
    try {
      const cell = sheet.getRange(row.rowNumber, table.map.SongID + 1);
      if (id_(cell.getValue()) === reservation.issuedId) cell.clearContent();
    } catch (ignore) {}
    if (creditRow) try { requireSheet_(ss, BU1.SHEETS.SONG_CREDITS).deleteRow(creditRow); } catch (ignore) {}
    try { finalizeIdReservation_(reservation, false, '楽曲登録失敗: ' + song.title); } catch (ignore) {}
    throw e;
  }
}

function commitLegacyLyricsInputForSharedWriter_(payload) {
  payload = payload || {};
  const raw = String(payload.raw || '');
  const metaInput = payload.metaInput || {};
  if (!clean_(raw)) throw new Error('歌詞欄が空です。');
  return withSharedWriterLock_('歌詞登録', function(){
    const ss = openCoreSpreadsheet_();
    const masters = {groups:loadLyricsGroups_(ss),singers:loadLyricsSingers_(ss),songs:loadLyricsSongs_(ss)};
    const result = parseLyricsMaterial_(raw, metaInput, masters);
    if (!result.canRegister) throw new Error((result.errors || ['歌詞を解析できませんでした。']).join('\n'));
    const incoming = result.parts.map(function(part){
      return {singers:part.mainSingerIds.map(function(id){return {id:String(id),role:'MAIN'};}),lyrics:part.lyrics};
    });
    if (result.song && result.song.songId) {
      return replaceSongPartsCore_(ss, String(result.song.songId), incoming);
    }
    const song = normalizeUniverseServiceSong_({title:result.title,artist:result.group.name,releaseDate:result.releaseDate,form:'',cdTitle:'',isTitleTrack:false});
    const parsedParts = result.parts.map(function(part,index){return {partOrder:index+1,singer:part.mainSingerIds.join(','),lyrics:part.lyrics};});
    return createSongWithPartsCore_(ss, song, normalizeUniverseServiceCredits_({}), parsedParts, {source:'BMSG-DB_LEGACY',notePrefix:'Spreadsheet 歌詞登録'});
  });
}
