import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import crypto from 'node:crypto';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
function fixture(){
  const tables={
    Groups:[['GroupID','GroupName','ColorHex','DisplayOrder','RecordStatus'],['G1','BE:FIRST','#123456',1,'ACTIVE'],['G7','New group','#abcdef',2,'ACTIVE']],
    Members:[['MemberID','GroupID','DisplayName','ColorHex','DisplayOrder','RecordStatus'],['M101','G1','SOTA','#00afcc',1,'ACTIVE'],['M501','G7','New member','#cdcdcd',2,'ACTIVE']],
    Guests:[['GuestID','DisplayName'],['901','Old Guest'],['902','Target Guest']],
    Links:[['GroupID','MemberID','DisplayOrder'],['G1','M101',1],['G7','M501',1]],
    Profiles:[['MemberID','P000','P001'],['M101',1,'Blue'],['M501',2,'Green']],
    Songs:[['SongID','Title','Artist','ReleaseDate','Form','CDTitle','IsTitleTrack','SongType','SoloMemberID','ArtistRef'],['1001','Test','BE:FIRST','','','','','NORMAL','','G1'],['5001','Other','New group','','','','','NORMAL','','G7']],
    Credits:[['SongID','Title','Lyricists','Composers','Choreographers'],['1001','Test','','','']],
    Lyrics:[['SongID','PartOrder','Singer','Lyrics'],['1001',1,'901_up','Text']],
    Images:[['ImageID','MemberID','Rarity','DriveFileID','IsProfileMain'],['100','M101','SSR','member-file',true],['101','M101','N','second-file',false]],
    Metrics:[['SongID','M101'],['','歌唱'],['1001','']],
  };
  const log={ProfileSettings:[['ProfileID','FieldName','DataType','IsMultiValue','DisplayGroup','IsCompareTarget','DisplayOrder','IsActive'],['P000','呼ばれ順','NUMBER',false,'基本',false,0,true],['P001','好きな色','TEXT',false,'基本',false,1,true]],CATALOG_Audit:[['AuditID','EntityType','EntityID','Action','BeforeJSON','AfterJSON','ActorEmail','OccurredAt','Source']],CardCollections:[['UserID','ImageID']],RecentActivities:[['UserID','ActivityType','TargetID']],IDRegistry:[['IssuedID']]};
  tables.ProfileSettings=log.ProfileSettings;delete log.ProfileSettings;
  const data={core:tables,log:log,backupCore0:structuredClone(tables),backupLog0:structuredClone(log)},writes=[],files=[];
  const props={UNIVERSE_CATALOG_ENABLED:'true',UNIVERSE_CATALOG_MEMBER_MAINTENANCE_ENABLED:'true',UNIVERSE_CATALOG_ADMIN_EMAILS:'admin@example.test',UNIVERSE_CATALOG_PROFILE_FIELDS_ENABLED:'true',UNIVERSE_CATALOG_BACKUP_ID:'backupCore0',UNIVERSE_CATALOG_LOG_BACKUP_ID:'backupLog0',UNIVERSE_CATALOG_BACKUP_HISTORY:JSON.stringify([{coreId:'backupCore0',logId:'backupLog0',createdAt:'2026-01-01'}])};
  let fail=null,failAudit=false,locked=false,serial=0;const books={};
  function book(id){if(books[id])return books[id];if(!data[id])throw Error('Unknown book '+id);
    const sheets={};const b={getId:()=>id,getSheets:()=>Object.keys(data[id]).map(sheet),getSheetByName:n=>data[id][n]?sheet(n):null,insertSheet:n=>{data[id][n]=[['']];return sheet(n);}};
    function sheet(name){if(sheets[name])return sheets[name];
      const rows=()=>data[id][name],lastRow=()=>{let n=rows().length;while(n>1&&!rows()[n-1].some(v=>v!==''&&v!=null))n--;return n;};
      const s={getName:()=>name,getLastRow:lastRow,getLastColumn:()=>Math.max(1,...rows().map(r=>r.length)),getMaxRows:()=>10000,getMaxColumns:()=>100,isSheetHidden:()=>false,setFrozenRows:()=>{},insertRowsAfter:()=>{},insertColumnsAfter:()=>{},deleteRow:r=>{writes.push({id,name,deleted:r});rows().splice(r-1,1);},getDataRange:()=>s.getRange(1,1,lastRow(),s.getLastColumn()),getRange:(r,c,n=1,m=1)=>{
        const values=()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows()[r-1+i]?.[c-1+j]??''));
        const range={getValues:()=>structuredClone(values()),getDisplayValues:()=>values().map(row=>row.map(x=>String(x))),getValue:()=>rows()[r-1]?.[c-1]??'',getDisplayValue:()=>String(rows()[r-1]?.[c-1]??''),getFormula:()=>'',getFormulas:()=>values().map(row=>row.map(()=>'')),setValue:value=>range.setValues([[value]]),setValues:matrix=>{if(fail&&fail({id,name,r,c,matrix})){fail=null;throw Error('simulated write failure');}for(let i=0;i<matrix.length;i++){rows()[r-1+i]??=[];for(let j=0;j<matrix[i].length;j++)rows()[r-1+i][c-1+j]=structuredClone(matrix[i][j]);}writes.push({id,name,r,c,matrix:structuredClone(matrix)});return range;},clearContent:()=>{for(let i=0;i<n;i++)for(let j=0;j<m;j++)if(rows()[r-1+i])rows()[r-1+i][c-1+j]='';return range;}};return range;
      }};sheets[name]=s;return s;
    }books[id]=b;return b;
  }
  const sheets={GROUPS:'Groups',MEMBERS:'Members',GUESTS:'Guests',GROUP_MEMBERS:'Links',PROFILES:'Profiles',SONGS:'Songs',SONG_CREDITS:'Credits',LYRICS_PARTS:'Lyrics',CARDS:'Images',METRICS:'Metrics'};
  const env={BU1:{CORE_DB_ID:'core',LOG_DB_ID:'log',SHEETS:sheets},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=v;}})},Session:{getActiveUser:()=>({getEmail:()=> 'admin@example.test'})},
    SpreadsheetApp:{openById:book,flush:()=>{}},DriveApp:{getFolderById:()=>({}),getFileById:id=>({getId:()=>id,getName:()=>id,makeCopy:(name)=>{const next='copy'+(++serial);data[next]=structuredClone(data[id]);files.push({id:next,name});return {getId:()=>next};}})},
    Utilities:{getUuid:()=>String(++serial),formatDate:()=> '20261117_000000',DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,x)=>Array.from(crypto.createHash('sha256').update(x).digest()),base64EncodeWebSafe:x=>Buffer.from(x).toString('base64url')},
    id_:x=>String(x??'').trim(),clean_:x=>String(x??'').trim(),normalizeHex_:x=>String(x).toUpperCase(),requireUniverseServiceUser_:uid=>{if(!['U001','U002','U003'].includes(uid))throw Error('user');},
    openCoreSpreadsheet_:()=>book('core'),requireSheet_:(b,n)=>{const s=b.getSheetByName(n);if(!s)throw Error('Missing '+n);return s;},requireColumns_:(t,cols)=>{for(const c of cols)if(t.map[c]==null)throw Error('column '+c);},
    readTable_:s=>{const values=s.getDataRange().getValues(),header=values[0].map(String),map={};header.forEach((h,i)=>map[h]=i);return {sheet:s,header,map,rows:values.slice(1).map((v,i)=>({rowNumber:i+2,values:v})).filter(r=>r.values.some(v=>v!==''&&v!=null))};},
    appendStyledRow_:(s,v)=>{if(failAudit&&s.getName()==='CATALOG_Audit')throw Error('audit unavailable');const row=s.getLastRow()+1;s.getRange(row,1,1,v.length).setValues([v]);return row;},
    withSharedWriterLock_:(_,f)=>{if(locked)throw Error('nested lock');locked=true;try{return f();}finally{locked=false;}},assertUniverseServiceArtist_:(_,artist)=>{if(!tables.Groups.slice(1).some(r=>r[1]===artist))throw Error('artist');},universeServiceArtistRef_:(_,artist)=>{const g=tables.Groups.slice(1).find(r=>r[1]===artist);if(!g)throw Error('artist');return g[0];}
  };
  vm.createContext(env);vm.runInContext(read('CatalogManagement.gs')+'\n'+read('ProfileFieldManagement.gs')+'\n'+read('CatalogMaintenance.gs')+'\n'+read('MetricsTransfers.gs')+'\n'+read('CatalogMemberMaintenance.gs'),env);
  const call=(fn,p={})=>env[fn]({userId:'U001',...p});const revision=(name,key,id)=>{const t=env.catalogTable_(book('core'),name,[key]),r=env.catalogRow_(t,key,id);return env.catalogRowRevision_(t,r);};
  return{data,tables,log,props,writes,files,env,call,revision,failOnce:fn=>fail=fn,failAudit:()=>failAudit=true};
}
test('bootstrap returns row revisions, fields, backups and member-only images',()=>{
  const x=fixture(),r=x.call('getCatalogMaintenanceBootstrapForUniverse');assert.equal(r.schema.ready,true);assert.equal(r.images.length,2);assert.ok(r.guests[0].revision);assert.equal(r.fields.length,2);
});
test('guest rename keeps ID and lyrics; stale update and duplicate names are refused',()=>{
  const x=fixture(),before=x.revision('Guests','GuestID','901');
  x.call('maintainCatalogGuestForUniverse',{guestId:'901',name:'Corrected',expectedRevision:before});
  assert.equal(x.tables.Guests[1][0],'901');assert.equal(x.tables.Lyrics[1][2],'901_up');
  assert.throws(()=>x.call('maintainCatalogGuestForUniverse',{guestId:'901',name:'Other',expectedRevision:before}),/更新/);
  assert.throws(()=>x.call('maintainCatalogGuestForUniverse',{guestId:'901',name:'Target Guest',expectedRevision:x.revision('Guests','GuestID','901')}),/同名/);
});
test('referenced guest cannot be deleted; merge preserves singer role and deletes only source',()=>{
  const x=fixture(),base={guestId:'901',expectedRevision:x.revision('Guests','GuestID','901'),confirm:'901'};
  assert.throws(()=>x.call('maintainCatalogGuestForUniverse',{...base,action:'DELETE'}),/参照/);
  x.call('maintainCatalogGuestForUniverse',{...base,action:'MERGE',targetGuestId:'902'});
  assert.equal(x.tables.Lyrics[1][2],'902_up');assert.equal(x.tables.Guests[1][0],'');assert.equal(x.tables.Guests[2][0],'902');
});
test('guest merge rolls back lyrics and guest row if audit fails',()=>{
  const x=fixture(),before=structuredClone(x.tables);x.failAudit();
  assert.throws(()=>x.call('maintainCatalogGuestForUniverse',{guestId:'901',action:'MERGE',targetGuestId:'902',expectedRevision:x.revision('Guests','GuestID','901'),confirm:'901'}),/audit/);
  assert.deepEqual(x.tables,before);
});
test('group metadata and related Song.Artist change together, retaining IDs',()=>{
  const x=fixture();x.call('maintainCatalogGroupForUniverse',{groupId:'G7',expectedRevision:x.revision('Groups','GroupID','G7'),name:'Renamed',kind:'GROUP',color:'#abcdef',displayOrder:3});
  assert.equal(x.tables.Groups[2][0],'G7');assert.equal(x.tables.Songs[2][0],'5001');assert.equal(x.tables.Songs[2][2],'Renamed');
});
test('referenced group deletion and GROUP-to-UNIT change with primary members are blocked',()=>{
  const x=fixture(),base={groupId:'G7',expectedRevision:x.revision('Groups','GroupID','G7')};
  assert.throws(()=>x.call('maintainCatalogGroupForUniverse',{...base,action:'DELETE',confirm:'G7'}),/参照/);
  assert.throws(()=>x.call('maintainCatalogGroupForUniverse',{...base,name:'New group',kind:'UNIT',color:'#abcdef',displayOrder:2}),/種別/);
});
test('group rename restores all related records after a partial write failure',()=>{
  const x=fixture(),before=structuredClone(x.tables);x.failOnce(e=>e.name==='Songs');
  assert.throws(()=>x.call('maintainCatalogGroupForUniverse',{groupId:'G7',expectedRevision:x.revision('Groups','GroupID','G7'),name:'Renamed',kind:'GROUP',color:'#abcdef',displayOrder:3}),/write failure/);
  assert.deepEqual(x.tables,before);
});
test('profile field edit preserves ProfileID/type and all member values',()=>{
  const x=fixture(),field=x.call('getCatalogMaintenanceBootstrapForUniverse').fields.find(f=>f.profileId==='P001'),values=structuredClone(x.tables.Profiles);
  x.call('updateCatalogProfileFieldForUniverse',{profileId:'P001',name:'好きな色（新）',displayGroup:'好み',displayOrder:8,expectedRevision:JSON.stringify(field)});
  assert.equal(x.tables.ProfileSettings[2][0],'P001');assert.equal(x.tables.ProfileSettings[2][2],'TEXT');assert.deepEqual(x.tables.Profiles,values);
});
test('image main selection clears only other images of the same member',()=>{
  const x=fixture();x.call('maintainCatalogImageForUniverse',{imageId:'101',expectedRevision:x.revision('Images','ImageID','101'),isProfileMain:true});
  assert.equal(x.tables.Images[1][4],false);assert.equal(x.tables.Images[2][4],true);assert.equal(x.tables.Images.length,3);
});
test('card collection and recent activity references prevent image deletion',()=>{
  const x=fixture(),args={imageId:'100',action:'DELETE',confirm:'100',expectedRevision:x.revision('Images','ImageID','100')};
  x.log.CardCollections.push(['U001','100']);assert.throws(()=>x.call('maintainCatalogImageForUniverse',args),/参照/);
  x.log.CardCollections.pop();x.log.RecentActivities.push(['U001','DRAW_CARD','100']);assert.throws(()=>x.call('maintainCatalogImageForUniverse',args),/参照/);
});
test('unreferenced image removal clears only its record and does not delete Drive files',()=>{
  const x=fixture();x.call('maintainCatalogImageForUniverse',{imageId:'101',action:'DELETE',confirm:'101',expectedRevision:x.revision('Images','ImageID','101')});
  assert.equal(x.tables.Images[2][0],'');assert.equal(x.tables.Images[1][4],'member-file');assert.equal(x.files.length,0);
});
test('retired logo cleanup is a no-op when only member images exist',()=>{
  const x=fixture(),members=structuredClone(x.tables.Images.slice(1,3));x.call('retireCatalogLogosForUniverse',{confirm:'RETIRE_LOGOS'});
  assert.deepEqual(x.tables.Images.slice(1,3),members);assert.equal(x.tables.Images.length,3);
});
test('backups are copied and verified before publishing their IDs',()=>{
  const x=fixture();const r=x.call('createCatalogBackupsForUniverse',{confirm:'CREATE_BACKUP'});
  assert.equal(x.files.length,2);assert.notEqual(r.backup.coreId,'core');assert.equal(x.props.UNIVERSE_CATALOG_BACKUP_ID,r.backup.coreId);assert.ok(x.data[r.backup.coreId].ProfileSettings);assert.ok(x.data[r.backup.logId].IDRegistry);
});
test('repair preview writes nothing; execution fills only missing canonical rows',()=>{
  const x=fixture();x.tables.Profiles.pop();x.tables.Links.pop();const preview=x.call('repairCatalogDatabaseForUniverse',{preview:true});assert.equal(x.writes.length,0);assert.equal(preview.plan.length,2);
  x.call('repairCatalogDatabaseForUniverse',{preview:false,confirm:'REPAIR',expectedRevision:preview.revision});assert.equal(x.tables.Profiles.at(-1)[0],'M501');assert.equal(x.tables.Links.at(-1)[1],'M501');
});
test('stale repair plan and unknown user are refused without writes',()=>{
  const x=fixture();assert.throws(()=>x.call('repairCatalogDatabaseForUniverse',{preview:false,confirm:'REPAIR',expectedRevision:'stale'}),/再確認/);
  assert.throws(()=>x.call('getCatalogMaintenanceBootstrapForUniverse',{userId:'unknown'}),/user/);assert.equal(x.writes.length,0);
});
test('backup restore preview writes nothing; restore preserves service histories and IDRegistry',()=>{
  const x=fixture();x.tables.Profiles[1][2]='Changed';x.log.CardCollections.push(['U001','100']);x.log.IDRegistry.push(['9999']);const logBefore=structuredClone(x.log.CardCollections);
  const preview=x.call('restoreCatalogMasterDataForUniverse',{preview:true,backupId:'backupCore0'});assert.equal(x.writes.length,0);
  x.call('restoreCatalogMasterDataForUniverse',{preview:false,backupId:'backupCore0',expectedRevision:preview.revision,confirm:'RESTORE_MASTER_DATA'});
  assert.equal(x.tables.Profiles[1][2],'Blue');assert.deepEqual(x.log.CardCollections,logBefore);assert.deepEqual(x.log.IDRegistry.at(-1),['9999']);assert.equal(x.tables.Images.length,3);
});
test('restore rechecks revision after safety backup and rolls back partial failures',()=>{
  const x=fixture();x.tables.Profiles[1][2]='Changed';let preview=x.call('restoreCatalogMasterDataForUniverse',{preview:true,backupId:'backupCore0'});
  x.tables.Profiles[1][2]='Newer';assert.throws(()=>x.call('restoreCatalogMasterDataForUniverse',{preview:false,backupId:'backupCore0',expectedRevision:preview.revision,confirm:'RESTORE_MASTER_DATA'}),/変わって/);
  preview=x.call('restoreCatalogMasterDataForUniverse',{preview:true,backupId:'backupCore0'});const before=structuredClone(x.tables);x.failOnce(e=>e.name==='Profiles');
  assert.throws(()=>x.call('restoreCatalogMasterDataForUniverse',{preview:false,backupId:'backupCore0',expectedRevision:preview.revision,confirm:'RESTORE_MASTER_DATA'}),/write failure/);assert.deepEqual(x.tables,before);
});
test('artist correction preserves SongID and creates BE:FIRST owned rows atomically',()=>{
  const x=fixture();x.call('correctCatalogSongArtistForUniverse',{songId:'5001',artist:'BE:FIRST',expectedArtist:'New group',confirm:'5001'});
  assert.equal(x.tables.Songs[2][0],'5001');assert.equal(x.tables.Songs[2][2],'BE:FIRST');assert.ok(x.tables.Credits.some(r=>r[0]==='5001'));assert.ok(x.tables.Metrics.some(r=>r[0]==='5001'));
});
test('artist correction rolls back newly owned rows on audit failure',()=>{
  const x=fixture(),before=structuredClone(x.tables);x.failAudit();assert.throws(()=>x.call('correctCatalogSongArtistForUniverse',{songId:'5001',artist:'BE:FIRST',expectedArtist:'New group',confirm:'5001'}),/audit/);assert.deepEqual(x.tables,before);
});
test('image deletion prevents repair from reattaching the old file; restore clears that tombstone',()=>{
  const x=fixture();x.call('maintainCatalogImageForUniverse',{imageId:'101',action:'DELETE',confirm:'101',expectedRevision:x.revision('Images','ImageID','101')});
  assert.deepEqual(Array.from(x.call('getRetiredCatalogImageFileIdsForUniverse')),['second-file']);
  const plan=x.call('restoreCatalogMasterDataForUniverse',{preview:true,backupId:'backupCore0'});
  x.call('restoreCatalogMasterDataForUniverse',{preview:false,backupId:'backupCore0',expectedRevision:plan.revision,confirm:'RESTORE_MASTER_DATA'});
  assert.deepEqual(Array.from(x.call('getRetiredCatalogImageFileIdsForUniverse')),[]);
});
test('restore refuses to orphan an image acquired after the backup',()=>{
  const x=fixture();x.tables.Images.push(['999','M101','R','new-file',false]);x.log.CardCollections.push(['U001','999']);
  assert.throws(()=>x.call('restoreCatalogMasterDataForUniverse',{preview:true,backupId:'backupCore0'}),/履歴参照/);
  assert.equal(x.writes.length,0);
});

