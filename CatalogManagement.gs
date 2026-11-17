/**
 * Catalog management v1 (staged feature).
 * All mutations are performed by BMSG-DB, never by the client or a Sheets menu.
 * Opt-in: UNIVERSE_CATALOG_ENABLED=true and UNIVERSE_CATALOG_ADMIN_EMAILS
 * (comma-delimited Google Account addresses) in Script Properties.
 * Empty/unknown identity, missing schema, or missing opt-in fails CLOSED.
 *
 * Migration is an explicit administrator action and does not run at startup.
 */
const BU_CATALOG_SCHEMA_ = Object.freeze({
  groups:['GroupKind','RecordStatus'],
  members:['RecordStatus'],
  songs:['SongType','SoloMemberID']
});
const BU_CATALOG_MAIN_GROUP_NAMES_ = Object.freeze(['BE:FIRST','MAZZEL','STARGLOW','HANA','ShowMinorSavage']);
const BU_CATALOG_SOLOS_ = Object.freeze({
  '1068':{title:'Want it',member:'SHUNTO'},
  '1069':{title:'Rain on me',member:'MANATO'},
  '1070':{title:'Nova Flame',member:'JUNON'},
  '1071':{title:'I just wanna be myself',member:'LEO'},
  '1072':{title:'Loop',member:'RYUHEI'},
  '1073':{title:'Chill with you',member:'SOTA'}
});

function catalogRequireAdmin_(payload) {
  payload=payload||{};
  requireUniverseServiceUser_(payload.userId);
  const props=PropertiesService.getScriptProperties();
  if(props.getProperty('UNIVERSE_CATALOG_ENABLED')!=='true')
    throw new Error('管理機能は有効化されていません。');
  const email=String(Session.getActiveUser().getEmail()||'').trim().toLowerCase();
  const allow=String(props.getProperty('UNIVERSE_CATALOG_ADMIN_EMAILS')||'')
    .split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!email||!allow.length||allow.indexOf(email)<0)
    throw new Error('ログイン中のGoogleアカウントは管理操作できません。');
  return email;
}

function catalogTable_(ss,name,headers) {
  const t=readTable_(requireSheet_(ss,name));
  requireColumns_(t,headers);
  return t;
}
function catalogRow_(table,key,val) {
  const matches=table.rows.filter(r=>id_(r.values[table.map[key]])===id_(val));
  if(matches.length!==1)throw new Error(table.sheet.getName()+': '+key+'を一意に特定できません。');
  return matches[0];
}
function catalogRec_(t,row) {
  const result={};
  t.header.forEach((h,i)=>{if(h)result[h]=row.values[i] instanceof Date ? row.values[i].toISOString() : row.values[i];});
  return result;
}
function catalogActive_(v){return clean_(v).toUpperCase()!=='ARCHIVED';}
function catalogEnsureActive_(t,row){if(!catalogActive_(row.values[t.map.RecordStatus]))throw new Error('アーカイブ済みのデータです。');}
function catalogRequiredString_(value,name,max) {
  const v=clean_(value);
  if(!v||v.length>(max||150))throw new Error(name+'が空か長すぎます。');
  return v;
}
function catalogAudit_(kind,id,action,before,after,actor) {
  const ss=SpreadsheetApp.openById(BU1.LOG_DB_ID);
  const sheet=ss.getSheetByName('CATALOG_Audit');
  if(!sheet)throw new Error('CATALOG_Auditが未準備です。');
  const t=readTable_(sheet);
  requireColumns_(t,['AuditID','EntityType','EntityID','Action','BeforeJSON','AfterJSON','ActorEmail','OccurredAt','Source']);
  const vals=new Array(t.header.length).fill('');
  const obj={AuditID:Utilities.getUuid(),EntityType:kind,EntityID:String(id),Action:action,
    BeforeJSON:JSON.stringify(before||null),AfterJSON:JSON.stringify(after||null),
    ActorEmail:actor,OccurredAt:new Date().toISOString(),Source:'BMSG-PJ_SITE_CATALOG'};
  Object.keys(obj).forEach(k=>vals[t.map[k]]=obj[k]);
  appendStyledRow_(sheet,vals);
}
function catalogWriteRecord_(table,row,updates,kind,action,actor) {
  const before=row.values.slice();
  const after=before.slice();
  const columns=Object.keys(updates).map(k=>{
    if(table.map[k]==null)throw new Error(k+'列がありません。');
    after[table.map[k]]=updates[k];
    return {name:k,column:table.map[k]+1,oldValue:before[table.map[k]],newValue:updates[k]};
  });
  const sheet=table.sheet;
  const applied=[];
  try {
    columns.forEach(col=>{
      sheet.getRange(row.rowNumber,col.column).setValue(col.newValue);
      applied.push(col);
    });
    SpreadsheetApp.flush();
    columns.forEach(col=>{
      const actual=sheet.getRange(row.rowNumber,col.column).getValue();
      if(String(actual)!==String(col.newValue))
        throw new Error(col.name+'の保存後照合に失敗しました。');
    });
    const entityKey=kind==='SONG'?'SongID':kind==='GROUP'?'GroupID':'MemberID';
    catalogAudit_(kind,before[table.map[entityKey]],action,
      catalogRec_(table,row),catalogRec_(table,{values:after}),actor);
    return {ok:true};
  }catch(e){
    applied.reverse().forEach(col=>{
      try{sheet.getRange(row.rowNumber,col.column).setValue(col.oldValue);}catch(ignore){}
    });
    SpreadsheetApp.flush();
    throw e;
  }
}
function catalogSchemaStatus_(ss){
  const defs=[
    [BU1.SHEETS.GROUPS,BU_CATALOG_SCHEMA_.groups],
    [BU1.SHEETS.MEMBERS,BU_CATALOG_SCHEMA_.members],
    [BU1.SHEETS.SONGS,BU_CATALOG_SCHEMA_.songs]
  ];
  const missing=[];
  defs.forEach(([name,headers])=>{
    const sheet=requireSheet_(ss,name);
    const present=sheet.getRange(1,1,1,Math.max(1,sheet.getLastColumn())).getDisplayValues()[0];
    headers.filter(k=>present.indexOf(k)<0).forEach(k=>missing.push(name+'.'+k));
  });
  const audit=SpreadsheetApp.openById(BU1.LOG_DB_ID).getSheetByName('CATALOG_Audit');
  if(!audit)missing.push('Log.CATALOG_Audit');
  else {
    const actual=audit.getRange(1,1,1,Math.max(1,audit.getLastColumn())).getDisplayValues()[0];
    ['AuditID','EntityType','EntityID','Action','BeforeJSON','AfterJSON','ActorEmail','OccurredAt','Source']
      .filter(function(k){return actual.indexOf(k)<0;})
      .forEach(function(k){missing.push('Log.CATALOG_Audit.'+k);});
  }
  return {ready:missing.length===0,missing};
}

