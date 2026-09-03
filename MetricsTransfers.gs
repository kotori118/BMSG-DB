function syncPerformanceMetricRows(optionalSs, silent) {
  const ss = optionalSs && optionalSs.getSheets ? optionalSs : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = requireSheet_(ss, BU1.SHEETS.METRICS), songs = readTable_(requireSheet_(ss, BU1.SHEETS.SONGS));
  const target = songs.rows.filter(r => clean_(r.values[songs.map.Artist]) === 'BE:FIRST');
  const lastCol = Math.max(2, sheet.getLastColumn()), old = sheet.getRange(1, 1, Math.max(3, sheet.getLastRow()), lastCol).getValues(), byId = {};
  for (let r = 2; r < old.length; r++) if (id_(old[r][0])) byId[id_(old[r][0])] = old[r];
  const rows = target.map(r => { const sid = id_(r.values[songs.map.SongID]), prev = byId[sid] || []; const row = [sid].concat(prev.slice(1, lastCol)); while (row.length < lastCol) row.push(''); return row; });
  if (sheet.getLastRow() > 3) sheet.getRange(3, 1, sheet.getLastRow() - 2, lastCol).clearContent(); writeRows_(sheet, 3, 1, rows);
  if (!silent) alert_('秒数表同期', 'BE:FIRST ' + rows.length + '曲の行を同期しました。');
}
function confirmAndSyncPartTransfers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(); withDocumentLock_('パート移行', function () {
    const t = readTable_(requireSheet_(ss, BU1.SHEETS.TRANSFERS)); requireColumns_(t, ['TransferID', 'SongID', 'PartOrder', 'FromMemberID', 'ToMemberID', 'TransferGroup']);
    const incomplete = t.rows.filter(r => r.values.some(v => clean_(v)) && (!id_(r.values[t.map.SongID]) || !id_(r.values[t.map.PartOrder]) || !id_(r.values[t.map.FromMemberID]) || !id_(r.values[t.map.ToMemberID])));
    if (incomplete.length) { alert_('パート移行を中止しました', '必須値が不足: ' + incomplete.map(r => r.rowNumber + '行').join(', ')); return; }
    const blanks = t.rows.filter(r => !id_(r.values[t.map.TransferID]) && r.values.some(v => clean_(v)));
    if (!confirm_('パート移行の確認', '新規ID採番: ' + blanks.length + '件\n保存しますか？')) return;
    blanks.forEach(r => t.sheet.getRange(r.rowNumber, t.map.TransferID + 1).setValue('PT' + padNumber_(issueNumber_(ss, 'NEXT_TRANSFER_ID'), 4)));
    alert_('パート移行', '確認・採番が完了しました。');
  });
}
function deleteSelectedPartTransfer() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), sheet = ss.getActiveSheet();
  if (sheet.getName() !== BU1.SHEETS.TRANSFERS || sheet.getActiveRange().getRow() < 2) { alert_('削除', '11_PartTransfersの対象行を選択してください。'); return; }
  if (confirm_('パート移行を削除', sheet.getActiveRange().getRow() + '行目を削除しますか？')) sheet.deleteRow(sheet.getActiveRange().getRow());
}