test('member reorder updates both master and primary-group order while preserving other groups',()=>{
  const x=fixture();x.tables.Members.push(['M102','G1','SHUNTO','#998877',3,'ACTIVE']);x.tables.Links.push(['G1','M102',2]);
  x.call('moveCatalogMemberDisplayOrderForUniverse',{memberId:'M101',direction:'DOWN'});
  assert.equal(x.tables.Members[1][4],3);assert.equal(x.tables.Members[3][4],1);
  assert.equal(x.tables.Links[1][2],2);assert.equal(x.tables.Links[3][2],1);assert.equal(x.tables.Links[2][2],1);
});

test('group rename updates quiz course labels atomically and refuses unsafe historical restore',()=>{
 const x=fixture();x.log.QuizScores=[['ScoreID','Course','Score'],['score1','NEW GROUP',99]];
 x.call('maintainCatalogGroupForUniverse',{groupId:'G7',expectedRevision:x.revision('Groups','GroupID','G7'),name:'Renamed',kind:'GROUP',color:'#abcdef',displayOrder:3});
 assert.deepEqual(x.log.QuizScores[1],['score1','RENAMED',99]);
 assert.throws(()=>x.call('restoreCatalogMasterDataForUniverse',{backupId:'backupCore0'}),/クイズ履歴/);
});
test('restore rejects duplicate identities and dangling core references before writes',()=>{
 const x=fixture();x.data.backupCore0.Members.push([...x.data.backupCore0.Members[1]]);
 assert.throws(()=>x.call('restoreCatalogMasterDataForUniverse',{backupId:'backupCore0'}),/ID重複/);assert.equal(x.writes.length,0);
 const y=fixture();y.data.backupCore0.Links[1][1]='999';
 assert.throws(()=>y.call('restoreCatalogMasterDataForUniverse',{backupId:'backupCore0'}),/参照不整合/);assert.equal(y.writes.length,0);
});