function getCatalogManagementBootstrapForUniverse(payload) {
  catalogRequireAdmin_(payload);
  const ss=openCoreSpreadsheet_();
  const schema=catalogSchemaStatus_(ss);
  const groups=readTable_(requireSheet_(ss,BU1.SHEETS.GROUPS));
  const members=readTable_(requireSheet_(ss,BU1.SHEETS.MEMBERS));
  const songs=readTable_(requireSheet_(ss,BU1.SHEETS.SONGS));
  const gm=readTable_(requireSheet_(ss,BU1.SHEETS.GROUP_MEMBERS));
  return {ok:true,schema,
    groups:groups.rows.filter(r=>id_(r.values[groups.map.GroupID])).map(r=>catalogRec_(groups,r)),
    members:members.rows.filter(r=>id_(r.values[members.map.MemberID])).map(r=>catalogRec_(members,r)),
    songs:songs.rows.filter(r=>id_(r.values[songs.map.SongID])).map(r=>catalogRec_(songs,r)),
    memberships:gm.rows.filter(r=>id_(r.values[gm.map.MemberID])).map(r=>catalogRec_(gm,r))};
}

/** Explicit one-time schema migration; requires an admin-owned backup before execution. */
function migrateCatalogManagementSchemaForUniverse(payload){
  const actor=catalogRequireAdmin_(payload);
  if(String(payload.confirm||'')!=='MIGRATE_CATALOG_V1')throw new Error('移行確認コードが必要です。');
  const backup=String(PropertiesService.getScriptProperties().getProperty('UNIVERSE_CATALOG_BACKUP_ID')||'').trim();
  if(!backup||backup===BU1.CORE_DB_ID)throw new Error('別ファイルに作成したCore DBバックアップのIDを設定してください。');
  const backupFile=DriveApp.getFileById(backup);
  if(!backupFile||!backupFile.getName())throw new Error('バックアップを確認できません。');
  return withSharedWriterLock_('カタログスキーマ移行',function(){
    const ss=openCoreSpreadsheet_();
    if(catalogSchemaStatus_(ss).ready)return {ok:true,alreadyReady:true};
    const existingAudit=SpreadsheetApp.openById(BU1.LOG_DB_ID).getSheetByName('CATALOG_Audit');
    if(existingAudit) {
      const h=existingAudit.getRange(1,1,1,Math.max(1,existingAudit.getLastColumn())).getDisplayValues()[0];
      const required=['AuditID','EntityType','EntityID','Action','BeforeJSON','AfterJSON','ActorEmail','OccurredAt','Source'];
      if(required.some(function(k){return h.indexOf(k)<0;}))
        throw new Error('既存CATALOG_Auditの列構造に不整合があります。スキーマ変更は中止しました。');
    }
    const specs=[
      [BU1.SHEETS.GROUPS,BU_CATALOG_SCHEMA_.groups],
      [BU1.SHEETS.MEMBERS,BU_CATALOG_SCHEMA_.members],
      [BU1.SHEETS.SONGS,BU_CATALOG_SCHEMA_.songs]
    ];
    specs.forEach(([name,fields])=>{
      const sh=requireSheet_(ss,name);
      const h=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getDisplayValues()[0];
      fields.forEach(field=>{
        if(h.indexOf(field)>=0)return;
        let col=sh.getLastColumn()+1;
        if(col>sh.getMaxColumns())sh.insertColumnAfter(sh.getMaxColumns());
        sh.getRange(1,col).setValue(field);
        h[col-1]=field;
      });
    });
    const g=catalogTable_(ss,BU1.SHEETS.GROUPS,['GroupID','GroupName','GroupKind','RecordStatus']);
    g.rows.forEach(r=>{
      if(!id_(r.values[g.map.GroupID]))return;
      if(!clean_(r.values[g.map.GroupKind]))
        g.sheet.getRange(r.rowNumber,g.map.GroupKind+1).setValue(BU_CATALOG_MAIN_GROUP_NAMES_.indexOf(clean_(r.values[g.map.GroupName]))>=0?'GROUP':'UNIT');
      if(!clean_(r.values[g.map.RecordStatus]))g.sheet.getRange(r.rowNumber,g.map.RecordStatus+1).setValue('ACTIVE');
    });
    const m=catalogTable_(ss,BU1.SHEETS.MEMBERS,['MemberID','DisplayName','RecordStatus']);
    m.rows.forEach(r=>{
      if(id_(r.values[m.map.MemberID])&&!clean_(r.values[m.map.RecordStatus]))
        m.sheet.getRange(r.rowNumber,m.map.RecordStatus+1).setValue('ACTIVE');
    });
    const s=catalogTable_(ss,BU1.SHEETS.SONGS,['SongID','Title','Artist','SongType','SoloMemberID']);
    const ids={};
    m.rows.forEach(r=>{if(id_(r.values[m.map.MemberID]))ids[clean_(r.values[m.map.DisplayName])]=id_(r.values[m.map.MemberID]);});
    s.rows.forEach(r=>{
      const sid=id_(r.values[s.map.SongID]);if(!sid)return;
      const solo=BU_CATALOG_SOLOS_[sid];
      const valid=solo&&clean_(r.values[s.map.Title])===solo.title&&clean_(r.values[s.map.Artist])==='BE:FIRST';
      if(!clean_(r.values[s.map.SongType]))s.sheet.getRange(r.rowNumber,s.map.SongType+1).setValue(valid?'SOLO':'NORMAL');
      if(valid&&!clean_(r.values[s.map.SoloMemberID])){
        if(!ids[solo.member])throw new Error('ソロ担当Memberが見つかりません: '+solo.member);
        s.sheet.getRange(r.rowNumber,s.map.SoloMemberID+1).setValue(ids[solo.member]);
      }
    });
    const log=SpreadsheetApp.openById(BU1.LOG_DB_ID);
    if(!log.getSheetByName('CATALOG_Audit')){
      const sh=log.insertSheet('CATALOG_Audit');
      sh.getRange(1,1,1,9).setValues([['AuditID','EntityType','EntityID','Action','BeforeJSON','AfterJSON','ActorEmail','OccurredAt','Source']]);
      sh.setFrozenRows(1);
    }
    SpreadsheetApp.flush();
    const status=catalogSchemaStatus_(ss);
    if(!status.ready)throw new Error('スキーマ確認に失敗: '+status.missing.join(', '));
    catalogAudit_('SCHEMA','V1','MIGRATE',null,{schema:status,backupId:backup},actor);
    return {ok:true,schema:status};
  });
}

