/** Part-transfer validation. Performance-metrics storage has been retired. */
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
  blockLegacySheetWrite_('旧パート移行削除');
  const ss = SpreadsheetApp.getActiveSpreadsheet(), sheet = ss.getActiveSheet();
  if (sheet.getName() !== BU1.SHEETS.TRANSFERS || sheet.getActiveRange().getRow() < 2) { alert_('削除', '11_PartTransfersの対象行を選択してください。'); return; }
  if (confirm_('パート移行を削除', sheet.getActiveRange().getRow() + '行目を削除しますか？')) sheet.deleteRow(sheet.getActiveRange().getRow());
}
