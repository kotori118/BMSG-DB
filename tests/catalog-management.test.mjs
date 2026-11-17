import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..');
const catalog=fs.readFileSync(path.join(root,'CatalogManagement.gs'),'utf8');
const writer=fs.readFileSync(path.join(root,'UniverseService.gs'),'utf8');

test('catalog accepts all three Universe users without email, role or activation settings',()=>{
 const env={PropertiesService:{getScriptProperties:()=>{throw Error('unexpected properties read');}},Session:{getActiveUser:()=>{throw Error('unexpected Google identity read');}},requireUniverseServiceUser_:uid=>{if(!['U001','U002','U003'].includes(uid))throw Error('利用ユーザー');}};
 vm.createContext(env);vm.runInContext(catalog,env);
 for(const userId of ['U001','U002','U003'])assert.equal(env.catalogRequireUser_({userId}),userId);
 for(const userId of ['',null,'U999'])assert.throws(()=>env.catalogRequireUser_({userId}),/利用ユーザー/);
});

test('site writer keeps registry allocation and a lyricless opt-in',()=>{
  assert.match(writer,/if \(!parts\.length && !context\.allowEmptyParts\)/);
  assert.match(writer,/reserveNumberForKey_\(ss, 'NEXT_SONG_ID_'/);
  assert.match(catalog,/createSongWithPartsCore_\(ss,song,credits,parts,\{/);
  assert.match(catalog,/allowEmptyParts:payload.includeLyrics!==true/);
  assert.doesNotMatch(catalog,/saveCatalogSoloForUniverse/);
});

test('catalog has explicit backup and schema gates',()=>{
  assert.match(catalog,/UNIVERSE_CATALOG_BACKUP_ID/);
  assert.match(catalog,/MIGRATE_CATALOG_V1/);
  assert.match(catalog,/catalogRequireReady_\(ss\)/);
  assert.match(catalog,/catalogAudit_\(/);
});

test('record updates touch only requested columns, preserving unrelated formulas',()=>{
  assert.match(catalog,/sheet\.getRange\(row\.rowNumber,col\.column\)\.setValue\(col\.newValue\)/);
  assert.doesNotMatch(catalog,/sheet\.getRange\(row\.rowNumber,1,1,after\.length\)\.setValues/);
});

test('songs have a deletion preview and no archive or restore action',()=>{
  assert.match(catalog,/function getCatalogSongDeletePreviewForUniverse/);
  assert.match(catalog,/function deleteCatalogSongForUniverse/);
  assert.match(catalog,/function catalogSongDeletePlan_/);
  assert.doesNotMatch(catalog,/function setCatalogSongArchiveForUniverse/);
  assert.doesNotMatch(catalog,/songs:\['RecordStatus'/);
  assert.match(catalog,/SongType','SoloMemberID/);
});

test('permanent deletion requires typed confirmation, external review and backup',()=>{
  assert.doesNotMatch(catalog,/UNIVERSE_CATALOG_SONG_DELETE_ENABLED/);
  assert.match(catalog,/catalogRequireUser_/);
  assert.match(catalog,/externalReferencesChecked!==true/);
  assert.match(catalog,/confirmTitle/);
  assert.match(catalog,/UNIVERSE_CATALOG_BACKUP_ID/);
  assert.match(catalog,/catalogSongDeletePlan_\(ss,songId\)/);
  assert.match(catalog,/!plan\.canDelete/);
});

test('deletion cleans direct children without shifting unrelated spreadsheet rows',()=>{
  assert.match(catalog,/BU1\.SHEETS\.SONG_CREDITS/);
  assert.match(catalog,/BU1\.SHEETS\.LYRICS_PARTS/);
  assert.match(catalog,/BU1\.SHEETS\.METRICS/);
  assert.match(catalog,/snap\.range\.clearContent\(\)/);
  assert.match(catalog,/snap\.formulas\[i\]\|\|v/);
  assert.match(catalog,/CATALOG_Audit/);
  assert.match(catalog,/IDRegistry is intentionally retained/);
});

test('new BE:FIRST song creates only its missing performance-metrics row',()=>{
  const metrics=fs.readFileSync(path.join(root,'MetricsTransfers.gs'),'utf8');
  const create=writer.slice(writer.indexOf('function createSongWithPartsCore_'),writer.indexOf('function replaceSongPartsCore_'));
  assert.match(metrics,/function ensurePerformanceMetricRowForSong_\(ss, songId\)/);
  assert.match(metrics,/if\(found\.length===1\)return \{created:false/);
  assert.match(metrics,/appendStyledRow_\(sheet,vals\)/);
  assert.match(create,/ensurePerformanceMetricRowForSong_\(ss,reservation\.issuedId\)/);
  assert.match(create,/rollback\.push\(\{sheet:metric\.sheet,row:metric\.row\}\)/);
  assert.doesNotMatch(create,/syncPerformanceMetricRows\(ss, true\)/);
});

test('DB optimization audit validates a Universe user and performs read-only checks',()=>{
  const audit=fs.readFileSync(path.join(root,'CatalogDbAudit.gs'),'utf8');
  assert.match(audit,/function auditCatalogDatabaseForUniverse\(payload\)/);
  assert.match(audit,/catalogRequireUser_\(payload\|\|\{\}\)/);
  assert.match(audit,/ORPHAN_LYRICS/);
  assert.match(audit,/MISSING_METRICS/);
  assert.match(audit,/CREDIT_TITLE_DRIFT/);
  assert.match(audit,/LEGACY_INPUT/);
  assert.doesNotMatch(audit,/\.setValues\(|\.setValue\(|\.clearContent\(|\.deleteRow\(/);
});

test('retired sheet-entry routes are always blocked',()=>{
  const code=fs.readFileSync(path.join(root,'Code.gs'),'utf8');
  assert.match(code,/function siteOnlyDbWritesEnabled_\(\)/);
  assert.match(code,/function siteOnlyDbWritesEnabled_\(\) \{ return true; \}/);
  assert.match(code,/function blockLegacySheetWrite_\(operation\)/);
  const protectedRoutes={
    'Groups.gs':['confirmAndSyncMemberships'],
    'Profiles.gs':['confirmAndSyncProfiles','retireSelectedProfileField','restoreRetiredProfileFields'],
    'Masters.gs':['confirmAndSyncDirectMasters'],
    'Lyrics.gs':['commitLyricsInput'],
    'MetricsTransfers.gs':['syncPerformanceMetricRows'],
    'Cards.gs':['syncCardsOnAccess_'],
    'UniverseService.gs':['commitLegacyDirectMasters_','commitLegacyLyricsInputForSharedWriter_']
  };
  for(const [file,names] of Object.entries(protectedRoutes)){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const name of names){
      const location=source.indexOf('function '+name+'(');
      assert.ok(location>=0,'missing '+file+'.'+name);
      assert.match(source.slice(location,location+210),/blockLegacySheetWrite_\(/,'unguarded '+file+'.'+name);
    }
  }
});

test('SongID keeps legacy band; G/U and M use unbounded shared/global issuers',()=>{
  const code=fs.readFileSync(path.join(root,'Code.gs'),'utf8');
  assert.match(writer,/Number\(reservation\.numericValue\)>band\+999/);
  assert.match(code,/NEXT_GROUP_ID_GROUP/);
  assert.match(code,/NEXT_GROUP_ID_UNIT/);
  assert.match(code,/NEXT_MEMBER_ID_GLOBAL/);
  assert.match(catalog,/NEXT_MEMBER_ID_GLOBAL/);
  assert.doesNotMatch(catalog,/MemberIDの採番帯が上限/);
});
test('schema installation checks existing catalog audit table headers before mutation',()=>{
  assert.match(catalog,/existingAudit/);
  assert.match(catalog,/列構造に不整合があります/);
  assert.match(catalog,/Log\.CATALOG_Audit\./);
});

test('PartTransfers are retired without touching PerformanceMetrics',()=>{
  const code=fs.readFileSync(path.join(root,'Code.gs'),'utf8');
  const metrics=fs.readFileSync(path.join(root,'MetricsTransfers.gs'),'utf8');
  const profile=fs.readFileSync(path.join(root,'Profiles.gs'),'utf8');
  const audit=fs.readFileSync(path.join(root,'CatalogDbAudit.gs'),'utf8');
  assert.doesNotMatch(code,/11_PartTransfers|SHEETS\.TRANSFERS|NEXT_TRANSFER_ID/);
  assert.doesNotMatch(profile,/SHEETS\.TRANSFERS/);
  assert.doesNotMatch(catalog,/SHEETS\.TRANSFERS/);
  assert.doesNotMatch(audit,/SHEETS\.TRANSFERS|ORPHAN_TRANSFER/);
  assert.doesNotMatch(metrics,/confirmAndSyncPartTransfers|deleteSelectedPartTransfer/);
  assert.match(code,/10_PerformanceMetrics/);
  assert.match(metrics,/function ensurePerformanceMetricRowForSong_\(/);
  assert.match(metrics,/function syncPerformanceMetricRows\(/);
  assert.match(writer,/ensurePerformanceMetricRowForSong_\(ss,reservation\.issuedId\)/);
});

test('new or changed colors must be unique across groups, units and members',()=>{
  const catalogSource=fs.readFileSync(path.join(root,'CatalogManagement.gs'),'utf8');
  assert.match(catalogSource,/function catalogRequireUniqueColor_\(/);
  assert.match(catalogSource,/function catalogValidateChangedColor_\(/);
  assert.match(catalogSource,/catalogRequireUniqueColor_\(ss,color,'GROUP',''\)/);
  assert.match(catalogSource,/catalogRequireUniqueColor_\(ss,color,'MEMBER',''\)/);
  assert.match(catalogSource,/catalogValidateChangedColor_\(ss,payload\.color\|\|before\.ColorHex/);
  assert.match(catalogSource,/catalogValidateChangedColor_\(ss,payload\.color\|\|row\.values\[t\.map\.ColorHex\]/);
  const sandbox={
    clean_:(v)=>String(v??'').trim(),
    id_:(v)=>String(v??'').trim(),
    normalizeHex_:(v)=>{
      v=String(v??'').trim().toUpperCase();
      if(v&&!/^#[0-9A-F]{6}$/.test(v))throw new Error('Invalid hex');
      return v;
    },
    BU1:{SHEETS:{GROUPS:'Groups',MEMBERS:'Members'}},
    catalogTable_:(_ss,name)=>{
      const rows=name==='Groups'?
        [['1','MAZZEL','#ff0000'],['6','ShowMinorSavage','#000080']]:
        [['401','CHIKA','#FF0000'],['101','SOTA','#00AFCC']];
      const headers=name==='Groups'?['GroupID','GroupName','ColorHex']:['MemberID','DisplayName','ColorHex'];
      return {map:Object.fromEntries(headers.map((h,i)=>[h,i])),rows:rows.map(v=>({values:v}))};
    }
  };
  vm.createContext(sandbox);
  const prefix=catalogSource.slice(catalogSource.indexOf('function catalogRequireUniqueColor_('),
    catalogSource.indexOf('function createCatalogGroupForUniverse('));
  vm.runInContext(prefix,sandbox);
  const check=(c,k,id)=>vm.runInContext(
    'catalogRequireUniqueColor_('+JSON.stringify({})+','+JSON.stringify(c)+','+JSON.stringify(k)+','+JSON.stringify(id)+')',sandbox);
  assert.equal(check('#00ff00','GROUP',''),'#00FF00');
  assert.throws(()=>check('#ff0000','GROUP',''),/MAZZEL.*CHIKA/);
  assert.throws(()=>check('#00afcc','MEMBER',''),/SOTA/);
  assert.throws(()=>check('#000080','GROUP',''),/ShowMinorSavage/);
  // Historical collision is allowed when the record does not change color.
  const unchanged=vm.runInContext("catalogValidateChangedColor_({},'#ff0000','#FF0000','GROUP','1')",sandbox);
  assert.equal(unchanged,'#FF0000');
  // New color from legacy duplicate still must be unused.
  assert.throws(()=>vm.runInContext("catalogValidateChangedColor_({},'#00AFCC','#FF0000','GROUP','1')",sandbox),/SOTA/);
});
