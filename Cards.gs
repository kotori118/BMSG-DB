/** Drive画像名「アーティスト名_レアリティ.ext」→ 09_Cards */
function syncCardsNow() { const r = syncCardsOnAccess_(); alert_('カード同期', '更新: ' + r.updated + '件 / 保留: ' + r.warnings + '件'); }
function syncCardsOnAccessSafe_() { try { return syncCardsOnAccess_(); } catch (e) { console.error(e); return { ok: false, error: String(e) }; } }
function syncCardsOnAccess_() {
  const lock = LockService.getDocumentLock(); if (!lock.tryLock(3000)) return { ok: true, skipped: true, updated: 0, warnings: 0 };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const folderId = clean_(getConfig_(ss, 'card_image_folder_id', getConfig_(ss, 'CARD_IMAGE_FOLDER_ID', '')));
    if (!folderId) throw new Error('00_Configにカード画像フォルダIDがありません');
    const members = readTable_(requireSheet_(ss, BU1.SHEETS.MEMBERS));
    const byName = buildNameIndex_(members.rows, r => r.values[members.map.DisplayName]); const filesByKey = {}, allImageIds = {};
    const files = DriveApp.getFolderById(folderId).getFiles();
    while (files.hasNext()) {
      const file = files.next(); if (String(file.getMimeType()).indexOf('image/') !== 0) continue; allImageIds[file.getId()] = true;
      const m = file.getName().match(/^\[(SSR|SR|R|N)\](.*?)\(([^()]+)\)/i); if (!m) { console.warn('カード名が規格外: ' + file.getName()); continue; }
      const matches = byName[clean_(m[2])] || []; if (matches.length !== 1) { console.warn('カード名を特定不能: ' + file.getName()); continue; }
      const key = id_(matches[0].values[members.map.MemberID]) + '|' + m[1].toUpperCase();
      if (!filesByKey[key]) filesByKey[key] = []; filesByKey[key].push(file.getId());
    }
    const cards = readTable_(requireSheet_(ss, BU1.SHEETS.CARDS)); requireColumns_(cards, ['CardID', 'MemberID', 'Rarity', 'DriveFileID', 'DisplayOrder']);
    let updated = 0, warnings = 0;
    cards.rows.forEach(r => {
      const key = id_(r.values[cards.map.MemberID]) + '|' + clean_(r.values[cards.map.Rarity]).toUpperCase();
      const ids = filesByKey[key] || [], current = clean_(r.values[cards.map.DriveFileID]); let next = current;
      if (!ids.length) next = current && allImageIds[current] ? current : ''; else if (ids.length === 1) next = ids[0]; else if (current && ids.indexOf(current) >= 0) next = current;
      else { warnings++; console.warn('カード画像が複数で判断保留: ' + key); return; }
      if (next !== current) { cards.sheet.getRange(r.rowNumber, cards.map.DriveFileID + 1).setValue(next); updated++; }
    });
    return { ok: true, updated: updated, warnings: warnings };
  } finally { lock.releaseLock(); }
}
function ensureCardRowsForMember_(ss, memberId, displayOrder) {
  const sheet = requireSheet_(ss, BU1.SHEETS.CARDS), table = readTable_(sheet);
  BU1.CARD_RARITIES.forEach((rarity, i) => {
    const exists = table.rows.some(r => id_(r.values[table.map.MemberID]) === String(memberId) && clean_(r.values[table.map.Rarity]) === rarity);
    if (!exists) appendStyledRow_(sheet, [issueNumber_(ss, 'NEXT_CARD_ID'), memberId, rarity, '', (Number(displayOrder) - 1) * 4 + i + 1]);
  });
}
