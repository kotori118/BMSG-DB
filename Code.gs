/**
 * BMSG Universe 管理GAS v1.0
 * 共通設定・メニュー・安全な読書きヘルパー
 *
 * このGASが書き込むのは、紐付け先の「BMSG Universe」だけ。
 * 旧サービス用Spreadsheet/GASへは書き込まない。
 */

const BU1 = Object.freeze({
  VERSION: '1.0.4',
  SHEETS: Object.freeze({
    GUIDE: '00_管理ガイド', INPUT_LYRICS: '入力_歌詞',
    INPUT_PROFILE: '入力_プロフィール', INPUT_MEMBERSHIP: '入力_所属',
    CONFIG: '00_Config', GROUPS: '01_Groups', MEMBERS: '02_Members',
    GUESTS: '03_Guests', GROUP_MEMBERS: '04_GroupMembers',
    PROFILES: '05_Profiles', SONGS: '06_Songs', SONG_CREDITS: '07_SongCredits',
    LYRICS_PARTS: '08_LyricsParts', CARDS: '09_Cards',
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
  SPECIAL_SINGERS: Object.freeze({ '99': 'ALL', '109': '' }),
});

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
  alert_('BMSG Universe 構成検証', errors.length
    ? errors.join('\n')
    : 'シート構成・必須ヘッダー・主要ID重複に問題はありません。');
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
  defs[BU1.SHEETS.CARDS] = ['CardID', 'MemberID', 'Rarity', 'DriveFileID', 'DisplayOrder'];
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
    [BU1.SHEETS.CARDS, 'CardID'], [BU1.SHEETS.TRANSFERS, 'TransferID']];
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
  if (!lock.tryLock(10000)) throw new Error(label + ': 別の更新処理が実行中です。');
  try { return fn(); } finally { lock.releaseLock(); }
}

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

function configTable_(ss) {
  const table = readTable_(requireSheet_(ss, BU1.SHEETS.CONFIG));
  requireColumns_(table, ['Key', 'Value', 'ValueType', 'Description']);
  const byKey = {};
  table.rows.forEach(row => { const key = clean_(row.values[table.map.Key]); if (key) byKey[key] = row; });
  table.byKey = byKey;
  return table;
}

function getConfig_(ss, key, fallback) {
  const table = configTable_(ss);
  const row = table.byKey[key];
  return row ? row.values[table.map.Value] : fallback;
}

function setConfig_(ss, key, value) {
  const table = configTable_(ss);
  const row = table.byKey[key];
  if (!row) throw new Error('00_Configに「' + key + '」がありません');
  table.sheet.getRange(row.rowNumber, table.map.Value + 1).setValue(value);
  if (table.map.UpdatedAt != null) table.sheet.getRange(row.rowNumber, table.map.UpdatedAt + 1).setValue(new Date());
}

function issueNumber_(ss, key) {
  const current = Number(getConfig_(ss, key, 0));
  if (!Number.isFinite(current) || current <= 0) throw new Error('00_Config.' + key + 'が正しい番号ではありません');
  setConfig_(ss, key, current + 1);
  return current;
}

function confirm_(title, body) {
  return SpreadsheetApp.getUi().alert(title, body, SpreadsheetApp.getUi().ButtonSet.YES_NO) === SpreadsheetApp.getUi().Button.YES;
}
function alert_(title, body) { SpreadsheetApp.getUi().alert(title, body, SpreadsheetApp.getUi().ButtonSet.OK); }

function writeRows_(sheet, startRow, startColumn, rows) {
  if (rows.length) sheet.getRange(startRow, startColumn, rows.length, rows[0].length).setValues(rows);
}

/**
 * 行・列を追加したとき、既存シートの見た目と入力規則を継承する。
 * 値はコピーしない。
 */
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

/** Basic filter の条件を保持したまま、新しい行・列まで範囲を広げる。 */
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
