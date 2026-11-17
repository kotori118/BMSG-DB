import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(path.join(import.meta.dirname,'..','CatalogManagement.gs'),'utf8');

function makeEnvironment({auditFails=false}={}){
  const data={
    Groups:[['GroupID','GroupName','ColorHex','DisplayOrder','RecordStatus'],
      ['G1','BE:FIRST','#0000FF',1,'ACTIVE'],['G2','MAZZEL','#FF0000',2,'ACTIVE']],
    Members:[['MemberID','GroupID','DisplayName','ColorHex','DisplayOrder','RecordStatus'],
      ['M201','G2','KAIRYU','#334080',7,'ACTIVE'],['M507','','FUMINO','',33,'ACTIVE']],
    Links:[['GroupID','MemberID','DisplayOrder'],
      ...Array.from({length:8},(_,i)=>['G2','M'+String(201+i),i+1])],
    Profiles:[['MemberID','P000'],['M201',1],['M507','']],
    Audit:[['AuditID','EntityType','EntityID','Action','BeforeJSON','AfterJSON','ActorEmail','OccurredAt','Source']]
  };
  const sheets={};
  for(const name of Object.keys(data)){
    sheets[name]={
      name,
      getName:()=>name,
      getLastRow:()=>data[name].length,
      getLastColumn:()=>data[name][0].length,
      getRange:(r,c)=>({getValue:()=>data[name][r-1]?.[c-1]}),
      deleteRow:(row)=>data[name].splice(row-1,1)
    };
  }
  const ss={getSheetByName:(n)=>sheets[n]};
  const log={getSheetByName:(n)=>n==='CATALOG_Audit'?sheets.Audit:null};
  const finalize=[];
  const vmEnv={
    BU1:{
      SHEETS:{GROUPS:'Groups',MEMBERS:'Members',GROUP_MEMBERS:'Links',PROFILES:'Profiles',SONGS:'Songs'},
      LOG_DB_ID:'log'
    },
    clean_:(v)=>v==null?'':String(v).trim(),
    id_:(v)=>v==null?'':String(v).trim(),
    normalizeHex_:(v)=>String(v).trim().toUpperCase(),
    requireUniverseServiceUser_:()=>{},
    requireSheet_:(x,n)=>x.getSheetByName(n),
    readTable_:(sheet)=>{
      const head=data[sheet.name][0];
      return {sheet,header:head,map:Object.fromEntries(head.map((v,i)=>[v,i])),
        rows:data[sheet.name].slice(1).map((values,i)=>({rowNumber:i+2,values:values.slice()}))};
    },
    requireColumns_:(t,headers)=>{for(const h of headers)if(t.map[h]===undefined)throw new Error('missing '+h);},
    openCoreSpreadsheet_:()=>ss,
    withSharedWriterLock_:(_label,fn)=>fn(),
    reserveNumberForKey_:(_ss,key)=>{
      assert.equal(key,'NEXT_MEMBER_ID_GLOBAL');
      return {issuedId:'M508',numericValue:508};
    },
    finalizeIdReservation_:(_r,committed)=>finalize.push(committed),
    appendStyledRow_:(sh,values)=>{
      if(sh===sheets.Audit&&auditFails)throw new Error('audit unavailable');
      data[sh.name].push(values.slice());
      return data[sh.name].length;
    },
    PropertiesService:{getScriptProperties:()=>({getProperty:(key)=>{
      return {'UNIVERSE_CATALOG_ENABLED':'true','UNIVERSE_CATALOG_ADMIN_EMAILS':'admin@example.com'}[key]||'';
    }})},
    Session:{getActiveUser:()=>({getEmail:()=> 'admin@example.com'})},
    SpreadsheetApp:{flush:()=>{},openById:()=>log},
    Utilities:{getUuid:()=> 'audit-uid'}
  };
  vm.createContext(vmEnv);
  vm.runInContext(source,vmEnv);
  // Structure is prepared in this test fixture; schema migration belongs to
  // a separate explicit staging test.
  vmEnv.catalogRequireReady_=()=>{};
  const create=(payload)=>vm.runInContext('createCatalogMemberForUniverse('+JSON.stringify({
    userId:'U001',name:'QA_MEMBER',primaryGroupId:'G2',color:'#AABBCC',...payload
  })+')',vmEnv);
  return{create,data,finalize};
}

test('member creation uses GLOBAL DisplayOrder but GROUP-local membership order',()=>{
  const x=makeEnvironment(),result=x.create();
  assert.equal(result.ok,true);
  assert.equal(result.memberId,'M508');
  const member=x.data.Members.find(r=>r[0]==='M508');
  const link=x.data.Links.find(r=>r[1]==='M508');
  assert.equal(member[4],34,'02_Members.DisplayOrder must follow global maximum 33');
  assert.equal(link[2],9,'04_GroupMembers.DisplayOrder must follow group 2 maximum 8');
  assert.equal(x.data.Profiles.at(-1)[0],'M508');
  assert.equal(x.data.Audit.length,2);
  assert.deepEqual(x.finalize,[true]);
});

test('member creation rejects globally reused group or member color before reserving ID',()=>{
  const x=makeEnvironment();
  assert.throws(()=>x.create({color:'#ff0000'}),/MAZZEL/);
  assert.throws(()=>x.create({color:'#334080'}),/KAIRYU/);
  assert.equal(x.data.Members.length,3);
  assert.equal(x.data.Profiles.length,3);
  assert.equal(x.finalize.length,0);
});

test('member creation rolls back all added rows when auditing fails',()=>{
  const x=makeEnvironment({auditFails:true});
  assert.throws(()=>x.create(),/audit unavailable/);
  assert.equal(x.data.Members.length,3);
  assert.equal(x.data.Links.length,9);
  assert.equal(x.data.Profiles.length,3);
  assert.deepEqual(x.finalize,[false]);
});
