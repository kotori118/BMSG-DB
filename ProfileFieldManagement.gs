/**
 * Site-only profile FIELD administration (not profile VALUE editing).
 *
 * Existing profile values stay in Core 05_Profiles; the 9-column
 * ProfileSettings table in Log DB remains the sole field definition.
 * Hidden fields are kept intact and are reactivated by IsActive=true.
 *
 * This module is disabled until UNIVERSE_CATALOG_PROFILE_FIELDS_ENABLED=true.
 * Creating a field additionally requires separately verified Core and Log
 * backups; neither backups nor schema are created automatically.
 */

const PF_MGMT_SETTINGS_ = 'ProfileSettings';
const PF_MGMT_HEADERS_ = Object.freeze([
  'ProfileID','FieldName','DataType','IsMultiValue','DisplayGroup',
  'IsCompareTarget','QuizDifficulty','DisplayOrder','IsActive'
]);

function pfMgmtFlag_() {
  if(PropertiesService.getScriptProperties().getProperty('UNIVERSE_CATALOG_PROFILE_FIELDS_ENABLED')!=='true')
    throw new Error('プロフィール項目管理はまだ有効化されていません。');
}
function pfMgmtActive_(value) {
  return value===true || /^(TRUE|1)$/i.test(clean_(value));
}
function pfMgmtRequireShape_(ss) {
  const profile=catalogTable_(ss,BU1.SHEETS.PROFILES,['MemberID']);
  const log=SpreadsheetApp.openById(BU1.LOG_DB_ID);
  const settings=catalogTable_(log,PF_MGMT_SETTINGS_,PF_MGMT_HEADERS_);
  const seen=Object.create(null),labels=Object.create(null);
  settings.rows.forEach(function(r){
    const id=id_(r.values[settings.map.ProfileID]);
    if(!id)return;
    if(!/^P\d{3}$/.test(id))throw new Error('ProfileSettingsのProfileID形式が不正です: '+id);
    if(seen[id])throw new Error('ProfileSettingsのProfileIDが重複しています: '+id);
    seen[id]=true;
    if(profile.map[id]==null)throw new Error('05_Profilesに項目列がありません: '+id);
    const label=clean_(r.values[settings.map.FieldName]).toLowerCase();
    if(label&&labels[label])throw new Error('ProfileSettingsの項目名が重複しています: '+label);
    if(label)labels[label]=true;
  });
  profile.header.forEach(function(id){
    if(/^P\d{3}$/.test(id)&&!seen[id])
      throw new Error('ProfileSettingsに定義がありません: '+id);
  });
  return {profile:profile,settings:settings,seen:seen,labels:labels};
}
function pfMgmtPrepareInput_(payload) {
  payload=payload||{};
  const name=catalogRequiredString_(payload.name,'項目名',80);
  const type=clean_(payload.dataType||'TEXT').toUpperCase();
  if(['TEXT','NUMBER','DATE'].indexOf(type)<0)
    throw new Error('項目形式はTEXT / NUMBER / DATEから選んでください。');
  if(typeof payload.isMultiValue!=='boolean')
    throw new Error('複数値設定を確認できません。');
  if(payload.isMultiValue&&type!=='TEXT')
    throw new Error('複数値にできるのは文字列の項目だけです。');
  const group=catalogRequiredString_(payload.displayGroup||'基本','分類',60);
  if(/[\r\n]/.test(name+group))throw new Error('項目名・分類に改行は使用できません。');
  return {name:name,dataType:type,isMultiValue:payload.isMultiValue,displayGroup:group};
}
function pfMgmtBootstrapRows_(state) {
  const table=state.settings, col=table.map;
  return table.rows.filter(function(row){return id_(row.values[col.ProfileID]);})
    .map(function(row){
      const v=row.values;
      const id=id_(v[col.ProfileID]);
      return {
        profileId:id,label:clean_(v[col.FieldName]),dataType:clean_(v[col.DataType]),
        isMultiValue:pfMgmtActive_(v[col.IsMultiValue]),
        displayGroup:clean_(v[col.DisplayGroup]),
        displayOrder:Number(v[col.DisplayOrder])||0,
        isActive:pfMgmtActive_(v[col.IsActive]),
        isCompareTarget:pfMgmtActive_(v[col.IsCompareTarget]),
        quizDifficulty:clean_(v[col.QuizDifficulty])
      };
    })
    .sort(function(a,b){return a.displayOrder-b.displayOrder||a.profileId.localeCompare(b.profileId);});
}
/** Read-only. Independent from the create/toggle feature flag. */
function getCatalogProfileFieldsForUniverse(payload) {
  catalogRequireAdmin_(payload);
  const ss=openCoreSpreadsheet_();
  catalogRequireReady_(ss);
  const state=pfMgmtRequireShape_(ss);
  return {ok:true,fields:pfMgmtBootstrapRows_(state)};
}
function pfMgmtBackupGate_() {
  const props=PropertiesService.getScriptProperties();
  const docs=[
    ['UNIVERSE_CATALOG_BACKUP_ID',BU1.CORE_DB_ID],
    ['UNIVERSE_CATALOG_LOG_BACKUP_ID',BU1.LOG_DB_ID]
  ];
  docs.forEach(function(pair){
    const value=clean_(props.getProperty(pair[0]));
    if(!value||value===pair[1])
      throw new Error(pair[0]+' は独立したバックアップを指定してください。');
    const file=DriveApp.getFileById(value);
    if(!file||!file.getName())throw new Error('バックアップにアクセスできません: '+pair[0]);
    const backup=SpreadsheetApp.openById(value);
    const required=pair[0]==='UNIVERSE_CATALOG_BACKUP_ID'?BU1.SHEETS.PROFILES:PF_MGMT_SETTINGS_;
    if(!backup.getSheetByName(required))throw new Error('バックアップに必要なタブがありません: '+required);
  });
}
/**
 * One-field transaction across Core and Log.
 * A failed creation removes only the just-added column/row; no existing profile
 * values are touched. ProfileID is intentionally never recycled.
 */
