/** Management maintenance: shared lock, optimistic row revisions, verified rollback.
 * No operation runs at startup. Logos are retired separately after preview/backup.
 */
function catalogRowRevision_(table,row){return JSON.stringify(catalogRec_(table,row));}
function catalogExpectRevision_(table,row,expected){
  if(typeof expected!=='string'||expected!==catalogRowRevision_(table,row))throw new Error('対象が更新されています。再読み込みしてから操作してください。');
}
function catalogEditCells_(table,row,changes){
  return Object.keys(changes).map(function(key){
    if(table.map[key]==null)throw new Error('必要な列がありません: '+key);
    return {cell:table.sheet.getRange(row.rowNumber,table.map[key]+1),value:changes[key]};
  });
}
function catalogClearRowCells_(table,row){
  const changes={};table.header.forEach(function(h){if(h)changes[h]='';});return catalogEditCells_(table,row,changes);
}
function catalogCommitCells_(edits,kind,id,action,before,after,actor){
  const undo=[];
  try{
    edits.forEach(function(e){
      if(typeof e.cell.getFormula==='function'&&e.cell.getFormula())throw new Error('数式が含まれる対象は変更できません。');
      const old=e.cell.getValue();if(String(old)===String(e.value))return;
      undo.push({cell:e.cell,value:old});e.cell.setValue(e.value);
      if(String(e.cell.getValue())!==String(e.value))throw new Error('保存内容の照合に失敗しました。');
    });
    SpreadsheetApp.flush();catalogAudit_(kind,id,action,before,after,actor);return {ok:true};
  }catch(error){
    const failed=[];undo.reverse().forEach(function(e){try{e.cell.setValue(e.value);if(String(e.cell.getValue())!==String(e.value))failed.push('復元照合');}catch(e2){failed.push(e2.message);}});
    SpreadsheetApp.flush();throw new Error(error.message+(failed.length?'／復元失敗: '+failed.join(' / '):''));
  }
}
/** Checks typed ID columns, singer tokens and structured references, never free-text lyrics. */
function catalogMaintenanceReferences_(ss,kind,id,skip){
  const key={GROUP:'GroupID',GUEST:'GuestID',IMAGE:'ImageID',MEMBER:'MemberID',SONG:'SongID'}[kind];
  const blockers=[];
  const legacyId = /^(?:G|U|M)\d+$/.test(String(id)) ? String(id).slice(1) : String(id);
  function matchesRef_(v){ const text=id_(v); return text===id || text===legacyId; }
  [ss,SpreadsheetApp.openById(BU1.LOG_DB_ID)].forEach(function(book){
    book.getSheets().forEach(function(sheet){
      if(['IDRegistry','CATALOG_Audit'].indexOf(sheet.getName())>=0)return;
      const t=readTable_(sheet);let count=0;
      t.rows.forEach(function(row){
        if(skip&&skip(t,row,book))return;
        const v=row.values,m=t.map;
        let found=key&&m[key]!=null&&matchesRef_(v[m[key]]);
        if(kind==='IMAGE'&&m.ActivityType!=null&&m.TargetID!=null&&String(v[m.ActivityType])==='DRAW_CARD'&&matchesRef_(v[m.TargetID]))found=true;
        if(kind==='SONG') ['SourceSongID','OriginalSongID','TargetSongID'].forEach(function(k){if(m[k]!=null&&id_(v[m[k]])===id)found=true;});
        if(kind==='GUEST')Object.keys(m).filter(function(k){return /Singer|GuestID/.test(k);}).forEach(function(k){if(String(v[m[k]]||'').split(/[^0-9A-Za-z]+/).indexOf(id)>=0)found=true;});
        if(kind==='GROUP'&&m.CoverGroupID!=null&&matchesRef_(v[m.CoverGroupID]))found=true;
        if(kind==='GUEST'&&m.Singer!=null){found=found||String(v[m.Singer]||'').split(',').some(function(token){return token.trim().replace(/_(up|down|sub)$/i,'')===id;});}
        if(m.TargetID!=null&&m.TargetType!=null&&String(v[m.TargetType]||'').toUpperCase()===kind&&matchesRef_(v[m.TargetID]))found=true;
        // Saved JSON snapshots and favorites can also contain an entity reference.
        Object.keys(m).filter(function(k){return /JSON$/.test(k);}).forEach(function(k){
          let data;try{data=JSON.parse(String(v[m[k]]||'null'));}catch(e){if(String(v[m[k]]||'').indexOf(id)>=0)found=true;return;}
          function walk(x,hint){if(x==null)return;if(typeof x!=='object'){if(String(hint||'').toLowerCase().indexOf((key||'__NONE__').toLowerCase())>=0&&matchesRef_(x))found=true;return;}Object.keys(x).forEach(function(p){const value=x[p],name=/^\d+$/.test(p)?hint:p;if((p.toLowerCase()===(key||'').toLowerCase()||(kind==='GUEST'&&/^(id|singerId)$/i.test(p)))&&matchesRef_(value))found=true;walk(value,name);});}walk(data,k);
        });
        if(found)count++;
      });
      if(count)blockers.push(sheet.getName()+': '+count+'件');
    });
  });return blockers;
}
function getCatalogMaintenanceBootstrapForUniverse(payload){
  catalogRequireUser_(payload);const ss=openCoreSpreadsheet_(),schema=catalogSchemaStatus_(ss);
  function rows(name,key){const t=catalogTable_(ss,name,[key]);return t.rows.filter(function(r){return id_(r.values[t.map[key]]);}).map(function(r){return Object.assign(catalogRec_(t,r),{revision:catalogRowRevision_(t,r)});});}
  let fields=[];if(schema.ready)fields=pfMgmtBootstrapRows_(pfMgmtRequireShape_(ss));
  return {ok:true,schema:schema,groups:rows(BU1.SHEETS.GROUPS,'GroupID'),guests:rows(BU1.SHEETS.GUESTS,'GuestID'),members:rows(BU1.SHEETS.MEMBERS,'MemberID'),images:rows(BU1.SHEETS.CARDS,'ImageID'),fields:fields,backups:catalogBackupHistory_()};
}
function maintainCatalogGuestForUniverse(payload){
  const actor=catalogRequireUser_(payload),id=id_(payload.guestId);
  return withSharedWriterLock_('Guest管理',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);const t=catalogTable_(ss,BU1.SHEETS.GUESTS,['GuestID','DisplayName']),row=catalogRow_(t,'GuestID',id);
    catalogExpectRevision_(t,row,payload.expectedRevision);
    if(payload.action==='MERGE'){
      const targetId=id_(payload.targetGuestId);if(targetId===id)throw new Error('別のゲストを選択してください。');catalogRow_(t,'GuestID',targetId);
      if(payload.confirm!==id)throw new Error('統合元GuestIDの確認が必要です。');pfMgmtBackupGate_();
      const lyrics=catalogTable_(ss,BU1.SHEETS.LYRICS_PARTS,['Singer']);
      const blockers=catalogMaintenanceReferences_(ss,'GUEST',id,function(tab,r,book){return book===ss&&(tab.sheet.getName()===lyrics.sheet.getName()||tab.sheet.getName()===t.sheet.getName()&&r.rowNumber===row.rowNumber);});
      if(blockers.length)throw new Error('歌詞以外に参照があります。先に対象を確認してください: '+blockers.join(' / '));
      const edits=catalogClearRowCells_(t,row);lyrics.rows.forEach(function(r){const old=String(r.values[lyrics.map.Singer]||'');const next=old.split(',').map(function(token){const suffix=token.match(/_(up|down|sub)$/i);return token.replace(/_(up|down|sub)$/i,'').trim()===id?targetId+(suffix?suffix[0]:''):token;}).filter(function(token,i,all){return all.indexOf(token)===i;}).join(',');if(next!==old)edits.push.apply(edits,catalogEditCells_(lyrics,r,{Singer:next}));});
      return catalogCommitCells_(edits,'GUEST',id,'MERGE',catalogRec_(t,row),{targetGuestId:targetId},actor);
    }
    if(payload.action==='DELETE'){
      if(payload.confirm!==id)throw new Error('GuestIDの削除確認が必要です。');pfMgmtBackupGate_();
      const blockers=catalogMaintenanceReferences_(ss,'GUEST',id,function(tab,r,book){return book===ss&&tab.sheet.getName()===t.sheet.getName()&&r.rowNumber===row.rowNumber;});
      if(blockers.length)throw new Error('参照が残っています: '+blockers.join(' / '));
      return catalogCommitCells_(catalogClearRowCells_(t,row),'GUEST',id,'DELETE',catalogRec_(t,row),null,actor);
    }
    const name=catalogRequiredString_(payload.name,'ゲスト名',120);
    if(t.rows.some(function(r){return r.rowNumber!==row.rowNumber&&clean_(r.values[t.map.DisplayName]).toLowerCase()===name.toLowerCase();}))throw new Error('同名ゲストが存在します。');
    return catalogCommitCells_(catalogEditCells_(t,row,{DisplayName:name}),'GUEST',id,'RENAME',catalogRec_(t,row),{DisplayName:name},actor);
  });
}
function updateCatalogProfileFieldForUniverse(payload){
  const actor=catalogRequireUser_(payload);
  return withSharedWriterLock_('プロフィール項目の編集',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);const state=pfMgmtRequireShape_(ss),t=state.settings,row=catalogRow_(t,'ProfileID',payload.profileId);
    const current=pfMgmtBootstrapRows_(state).find(function(f){return f.profileId===id_(payload.profileId);});
    if(JSON.stringify(current)!==payload.expectedRevision)throw new Error('項目が更新されています。再読み込みしてください。');
    const name=catalogRequiredString_(payload.name,'項目名',80),group=catalogRequiredString_(payload.displayGroup,'分類',60),order=Number(payload.displayOrder);
    if(!Number.isSafeInteger(order)||order<0||/[\r\n]/.test(name+group))throw new Error('名前・分類・表示順を確認してください。');
    if(t.rows.some(function(r){return r.rowNumber!==row.rowNumber&&clean_(r.values[t.map.FieldName]).toLowerCase()===name.toLowerCase();}))throw new Error('同名項目があります。');
    return catalogCommitCells_(catalogEditCells_(t,row,{FieldName:name,DisplayGroup:group,DisplayOrder:order}),'PROFILE_FIELD',payload.profileId,'EDIT',current,{name:name,displayGroup:group,displayOrder:order},actor);
  });
}
function maintainCatalogGroupForUniverse(payload){
  const actor=catalogRequireUser_(payload),id=id_(payload.groupId);
  return withSharedWriterLock_('グループ管理',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);const t=catalogTable_(ss,BU1.SHEETS.GROUPS,['GroupID','GroupName','DisplayOrder','ColorHex']),row=catalogRow_(t,'GroupID',id),before=catalogRec_(t,row);
    catalogExpectRevision_(t,row,payload.expectedRevision);
    if(payload.action==='DELETE'){
      if(payload.confirm!==id)throw new Error('GroupIDの確認が必要です。');pfMgmtBackupGate_();
      const blockers=catalogMaintenanceReferences_(ss,'GROUP',id,function(tab,r,book){return book===ss&&tab.sheet.getName()===t.sheet.getName()&&r.rowNumber===row.rowNumber;});
      const songs=catalogTable_(ss,BU1.SHEETS.SONGS,['Artist']);if(songs.rows.some(function(r){return clean_(r.values[songs.map.Artist])===before.GroupName;}))blockers.push('楽曲Artist');
      if(blockers.length)throw new Error('参照が残っています: '+blockers.join(' / '));
      return catalogCommitCells_(catalogClearRowCells_(t,row),'GROUP',id,'DELETE',before,null,actor);
    }
    const name=catalogRequiredString_(payload.name,'名前',100),kind=id.startsWith('G')?'GROUP':id.startsWith('U')?'UNIT':'INVALID',order=Number(payload.displayOrder);
    if(['GROUP','UNIT'].indexOf(kind)<0||(payload.kind&&String(payload.kind)!==kind)||!Number.isSafeInteger(order)||order<1)throw new Error('種別・表示順を確認してください。');
    if(t.rows.some(function(r){return r.rowNumber!==row.rowNumber&&clean_(r.values[t.map.GroupName]).toLowerCase()===name.toLowerCase();}))throw new Error('同名グループがあります。');
    const members=catalogTable_(ss,BU1.SHEETS.MEMBERS,['GroupID']);
    if(kind==='UNIT'&&members.rows.some(function(r){return id_(r.values[members.map.GroupID])===id;}))throw new Error('主所属メンバーがいます。先に主所属を変更してください。');
    const changes={GroupName:name,DisplayOrder:order,ColorHex:catalogValidateChangedColor_(ss,payload.color,before.ColorHex,'GROUP',id)};
    const edits=catalogEditCells_(t,row,changes);
    // Group IDs remain unchanged; Artist names in existing songs follow the renamed group.
    const songs=catalogTable_(ss,BU1.SHEETS.SONGS,['Artist']);songs.rows.filter(function(r){return clean_(r.values[songs.map.Artist])===before.GroupName;}).forEach(function(r){edits.push.apply(edits,catalogEditCells_(songs,r,{Artist:name}));});
    if(name!==before.GroupName){
      const log=SpreadsheetApp.openById(BU1.LOG_DB_ID);
      log.getSheets().forEach(function(sheet){if(sheet.getName()==='CATALOG_Audit')return;const tab=readTable_(sheet);if(tab.map.Course==null)return;tab.rows.forEach(function(r){if(String(r.values[tab.map.Course]).toUpperCase()===before.GroupName.toUpperCase())edits.push.apply(edits,catalogEditCells_(tab,r,{Course:name.toUpperCase()}));});});
    }
    if(before.GroupName==='BE:FIRST'&&name!==before.GroupName)throw new Error('BE:FIRSTは分析・ソロ分類の基準名のため変更できません。');
    return catalogCommitCells_(edits,'GROUP',id,'EDIT',before,changes,actor);
  });
}
function correctCatalogSongArtistForUniverse(payload){
  const actor=catalogRequireUser_(payload),id=id_(payload.songId),artist=catalogRequiredString_(payload.artist,'アーティスト',120);
  return withSharedWriterLock_('楽曲Artistの訂正',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);assertUniverseServiceArtist_(ss,artist);
    const t=catalogTable_(ss,BU1.SHEETS.SONGS,['SongID','Artist','ArtistRef','SongType','SoloMemberID']),row=catalogRow_(t,'SongID',id),before=catalogRec_(t,row);
    if(payload.expectedArtist!==before.Artist||payload.confirm!==id)throw new Error('変更前Artistと確認が一致しません。');
    if(artist===before.Artist)return {ok:true,unchanged:true};
    // Crossing the BE:FIRST-only analysis boundary requires empty dependent records.
    const credits=catalogTable_(ss,BU1.SHEETS.SONG_CREDITS,['SongID']),metrics=catalogTable_(ss,BU1.SHEETS.METRICS,['SongID']);
    if(before.Artist==='BE:FIRST'&&artist!=='BE:FIRST'){
      const meaningful=function(tab){return tab.rows.some(function(r){return id_(r.values[tab.map.SongID])===id&&r.values.some(function(v,i){return !['SongID','Title'].includes(tab.header[i])&&v!==''&&v!==null&&v!==0;});});};
      if(meaningful(credits)||meaningful(metrics))throw new Error('制作クレジット・秒数データがあります。内容を空にしてからArtistを訂正してください。');
    }
    const appended=[];
    try{
      if(artist==='BE:FIRST'){
        if(!credits.rows.some(function(r){return id_(r.values[credits.map.SongID])===id;})){
          const v=new Array(credits.header.length).fill('');v[credits.map.SongID]=id;if(credits.map.Title!=null)v[credits.map.Title]=before.Title;
          appended.push({sheet:credits.sheet,row:appendStyledRow_(credits.sheet,v)});
        }
        const metric=ensurePerformanceMetricRowForSong_(ss,id);if(metric.created)appended.push(metric);
      }
      return catalogCommitCells_(catalogEditCells_(t,row,{Artist:artist,ArtistRef:universeServiceArtistRef_(ss,artist),SongType:'NORMAL',SoloMemberID:''}),'SONG',id,'CORRECT_ARTIST',before,{Artist:artist},actor);
    }catch(error){appended.reverse().forEach(function(r){try{r.sheet.deleteRow(r.row);}catch(rollback){throw new Error(error.message+'／追加行の復旧失敗: '+rollback.message);}});throw error;}
  });
}
function maintainCatalogImageForUniverse(payload){
  const actor=catalogRequireUser_(payload),id=id_(payload.imageId);
  return withSharedWriterLock_('メンバー画像の表示設定',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);const t=catalogTable_(ss,BU1.SHEETS.CARDS,['ImageID','MemberID','IsProfileMain']),row=catalogRow_(t,'ImageID',id),before=catalogRec_(t,row);
    catalogExpectRevision_(t,row,payload.expectedRevision);
    let edits=[];
    if(payload.action==='DELETE'){
      if(payload.confirm!==id)throw new Error('ImageIDの確認が必要です。');pfMgmtBackupGate_();
      const blockers=catalogMaintenanceReferences_(ss,'IMAGE',id,function(tab,r,book){return book===ss&&tab.sheet.getName()===t.sheet.getName()&&r.rowNumber===row.rowNumber;});
      if(blockers.length)throw new Error('取得履歴等に参照があります: '+blockers.join(' / '));edits=catalogClearRowCells_(t,row);
    }else{
      if(typeof payload.isProfileMain!=='boolean')throw new Error('メイン画像設定を確認してください。');
      edits=catalogEditCells_(t,row,{IsProfileMain:payload.isProfileMain});
      if(payload.isProfileMain)t.rows.filter(function(r){return r.rowNumber!==row.rowNumber&&id_(r.values[t.map.MemberID])===String(before.MemberID);}).forEach(function(r){edits.push.apply(edits,catalogEditCells_(t,r,{IsProfileMain:false}));});
    }
    return catalogCommitCells_(edits,'IMAGE',id,payload.action==='DELETE'?'DELETE':'DISPLAY',before,payload.action==='DELETE'?null:{isProfileMain:payload.isProfileMain},actor);
  });
}

