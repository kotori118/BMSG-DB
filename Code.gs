/**
 * BMSG Universe 管理GAS
 * 共通設定・メニュー・安全な読書きヘルパー
 */

const BU1 = Object.freeze({
  VERSION: '1.1.0',
  CORE_DB_ID: '1-1AY6-BACOaGW3HIgYS0UjFMPSh-cjvYMMnJ_UYoRFY',
  LOG_DB_ID: '10vDKc_Q431iMDTTqB2A16i-Yp28oXSInoKiJXZtonRQ',
  CARD_IMAGE_FOLDER_ID: '1ayh-EAbV585JqRofClrTHjBxNTQlfQBK',
  ID_REGISTRY_SHEET: 'IDRegistry',
  SHEETS: Object.freeze({
    GUIDE: '00_管理ガイド', INPUT_LYRICS: '入力_歌詞',
    INPUT_PROFILE: '入力_プロフィール', INPUT_MEMBERSHIP: '入力_所属',
    GROUPS: '01_Groups', MEMBERS: '02_Members',
    GUESTS: '03_Guests', GROUP_MEMBERS: '04_GroupMembers',
    PROFILES: '05_Profiles', SONGS: '06_Songs', SONG_CREDITS: '07_SongCredits',
    LYRICS_PARTS: '08_LyricsParts', CARDS: '09_Images',
    METRICS: '10_PerformanceMetrics', TRANSFERS: '11_PartTransfers',
  }),
  COLORS: Object.freeze({ INPUT: '#FFF9D6', AUTO: '#EFEFEF', ERROR: '#F4CCCC' }),
  CARD_RARITIES: Object.freeze(['SSR', 'SR', 'R', 'N']),
  MAIN_GROUP_BANDS: Object.freeze({
    'BE:FIRST': 100, 'MAZZEL': 200, 'STARGLOW': 300, 'HANA': 400,
    'ソロ・その他': 500,
  }),
  SONG_BANDS: Object.freeze({
    'BE:FIRST': 1000, 'MAZZEL': 2000, 'STARGLOW': 3000, 'HANA': 4000,
    'DEFAULT': 5000,
  }),
  SPECIAL_SINGERS: Object.freeze({ '99': 'ALL', '109': 'その他' }),
});

const BU_ID_REGISTRY_HEADERS_ = Object.freeze([
  'EntityType','Scope','IssuedID','NumericValue','Status','RequestID','Source','IssuedAt','UpdatedAt','Note'
]);

function onOpen() {
  SpreadsheetApp.getUi().createMenu('BMSG Universe')
    .addItem('プロフィール｜変更を確認・反映', 'confirmAndSyncProfiles')
    .addSeparator()
    .addItem('所属・グループ｜変更を確認・反映', 'confirmAndSyncMemberships')
    .addItem('Guest・楽曲｜新規登録を確認', 'confirmAndSyncDirectMasters')
    .addSeparator()
    .addItem('歌詞｜解析（プレビュー）', 'previewLyricsInput')
    .addItem('歌詞｜解析結果を登録', 'commitLyricsInput')
    .addSeparator()
    .addItem('全体｜構成を検証', 'validateUniverseStructure')
    .addToUi();
  try { ensureLyricsInputLayout_(); } catch (err) { console.error(err); }
}

function onInstall(e) { onOpen(e); }

function validateUniverseStructure() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const required = Object.keys(BU1.SHEETS).map(k => BU1.SHEETS[k]);
  const errors = required.filter(name => !ss.getSheetByName(name))
    .map(name => '不足シート: ' + name);
  errors.push.apply(errors, validateRequiredHeaders_(ss));
  errors.push.apply(errors, validateUniqueIds_(ss));
  try { idRegistryTable_(); } catch (e) { errors.push(e.message); }
  alert_('BMSG Universe 構成検証', errors.length
    ? errors.join('\n')
    : 'シート構成・必須ヘッダー・主要ID重複・IDRegistryに問題はありません。');
  return { ok: errors.length === 0, errors: errors };
}