function catalogRequireReady_(ss){
  const s=catalogSchemaStatus_(ss);
  if(!s.ready)throw new Error('サイト管理用DBの移行がまだ完了していません: '+s.missing.join(', '));
}

/**
 * Globally unique colors for NEW/CHANGED Group, Unit and Member colors.
 * Historical unchanged collisions are accepted without silently rewriting
 * existing records (e.g., group/individual legacy values).
 * All comparisons normalize #RRGGBB case; blanks are not valid for new writes.
 */
function catalogRequireUniqueColor_(ss,proposed,exceptKind,exceptId) {
  const color=normalizeHex_(proposed);
  if(!color)throw new Error('カラーコードを選択してください。');
  const tables=[
    {sheet:BU1.SHEETS.GROUPS,id:'GroupID',name:'GroupName',kind:'GROUP',label:'グループ・ユニット'},
    {sheet:BU1.SHEETS.MEMBERS,id:'MemberID',name:'DisplayName',kind:'MEMBER',label:'メンバー'}
  ];
  const conflicts=[];
  tables.forEach(function(def){
    const t=catalogTable_(ss,def.sheet,[def.id,def.name,'ColorHex']);
    t.rows.forEach(function(r){
      const otherId=id_(r.values[t.map[def.id]]);
      if(!otherId||(def.kind===exceptKind&&otherId===id_(exceptId)))return;
      const original=clean_(r.values[t.map.ColorHex]);
      if(!/^#[0-9a-fA-F]{6}$/.test(original))return;
      if(original.toUpperCase()===color){
        const name=clean_(r.values[t.map[def.name]])||otherId;
        conflicts.push(def.label+'「'+name+'」');
      }
    });
  });
  if(conflicts.length)throw new Error(
    'カラーコード '+color+' はすでに'+conflicts.join('、')+'が使用しています。別の色を選択してください。'
  );
  return color;
}
function catalogValidateChangedColor_(ss,proposed,previous,kind,id) {
  const proposedColor=normalizeHex_(proposed);
  if(!proposedColor)throw new Error('カラーコードを選択してください。');
  // Do not reject an existing record solely due to historical overlap.
  if(proposedColor===clean_(previous).toUpperCase())return proposedColor;
  return catalogRequireUniqueColor_(ss,proposedColor,kind,id);
}

function createCatalogGroupForUniverse(payload){
  const actor=catalogRequireAdmin_(payload);
  const name=catalogRequiredString_(payload.name,'グループ名',100);
  const kind=clean_(payload.kind).toUpperCase();
  if(['GROUP','UNIT'].indexOf(kind)<0)throw new Error('GROUP/UNITを選択してください。');
  const color=normalizeHex_(payload.color||'#777777');
  return withSharedWriterLock_('グループ作成',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    const t=catalogTable_(ss,BU1.SHEETS.GROUPS,['GroupID','GroupName','ColorHex','DisplayOrder','GroupKind','RecordStatus']);
    if(t.rows.some(r=>clean_(r.values[t.map.GroupName]).toLowerCase()===name.toLowerCase()))throw new Error('同名グループが既に存在します。');
    catalogRequireUniqueColor_(ss,color,'GROUP','');
    const reservation=reserveNumberForKey_(ss,'NEXT_GROUP_ID','BMSG-DB_SITE_CATALOG','サイトでGroup作成: '+name);
    let row=0;
    try{
      const vals=new Array(t.header.length).fill('');
      vals[t.map.GroupID]=reservation.issuedId;vals[t.map.GroupName]=name;vals[t.map.ColorHex]=color;
      vals[t.map.DisplayOrder]=t.rows.reduce((n,r)=>Math.max(n,Number(r.values[t.map.DisplayOrder])||0),0)+1;
      vals[t.map.GroupKind]=kind;vals[t.map.RecordStatus]='ACTIVE';
      row=appendStyledRow_(t.sheet,vals);
      SpreadsheetApp.flush();
      if(id_(t.sheet.getRange(row,t.map.GroupID+1).getValue())!==reservation.issuedId)throw new Error('保存確認に失敗しました。');
      catalogAudit_('GROUP',reservation.issuedId,'CREATE',null,{name,kind,color},actor);
      finalizeIdReservation_(reservation,true,'サイト登録完了: '+name);
      return{ok:true,groupId:reservation.issuedId};
    }catch(e){
      if(row)try{t.sheet.deleteRow(row);}catch(ignore){}
      try{finalizeIdReservation_(reservation,false,'サイト登録失敗: '+name);}catch(ignore){}
      throw e;
    }
  });
}