function catalogLegacyRefMap_(){
  const ss=openCoreSpreadsheet_(),groups=readTable_(requireSheet_(ss,BU1.SHEETS.GROUPS)),members=readTable_(requireSheet_(ss,BU1.SHEETS.MEMBERS));
  const group={},member={};
  groups.rows.forEach(function(r){const id=id_(r.values[groups.map.GroupID]);if(/^[GU]\d+$/.test(id))group[id.slice(1)]=id;});
  members.rows.forEach(function(r){const id=id_(r.values[members.map.MemberID]);if(/^M\d+$/.test(id))member[id.slice(1)]=id;});
  return {group,member};
}
function catalogAdaptAuditHistory_(row,refs){
  const result=Object.assign({},row),kind=String(row.EntityType||'').toUpperCase();
  const entity=String(result.EntityID||'');
  if(kind==='GROUP'&&refs.group[entity])result.EntityID=refs.group[entity];
  if(kind==='MEMBER'&&refs.member[entity])result.EntityID=refs.member[entity];
  const groupKeys={GroupID:true,groupId:true,primaryGroupId:true,CoverGroupID:true,coverGroupId:true};
  const memberKeys={MemberID:true,memberId:true,soloMemberId:true,SoloMemberID:true};
  function transform(value,key){
    if(Array.isArray(value))return value.map(function(v){return transform(v,key);});
    if(value&&typeof value==='object'){const result={};Object.keys(value).forEach(function(k){result[k]=transform(value[k],k);});return result;}
    const raw=String(value==null?'':value);
    if(groupKeys[key]&&refs.group[raw])return refs.group[raw];
    if(memberKeys[key]&&refs.member[raw])return refs.member[raw];
    return value;
  }
  ['BeforeJSON','AfterJSON'].forEach(function(key){
    const raw=String(result[key]||'');
    if(!raw)return;
    try{result[key]=JSON.stringify(transform(JSON.parse(raw),''));}catch(ignore){}
  });
  return result;
}

