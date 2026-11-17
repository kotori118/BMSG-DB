import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..');
const catalog=fs.readFileSync(path.join(root,'CatalogManagement.gs'),'utf8');
const writer=fs.readFileSync(path.join(root,'UniverseService.gs'),'utf8');

test('catalog is opt-in and rejects anonymous/unapproved users',()=>{
  const sandbox={
    result:[],
    PropertiesService:{getScriptProperties:()=>({getProperty:(k)=>k==='UNIVERSE_CATALOG_ENABLED'?'false':''})},
    Session:{getActiveUser:()=>({getEmail:()=>''})},
    requireUniverseServiceUser_:()=>true
  };
  vm.runInNewContext(catalog+'\nresult.push((()=>{try{catalogRequireAdmin_({userId:"U001"});return "allowed";}catch(e){return e.message}})());',sandbox);
  assert.match(sandbox.result[0],/有効化されていません/);
  sandbox.PropertiesService={getScriptProperties:()=>({getProperty:(k)=>k==='UNIVERSE_CATALOG_ENABLED'?'true':'owner@example.com'})};
  vm.runInNewContext('result.push((()=>{try{catalogRequireAdmin_({userId:"U001"});return "allowed";}catch(e){return e.message}})());',sandbox);
  assert.match(sandbox.result[1],/管理操作できません/);
});

test('site writer keeps registry allocation and a lyricless opt-in',()=>{
  assert.match(writer,/if \(!parts\.length && !context\.allowEmptyParts\)/);
  assert.match(writer,/reserveNumberForKey_\(ss, 'NEXT_SONG_ID_'/);
  assert.match(catalog,/createSongWithPartsCore_\(ss,song,credits,\[\],\{/);
  assert.match(catalog,/allowEmptyParts:true/);
  assert.match(catalog,/saveCatalogSoloForUniverse/);
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
  assert.match(catalog,/UNIVERSE_CATALOG_SONG_DELETE_ENABLED/);
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

test('DB optimization audit is administrator gated and performs read-only checks',()=>{
  const audit=fs.readFileSync(path.join(root,'CatalogDbAudit.gs'),'utf8');
  assert.match(audit,/function auditCatalogDatabaseForUniverse\(payload\)/);
  assert.match(audit,/catalogRequireAdmin_\(payload\|\|\{\}\)/);
  assert.match(audit,/ORPHAN_LYRICS/);
  assert.match(audit,/MISSING_METRICS/);
  assert.match(audit,/CREDIT_TITLE_DRIFT/);
  assert.match(audit,/LEGACY_INPUT/);
  assert.doesNotMatch(audit,/\.setValues\(|\.setValue\(|\.clearContent\(|\.deleteRow\(/);
});

test('sheet-entry routes can be locked when site-only mode is enabled',()=>{
  const code=fs.readFileSync(path.join(root,'Code.gs'),'utf8');
  assert.match(code,/function siteOnlyDbWritesEnabled_\(\)/);
  assert.match(code,/UNIVERSE_SITE_ONLY_WRITES/);
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

test('identifier allocation stays within the owning artist/member band',()=>{
  assert.match(writer,/Number\(reservation\.numericValue\)>band\+999/);
  assert.match(catalog,/Number\(res\.numericValue\)>band\+99/);
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