function updateCatalogGroupForUniverse(payload){
  const actor=catalogRequireAdmin_(payload),gid=id_(payload.groupId);
  return withSharedWriterLock_('グループ編集',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    const t=catalogTable_(ss,BU1.SHEETS.GROUPS,['GroupID','GroupName','ColorHex','GroupKind','RecordStatus']);
    const row=catalogRow_(t,'GroupID',gid),before=catalogRec_(t,row);
    const newName=catalogRequiredString_(payload.name||before.GroupName,'グループ名',100);
    const songs=readTable_(requireSheet_(ss,BU1.SHEETS.SONGS));
    if(newName!==before.GroupName&&songs.rows.some(r=>clean_(r.values[songs.map.Artist])===before.GroupName))
      throw new Error('曲のArtistに使用中のためグループ名は変更できません。');
    if(t.rows.some(r=>r!==row&&id_(r.values[t.map.GroupID])!==gid&&clean_(r.values[t.map.GroupName]).toLowerCase()===newName.toLowerCase()))throw new Error('同じ名前のグループが存在します。');
    const changes={GroupName:newName,ColorHex:catalogValidateChangedColor_(ss,payload.color||before.ColorHex,before.ColorHex,'GROUP',gid)};
    return catalogWriteRecord_(t,row,changes,'GROUP','UPDATE',actor);
  });
}

