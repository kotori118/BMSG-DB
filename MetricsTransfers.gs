
/**
 * New-song writer only: append a single metrics row instead of clearing and
 * rebuilding the entire two-header performance table.
 * Calling code already holds withSharedWriterLock_.
 * Returns the newly appended row for writer rollback, or null if present.
 */
function ensurePerformanceMetricRowForSong_(ss, songId) {
  const sheet=requireSheet_(ss,BU1.SHEETS.METRICS);
  const id=id_(songId);
  if(!id)throw new Error('秒数行のSongIDがありません。');
  const last=sheet.getLastRow();
  const ids=last>=3?sheet.getRange(3,1,last-2,1).getValues():[];
  const found=[];
  ids.forEach(function(row,index){if(id_(row[0])===id)found.push(index+3);});
  if(found.length>1)throw new Error('10_PerformanceMetricsにSongID重複: '+id);
  if(found.length===1)return {created:false,row:found[0]};
  const cols=Math.max(13,sheet.getLastColumn());
  const vals=new Array(cols).fill('');
  vals[0]=id;
  const added=appendStyledRow_(sheet,vals);
  if(id_(sheet.getRange(added,1).getValue())!==id)throw new Error('秒数行の保存照合に失敗しました: '+id);
  return {created:true,row:added,sheet:sheet};
}

function syncPerformanceMetricRows(optionalSs, silent) {
  blockLegacySheetWrite_('秒数表の旧全表同期');
  const ss = optionalSs && optionalSs.getSheets ? optionalSs : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = requireSheet_(ss, BU1.SHEETS.METRICS), songs = readTable_(requireSheet_(ss, BU1.SHEETS.SONGS));
  const target = songs.rows.filter(r => universeServiceBeFirst_(songs,r));
  const lastCol = Math.max(2, sheet.getLastColumn()), old = sheet.getRange(1, 1, Math.max(3, sheet.getLastRow()), lastCol).getValues(), byId = {};
  for (let r = 2; r < old.length; r++) if (id_(old[r][0])) byId[id_(old[r][0])] = old[r];
  const rows = target.map(r => { const sid = id_(r.values[songs.map.SongID]), prev = byId[sid] || []; const row = [sid].concat(prev.slice(1, lastCol)); while (row.length < lastCol) row.push(''); return row; });
  if (sheet.getLastRow() > 3) sheet.getRange(3, 1, sheet.getLastRow() - 2, lastCol).clearContent(); writeRows_(sheet, 3, 1, rows);
  if (!silent) alert_('秒数表同期', 'BE:FIRST ' + rows.length + '曲の行を同期しました。');
}