function getCatalogAuditHistoryForUniverse(payload){
  catalogRequireUser_(payload);const sheet=SpreadsheetApp.openById(BU1.LOG_DB_ID).getSheetByName('CATALOG_Audit');
  if(!sheet)return {ok:true,rows:[],nextOffset:null};const offset=Math.max(0,Number(payload.offset)||0),last=sheet.getLastRow()-offset;
  const start=Math.max(2,last-49);if(last<2)return {ok:true,rows:[],nextOffset:null};
  const header=sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0];
  const rows=sheet.getRange(start,1,last-start+1,header.length).getDisplayValues().reverse().map(function(v){const r={};header.forEach(function(h,i){r[h]=v[i];});return r;});
  // Convert only typed historical references in the API response. Stored audit JSON is immutable.
  const refs=catalogLegacyRefMap_();
  return {ok:true,rows:rows.map(function(row){return catalogAdaptAuditHistory_(row,refs);}),nextOffset:start>2?offset+rows.length:null};
}
function catalogBackupHistory_(){
  try{return JSON.parse(PropertiesService.getScriptProperties().getProperty('UNIVERSE_CATALOG_BACKUP_HISTORY')||'[]');}catch(e){throw new Error('バックアップ履歴が不正です。');}
}
function createCatalogBackupsForUniverse(payload){
  const actor=catalogRequireUser_(payload);
  if(payload.confirm!=='CREATE_BACKUP')throw new Error('バックアップ作成の確認が必要です。');
  return withSharedWriterLock_('Core／Logバックアップ',function(){
    const folder=DriveApp.getFolderById('1YD-Df-gJPyes1fCRFYsOj5kL4YLidTyq'),stamp=Utilities.formatDate(new Date(),'Asia/Tokyo','yyyyMMdd_HHmmss'),copies=[];
    try{
      [BU1.CORE_DB_ID,BU1.LOG_DB_ID].forEach(function(id,i){const file=DriveApp.getFileById(id).makeCopy('BMSG_Universe_'+(i?'Log':'Core')+'_BACKUP_'+stamp,folder);const ss=SpreadsheetApp.openById(file.getId());if(!ss.getSheetByName(i?'IDRegistry':BU1.SHEETS.PROFILES))throw new Error('バックアップの照合に失敗しました。');copies.push(file.getId());});
      const entry={createdAt:new Date().toISOString(),coreId:copies[0],logId:copies[1],actor:actor};
      const props=PropertiesService.getScriptProperties();props.setProperty('UNIVERSE_CATALOG_BACKUP_ID',entry.coreId);props.setProperty('UNIVERSE_CATALOG_LOG_BACKUP_ID',entry.logId);props.setProperty('UNIVERSE_CATALOG_BACKUP_HISTORY',JSON.stringify([entry].concat(catalogBackupHistory_()).slice(0,10)));
      return {ok:true,backup:entry};
    }catch(e){throw new Error('バックアップを完了できませんでした（作成済みファイルは保持）: '+e.message);}
  });
}
/** Retire application logo records; source Drive files are not library-owned assets. */
function retireCatalogLogosForUniverse(payload){
  catalogRequireUser_(payload);
  return {ok:true,retired:0,skipped:true}; // No group/brand image types exist in the five-column schema.
}
function prepareCatalogManagementForUniverse(payload){
  catalogRequireUser_(payload);if(payload.confirm!=='PREPARE_MANAGEMENT')throw new Error('初期整備の確認が必要です。');
  const backup=createCatalogBackupsForUniverse({userId:payload.userId,confirm:'CREATE_BACKUP'});
  const schema=migrateCatalogManagementSchemaForUniverse({userId:payload.userId,confirm:'MIGRATE_CATALOG_V1'});
  const logos=retireCatalogLogosForUniverse({userId:payload.userId,confirm:'RETIRE_LOGOS'});
  return {ok:true,backup:backup.backup,schema:schema.schema||{ready:true},retiredLogos:logos.retired};
}
/** Only unambiguous repairs are offered. Orphans and conflicting IDs need entity-level editing. */
function catalogRepairPlan_(ss){
  const groups=catalogTable_(ss,BU1.SHEETS.GROUPS,['GroupID']),members=catalogTable_(ss,BU1.SHEETS.MEMBERS,['MemberID','GroupID']),profiles=catalogTable_(ss,BU1.SHEETS.PROFILES,['MemberID']),links=catalogTable_(ss,BU1.SHEETS.GROUP_MEMBERS,['GroupID','MemberID','DisplayOrder']);
  const actions=[];
  members.rows.forEach(function(m){
    const id=id_(m.values[members.map.MemberID]),gid=id_(m.values[members.map.GroupID]);if(!id)return;
    if(members.rows.filter(function(r){return id_(r.values[members.map.MemberID])===id;}).length!==1)return;
    if(!profiles.rows.some(function(r){return id_(r.values[profiles.map.MemberID])===id;}))actions.push({kind:'PROFILE',memberId:id});
    if(gid&&groups.rows.some(function(r){return id_(r.values[groups.map.GroupID])===gid;})&&!links.rows.some(function(r){return id_(r.values[links.map.MemberID])===id&&id_(r.values[links.map.GroupID])===gid;}))actions.push({kind:'MEMBERSHIP',memberId:id,groupId:gid});
  });return actions;
}
function repairCatalogDatabaseForUniverse(payload){
  const actor=catalogRequireUser_(payload);
  return withSharedWriterLock_('管理データの修復',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);const plan=catalogRepairPlan_(ss),revision=JSON.stringify(plan);
    if(payload.preview!==false)return {ok:true,plan:plan,revision:revision};
    if(payload.confirm!=='REPAIR' || payload.expectedRevision!==revision)throw new Error('修復計画が変わっています。再確認してください。');pfMgmtBackupGate_();
    const appended=[];
    try{
      plan.forEach(function(action){
        const t=catalogTable_(ss,action.kind==='PROFILE'?BU1.SHEETS.PROFILES:BU1.SHEETS.GROUP_MEMBERS,['MemberID']),v=new Array(t.header.length).fill('');v[t.map.MemberID]=action.memberId;
        if(action.kind==='MEMBERSHIP'){requireColumns_(t,['GroupID','DisplayOrder']);v[t.map.GroupID]=action.groupId;v[t.map.DisplayOrder]=t.rows.filter(function(r){return id_(r.values[t.map.GroupID])===action.groupId;}).reduce(function(n,r){return Math.max(n,Number(r.values[t.map.DisplayOrder])||0);},0)+1;}
        const row=appendStyledRow_(t.sheet,v);appended.push({sheet:t.sheet,row:row});if(id_(t.sheet.getRange(row,t.map.MemberID+1).getValue())!==action.memberId)throw new Error('修復の照合に失敗しました。');
      });
      catalogAudit_('DATABASE','REPAIR','REPAIR',plan,{repaired:plan.length},actor);return {ok:true,repaired:plan.length};
    }catch(error){const failures=[];appended.reverse().forEach(function(r){try{r.sheet.deleteRow(r.row);}catch(e){failures.push(e.message);}});throw new Error(error.message+(failures.length?'／復旧失敗: '+failures.join(' / '):''));}
  });
}
function catalogMasterTargets_(){
  return [BU1.SHEETS.GROUPS,BU1.SHEETS.MEMBERS,BU1.SHEETS.GUESTS,BU1.SHEETS.GROUP_MEMBERS,BU1.SHEETS.PROFILES,BU1.SHEETS.SONGS,BU1.SHEETS.SONG_CREDITS,BU1.SHEETS.LYRICS_PARTS,BU1.SHEETS.CARDS,BU1.SHEETS.METRICS].map(function(name){return {book:'core',name:name};}).concat([{book:'core',name:'ProfileSettings'}]);
}
function catalogMasterSnapshot_(coreId,logId){
  const books={core:SpreadsheetApp.openById(coreId),log:SpreadsheetApp.openById(logId)};
  return catalogMasterTargets_().map(function(target){
    // Only independent historical backups may carry definitions in their old Log location.
    let sheet=books[target.book].getSheetByName(target.name);
    if(!sheet&&target.name==='ProfileSettings'&&coreId!==BU1.CORE_DB_ID)
      sheet=books.log.getSheetByName(target.name);
    if(!sheet)throw new Error(target.name+'がありません。');
    const range=sheet.getDataRange(),values=range.getValues(),formulas=range.getFormulas();
    if(target.name==='ProfileSettings'){
      const retired=values[0].indexOf('QuizDifficulty');
      if(retired>=0){values.forEach(function(row){row.splice(retired,1);});formulas.forEach(function(row){row.splice(retired,1);});}
    }
    return {book:target.book,name:target.name,values:values,formulas:formulas};
  });
}
function catalogSnapshotDigest_(snapshot){
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(snapshot)));
}
function catalogRestorePlan_(entry){
  const current=catalogMasterSnapshot_(BU1.CORE_DB_ID,BU1.LOG_DB_ID),target=catalogMasterSnapshot_(entry.coreId,entry.logId);
  target.forEach(function(t,i){
    if(JSON.stringify(t.values[0])!==JSON.stringify(current[i].values[0]))throw new Error(t.name+'の列構成が異なります。このバックアップは現在の構造へ直接復元できません。');
    // Retired logos must not return when restoring an older application snapshot.

  });
  catalogValidateRestoreSnapshot_(target);
  const identityKeys={};identityKeys[BU1.SHEETS.GROUPS]=['GroupID','GROUP'];identityKeys[BU1.SHEETS.MEMBERS]=['MemberID','MEMBER'];identityKeys[BU1.SHEETS.GUESTS]=['GuestID','GUEST'];identityKeys[BU1.SHEETS.SONGS]=['SongID','SONG'];identityKeys[BU1.SHEETS.CARDS]=['ImageID','IMAGE'];
  const core=openCoreSpreadsheet_();current.forEach(function(t,i){const identity=identityKeys[t.name];if(!identity)return;const col=t.values[0].indexOf(identity[0]);const restored=new Set(target[i].values.slice(1).map(function(r){return id_(r[col]);}));t.values.slice(1).forEach(function(r){const id=id_(r[col]);if(!id||restored.has(id))return;const blockers=catalogMaintenanceReferences_(core,identity[1],id,function(tab,row,book){return book===core;});if(blockers.length)throw new Error('復元により履歴参照が失われます: '+identity[1]+' '+id+' / '+blockers.join(' / '));});});
  const counts=target.map(function(t,i){return {table:t.name,currentRows:Math.max(0,current[i].values.length-1),backupRows:Math.max(0,t.values.length-1)};});
  return {current:current,target:target,counts:counts,revision:catalogSnapshotDigest_({current:current,target:target})};
}
/** Refuse malformed backups before any restore write. */
function catalogValidateRestoreSnapshot_(snapshot){
  const byName={};snapshot.forEach(function(t){byName[t.name]=t;});
  function ids(name,key){const t=byName[name],col=t.values[0].indexOf(key),out=new Set();if(col<0)throw new Error(name+'にID列がありません。');t.values.slice(1).forEach(function(r){const id=id_(r[col]);if(!id)return;if(out.has(id))throw new Error(name+'のID重複: '+id);out.add(id);});return out;}
  const groups=ids(BU1.SHEETS.GROUPS,'GroupID'),members=ids(BU1.SHEETS.MEMBERS,'MemberID'),guests=ids(BU1.SHEETS.GUESTS,'GuestID'),songs=ids(BU1.SHEETS.SONGS,'SongID');
  ids(BU1.SHEETS.CARDS,'ImageID');ids('ProfileSettings','ProfileID');ids(BU1.SHEETS.PROFILES,'MemberID');
  function refs(name,key,known){const t=byName[name],col=t.values[0].indexOf(key);if(col<0)return;t.values.slice(1).forEach(function(r){const id=id_(r[col]);if(id&&!known.has(id))throw new Error(name+'の参照不整合: '+key+' '+id);});}
  refs(BU1.SHEETS.MEMBERS,'GroupID',groups);refs(BU1.SHEETS.GROUP_MEMBERS,'GroupID',groups);refs(BU1.SHEETS.GROUP_MEMBERS,'MemberID',members);refs(BU1.SHEETS.PROFILES,'MemberID',members);
  [BU1.SHEETS.SONG_CREDITS,BU1.SHEETS.LYRICS_PARTS,BU1.SHEETS.METRICS].forEach(function(n){refs(n,'SongID',songs);});
  const images=byName[BU1.SHEETS.CARDS],h=images.values[0];images.values.slice(1).forEach(function(r){if(id_(r[h.indexOf('ImageID')])&&!members.has(id_(r[h.indexOf('MemberID')])))throw new Error('画像のメンバー参照が不正です。');});
  // Histories are retained, so a snapshot may not silently undo their current group labels.
  const groupTable=byName[BU1.SHEETS.GROUPS],nameCol=groupTable.values[0].indexOf('GroupName'),names=new Set(groupTable.values.slice(1).map(function(r){return String(r[nameCol]||'').toUpperCase();}));
  const current=catalogTable_(openCoreSpreadsheet_(),BU1.SHEETS.GROUPS,['GroupName']),currentNames=new Set(current.rows.map(function(r){return String(r.values[current.map.GroupName]).toUpperCase();}));
  SpreadsheetApp.openById(BU1.LOG_DB_ID).getSheets().forEach(function(sheet){const t=readTable_(sheet);if(t.map.Course==null)return;t.rows.forEach(function(r){const course=String(r.values[t.map.Course]||'').toUpperCase();if(currentNames.has(course)&&!names.has(course))throw new Error('復元するとクイズ履歴のグループ名が不整合になります。');});});
}
function catalogWriteMasterSnapshot_(snapshot){
  snapshot.forEach(function(t){
    const book=SpreadsheetApp.openById(t.book==='core'?BU1.CORE_DB_ID:BU1.LOG_DB_ID),sheet=requireSheet_(book,t.name),rows=t.values.length,cols=t.values[0].length;
    if(sheet.getMaxRows()<rows)sheet.insertRowsAfter(sheet.getMaxRows(),rows-sheet.getMaxRows());
    if(sheet.getMaxColumns()<cols)sheet.insertColumnsAfter(sheet.getMaxColumns(),cols-sheet.getMaxColumns());
    sheet.getDataRange().clearContent();
    const input=t.values.map(function(row,r){return row.map(function(v,c){return t.formulas[r]&&t.formulas[r][c]|| (typeof v==='string'&&v.charAt(0)==='='?"'"+v:v);});});
    sheet.getRange(1,1,rows,cols).setValues(input);
  });SpreadsheetApp.flush();
}
function restoreCatalogMasterDataForUniverse(payload){
  const actor=catalogRequireUser_(payload),entry=catalogBackupHistory_().find(function(b){return b.coreId===payload.backupId;});
  if(!entry||entry.coreId===BU1.CORE_DB_ID||entry.logId===BU1.LOG_DB_ID)throw new Error('登録済みの独立したバックアップを選んでください。');
  if(payload.preview!==false){const plan=catalogRestorePlan_(entry);return {ok:true,backupId:entry.coreId,revision:plan.revision,counts:plan.counts};}
  if(payload.confirm!=='RESTORE_MASTER_DATA'||typeof payload.expectedRevision!=='string')throw new Error('復元確認が必要です。');
  // Preserve a fresh recovery point before changing current master data.
  createCatalogBackupsForUniverse({userId:payload.userId,confirm:'CREATE_BACKUP'});
  return withSharedWriterLock_('管理データの復元',function(){
    const plan=catalogRestorePlan_(entry);if(plan.revision!==payload.expectedRevision)throw new Error('対象データかバックアップが変わっています。影響を再確認してください。');
    try{
      catalogWriteMasterSnapshot_(plan.target);
      const actual=catalogMasterSnapshot_(BU1.CORE_DB_ID,BU1.LOG_DB_ID);
      // Ignore unused trailing rows; validate the actual stored values and formulas.
      actual.forEach(function(t,i){const want=plan.target[i];want.values.forEach(function(row,r){row.forEach(function(v,c){const formula=want.formulas[r]&&want.formulas[r][c]||'';if(formula){if(!t.formulas[r]||t.formulas[r][c]!==formula)throw new Error(t.name+'の数式復元照合に失敗しました。');}else if(JSON.stringify(t.values[r]&&t.values[r][c])!==JSON.stringify(v))throw new Error(t.name+'の復元照合に失敗しました。');});});});
      const restoredImages=plan.target.find(function(t){return t.name===BU1.SHEETS.CARDS;});const fileColumn=restoredImages.values[0].indexOf('DriveFileID');const fileIds=restoredImages.values.slice(1).map(function(row){return String(row[fileColumn]||'');}).filter(Boolean);
      catalogAudit_('DATABASE',entry.coreId,'RESTORE',plan.counts,{backupId:entry.coreId,restoredImageFileIds:fileIds},actor);return {ok:true,restoredTables:plan.target.length};
    }catch(error){try{catalogWriteMasterSnapshot_(plan.current);}catch(rollback){throw new Error(error.message+'／復旧失敗: '+rollback.message);}throw error;}
  });
}
/** Removed image files remain recoverable but must never be reattached by repair. */
function getRetiredCatalogImageFileIdsForUniverse(payload){
  requireUniverseServiceUser_((payload||{}).userId);
  const sheet=SpreadsheetApp.openById(BU1.LOG_DB_ID).getSheetByName('CATALOG_Audit');if(!sheet)return [];
  const t=readTable_(sheet),retired=new Set();
  t.rows.forEach(function(r){const action=String(r.values[t.map.Action]||''),kind=String(r.values[t.map.EntityType]||'');
    if(kind==='IMAGE'&&action==='DELETE'){let before;try{before=JSON.parse(String(r.values[t.map.BeforeJSON]||'null'));}catch(e){throw new Error('画像削除履歴を確認できません。修復は中止します。');}if(before&&before.DriveFileID)retired.add(String(before.DriveFileID));}
    if(kind==='DATABASE'&&action==='RESTORE'){let after;try{after=JSON.parse(String(r.values[t.map.AfterJSON]||'null'));}catch(e){throw new Error('復元履歴を確認できません。修復は中止します。');}(after&&after.restoredImageFileIds||[]).forEach(function(id){retired.delete(String(id));});}
  });return Array.from(retired);
}