test('all Universe users manage guests and groups without activation flags or Google roles',()=>{
 for(const userId of ['U001','U002','U003']){
  const x=fixture();Object.keys(x.props).filter(k=>k.includes('ENABLED')).forEach(k=>x.props[k]='false');delete x.props.UNIVERSE_CATALOG_ADMIN_EMAILS;
  x.call('getCatalogMaintenanceBootstrapForUniverse',{userId});
  x.call('maintainCatalogGuestForUniverse',{userId,guestId:'901',name:'Corrected',expectedRevision:x.revision('Guests','GuestID','901')});
  x.call('maintainCatalogGroupForUniverse',{userId,groupId:'G7',name:'Shared group',kind:'GROUP',color:'#abcdef',displayOrder:2,expectedRevision:x.revision('Groups','GroupID','G7')});
  assert.equal(x.tables.Guests[1][1],'Corrected');assert.equal(x.tables.Groups[2][1],'Shared group');
  assert.equal(x.call('getCatalogManagementReadinessForUniverse',{userId}).ready,true);
 }
});

test('historical Log field definitions restore into Core and discard retired quiz column',()=>{
  const x=fixture();
  const old=x.data.backupCore0.ProfileSettings;
  delete x.data.backupCore0.ProfileSettings;
  old.forEach((r,i)=>r.splice(6,0,i===0?'QuizDifficulty':'普通'));
  x.data.backupLog0.ProfileSettings=old;
  x.tables.ProfileSettings[2][1]='Changed field';
  const plan=x.call('restoreCatalogMasterDataForUniverse',{preview:true,backupId:'backupCore0'});
  x.call('restoreCatalogMasterDataForUniverse',{preview:false,backupId:'backupCore0',expectedRevision:plan.revision,confirm:'RESTORE_MASTER_DATA'});
  assert.equal(x.tables.ProfileSettings[2][1],'好きな色');
  assert.equal(x.tables.ProfileSettings[0].length,8);
  assert.equal(x.log.ProfileSettings,undefined);
  assert.equal(x.data.backupLog0.ProfileSettings[0][6],'QuizDifficulty');
});

test('live profile definitions require Core even if a stale Log copy exists',()=>{
  const x=fixture();x.log.ProfileSettings=x.tables.ProfileSettings;delete x.tables.ProfileSettings;
  assert.throws(()=>x.call('getCatalogMaintenanceBootstrapForUniverse',{}),/ProfileSettings|見つかり|ありません|Missing/);
});