function createCatalogMemberForUniverse(payload){
  const actor=catalogRequireAdmin_(payload),name=catalogRequiredString_(payload.name,'メンバー名',120);
  const groupId=id_(payload.primaryGroupId),color=normalizeHex_(payload.color||'#777777');
  return withSharedWriterLock_('メンバー作成',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    const g=catalogTable_(ss,BU1.SHEETS.GROUPS,['GroupID','GroupName','GroupKind','RecordStatus']);
    const grp=catalogRow_(g,'GroupID',groupId);catalogEnsureActive_(g,grp);
    if(clean_(grp.values[g.map.GroupKind])!=='GROUP')throw new Error('主所属にはGROUPを指定してください。ユニットへの参加は所属管理から追加します。');
    const m=catalogTable_(ss,BU1.SHEETS.MEMBERS,['MemberID','GroupID','DisplayName','ColorHex','DisplayOrder','RecordStatus']);
    if(m.rows.some(r=>clean_(r.values[m.map.DisplayName]).toLowerCase()===name.toLowerCase()))throw new Error('同名メンバーが登録済みです。');
    catalogRequireUniqueColor_(ss,color,'MEMBER','');
    const gm=catalogTable_(ss,BU1.SHEETS.GROUP_MEMBERS,['GroupID','MemberID','DisplayOrder']);
    const p=catalogTable_(ss,BU1.SHEETS.PROFILES,['MemberID']);
    const groupName=clean_(grp.values[g.map.GroupName]);
    const band=BU1.MAIN_GROUP_BANDS[groupName]||BU1.MAIN_GROUP_BANDS['ソロ・その他'];
    const res=reserveNumberForKey_(ss,'NEXT_MEMBER_ID_'+band,'BMSG-DB_SITE_CATALOG','サイトでMember作成: '+name);
    const rows=[];
    try{
      if(Number(res.numericValue)>band+99)throw new Error('MemberIDの採番帯が上限に達しました: '+band+'〜'+(band+99));
      // 02_Members.DisplayOrder is GLOBAL (existing members are ordered 1..33).
      // 04_GroupMembers.DisplayOrder is scoped to each group independently.
      const display=m.rows.reduce(function(max,r){
        return Math.max(max,Number(r.values[m.map.DisplayOrder])||0);
      },0)+1;
      const groupDisplay=gm.rows.filter(function(r){
        return id_(r.values[gm.map.GroupID])===groupId;
      }).reduce(function(max,r){
        return Math.max(max,Number(r.values[gm.map.DisplayOrder])||0);
      },0)+1;
      const v=new Array(m.header.length).fill('');
      v[m.map.MemberID]=res.issuedId;v[m.map.GroupID]=groupId;v[m.map.DisplayName]=name;v[m.map.ColorHex]=color;v[m.map.DisplayOrder]=display;v[m.map.RecordStatus]='ACTIVE';
      rows.push({sheet:m.sheet,row:appendStyledRow_(m.sheet,v)});
      const mem=new Array(gm.header.length).fill('');
      mem[gm.map.GroupID]=groupId;mem[gm.map.MemberID]=res.issuedId;mem[gm.map.DisplayOrder]=groupDisplay;
      rows.push({sheet:gm.sheet,row:appendStyledRow_(gm.sheet,mem)});
      const profile=new Array(p.header.length).fill('');profile[p.map.MemberID]=res.issuedId;
      rows.push({sheet:p.sheet,row:appendStyledRow_(p.sheet,profile)});
      SpreadsheetApp.flush();
      if(id_(m.sheet.getRange(rows[0].row,m.map.MemberID+1).getValue())!==res.issuedId)throw new Error('MemberIDの保存確認に失敗しました。');
      catalogAudit_('MEMBER',res.issuedId,'CREATE',null,{name,primaryGroupId:groupId,color},actor);
      finalizeIdReservation_(res,true,'サイト登録完了: '+name);
      return {ok:true,memberId:res.issuedId};
    }catch(e){
      rows.reverse().forEach(x=>{try{x.sheet.deleteRow(x.row);}catch(ignore){}});
      try{finalizeIdReservation_(res,false,'サイト登録失敗: '+name);}catch(ignore){}
      throw e;
    }
  });
}

