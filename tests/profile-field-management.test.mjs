import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..');
const src=fs.readFileSync(path.join(root,'ProfileFieldManagement.gs'),'utf8');

test('profile-field module parses and keeps writes behind opt-in + backups',()=>{
  assert.doesNotThrow(()=>new vm.Script(src));
  assert.match(src,/UNIVERSE_CATALOG_PROFILE_FIELDS_ENABLED/);
  assert.match(src,/UNIVERSE_CATALOG_BACKUP_ID/);
  assert.match(src,/UNIVERSE_CATALOG_LOG_BACKUP_ID/);
  assert.match(src,/reserveNumberForKey_\(ss,'NEXT_PROFILE_ID'/);
  assert.match(src,/finalizeIdReservation_\(reserved,true/);
  assert.match(src,/finalizeIdReservation_\(reserved,false/);
  assert.match(src,/ProfileIDの上限P999/);
});

test('profile metadata validates names, types and compatible multivalue fields',()=>{
  const sandbox={
    clean_:(v)=>v==null?'':String(v).trim(),
    catalogRequiredString_:(value,label,max)=>{
      const v=String(value||'').trim();
      if(!v||v.length>max)throw new Error(label+'が不正');
      return v;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(src,sandbox);
  const prep=(value)=>vm.runInContext('pfMgmtPrepareInput_('+JSON.stringify(value)+')',sandbox);
  const good=prep({name:'好きな楽器',dataType:'TEXT',isMultiValue:true,displayGroup:'好み'});
  assert.equal(good.name,'好きな楽器');
  assert.equal(good.isMultiValue,true);
  assert.equal(good.displayGroup,'好み');
  assert.throws(()=>prep({name:'体重',dataType:'NUMBER',isMultiValue:true}),/文字列/);
  assert.throws(()=>prep({name:'日付',dataType:'DATETIME',isMultiValue:false}),/形式/);
  assert.throws(()=>prep({name:'',dataType:'TEXT',isMultiValue:false}),/項目名/);
  assert.throws(()=>prep({name:'色',dataType:'TEXT'}),/複数値設定/);
});

test('field hide / restore changes only ProfileSettings.IsActive and retains values',()=>{
  const headers=['ProfileID','FieldName','DataType','IsMultiValue','DisplayGroup',
    'IsCompareTarget','QuizDifficulty','DisplayOrder','IsActive'];
  const map=Object.fromEntries(headers.map((v,i)=>[v,i]));
  const rec=(id,name,active,rowNumber)=>({
    rowNumber,values:[id,name,'TEXT',false,'基本',false,'普通',rowNumber-2,active]
  });
  const original=[
    rec('P000','呼ばれ順',true,2),
    rec('P001','本名',true,3)
  ];
  const profile={
    header:['MemberID','P000','P001'],
    map:{MemberID:0,P000:1,P001:2},
    rows:[{rowNumber:2,values:['101',1,'テスト']}]
  };
  const settings={header:headers,map,rows:original,sheet:null};
  const audits=[];
  const log={
    getRange:(row,col)=>{
      assert.equal(col,9);
      return {
        getValue:()=>settings.rows[row-2].values[8],
        setValue:(v)=>{settings.rows[row-2].values[8]=v;}
      };
    }
  };
  settings.sheet=log;
  const context={
    clean_:(v)=>v==null?'':String(v).trim(),
    id_:(v)=>String(v).trim(),
    catalogRequiredString_:(v)=>String(v).trim(),
    catalogRequireAdmin_:()=> 'admin@example.com',
    catalogRequireReady_:()=>{},
    catalogTable_:(ss,name)=> name==='05_Profiles'?profile:settings,
    catalogRow_:(t,key,val)=>t.rows.find(r=>r.values[t.map[key]]===val),
    catalogAudit_:(...args)=>audits.push(args),
    withSharedWriterLock_:(_label,fn)=>fn(),
    openCoreSpreadsheet_:()=>({}),
    SpreadsheetApp:{openById:()=>log,flush:()=>{}},
    PropertiesService:{getScriptProperties:()=>({getProperty:(k)=>
      k==='UNIVERSE_CATALOG_PROFILE_FIELDS_ENABLED'?'true':''})},
    BU1:{SHEETS:{PROFILES:'05_Profiles'},LOG_DB_ID:'log'}
  };
  vm.createContext(context);
  vm.runInContext(src,context);
  const act=(args)=>vm.runInContext('setCatalogProfileFieldActiveForUniverse('+JSON.stringify(args)+')',context);
  const disabled=act({profileId:'P001',expectedActive:true,isActive:false});
  assert.equal(disabled.ok,true);
  assert.equal(settings.rows[1].values[8],false);
  assert.equal(profile.rows[0].values[2],'テスト');
  const restored=act({profileId:'P001',expectedActive:false,isActive:true});
  assert.equal(restored.isActive,true);
  assert.equal(settings.rows[1].values[8],true);
  assert.equal(audits.length,2);
  assert.throws(()=>act({profileId:'P000',expectedActive:true,isActive:false}),/基礎項目/);
  assert.throws(()=>act({profileId:'P001',expectedActive:false,isActive:false}),/最新情報/);
});

test('create path preserves old cells and rolls back partially added field',()=>{
  assert.match(src,/p\.getLastColumn\(\)\+1/);
  assert.match(src,/PASTE_FORMAT,false/);
  assert.doesNotMatch(src,/PASTE_DATA_VALIDATION/);
  assert.match(src,/pfMgmtRequireShape_\(ss\)/);
  assert.match(src,/logRow=appendStyledRow_\(log,values\)/);
  assert.match(src,/log\.deleteRow\(logRow\)/);
  assert.match(src,/p\.deleteColumn\(column\)/);
  assert.match(src,/p\.getRange\(1,column\)\.clearContent\(\)/);
  assert.doesNotMatch(src,/clearDataRows_/);
});
