import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..');
const src=fs.readFileSync(path.join(root,'ProfileFieldManagement.gs'),'utf8');

test('profile-field module validates a user and preserves backup requirements',()=>{
  assert.doesNotThrow(()=>new vm.Script(src));
  assert.doesNotMatch(src,/UNIVERSE_CATALOG_PROFILE_FIELDS_ENABLED/);
  assert.match(src,/catalogRequireUser_/);
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
    'IsCompareTarget','DisplayOrder','IsActive'];
  const map=Object.fromEntries(headers.map((v,i)=>[v,i]));
  const rec=(id,name,active,rowNumber)=>({
    rowNumber,values:[id,name,'TEXT',false,'基本',false,rowNumber-2,active]
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
      assert.equal(col,map.IsActive+1);
      return {
        getValue:()=>settings.rows[row-2].values[map.IsActive],
        setValue:(v)=>{settings.rows[row-2].values[map.IsActive]=v;}
      };
    }
  };
  settings.sheet=log;
  const context={
    clean_:(v)=>v==null?'':String(v).trim(),
    id_:(v)=>String(v).trim(),
    catalogRequiredString_:(v)=>String(v).trim(),
    catalogRequireUser_:()=> 'admin@example.com',
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
  assert.equal(settings.rows[1].values[map.IsActive],false);
  assert.equal(profile.rows[0].values[2],'テスト');
  const restored=act({profileId:'P001',expectedActive:false,isActive:true});
  assert.equal(restored.isActive,true);
  assert.equal(settings.rows[1].values[map.IsActive],true);
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

test('field creation writes P016 to Core value and definition tables without changing existing values; rollback is safe',()=>{
  function fakeSheet(rows){
    const sh={
      data:rows.map(r=>r.slice()),
      cols:Math.max(...rows.map(r=>r.length)),
      getLastRow(){return this.data.length;},
      getLastColumn(){return Math.max(...this.data.map(x=>x.length));},
      getMaxRows(){return this.data.length;},
      getMaxColumns(){return this.cols;},
      getColumnWidth(){return 100;},
      setColumnWidth(){},
      insertColumnAfter(c){assert.equal(c,this.cols);this.cols++;this.data.forEach(r=>r.push(''));},
      deleteColumn(c){this.data.forEach(r=>r.splice(c-1,1));this.cols--;},
      deleteRow(r){this.data.splice(r-1,1);},
      getRange(row,col){
        return {
          getValue:()=>sh.data[row-1][col-1],
          setValue:(v)=>{sh.data[row-1][col-1]=v;},
          clearContent:()=>{sh.data[row-1][col-1]='';},
          copyTo:()=>{}
        };
      }
    };
    return sh;
  }
  function makeSandbox(failAudit){
    const headers=['ProfileID','FieldName','DataType','IsMultiValue','DisplayGroup',
      'IsCompareTarget','DisplayOrder','IsActive'];
    const settings=fakeSheet([
      headers,
      ['P000','呼ばれ順','NUMBER',false,'基本',true,0,true],
      ['P001','本名','TEXT',false,'基本',false,1,true]
    ]);
    const profile=fakeSheet([['MemberID','P000','P001'],['101',1,'テスト']]);
    const core={getSheetByName:()=>profile}, log={getSheetByName:()=>settings};
    const statuses=[],audits=[];
    const table=(sheet)=>{
      const h=sheet.data[0].slice();
      return {
        sheet,header:h,map:Object.fromEntries(h.map((x,i)=>[x,i])),
        rows:sheet.data.slice(1).map((values,i)=>({rowNumber:i+2,values:values.slice()}))
      };
    };
    const props={
      UNIVERSE_CATALOG_PROFILE_FIELDS_ENABLED:'true',
      UNIVERSE_CATALOG_BACKUP_ID:'core-backup',
      UNIVERSE_CATALOG_LOG_BACKUP_ID:'log-backup'
    };
    const env={
      clean_:(v)=>v==null?'':String(v).trim(),
      id_:(v)=>String(v).trim(),
      catalogRequireUser_:()=> 'admin@example.com',
      catalogRequireReady_:()=>{},
      catalogRequiredString_:(v,name,max)=>{
        v=String(v||'').trim();if(!v||v.length>max)throw new Error(name);
        return v;
      },
      catalogTable_:(ss,name)=>name==='05_Profiles'?table(profile):table(settings),
      catalogAudit_:(...args)=>{
        if(failAudit)throw new Error('audit unavailable');
        audits.push(args);
      },
      withSharedWriterLock_:(_label,fn)=>fn(),
      openCoreSpreadsheet_:()=>core,
      reserveNumberForKey_:()=>({numericValue:16,issuedId:'P016',requestId:'r1'}),
      finalizeIdReservation_:(_r,committed)=>statuses.push(committed),
      appendStyledRow_:(sheet,values)=>{sheet.data.push(values.slice());return sheet.data.length;},
      PropertiesService:{getScriptProperties:()=>({getProperty:(k)=>props[k]||''})},
      SpreadsheetApp:{
        openById:(id)=>id==='log'?log:{getSheetByName:()=>({})},
        CopyPasteType:{PASTE_FORMAT:'format'},
        flush:()=>{}
      },
      DriveApp:{getFileById:()=>({getName:()=> 'separate snapshot'})},
      BU1:{SHEETS:{PROFILES:'05_Profiles'},LOG_DB_ID:'log',CORE_DB_ID:'core'},
      catalogRow_:()=>{throw new Error('unused');}
    };
    vm.createContext(env);
    vm.runInContext(src,env);
    return {env,profile,settings,statuses,audits};
  }
  const payload={userId:'U001',name:'推しカラー',dataType:'TEXT',isMultiValue:false,displayGroup:'好み'};
  const ok=makeSandbox(false);
  const invoke=(mock)=>vm.runInContext('createCatalogProfileFieldForUniverse('+JSON.stringify(payload)+')',mock.env);
  const result=invoke(ok);
  assert.equal(result.profileId,'P016');
  assert.deepEqual(ok.profile.data[0],['MemberID','P000','P001','P016']);
  assert.deepEqual(ok.profile.data[1],['101',1,'テスト','']);
  assert.equal(ok.settings.data.at(-1)[0],'P016');
  assert.equal(ok.settings.data.at(-1)[1],'推しカラー');
  assert.equal(ok.settings.data.at(-1)[ok.settings.data[0].indexOf('IsActive')],true);
  assert.deepEqual(ok.statuses,[true]);
  assert.equal(ok.audits.length,1);
  const failed=makeSandbox(true);
  assert.throws(()=>invoke(failed),/audit unavailable/);
  assert.deepEqual(failed.profile.data,[['MemberID','P000','P001'],['101',1,'テスト']]);
  assert.equal(failed.settings.data.length,3);
  assert.deepEqual(failed.statuses,[false]);
});
