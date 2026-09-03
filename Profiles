/** 入力_プロフィール → 02_Members / 05_Profiles */

const BU_PROFILE = Object.freeze({
  PROFILE_ID_ROW: 5,
  DATA_TYPE_ROW: 6,
  MULTI_ROW: 7,
  GROUP_ROW: 8,
  HEADER_ROW: 9,
  DATA_START_ROW: 10,
  FIXED_COLUMNS: 4,
  EMPTY_FIELD_COLUMNS: 3,
  LOG_DB_ID: '10vDKc_Q431iMDTTqB2A16i-Yp28oXSInoKiJXZtonRQ',
  PROFILE_SETTINGS_SHEET: 'ProfileSettings',
  PROFILE_SETTINGS_HEADERS: Object.freeze([
    'ProfileID', 'FieldName', 'DataType', 'IsMultiValue', 'DisplayGroup',
    'IsCompareTarget', 'QuizDifficulty', 'DisplayOrder', 'IsActive'
  ]),
});

function confirmAndSyncProfiles() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  withDocumentLock_('プロフィール同期', function() {
    const plan = buildProfileSyncPlan_(ss);
    if (plan.errors.length) {
      alert_('プロフィール同期を中止しました', plan.errors.join('\n'));
      return;
    }
    const summary = [
      '新規Member: ' + plan.newMembers.length + '件',
      'Member更新: ' + plan.memberUpdates.length + '件',
      'プロフィール更新: ' + plan.profileUpdates.length + '人',
      '新規プロフィール項目: ' + plan.newFields.length + '件',
      '削除候補: ' + plan.deletes.length + '件',
      '', '反映してよいですか？'
    ].join('\n');
    if (!confirm_('プロフィール変更確認', summary)) return;
    applyProfileSyncPlan_(ss, plan);
    SpreadsheetApp.flush();
    const verify = buildProfileSyncPlan_(ss);
    if (verify.errors.length || verify.newMembers.length || verify.memberUpdates.length ||
        verify.profileUpdates.length || verify.newFields.length || verify.deletes.length) {
      throw new Error('プロフィール反映後の再検証で差分が残りました: ' + verify.errors.concat([
        'new=' + verify.newMembers.length, 'member=' + verify.memberUpdates.length,
        'profile=' + verify.profileUpdates.length, 'field=' + verify.newFields.length,
        'delete=' + verify.deletes.length
      ]).join(' / '));
    }
    alert_('プロフィール同期完了', '変更を反映し、再読込検証まで完了しました。');
  });
}