function validateRequiredHeaders_(ss) {
  const defs = {};
  defs[BU1.SHEETS.GROUPS] = ['GroupID', 'GroupName', 'ColorHex', 'DisplayOrder'];
  defs[BU1.SHEETS.MEMBERS] = ['MemberID', 'GroupID', 'DisplayName', 'ColorHex', 'DisplayOrder'];
  defs[BU1.SHEETS.GUESTS] = ['GuestID', 'DisplayName'];
  defs[BU1.SHEETS.GROUP_MEMBERS] = ['GroupID', 'MemberID', 'DisplayOrder'];
  defs[BU1.SHEETS.PROFILES] = ['MemberID'];
  defs[BU1.SHEETS.SONGS] = ['SongID', 'Title', 'Artist', 'ReleaseDate', 'Form', 'CDTitle', 'IsTitleTrack'];
  defs[BU1.SHEETS.SONG_CREDITS] = ['SongID', 'Title', 'Lyricists', 'Composers', 'Choreographers'];
  defs[BU1.SHEETS.LYRICS_PARTS] = ['SongID', 'PartOrder', 'Singer', 'Lyrics'];
  defs[BU1.SHEETS.CARDS] = ['ImageID', 'TargetType', 'TargetID', 'Rarity', 'DriveFileID', 'DisplayOrder', 'IsProfileMain'];
  defs[BU1.SHEETS.TRANSFERS] = ['TransferID', 'SongID', 'PartOrder', 'FromMemberID', 'ToMemberID', 'TransferGroup'];
  const errors = [];
  Object.keys(defs).forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const header = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getDisplayValues()[0];
    defs[name].forEach(h => { if (header.indexOf(h) < 0) errors.push(name + ' に必須列「' + h + '」がありません'); });
  });
  return errors;
}

function validateUniqueIds_(ss) {
  const targets = [[BU1.SHEETS.GROUPS, 'GroupID'], [BU1.SHEETS.MEMBERS, 'MemberID'],
    [BU1.SHEETS.GUESTS, 'GuestID'], [BU1.SHEETS.SONGS, 'SongID'],
    [BU1.SHEETS.CARDS, 'ImageID'], [BU1.SHEETS.TRANSFERS, 'TransferID']];
  const errors = [];
  targets.forEach(t => {
    const table = readTable_(requireSheet_(ss, t[0]));
    const idx = table.map[t[1]];
    if (idx == null) return;
    const seen = {};
    table.rows.forEach(r => {
      const key = id_(r.values[idx]);
      if (!key) return;
      if (seen[key]) errors.push(t[0] + ' の' + t[1] + 'が重複: ' + key);
      seen[key] = true;
    });
  });
  return errors;
}

function withDocumentLock_(label, fn) {
  const lock = LockService.getDocumentLock();
  if (!lock || !lock.tryLock(10000)) throw new Error(label + ': 別の更新処理が実行中です。');
  try { return fn(); } finally { lock.releaseLock(); }
}

function withSharedWriterLock_(label, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error(label + ': 別の更新処理が実行中です。');
  try { return fn(); } finally { lock.releaseLock(); }
}

function openCoreSpreadsheet_() { return SpreadsheetApp.openById(BU1.CORE_DB_ID); }

function requireSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('シート「' + name + '」がありません');
  return sheet;
}

function readTable_(sheet, headerRow) {
  headerRow = headerRow || 1;
  const lastRow = Math.max(headerRow, sheet.getLastRow());
  const lastCol = Math.max(1, sheet.getLastColumn());
  const range = sheet.getRange(headerRow, 1, lastRow - headerRow + 1, lastCol);
  const values = range.getValues();
  const display = range.getDisplayValues();
  const header = display[0] || [];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    rows.push({ rowNumber: headerRow + i, values: values[i], displayValues: display[i] });
  }
  return { sheet: sheet, headerRow: headerRow, header: header,
    map: headerMap_(header), rows: rows, values: values, display: display };
}