function updateCatalogMemberForUniverse(payload){
  const actor=catalogRequireAdmin_(payload),memberId=id_(payload.memberId);
  return withSharedWriterLock_('メンバー更新',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    const t=catalogTable_(ss,BU1.SHEETS.MEMBERS,['MemberID','DisplayName','ColorHex','RecordStatus']);
    const row=catalogRow_(t,'MemberID',memberId);catalogEnsureActive_(t,row);
    const name=catalogRequiredString_(payload.name||row.values[t.map.DisplayName],'メンバー名',120);
    if(t.rows.some(r=>r.rowNumber!==row.rowNumber&&clean_(r.values[t.map.DisplayName]).toLowerCase()===name.toLowerCase()))throw new Error('同名メンバーが存在します。');
    return catalogWriteRecord_(t,row,{DisplayName:name,ColorHex:catalogValidateChangedColor_(ss,payload.color||row.values[t.map.ColorHex],row.values[t.map.ColorHex],'MEMBER',memberId)},'MEMBER','UPDATE',actor);
  });
}

function addCatalogUnitMemberForUniverse(payload){
  const actor=catalogRequireAdmin_(payload),groupId=id_(payload.groupId),memberId=id_(payload.memberId);
  return withSharedWriterLock_('ユニット所属追加',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    const groups=catalogTable_(ss,BU1.SHEETS.GROUPS,['GroupID','GroupKind','RecordStatus']);
    const g=catalogRow_(groups,'GroupID',groupId);catalogEnsureActive_(groups,g);
    if(clean_(g.values[groups.map.GroupKind])!=='UNIT')throw new Error('所属追加先はUNITのみ選択してください。');
    const members=catalogTable_(ss,BU1.SHEETS.MEMBERS,['MemberID','RecordStatus']);
    catalogEnsureActive_(members,catalogRow_(members,'MemberID',memberId));
    const gm=catalogTable_(ss,BU1.SHEETS.GROUP_MEMBERS,['GroupID','MemberID','DisplayOrder']);
    if(gm.rows.some(r=>id_(r.values[gm.map.GroupID])===groupId&&id_(r.values[gm.map.MemberID])===memberId))throw new Error('所属済みです。');
    const v=new Array(gm.header.length).fill('');
    v[gm.map.GroupID]=groupId;v[gm.map.MemberID]=memberId;
    v[gm.map.DisplayOrder]=1+gm.rows.filter(r=>id_(r.values[gm.map.GroupID])===groupId).reduce((n,r)=>Math.max(n,Number(r.values[gm.map.DisplayOrder])||0),0);
    let row=0;
    try{
      row=appendStyledRow_(gm.sheet,v);
      SpreadsheetApp.flush();
      if(id_(gm.sheet.getRange(row,gm.map.MemberID+1).getValue())!==memberId)throw new Error('所属の保存確認に失敗しました。');
      catalogAudit_('UNIT_MEMBERSHIP',groupId+'_'+memberId,'CREATE',null,{groupId,memberId},actor);
      return {ok:true,groupId,memberId};
    }catch(e){if(row)try{gm.sheet.deleteRow(row);}catch(ignore){}throw e;}
  });
}

function saveCatalogSoloForUniverse(payload){
  const actor=catalogRequireAdmin_(payload),songId=id_(payload.songId);
  const songType=clean_(payload.songType||'NORMAL').toUpperCase();
  if(['NORMAL','SOLO'].indexOf(songType)<0)throw new Error('NORMAL/SOLOのみ対応します。');
  return withSharedWriterLock_('楽曲分類更新',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    const t=catalogTable_(ss,BU1.SHEETS.SONGS,['SongID','Artist','SongType','SoloMemberID']);
    const row=catalogRow_(t,'SongID',songId);
    let mid='';
    if(songType==='SOLO'){
      if(clean_(row.values[t.map.Artist])!=='BE:FIRST')throw new Error('ソロ担当はBE:FIRST曲にのみ設定可能です。');
      mid=id_(payload.soloMemberId);
      const m=catalogTable_(ss,BU1.SHEETS.MEMBERS,['MemberID','GroupID','RecordStatus']);
      const member=catalogRow_(m,'MemberID',mid);catalogEnsureActive_(m,member);
      const groups=catalogTable_(ss,BU1.SHEETS.GROUPS,['GroupID','GroupName']);
      const group=catalogRow_(groups,'GroupID',member.values[m.map.GroupID]);
      if(clean_(group.values[groups.map.GroupName])!=='BE:FIRST')throw new Error('BE:FIRSTメンバーを選択してください。');
    }
    return catalogWriteRecord_(t,row,{SongType:songType,SoloMemberID:mid},'SONG','CLASSIFY',actor);
  });
}