function buildProfileSyncPlan_(ss) {
  const input = requireSheet_(ss, BU1.SHEETS.INPUT_PROFILE);
  const members = readTable_(requireSheet_(ss, BU1.SHEETS.MEMBERS));
  const profiles = readTable_(requireSheet_(ss, BU1.SHEETS.PROFILES));
  const groups = readTable_(requireSheet_(ss, BU1.SHEETS.GROUPS));
  requireColumns_(members, ['MemberID', 'GroupID', 'DisplayName', 'ColorHex', 'DisplayOrder']);
  requireColumns_(profiles, ['MemberID']);
  requireColumns_(groups, ['GroupID', 'GroupName']);

  const lastCol = Math.max(BU_PROFILE.FIXED_COLUMNS + 1, input.getLastColumn());
  const lastRow = Math.max(BU_PROFILE.DATA_START_ROW, input.getLastRow());
  const values = input.getRange(1, 1, lastRow, lastCol).getValues();
  const display = input.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const groupByName = {};
  groups.rows.forEach(r => { groupByName[clean_(r.values[groups.map.GroupName])] = id_(r.values[groups.map.GroupID]); });
  const memberById = {};
  const memberByName = {};
  members.rows.forEach(r => {
    const memberId = id_(r.values[members.map.MemberID]);
    const name = clean_(r.values[members.map.DisplayName]);
    if (memberId) memberById[memberId] = r;
    if (name) { if (!memberByName[name]) memberByName[name] = []; memberByName[name].push(r); }
  });
  const profileByMember = {};
  profiles.rows.forEach(r => { const memberId = id_(r.values[profiles.map.MemberID]); if (memberId) profileByMember[memberId] = r; });

  const fields = [];
  const newFields = [];
  for (let c = BU_PROFILE.FIXED_COLUMNS; c < lastCol; c++) {
    const profileId = clean_(display[BU_PROFILE.PROFILE_ID_ROW - 1][c]);
    const label = clean_(display[BU_PROFILE.HEADER_ROW - 1][c]);
    const dataType = clean_(display[BU_PROFILE.DATA_TYPE_ROW - 1][c]).toUpperCase() || 'TEXT';
    const isMulti = values[BU_PROFILE.MULTI_ROW - 1][c] === true;
    const inputGroup = clean_(display[BU_PROFILE.GROUP_ROW - 1][c]) || '基本';
    if (!profileId && !label) continue;
    if (!['TEXT', 'NUMBER', 'DATE'].includes(dataType)) {
      newFields.push({ error: '列' + (c + 1) + 'のDataType「' + dataType + '」は未対応です' });
      continue;
    }
    if (!profileId) {
      newFields.push({ col: c, label: label, dataType: dataType, isMulti: isMulti, inputGroup: inputGroup });
    } else {
      fields.push({ col: c, profileId: profileId, label: label, dataType: dataType, isMulti: isMulti, inputGroup: inputGroup });
    }
  }

  const errors = newFields.filter(f => f.error).map(f => f.error);
  const validNewFields = newFields.filter(f => !f.error);
  const labels = {};
  fields.concat(validNewFields).forEach(f => {
    if (!f.label) errors.push('プロフィール項目名が空欄の列があります');
    if (f.label && labels[f.label]) errors.push('プロフィール項目名が重複しています: ' + f.label);
    labels[f.label] = true;
  });

  const plan = { errors: errors, fields: fields, newFields: validNewFields,
    newMembers: [], memberUpdates: [], profileUpdates: [], deletes: [] };
  const usedNames = {};
  members.rows.forEach(r => { const n = clean_(r.values[members.map.DisplayName]); if (n) usedNames[n] = id_(r.values[members.map.MemberID]); });

  for (let r = BU_PROFILE.DATA_START_ROW - 1; r < values.length; r++) {
    const name = clean_(display[r][0]);
    const mainGroupName = clean_(display[r][1]);
    const memberId = id_(display[r][2]);
    const colorHexRaw = clean_(display[r][3]);
    const hasAny = display[r].some(v => clean_(v));
    if (!hasAny) continue;

    if (memberId && !memberById[memberId]) {
      plan.errors.push('入力_プロフィール ' + (r + 1) + '行目: 未知のMemberID ' + memberId);
      continue;
    }
    if (memberId && !name) {
      const refs = findMemberReferences_(ss, memberId);
      if (refs.length) plan.errors.push('MemberID ' + memberId + ' は ' + refs.join(' / ') + ' で使用中のため削除できません');
      else plan.deletes.push({ memberId: memberId });
      continue;
    }
    if (!name) { plan.errors.push('入力_プロフィール ' + (r + 1) + '行目: アーティスト名が空欄です'); continue; }
    const groupId = mainGroupName === 'ソロ・その他' ? '' : groupByName[mainGroupName];
    if (mainGroupName && mainGroupName !== 'ソロ・その他' && !groupId) {
      plan.errors.push(name + ': メイングループ「' + mainGroupName + '」が01_Groupsにありません');
      continue;
    }
    let colorHex = '';
    try { colorHex = normalizeHex_(colorHexRaw); } catch (e) { plan.errors.push(name + ': ' + e.message); continue; }
    if (usedNames[name] && usedNames[name] !== memberId) {
      plan.errors.push('アーティスト名が重複しています: ' + name);
      continue;
    }
    usedNames[name] = memberId || '__NEW__' + r;
    const item = { inputRow: r + 1, name: name, mainGroupName: mainGroupName,
      groupId: groupId || '', colorHex: colorHex, memberId: memberId,
      displayOrder: r - (BU_PROFILE.DATA_START_ROW - 1) + 1, profileValues: {} };
    fields.forEach(f => {
      try { item.profileValues[f.profileId] = normalizeProfileValue_(values[r][f.col], f); }
      catch (e) { plan.errors.push(name + ' / ' + f.label + ': ' + e.message); }
    });
    validNewFields.forEach(f => {
      try { item.profileValues['__COL_' + f.col] = normalizeProfileValue_(values[r][f.col], f); }
      catch (e) { plan.errors.push(name + ' / ' + f.label + ': ' + e.message); }
    });

    if (!memberId) {
      if (!mainGroupName) plan.errors.push(name + ': 新規Memberはメイングループが必要です');
      plan.newMembers.push(item);
    } else {
      const current = memberById[memberId];
      const currentMember = [id_(current.values[members.map.GroupID]), clean_(current.values[members.map.DisplayName]),
        clean_(current.values[members.map.ColorHex]).toUpperCase(), Number(current.values[members.map.DisplayOrder]) || 0];
      const desiredMember = [item.groupId, item.name, item.colorHex, item.displayOrder];
      if (JSON.stringify(currentMember) !== JSON.stringify(desiredMember)) plan.memberUpdates.push(item);
      const profileRow = profileByMember[memberId];
      let differs = !profileRow;
      if (profileRow) fields.forEach(f => {
        const col = profiles.map[f.profileId];
        if (col == null || normalizeStoredProfileValue_(profileRow.values[col], f) !== clean_(item.profileValues[f.profileId])) differs = true;
      });
      if (differs || validNewFields.length) plan.profileUpdates.push(item);
    }
  }
  return plan;
}