function headerMap_(header) {
  const map = {};
  header.forEach((value, i) => { const key = clean_(value); if (key && map[key] == null) map[key] = i; });
  return map;
}

function requireColumns_(table, names) {
  names.forEach(name => { if (table.map[name] == null) throw new Error(table.sheet.getName() + ' に列「' + name + '」がありません'); });
  return table.map;
}

function clean_(value) { return value == null ? '' : String(value).replace(/\r\n?/g, '\n').trim(); }
function id_(value) { return clean_(value).replace(/\.0$/, ''); }
function sameText_(a, b) { return clean_(a) === clean_(b); }

function normalizeHex_(value) {
  const text = clean_(value);
  if (!text) return '';
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) throw new Error('ColorHex「' + text + '」は #RRGGBB 形式ではありません');
  return text.toUpperCase();
}

function normalizeDateForSheet_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const text = clean_(value);
  if (!text) return '';
  const normalized = text.replace(/年|\//g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/\s+/g, '');
  const m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) throw new Error('日付「' + text + '」を解析できません');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) throw new Error('日付「' + text + '」が不正です');
  return d;
}

function displayDate_(value) {
  if (!value) return '';
  return Utilities.formatDate(normalizeDateForSheet_(value), 'Asia/Tokyo', 'yyyy-MM-dd');
}

function idRegistryTable_() {
  const ss = SpreadsheetApp.openById(BU1.LOG_DB_ID);
  const sheet = ss.getSheetByName(BU1.ID_REGISTRY_SHEET);
  if (!sheet) throw new Error('BMSG_ Universe_Log に IDRegistry シートがありません');
  const table = readTable_(sheet);
  requireColumns_(table, BU_ID_REGISTRY_HEADERS_);
  return table;
}

function resolveIssueSpec_(ss, key) {
  let m;
  if (key === 'NEXT_GROUP_ID') {
    return { entity:'GROUP', scope:'GLOBAL', liveMax:maxNumericColumn_(requireSheet_(ss, BU1.SHEETS.GROUPS), 'GroupID') };
  }
  if ((m = String(key).match(/^NEXT_MEMBER_ID_(\d+)$/))) {
    const band = Number(m[1]);
    return { entity:'MEMBER', scope:String(band), liveMax:maxNumericColumnInBand_(requireSheet_(ss, BU1.SHEETS.MEMBERS), 'MemberID', band, band + 99) };
  }
  if (key === 'NEXT_GUEST_ID') {
    return { entity:'GUEST', scope:'GLOBAL', liveMax:maxNumericColumn_(requireSheet_(ss, BU1.SHEETS.GUESTS), 'GuestID') };
  }
  if ((m = String(key).match(/^NEXT_SONG_ID_(\d+)$/))) {
    const band = Number(m[1]);
    return { entity:'SONG', scope:String(band), liveMax:maxNumericColumnInBand_(requireSheet_(ss, BU1.SHEETS.SONGS), 'SongID', band, band + 999) };
  }
  if (key === 'NEXT_PROFILE_ID') {
    return { entity:'PROFILE', scope:'GLOBAL', liveMax:maxProfileNumber_(ss), formatter:function(n){ return 'P' + padNumber_(n, 3); } };
  }
  if (key === 'NEXT_IMAGE_ID') throw new Error('ImageIDはBMSG-PJの画像管理だけが発行します。');
  if (key === 'NEXT_TRANSFER_ID') throw new Error('11_PartTransfersは完全手動管理です。TransferIDは自動採番しません。');
  throw new Error('未対応の採番キーです: ' + key);
}

function maxNumericColumn_(sheet, headerName) {
  const table = readTable_(sheet), col = table.map[headerName];
  if (col == null) throw new Error(sheet.getName() + ' に列「' + headerName + '」がありません');
  return table.rows.reduce(function(max,row){ const n=Number(id_(row.values[col])); return Number.isFinite(n)?Math.max(max,n):max; }, 0);
}