/**
 * Permanent deletion (not archive). Preview always rechecks live dependencies.
 * Child rows (credits, lyrics, metrics) are cleared with Song.
 * External workbooks are NOT under the Core DB transaction; users must first
 * inspect references such as YouTube analytics and setlists. Unknown Core / Log
 * references block deletion. IDRegistry is intentionally retained.
 */
function catalogSongDeletePlan_(ss,songId) {
  const songs=catalogTable_(ss,BU1.SHEETS.SONGS,['SongID','Title']);
  const song=catalogRow_(songs,'SongID',songId);
  const rows=[{sheet:songs.sheet,rowNumber:song.rowNumber,label:'06_Songs'}];
  const counts={},blockers=[];
  const children=[
    [BU1.SHEETS.SONG_CREDITS,'07_SongCredits'],
    [BU1.SHEETS.LYRICS_PARTS,'08_LyricsParts'],
    [BU1.SHEETS.METRICS,'10_PerformanceMetrics']
  ];
  children.forEach(function(item){
    const table=catalogTable_(ss,item[0],['SongID']);
    const found=table.rows.filter(function(r){return id_(r.values[table.map.SongID])===songId;});
    counts[item[1]]=found.length;
    found.forEach(function(r){rows.push({sheet:table.sheet,rowNumber:r.rowNumber,label:item[1]});});
  });
  const skip={};
  [BU1.SHEETS.SONGS].concat(children.map(function(x){return x[0];})).forEach(function(k){skip[k]=true;});
  const log=SpreadsheetApp.openById(BU1.LOG_DB_ID);
  const pattern=new RegExp('(^|[^0-9])'+songId+'([^0-9]|$)');
  function inspect(sheet) {
    if(sheet.getLastRow()<2||sheet.getLastColumn()<1)return;
    const table=readTable_(sheet);
    const direct=['SongID','SourceSongID','TargetSongID','OriginalSongID']
      .filter(function(k){return table.map[k]!=null;});
    const json=['CandidateSongIDsJSON','SourceRefJSON','SongIDsJSON'].filter(function(k){return table.map[k]!=null;});
    const hasTarget=table.map.TargetID!=null&&table.map.TargetType!=null;
    const hasRecent=table.map.TargetID!=null&&table.map.ActivityType!=null;
    if(!direct.length&&!json.length&&!hasTarget&&!hasRecent)return;
    let count=0;
    table.rows.forEach(function(r){
      const v=r.values;
      const linked=direct.some(function(k){return id_(v[table.map[k]])===songId;}) ||
        json.some(function(k){return pattern.test(clean_(v[table.map[k]]));}) ||
        (hasTarget&&id_(v[table.map.TargetID])===songId&&
          ['SONG','LYRICS'].indexOf(clean_(v[table.map.TargetType]).toUpperCase())>=0) ||
        (hasRecent&&id_(v[table.map.TargetID])===songId&&
          /LYRICS|SONG/.test(clean_(v[table.map.ActivityType]).toUpperCase()));
      if(linked)count++;
    });
    if(count)blockers.push(sheet.getName()+' に参照 '+count+'件');
  }
  ss.getSheets().filter(function(sh){return !skip[sh.getName()];}).forEach(inspect);
  log.getSheets().filter(function(sh){return ['IDRegistry','CATALOG_Audit'].indexOf(sh.getName())<0;}).forEach(inspect);
  if(rows.length>500)blockers.push('内部関連データが500行を超えています。個別の移行が必要です。');
  return {songId:songId,title:clean_(song.values[songs.map.Title]),counts:counts,
    blockers:blockers,canDelete:blockers.length===0,rows:rows};
}
function getCatalogSongDeletePreviewForUniverse(payload) {
  catalogRequireAdmin_(payload);
  const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
  const plan=catalogSongDeletePlan_(ss,id_(payload.songId));
  return {ok:true,songId:plan.songId,title:plan.title,
    counts:plan.counts,blockers:plan.blockers,canDelete:plan.canDelete};
}
function deleteCatalogSongForUniverse(payload) {
  const actor=catalogRequireAdmin_(payload),songId=id_(payload.songId);
  if(!songId||id_(payload.confirm)!==songId||payload.externalReferencesChecked!==true)
    throw new Error('削除する曲のSongIDと、外部参照の確認が必要です。');
  const props=PropertiesService.getScriptProperties();
  if(props.getProperty('UNIVERSE_CATALOG_SONG_DELETE_ENABLED')!=='true')
    throw new Error('完全削除は現在無効です。管理者による有効化とバックアップ確認が必要です。');
  const backup=clean_(props.getProperty('UNIVERSE_CATALOG_BACKUP_ID'));
  if(!backup||backup===BU1.CORE_DB_ID)throw new Error('別ファイルのCore DBバックアップを設定してください。');
  if(!DriveApp.getFileById(backup).getName())throw new Error('バックアップを確認できません。');
  return withSharedWriterLock_('楽曲完全削除',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    const plan=catalogSongDeletePlan_(ss,songId);
    if(clean_(payload.confirmTitle)!==plan.title)throw new Error('曲名が一致しません。削除を中止しました。');
    if(!plan.canDelete)throw new Error('他の機能から参照されています。削除を中止しました: '+plan.blockers.join(' / '));
    // Capture all cell values/formulas at original row coordinates.
    // Clear instead of deleteRow: protects unrelated formulas and row positions.
    const snapshots=plan.rows.map(function(item){
      const range=item.sheet.getRange(item.rowNumber,1,1,item.sheet.getLastColumn());
      return {range:range,label:item.label,row:item.rowNumber,
        values:range.getValues()[0],formulas:range.getFormulas()[0]};
    });
    catalogAudit_('SONG',songId,'DELETE_BEGIN',{title:plan.title,related:plan.counts},null,actor);
    try {
      snapshots.forEach(function(snap){snap.range.clearContent();});
      SpreadsheetApp.flush();
      snapshots.forEach(function(snap){
        if(snap.range.getValues()[0].some(function(v){return v!==''&&v!==null;}))
          throw new Error(snap.label+' '+snap.row+'行の削除後照合に失敗しました。');
      });
      catalogAudit_('SONG',songId,'DELETE_COMPLETE',{title:plan.title,related:plan.counts},null,actor);
      // Do not delete or roll back IDRegistry: SongID must never be reused.
      return {ok:true,deleted:true,songId:songId,removed:plan.counts};
    }catch(error){
      const failures=[];
      snapshots.forEach(function(snap){
        try {
          snap.range.setValues([snap.values.map(function(v,i){return snap.formulas[i]||v;})]);
        }catch(e){failures.push(snap.label+': '+e.message);}
      });
      SpreadsheetApp.flush();
      throw new Error('削除を中止しました: '+error.message+(failures.length?'／復旧失敗: '+failures.join(' / '):''));
    }
  });
}

