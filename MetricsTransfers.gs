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

/**
 * 11_PartTransfers は完全手動管理。
 * この処理は必須値と重複だけを確認し、TransferIDを採番・変更しない。
 */
function confirmAndSyncPartTransfers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  withDocumentLock_('パート移行確認', function () {
    const t = readTable_(requireSheet_(ss, BU1.SHEETS.TRANSFERS));
    requireColumns_(t, ['TransferID', 'SongID', 'PartOrder', 'FromMemberID', 'ToMemberID', 'TransferGroup']);
    const errors = [];
    const seen = {};
    t.rows.forEach(r => {
      if (!r.values.some(v => clean_(v))) return;
      const transferId = id_(r.values[t.map.TransferID]);
      const songId = id_(r.values[t.map.SongID]);
      const partOrder = id_(r.values[t.map.PartOrder]);
      const fromId = id_(r.values[t.map.FromMemberID]);
      const toId = id_(r.values[t.map.ToMemberID]);
      if (!transferId || !songId || !partOrder || !fromId || !toId) errors.push(r.rowNumber + '行目: 必須値が不足しています');
      if (transferId) {
        if (seen[transferId]) errors.push('TransferIDが重複しています: ' + transferId);
        seen[transferId] = true;
      }
    });
    alert_('パート移行確認', errors.length ? errors.join('\n') : '11_PartTransfers に入力上の問題はありません。自動変更は行っていません。');
  });
}

function deleteSelectedPartTransfer() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), sheet = ss.getActiveSheet();
  if (sheet.getName() !== BU1.SHEETS.TRANSFERS || sheet.getActiveRange().getRow() < 2) { alert_('削除', '11_PartTransfersの対象行を選択してください。'); return; }
  if (confirm_('パート移行を削除', sheet.getActiveRange().getRow() + '行目を削除しますか？')) sheet.deleteRow(sheet.getActiveRange().getRow());
}