function maxNumericColumnInBand_(sheet, headerName, min, maxAllowed) {
  const table = readTable_(sheet), col = table.map[headerName];
  if (col == null) throw new Error(sheet.getName() + ' に列「' + headerName + '」がありません');
  return table.rows.reduce(function(max,row){
    const n=Number(id_(row.values[col]));
    return Number.isFinite(n) && n >= min && n <= maxAllowed ? Math.max(max,n) : max;
  }, min - 1);
}

function maxProfileNumber_(ss) {
  let max = 0;
  const profiles = requireSheet_(ss, BU1.SHEETS.PROFILES);
  const headers = profiles.getRange(1,1,1,Math.max(1,profiles.getLastColumn())).getDisplayValues()[0];
  headers.forEach(function(value){ const m=String(value||'').trim().match(/^P(\d+)$/i); if(m) max=Math.max(max,Number(m[1])); });
  try {
    const log = SpreadsheetApp.openById(BU1.LOG_DB_ID).getSheetByName('ProfileSettings');
    if (log) {
      const values = log.getDataRange().getDisplayValues();
      const col = (values[0] || []).indexOf('ProfileID');
      if (col >= 0) values.slice(1).forEach(function(row){ const m=String(row[col]||'').trim().match(/^P(\d+)$/i); if(m) max=Math.max(max,Number(m[1])); });
    }
  } catch (e) {}
  return max;
}

function reserveNumberForKey_(ss, key, source, note) {
  const spec = resolveIssueSpec_(ss, key);
  const table = idRegistryTable_();
  let registryMax = 0;
  table.rows.forEach(function(row){
    if (clean_(row.values[table.map.EntityType]).toUpperCase() !== spec.entity) return;
    if (clean_(row.values[table.map.Scope]) !== spec.scope) return;
    const n = Number(row.values[table.map.NumericValue]);
    if (Number.isFinite(n)) registryMax = Math.max(registryMax, n);
  });
  const numeric = Math.max(spec.liveMax || 0, registryMax) + 1;
  const issuedId = spec.formatter ? spec.formatter(numeric) : String(numeric);
  const requestId = Utilities.getUuid();
  const now = new Date().toISOString();
  const values = new Array(table.header.length).fill('');
  values[table.map.EntityType] = spec.entity;
  values[table.map.Scope] = spec.scope;
  values[table.map.IssuedID] = issuedId;
  values[table.map.NumericValue] = numeric;
  values[table.map.Status] = 'RESERVED';
  values[table.map.RequestID] = requestId;
  values[table.map.Source] = source || 'BMSG-DB';
  values[table.map.IssuedAt] = now;
  values[table.map.UpdatedAt] = now;
  values[table.map.Note] = note || '';
  const rowNumber = appendStyledRow_(table.sheet, values);
  return { key:key, entityType:spec.entity, scope:spec.scope, issuedId:issuedId, numericValue:numeric, requestId:requestId, rowNumber:rowNumber };
}

function finalizeIdReservation_(reservation, committed, note) {
  if (!reservation || !reservation.requestId) return;
  const table = idRegistryTable_();
  const row = table.rows.find(function(r){ return clean_(r.values[table.map.RequestID]) === reservation.requestId; });
  if (!row) throw new Error('IDRegistryの予約情報を確認できません: ' + reservation.requestId);
  table.sheet.getRange(row.rowNumber, table.map.Status + 1).setValue(committed ? 'COMMITTED' : 'ABORTED');
  table.sheet.getRange(row.rowNumber, table.map.UpdatedAt + 1).setValue(new Date().toISOString());
  if (note != null) table.sheet.getRange(row.rowNumber, table.map.Note + 1).setValue(String(note));
}

function issueNumber_(ss, key) {
  return withSharedWriterLock_('ID採番', function(){
    const reservation = reserveNumberForKey_(ss, key, 'BMSG-DB_LEGACY', '旧管理ルートからの採番');
    finalizeIdReservation_(reservation, true, '旧管理ルートで発行済み');
    return reservation.numericValue;
  });
}