function createCatalogProfileFieldForUniverse(payload) {
  const actor=catalogRequireAdmin_(payload);
  pfMgmtFlag_();
  const data=pfMgmtPrepareInput_(payload);
  pfMgmtBackupGate_();
  return withSharedWriterLock_('プロフィール項目追加',function(){
    const ss=openCoreSpreadsheet_();
    catalogRequireReady_(ss);
    const state=pfMgmtRequireShape_(ss);
    if(state.labels[data.name.toLowerCase()])
      throw new Error('同じ名前のプロフィール項目がすでにあります。');
    const p=state.profile.sheet, log=state.settings.sheet;
    const last=state.settings.rows.reduce(function(max,r){
      const n=Number(r.values[state.settings.map.DisplayOrder]);
      return Number.isFinite(n)?Math.max(n,max):max;
    },-1);
    const reserved=reserveNumberForKey_(ss,'NEXT_PROFILE_ID','BMSG-DB_SITE_PROFILE_FIELDS','サイトから項目作成: '+data.name);
    let column=0,inserted=false,logRow=0;
    const logLastBefore=log.getLastRow();
    try {
      if(reserved.numericValue>999)throw new Error('ProfileIDの上限P999に到達しました。');
      if(state.seen[reserved.issuedId]||state.profile.map[reserved.issuedId]!=null)
        throw new Error('予約したProfileIDはすでに存在します。');
      column=p.getLastColumn()+1;
      if(column>p.getMaxColumns()){
        p.insertColumnAfter(p.getMaxColumns());
        inserted=true;
      }
      // Copy appearance ONLY. Copying P015's validation would constrain a new
      // field to the previous field's incompatible DATE/NUMBER/TEXT type.
      if(column>2){
        const from=p.getRange(1,column-1,p.getMaxRows(),1);
        const to=p.getRange(1,column,p.getMaxRows(),1);
        from.copyTo(to,SpreadsheetApp.CopyPasteType.PASTE_FORMAT,false);
        p.setColumnWidth(column,p.getColumnWidth(column-1));
      }
      p.getRange(1,column).setValue(reserved.issuedId);
      const values=new Array(state.settings.header.length).fill('');
      const fields={
        ProfileID:reserved.issuedId,FieldName:data.name,DataType:data.dataType,
        IsMultiValue:data.isMultiValue,DisplayGroup:data.displayGroup,
        IsCompareTarget:false,QuizDifficulty:'普通',DisplayOrder:last+1,IsActive:true
      };
      Object.keys(fields).forEach(function(key){values[state.settings.map[key]]=fields[key];});
      logRow=appendStyledRow_(log,values);
      SpreadsheetApp.flush();
      const verify=pfMgmtRequireShape_(ss);
      if(verify.profile.map[reserved.issuedId]==null||
         !verify.settings.rows.some(function(r){return id_(r.values[verify.settings.map.ProfileID])===reserved.issuedId;}))
        throw new Error('プロフィール項目の保存確認に失敗しました。');
      catalogAudit_('PROFILE_FIELD',reserved.issuedId,'CREATE',null,fields,actor);
      finalizeIdReservation_(reserved,true,'項目を登録しました: '+data.name);
      return {ok:true,profileId:reserved.issuedId};
    } catch(error){
      const rollbackErrors=[];
      if(!logRow && log.getLastRow()>logLastBefore){
        const r=logLastBefore+1;
        if(id_(log.getRange(r,state.settings.map.ProfileID+1).getValue())===reserved.issuedId)logRow=r;
      }
      if(logRow)try{
        if(id_(log.getRange(logRow,state.settings.map.ProfileID+1).getValue())===reserved.issuedId)
          log.deleteRow(logRow);
        else rollbackErrors.push('Log行: 他の項目へ変更されたため削除を止めました');
      }catch(e){rollbackErrors.push('Log行: '+e.message);}
      if(column){
        try{
          if(inserted && column===p.getMaxColumns())p.deleteColumn(column);
          else p.getRange(1,column).clearContent();
        }catch(e){rollbackErrors.push('Core列: '+e.message);}
      }
      try{finalizeIdReservation_(reserved,false,'項目登録失敗: '+data.name);}catch(e){rollbackErrors.push('IDRegistry: '+e.message);}
      throw new Error('項目を保存できませんでした: '+error.message+
        (rollbackErrors.length?'／復旧に失敗: '+rollbackErrors.join(' / '):''));
    }
  });
}
/**
 * Toggle ONLY Log ProfileSettings.IsActive. Never delete or hide Core cells.
 * Existing Profile and Quiz readers already respect this flag.
 */