function normalizeProfileValue_(value, field) {
  const raw = clean_(value);
  if (!raw) return '';
  const parts = field.isMulti ? raw.split(/[\n、,]+/).map(clean_).filter(Boolean) : [raw];
  const normalized = parts.map(v => {
    if (field.dataType === 'NUMBER') {
      const n = Number(v); if (!Number.isFinite(n)) throw new Error('数値として解析できません: ' + v); return String(n);
    }
    if (field.dataType === 'DATE') {
      const d = normalizeDateForSheet_(v); return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/M/d');
    }
    return v;
  });
  return normalized.join('\n');
}

function normalizeStoredProfileValue_(value, field) {
  if (value == null || value === '') return '';
  if (field.dataType === 'DATE') {
    const d = normalizeDateForSheet_(value);
    return d ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/M/d') : '';
  }
  if (field.dataType === 'NUMBER') {
    const text = clean_(value);
    if (!text) return '';
    const n = Number(text);
    return Number.isFinite(n) ? String(n) : text;
  }
  if (field.isMulti) return clean_(value).split(/[\n、,]+/).map(clean_).filter(Boolean).join('\n');
  return clean_(value);
}

function getProfileSettingsTable_() {
  const logSs = SpreadsheetApp.openById(BU_PROFILE.LOG_DB_ID);
  const sheet = logSs.getSheetByName(BU_PROFILE.PROFILE_SETTINGS_SHEET);
  if (!sheet) throw new Error('BMSG_ Universe_Log に ProfileSettings シートがありません');
  const table = readTable_(sheet);
  requireColumns_(table, BU_PROFILE.PROFILE_SETTINGS_HEADERS);
  return table;
}

