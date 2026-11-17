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
  assert.match(catalog,/BU1\.SHEETS\.TRANSFERS/);
  assert.match(catalog,/snap\.range\.clearContent\(\)/);
  assert.match(catalog,/snap\.formulas\[i\]\|\|v/);
  assert.match(catalog,/CATALOG_Audit/);
  assert.match(catalog,/IDRegistry is intentionally retained/);
});