function setCatalogProfileFieldActiveForUniverse(payload) {
  const actor=catalogRequireAdmin_(payload);
  pfMgmtFlag_();
  if(typeof payload.isActive!=='boolean'||typeof payload.expectedActive!=='boolean')
    throw new Error('変更前・変更後の状態を指定してください。');
  const id=id_(payload.profileId);
  if(!/^P\d{3}$/.test(id))throw new Error('ProfileIDが不正です。');
  if(id==='P000'&&!payload.isActive)
    throw new Error('呼ばれ順(P000)は基礎項目のため非表示にできません。');
  return withSharedWriterLock_('プロフィール項目の表示設定',function(){
    const ss=openCoreSpreadsheet_();
    catalogRequireReady_(ss);
    const state=pfMgmtRequireShape_(ss);
    const row=catalogRow_(state.settings,'ProfileID',id);
    const old=pfMgmtActive_(row.values[state.settings.map.IsActive]);
    if(old!==payload.expectedActive)
      throw new Error('項目の表示状態が変更されています。最新情報を読み直してください。');
    if(old===payload.isActive)return {ok:true,profileId:id,isActive:old,unchanged:true};
    const col=state.settings.map.IsActive+1;
    const cell=state.settings.sheet.getRange(row.rowNumber,col);
    const previous=cell.getValue();
    try{
      cell.setValue(payload.isActive);
      SpreadsheetApp.flush();
      if(pfMgmtActive_(cell.getValue())!==payload.isActive)
        throw new Error('表示設定の保存後照合に失敗しました。');
      catalogAudit_('PROFILE_FIELD',id,payload.isActive?'RESTORE':'HIDE',
        {isActive:old},{isActive:payload.isActive},actor);
      return {ok:true,profileId:id,isActive:payload.isActive};
    }catch(error){
      try{cell.setValue(previous);}catch(restoreError){
        throw new Error(error.message+'／元の状態に戻せませんでした: '+restoreError.message);
      }
      throw error;
    }
  });
}