function nextProfileSettingsDisplayOrder_(table) {
  const col = table.map.DisplayOrder;
  let max = -1;
  table.rows.forEach(row => {
    const n = Number(row.values[col]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  });
  return max + 1;
}

function appendProfileSettingForNewField_(table, profileId, field, displayOrder) {
  const idCol = table.map.ProfileID;
  if (table.rows.some(row => id_(row.values[idCol]) === profileId)) {
    throw new Error('ProfileSettings に ' + profileId + ' がすでに存在します');
  }
  appendStyledRow_(table.sheet, [
    profileId,
    field.label,
    field.dataType,
    field.isMulti,
    field.inputGroup || '基本',
    false,
    '',
    displayOrder,
    true,
  ]);
}

function applyProfileSyncPlan_(ss, plan) {
  const input = requireSheet_(ss, BU1.SHEETS.INPUT_PROFILE);
  const membersSheet = requireSheet_(ss, BU1.SHEETS.MEMBERS);
  const profilesSheet = requireSheet_(ss, BU1.SHEETS.PROFILES);
  const fieldIdByInputCol = {};
  plan.fields.forEach(f => { fieldIdByInputCol[f.col] = f.profileId; });

  // 新規項目がある場合は、コアDBを書き始める前にLog側の構造を検証する。
  const profileSettings = plan.newFields.length ? getProfileSettingsTable_() : null;
  let nextSettingsOrder = profileSettings ? nextProfileSettingsDisplayOrder_(profileSettings) : 0;

  plan.newFields.forEach(f => {
    const no = issueNumber_(ss, 'NEXT_PROFILE_ID');
    const profileId = 'P' + padNumber_(no, 3);
    fieldIdByInputCol[f.col] = profileId;
    input.getRange(BU_PROFILE.PROFILE_ID_ROW, f.col + 1).setValue(profileId);

    const oldLastCol = profilesSheet.getLastColumn();
    const newCol = oldLastCol + 1;
    ensureSheetColumns_(profilesSheet, newCol);
    copyColumnPresentation_(profilesSheet, oldLastCol, newCol);
    profilesSheet.getRange(1, newCol).setValue(profileId);
    expandBasicFilter_(profilesSheet, profilesSheet.getLastRow(), newCol);

    appendProfileSettingForNewField_(profileSettings, profileId, f, nextSettingsOrder++);
  });

  let members = readTable_(membersSheet);
  let profiles = readTable_(profilesSheet);
  const groups = readTable_(requireSheet_(ss, BU1.SHEETS.GROUPS));
  const groupNames = {};
  groups.rows.forEach(r => { groupNames[id_(r.values[groups.map.GroupID])] = clean_(r.values[groups.map.GroupName]); });

  const allItems = [];
  plan.newMembers.forEach(item => {
    const band = BU1.MAIN_GROUP_BANDS[item.mainGroupName] || 500;
    const memberId = String(issueNumber_(ss, 'NEXT_MEMBER_ID_' + band));
    item.memberId = memberId;
    input.getRange(item.inputRow, 3).setValue(memberId);
    appendStyledRow_(membersSheet, [memberId, item.groupId, item.name, item.colorHex, item.displayOrder]);
    appendStyledRow_(profilesSheet, [memberId]);
    ensureMainMembership_(ss, item.groupId, memberId);
    ensureCardRowsForMember_(ss, memberId, item.displayOrder);
    allItems.push(item);
  });
  plan.memberUpdates.forEach(item => allItems.push(item));
  plan.profileUpdates.forEach(item => { if (!allItems.some(x => x.memberId === item.memberId)) allItems.push(item); });

  members = readTable_(membersSheet);
  profiles = readTable_(profilesSheet);
  const memberRows = {}; members.rows.forEach(r => { memberRows[id_(r.values[members.map.MemberID])] = r; });
  const profileRows = {}; profiles.rows.forEach(r => { profileRows[id_(r.values[profiles.map.MemberID])] = r; });

  allItems.forEach(item => {
    const mr = memberRows[item.memberId];
    if (!mr) throw new Error('MemberID ' + item.memberId + ' の行を作成できませんでした');
    membersSheet.getRange(mr.rowNumber, 1, 1, 5).setValues([[
      item.memberId, item.groupId, item.name, item.colorHex, item.displayOrder
    ]]);
    ensureMainMembership_(ss, item.groupId, item.memberId);
    let pr = profileRows[item.memberId];
    if (!pr) {
      appendStyledRow_(profilesSheet, [item.memberId]);
      profiles = readTable_(profilesSheet);
      pr = profiles.rows.find(r => id_(r.values[profiles.map.MemberID]) === item.memberId);
      profileRows[item.memberId] = pr;
    }
    Object.keys(item.profileValues).forEach(key => {
      let profileId = key;
      if (key.indexOf('__COL_') === 0) profileId = fieldIdByInputCol[Number(key.replace('__COL_', ''))];
      profiles = readTable_(profilesSheet);
      const col = profiles.map[profileId];
      if (col == null) throw new Error('05_Profilesに' + profileId + '列がありません');
      profilesSheet.getRange(pr.rowNumber, col + 1).setValue(item.profileValues[key]);
    });
  });

  plan.deletes.slice().sort((a, b) => Number(b.memberId) - Number(a.memberId)).forEach(item => {
    deleteUnreferencedMember_(ss, item.memberId);
  });
  keepThreeEmptyProfileColumns_(input);
}

function ensureMainMembership_(ss, groupId, memberId) {
  if (!groupId) return;
  const sheet = requireSheet_(ss, BU1.SHEETS.GROUP_MEMBERS);
  const table = readTable_(sheet);
  const exists = table.rows.some(r => id_(r.values[table.map.GroupID]) === String(groupId) && id_(r.values[table.map.MemberID]) === String(memberId));
  if (exists) return;
  const order = table.rows.filter(r => id_(r.values[table.map.GroupID]) === String(groupId)).length + 1;
  appendStyledRow_(sheet, [groupId, memberId, order]);
}

function keepThreeEmptyProfileColumns_(sheet) {
  let lastCol = sheet.getLastColumn();
  let ids = sheet.getRange(BU_PROFILE.PROFILE_ID_ROW, 1, 1, lastCol).getDisplayValues()[0];
  let labels = sheet.getRange(BU_PROFILE.HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0];

  let templateCol = 0;
  let empty = 0;
  for (let c = BU_PROFILE.FIXED_COLUMNS; c < lastCol; c++) {
    if (clean_(ids[c]) || clean_(labels[c])) templateCol = c + 1;
    else empty++;
  }
  if (!templateCol) templateCol = Math.min(lastCol, BU_PROFILE.FIXED_COLUMNS + 1);

  const need = Math.max(0, BU_PROFILE.EMPTY_FIELD_COLUMNS - empty);
  if (need > 0) {
    sheet.insertColumnsAfter(lastCol, need);
    lastCol += need;
  }

  ids = sheet.getRange(BU_PROFILE.PROFILE_ID_ROW, 1, 1, lastCol).getDisplayValues()[0];
  labels = sheet.getRange(BU_PROFILE.HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0];

  // 既存の空き列も含め、最後の実項目列の見た目・入力規則・列幅へ統一する。
  for (let c = BU_PROFILE.FIXED_COLUMNS; c < lastCol; c++) {
    if (clean_(ids[c]) || clean_(labels[c])) continue;
    copyColumnPresentation_(sheet, templateCol, c + 1);
    sheet.getRange(BU_PROFILE.PROFILE_ID_ROW, c + 1).clearContent();
    sheet.getRange(BU_PROFILE.DATA_TYPE_ROW, c + 1).setValue('TEXT');
    sheet.getRange(BU_PROFILE.MULTI_ROW, c + 1).insertCheckboxes().setValue(false);
    sheet.getRange(BU_PROFILE.GROUP_ROW, c + 1).setValue('基本');
    sheet.getRange(BU_PROFILE.HEADER_ROW, c + 1).clearContent();
    if (sheet.getMaxRows() >= BU_PROFILE.DATA_START_ROW) {
      sheet.getRange(BU_PROFILE.DATA_START_ROW, c + 1, sheet.getMaxRows() - BU_PROFILE.DATA_START_ROW + 1, 1).clearContent();
    }
  }

  expandBasicFilter_(sheet, sheet.getLastRow(), lastCol);
}

function retireSelectedProfileField() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== BU1.SHEETS.INPUT_PROFILE) { alert_('項目廃止', '入力_プロフィールで対象列を選択してください。'); return; }
  const col = sheet.getActiveRange().getColumn();
  if (col <= BU_PROFILE.FIXED_COLUMNS) { alert_('項目廃止', '固定列は廃止できません。'); return; }
  const profileId = clean_(sheet.getRange(BU_PROFILE.PROFILE_ID_ROW, col).getDisplayValue());
  const label = clean_(sheet.getRange(BU_PROFILE.HEADER_ROW, col).getDisplayValue());
  if (!profileId) { alert_('項目廃止', 'ProfileIDがない空き列です。'); return; }
  const profiles = readTable_(requireSheet_(ss, BU1.SHEETS.PROFILES));
  const pCol = profiles.map[profileId];
  const count = pCol == null ? 0 : profiles.rows.filter(r => clean_(r.values[pCol])).length;
  if (!confirm_('プロフィール項目を廃止', profileId + '「' + label + '」を非表示にします。\n既存値: ' + count + '人\n値と列は削除しません。')) return;
  const retired = clean_(getConfig_(ss, 'RETIRED_PROFILE_IDS', '')).split(',').map(clean_).filter(Boolean);
  if (retired.indexOf(profileId) < 0) retired.push(profileId);
  setConfig_(ss, 'RETIRED_PROFILE_IDS', retired.join(','));
  sheet.hideColumns(col);
  if (pCol != null) profiles.sheet.hideColumns(pCol + 1);
  alert_('項目廃止', profileId + 'を非表示にしました。');
}