/** Safe lyricless registration through the SAME core writer and IDRegistry. */
function createCatalogSongDraftForUniverse(payload){
  const actor=catalogRequireAdmin_(payload);
  const song=normalizeUniverseServiceSong_(payload.song||{});
  const credits=normalizeUniverseServiceCredits_(payload.credits||{});
  const type=clean_(payload.songType||'NORMAL').toUpperCase();
  if(['NORMAL','SOLO'].indexOf(type)<0)throw new Error('楽曲区分はNORMAL/SOLOのみです。');
  return withSharedWriterLock_('歌詞なし新曲登録',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    let solo='';
    if(type==='SOLO'){
      if(song.artist!=='BE:FIRST')throw new Error('ソロ曲はArtist=BE:FIRSTとして登録します。');
      solo=id_(payload.soloMemberId);
      const m=catalogTable_(ss,BU1.SHEETS.MEMBERS,['MemberID','GroupID','RecordStatus']);
      const member=catalogRow_(m,'MemberID',solo);catalogEnsureActive_(m,member);
      const groups=catalogTable_(ss,BU1.SHEETS.GROUPS,['GroupID','GroupName']);
      const group=catalogRow_(groups,'GroupID',member.values[m.map.GroupID]);
      if(clean_(group.values[groups.map.GroupName])!=='BE:FIRST')throw new Error('BE:FIRSTメンバー以外は指定できません。');
    }
    let parts=[];
    if(payload.includeLyrics===true){
      const parsed=parseSongLyricsForUniverse({userId:payload.userId,rawLyrics:payload.rawLyrics,ignoredGuestCandidates:payload.ignoredGuestCandidates});
      if(!parsed.canRegister||parsed.unknownGuests.length)throw new Error('歌詞を確認してください。未登録のSingerまたは解析エラーがあります。');
      parts=parsed.parts;
    }
    const result=createSongWithPartsCore_(ss,song,credits,parts,{
      source:'BMSG-DB_SITE_CATALOG',notePrefix:'サイト歌詞なし登録',
      allowEmptyParts:payload.includeLyrics!==true,songType:type,soloMemberId:solo
    });
    if(result&&result.ok){
      try{catalogAudit_('SONG',result.songId,payload.includeLyrics===true?'CREATE_WITH_LYRICS':'CREATE_NO_LYRICS',null,{title:song.title,artist:song.artist,songType:type,soloMemberId:solo},actor);}
      catch(e){throw new Error('楽曲は登録済みですが監査ログの保存に失敗しました（重複登録せず管理者へ連絡）: '+e.message);}
    }
    return result;
  });
}
