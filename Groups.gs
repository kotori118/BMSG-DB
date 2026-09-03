/** 入力_所属 → 01_Groups / 04_GroupMembers */
function confirmAndSyncMemberships() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  withDocumentLock_('所属同期', function () {
    const plan = buildMembershipPlan_(ss);
    if (plan.errors.length) { alert_('所属同期を中止しました', plan.errors.join('\n')); return; }
    const msg = ['グループ: ' + plan.groups.length + '件', '所属: ' + plan.memberships.length + '件',
      '新規グループ: ' + plan.newGroups.length + '件', '', 'この内容で保存しますか？'].join('\n');
    if (!confirm_('所属変更の確認', msg)) return;
    applyMembershipPlan_(ss, plan);
    alert_('所属同期完了', 'グループと所属を保存しました。');
  });
}

function buildMembershipPlan_(ss) {
  const input = requireSheet_(ss, BU1.SHEETS.INPUT_MEMBERSHIP);
  const members = readTable_(requireSheet_(ss, BU1.SHEETS.MEMBERS));
  const groupsDb = readTable_(requireSheet_(ss, BU1.SHEETS.GROUPS));
  requireColumns_(members, ['MemberID', 'DisplayName']);
  const byName = buildNameIndex_(members.rows, r => r.values[members.map.DisplayName]);
  const knownGroupIds = {};
  groupsDb.rows.forEach(r => { knownGroupIds[id_(r.values[groupsDb.map.GroupID])] = true; });
  const values = input.getRange(1, 1, Math.max(7, input.getLastRow()), input.getLastColumn()).getDisplayValues();
  const groups = [], memberships = [], newGroups = [], errors = [], seenNames = {}, seenIds = {};
  for (let c = 1; c < input.getLastColumn(); c++) {
    const groupId = id_(values[3][c]); const name = clean_(values[4][c]); const colorRaw = clean_(values[5][c]);
    if (!groupId && !name && !colorRaw) continue;
    if (!name) { errors.push((c + 1) + '列目: グループ名が空欄です'); continue; }
    if (seenNames[name]) errors.push('グループ名が重複しています: ' + name); seenNames[name] = true;
    if (groupId && !knownGroupIds[groupId]) errors.push(name + ': 未知のGroupID ' + groupId);
    if (groupId && seenIds[groupId]) errors.push('GroupIDが重複しています: ' + groupId); seenIds[groupId] = true;
    let color = ''; try { color = normalizeHex_(colorRaw); } catch (e) { errors.push(name + ': ' + e.message); }
    const group = { col: c + 1, groupId: groupId, name: name, color: color, order: groups.length + 1 };
    groups.push(group); if (!groupId) newGroups.push(group);
    for (let r = 6; r < values.length; r++) {
      const memberName = clean_(values[r][c]); if (!memberName) continue;
      const matches = byName[memberName] || [];
      if (matches.length !== 1) { errors.push(name + ' / ' + (r + 1) + '行目: 「' + memberName + '」を一意に特定できません'); continue; }
      memberships.push({ group: group, memberId: id_(matches[0].values[members.map.MemberID]), order: r - 5 });
    }
  }
  const desiredIds = {}; groups.forEach(g => { if (g.groupId) desiredIds[g.groupId] = true; });
  const songs = readTable_(requireSheet_(ss, BU1.SHEETS.SONGS));
  groupsDb.rows.forEach(r => {
    const gid = id_(r.values[groupsDb.map.GroupID]); if (!gid || desiredIds[gid]) return;
    const name = clean_(r.values[groupsDb.map.GroupName]);
    if (songs.rows.some(s => clean_(s.values[songs.map.Artist]) === name)) errors.push('グループ「' + name + '」は06_Songsで使用中のため削除できません');
  });
  return { groups: groups, memberships: memberships, newGroups: newGroups, errors: errors };
}

function applyMembershipPlan_(ss, plan) {
  const input = requireSheet_(ss, BU1.SHEETS.INPUT_MEMBERSHIP);
  plan.newGroups.forEach(g => { g.groupId = String(issueNumber_(ss, 'NEXT_GROUP_ID')); input.getRange(4, g.col).setValue(g.groupId); });
  const groupsSheet = requireSheet_(ss, BU1.SHEETS.GROUPS);
  const gmSheet = requireSheet_(ss, BU1.SHEETS.GROUP_MEMBERS);
  clearDataRows_(groupsSheet, 2, 4); clearDataRows_(gmSheet, 2, 3);
  writeRows_(groupsSheet, 2, 1, plan.groups.map(g => [g.groupId, g.name, g.color, g.order]));
  writeRows_(gmSheet, 2, 1, plan.memberships.map(m => [m.group.groupId, m.memberId, m.order]));
  groupsSheet.getRange(1, 1, groupsSheet.getMaxRows(), 4).setBackground(BU1.COLORS.AUTO);
  gmSheet.getRange(1, 1, gmSheet.getMaxRows(), 3).setBackground(BU1.COLORS.AUTO);
  keepThreeEmptyMembershipColumns_(input);
}

function keepThreeEmptyMembershipColumns_(sheet) {
  const FIXED_COLUMNS = 1;
  const EMPTY_COLUMNS = 3;
  const GROUP_ID_ROW = 4;
  const GROUP_NAME_ROW = 5;
  const COLOR_ROW = 6;

  let lastCol = sheet.getLastColumn();
  let values = sheet.getRange(1, 1, Math.max(COLOR_ROW, sheet.getLastRow()), lastCol).getDisplayValues();
  let templateCol = 0;
  let empty = 0;

  for (let c = FIXED_COLUMNS; c < lastCol; c++) {
    const hasGroup = clean_(values[GROUP_ID_ROW - 1][c]) || clean_(values[GROUP_NAME_ROW - 1][c]) || clean_(values[COLOR_ROW - 1][c]);
    if (hasGroup) templateCol = c + 1;
    else empty++;
  }
  if (!templateCol) templateCol = Math.min(lastCol, FIXED_COLUMNS + 1);

  const need = Math.max(0, EMPTY_COLUMNS - empty);
  if (need > 0) {
    sheet.insertColumnsAfter(lastCol, need);
    lastCol += need;
  }

  values = sheet.getRange(1, 1, Math.max(COLOR_ROW, sheet.getLastRow()), lastCol).getDisplayValues();
  for (let c = FIXED_COLUMNS; c < lastCol; c++) {
    const hasGroup = clean_(values[GROUP_ID_ROW - 1][c]) || clean_(values[GROUP_NAME_ROW - 1][c]) || clean_(values[COLOR_ROW - 1][c]);
    if (hasGroup) continue;
    copyColumnPresentation_(sheet, templateCol, c + 1);
    sheet.getRange(GROUP_ID_ROW, c + 1).clearContent();
    sheet.getRange(GROUP_NAME_ROW, c + 1).clearContent();
    sheet.getRange(COLOR_ROW, c + 1).clearContent();
    if (sheet.getMaxRows() >= 7) sheet.getRange(7, c + 1, sheet.getMaxRows() - 6, 1).clearContent();
  }
}