function restoreRetiredProfileFields() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const retired = clean_(getConfig_(ss, 'RETIRED_PROFILE_IDS', '')).split(',').map(clean_).filter(Boolean);
  if (!retired.length) { alert_('廃止項目', '廃止中のプロフィール項目はありません。'); return; }
  if (!confirm_('廃止項目を再表示', retired.join(' / ') + ' をすべて再表示します。')) return;
  const input = requireSheet_(ss, BU1.SHEETS.INPUT_PROFILE);
  const profiles = readTable_(requireSheet_(ss, BU1.SHEETS.PROFILES));
  const ids = input.getRange(BU_PROFILE.PROFILE_ID_ROW, 1, 1, input.getLastColumn()).getDisplayValues()[0];
  retired.forEach(profileId => {
    const iCol = ids.indexOf(profileId); if (iCol >= 0) input.showColumns(iCol + 1);
    const pCol = profiles.map[profileId]; if (pCol != null) profiles.sheet.showColumns(pCol + 1);
  });
  setConfig_(ss, 'RETIRED_PROFILE_IDS', '');
  alert_('廃止項目', '再表示しました。');
}

function findMemberReferences_(ss, memberId) {
  const refs = [];
  [[BU1.SHEETS.GROUP_MEMBERS, 'MemberID'], [BU1.SHEETS.LYRICS_PARTS, 'Singer'],
   [BU1.SHEETS.CARDS, 'MemberID'], [BU1.SHEETS.TRANSFERS, 'FromMemberID'],
   [BU1.SHEETS.TRANSFERS, 'ToMemberID']].forEach(def => {
    const sheet = ss.getSheetByName(def[0]); if (!sheet) return;
    const table = readTable_(sheet); const col = table.map[def[1]]; if (col == null) return;
    const found = table.rows.some(r => def[1] === 'Singer'
      ? clean_(r.values[col]).split(',').some(x => id_(x).replace(/_(up|down|sub)$/i, '') === String(memberId))
      : id_(r.values[col]) === String(memberId));
    if (found) refs.push(def[0]);
  });
  return refs;
}

function deleteUnreferencedMember_(ss, memberId) {
  const refs = findMemberReferences_(ss, memberId);
  if (refs.length) throw new Error('MemberID ' + memberId + ' は参照中です: ' + refs.join(' / '));
  [BU1.SHEETS.MEMBERS, BU1.SHEETS.PROFILES].forEach(name => {
    const sheet = requireSheet_(ss, name); const table = readTable_(sheet);
    const col = table.map.MemberID; const row = table.rows.find(r => id_(r.values[col]) === String(memberId));
    if (row) sheet.deleteRow(row.rowNumber);
  });
}