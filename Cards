/**
 * 09_Images 修復用。
 * 通常の画像登録・行作成・ImageID発行は BMSG Universe の SETTINGS > 画像管理を正規入口とする。
 * BMSG-DB側は既存09_Images行とDriveファイルの紐付け修復だけを行い、新規ImageIDは発行しない。
 */
function syncCardsNow() {
  const r = syncCardsOnAccess_();
  alert_('画像データ修復', '更新: ' + r.updated + '件 / 判断保留: ' + r.warnings + '件');
}

function syncCardsOnAccessSafe_() {
  try { return syncCardsOnAccess_(); }
  catch (e) { console.error(e); return { ok: false, error: String(e) }; }
}

function syncCardsOnAccess_() {
  const lock = LockService.getDocumentLock();
  if (!lock || !lock.tryLock(3000)) return { ok: true, skipped: true, updated: 0, warnings: 0 };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const folderId = clean_(BU1.CARD_IMAGE_FOLDER_ID);
    if (!folderId) throw new Error('カード画像フォルダIDを確認できません');

    const members = readTable_(requireSheet_(ss, BU1.SHEETS.MEMBERS));
    requireColumns_(members, ['MemberID', 'GroupID', 'DisplayName', 'DisplayOrder']);
    const groups = readTable_(requireSheet_(ss, BU1.SHEETS.GROUPS));
    requireColumns_(groups, ['GroupID', 'GroupName']);
    const groupNameById = {};
    groups.rows.forEach(r => { groupNameById[id_(r.values[groups.map.GroupID])] = clean_(r.values[groups.map.GroupName]); });
    const byName = buildNameIndex_(members.rows, r => r.values[members.map.DisplayName]);

    const filesByKey = {}, allImageIds = {};
    const files = DriveApp.getFolderById(folderId).getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (String(file.getMimeType()).indexOf('image/') !== 0) continue;
      allImageIds[file.getId()] = true;
      const m = file.getName().match(/^\[(SSR|SR|R|N)\](.*?)\(([^()]+)\)(?:\.[^.]+)?$/i);
      if (!m) { console.warn('カード名が規格外: ' + file.getName()); continue; }
      const matches = byName[clean_(m[2])] || [];
      if (matches.length !== 1) { console.warn('カード名を特定不能: ' + file.getName()); continue; }
      const memberRow = matches[0];
      const memberId = id_(memberRow.values[members.map.MemberID]);
      const expectedGroup = /^5/.test(memberId)
        ? 'BMSG POSSE'
        : (groupNameById[id_(memberRow.values[members.map.GroupID])] || '');
      if (clean_(m[3]) !== expectedGroup) { console.warn('カードのグループ表記が不一致: ' + file.getName()); continue; }
      const key = memberId + '|' + m[1].toUpperCase();
      if (!filesByKey[key]) filesByKey[key] = [];
      filesByKey[key].push(file.getId());
    }

    const images = readTable_(requireSheet_(ss, BU1.SHEETS.CARDS));
    requireColumns_(images, ['ImageID', 'TargetType', 'TargetID', 'Rarity', 'DriveFileID', 'DisplayOrder', 'IsProfileMain']);
    let updated = 0, warnings = 0;
    images.rows.forEach(r => {
      if (clean_(r.values[images.map.TargetType]).toLowerCase() !== 'member') return;
      const rarity = clean_(r.values[images.map.Rarity]).toUpperCase();
      if (BU1.CARD_RARITIES.indexOf(rarity) < 0) return;
      const key = id_(r.values[images.map.TargetID]) + '|' + rarity;
      const ids = filesByKey[key] || [];
      const current = clean_(r.values[images.map.DriveFileID]);
      let next = current;
      if (!ids.length) next = current && allImageIds[current] ? current : '';
      else if (ids.length === 1) next = ids[0];
      else if (current && ids.indexOf(current) >= 0) next = current;
      else { warnings++; console.warn('カード画像が複数で判断保留: ' + key); return; }
      if (next !== current) {
        images.sheet.getRange(r.rowNumber, images.map.DriveFileID + 1).setValue(next);
        updated++;
      }
    });
    SpreadsheetApp.flush();
    return { ok: true, updated: updated, warnings: warnings };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 互換用。旧プロフィール同期から呼ばれてもDB側では行作成しない。
 * 画像行の不足はSETTINGS > 画像管理の「Driveから再同期」で補う。
 */
function ensureCardRowsForMember_(ss, memberId, displayOrder) {
  return { ok: true, skipped: true, memberId: String(memberId || '') };
}