function confirm_(title, body) {
  return SpreadsheetApp.getUi().alert(title, body, SpreadsheetApp.getUi().ButtonSet.YES_NO) === SpreadsheetApp.getUi().Button.YES;
}
function alert_(title, body) { SpreadsheetApp.getUi().alert(title, body, SpreadsheetApp.getUi().ButtonSet.OK); }

function writeRows_(sheet, startRow, startColumn, rows) {
  if (rows.length) sheet.getRange(startRow, startColumn, rows.length, rows[0].length).setValues(rows);
}

function copyColumnPresentation_(sheet, sourceCol, targetCol) {
  if (!sourceCol || !targetCol || sourceCol === targetCol) return;
  const rows = sheet.getMaxRows();
  const src = sheet.getRange(1, sourceCol, rows, 1);
  const dst = sheet.getRange(1, targetCol, rows, 1);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  sheet.setColumnWidth(targetCol, sheet.getColumnWidth(sourceCol));
}

function copyRowPresentation_(sheet, sourceRow, targetRow) {
  if (!sourceRow || !targetRow || sourceRow === targetRow) return;
  const cols = Math.max(1, sheet.getLastColumn());
  const src = sheet.getRange(sourceRow, 1, 1, cols);
  const dst = sheet.getRange(targetRow, 1, 1, cols);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  sheet.setRowHeight(targetRow, sheet.getRowHeight(sourceRow));
}

function ensureSheetRows_(sheet, requiredLastRow) {
  const maxRows = sheet.getMaxRows();
  if (requiredLastRow > maxRows) sheet.insertRowsAfter(maxRows, requiredLastRow - maxRows);
}

function ensureSheetColumns_(sheet, requiredLastCol) {
  const maxCols = sheet.getMaxColumns();
  if (requiredLastCol > maxCols) sheet.insertColumnsAfter(maxCols, requiredLastCol - maxCols);
}

function appendStyledRow_(sheet, values, templateRow) {
  const targetRow = sheet.getLastRow() + 1;
  ensureSheetRows_(sheet, targetRow);
  const sourceRow = templateRow || Math.max(2, targetRow - 1);
  if (sourceRow < targetRow && sourceRow <= sheet.getMaxRows()) copyRowPresentation_(sheet, sourceRow, targetRow);
  sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
  expandBasicFilter_(sheet, targetRow, sheet.getLastColumn());
  return targetRow;
}

function expandBasicFilter_(sheet, requiredLastRow, requiredLastCol) {
  const filter = sheet.getFilter();
  if (!filter) return;
  const range = filter.getRange();
  const startRow = range.getRow();
  const startCol = range.getColumn();
  const lastRow = Math.max(range.getLastRow(), requiredLastRow || range.getLastRow());
  const lastCol = Math.max(range.getLastColumn(), requiredLastCol || range.getLastColumn());
  if (lastRow === range.getLastRow() && lastCol === range.getLastColumn()) return;
  const criteria = [];
  for (let c = startCol; c <= range.getLastColumn(); c++) {
    const criterion = filter.getColumnFilterCriteria(c);
    if (criterion) criteria.push({ col: c, criterion: criterion });
  }
  filter.remove();
  sheet.getRange(startRow, startCol, lastRow - startRow + 1, lastCol - startCol + 1).createFilter();
  const newFilter = sheet.getFilter();
  criteria.forEach(x => newFilter.setColumnFilterCriteria(x.col, x.criterion));
}

function clearDataRows_(sheet, startRow, columns) {
  const last = sheet.getLastRow();
  if (last >= startRow) sheet.getRange(startRow, 1, last - startRow + 1, columns).clearContent();
}

function buildNameIndex_(rows, nameGetter) {
  const byName = {};
  rows.forEach(row => {
    const name = clean_(nameGetter(row));
    if (!name) return;
    if (!byName[name]) byName[name] = [];
    byName[name].push(row);
  });
  return byName;
}

function padNumber_(value, width) { return String(value).padStart(width, '0'); }
