import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
const root=path.resolve(import.meta.dirname,'..');
const src=fs.readFileSync(path.join(root,'CatalogMemberMaintenance.gs'),'utf8');

function sandbox(){
  const data={
    Members:[['MemberID','GroupID','DisplayName','DisplayOrder','RecordStatus'],
      ['101','1','SOTA',1,'ACTIVE'],['102','1','SHUNTO',2,'ACTIVE'],['201','2','KAIRYU',3,'ACTIVE']],
    Groups:[['GroupID','GroupName','GroupKind','RecordStatus'],
      ['1','BE:FIRST','GROUP','ACTIVE'],['2','MAZZEL','GROUP','ACTIVE'],['6','ShowMinorSavage','UNIT','ACTIVE']],
    Links:[['GroupID','MemberID','DisplayOrder'],
      ['1','101',1],['1','102',2],['2','201',1],['6','101',1]]
  };
  const fakeSheet=(name)=>({
    getName:()=>name,
    getLastColumn:()=>data[name][0].length,
    getRange:(row,col,count=1,width=1)=>({
      getValue:()=>data[name][row-1]?.[col-1],
      setValue:(v)=>{data[name][row-1][col-1]=v;},
      getValues:()=>Array.from({length:count},(_,i)=>data[name][row-1+i].slice(col-1,col-1+width)),
      getFormulas:()=>Array.from({length:count},()=>Array(width).fill('')),
      setValues:(v)=>{for(let i=0;i<v.length;i++)for(let j=0;j<v[i].length;j++)data[name][row-1+i][col-1+j]=v[i][j];},
      clearContent:()=>{for(let i=0;i<count;i++)for(let j=0;j<width;j++)data[name][row-1+i][col-1+j]='';}
    }),
    deleteRow:(row)=>{data[name].splice(row-1,1);}
  });
  const sheets=Object.fromEntries(Object.keys(data).map(n=>[n,fakeSheet(n)]));
  const table=(name)=>{
    const header=data[name][0],map=Object.fromEntries(header.map((n,i)=>[n,i]));
    return{sheet:sheets[name],header,map,rows:data[name].slice(1).map((values,i)=>({rowNumber:i+2,values:values.slice()}))};
  };
  const audits=[];
  const env={
    clean_:(x)=>String(x??'').trim(),
    id_:(x)=>String(x??'').trim(),
    catalogRequireAdmin_:()=> 'admin@example.com',
    catalogRequireReady_:()=>{},
    catalogTable_:(_ss,name)=>table(name),
    catalogRow_:(t,key,id)=>t.rows.find(x=>String(x.values[t.map[key]])===id),
    catalogActive_:(x)=>x!=='ARCHIVED',
    catalogEnsureActive_:(t,r)=>{if(r.values[t.map.RecordStatus]==='ARCHIVED')throw Error('archived');},
    catalogAudit_:(...args)=>audits.push(args),
    withSharedWriterLock_:(_label,fn)=>fn(),
    openCoreSpreadsheet_:()=>({getSheets:()=>Object.values(sheets)}),
    PropertiesService:{getScriptProperties:()=>({getProperty:(name)=>
      name==='UNIVERSE_CATALOG_MEMBER_MAINTENANCE_ENABLED'?'true':''})},
    SpreadsheetApp:{flush:()=>{}},
    readTable_:()=>table('Links'),
    appendStyledRow_:(sh,values)=>{data[sh.getName()].push(values.slice());return data[sh.getName()].length},
    BU1:{SHEETS:{MEMBERS:'Members',GROUPS:'Groups',GROUP_MEMBERS:'Links',PROFILES:'Profiles'}}
  };
  vm.createContext(env);
  vm.runInContext(src,env);
  const invoke=(fn,args)=>vm.runInContext(fn+'('+JSON.stringify(args)+')',env);
  return{data,audits,invoke};
}

test('member maintenance parses; deletes disabled independently',()=>{
  assert.doesNotThrow(()=>new vm.Script(src));
  assert.match(src,/UNIVERSE_CATALOG_MEMBER_MAINTENANCE_ENABLED/);
  assert.match(src,/UNIVERSE_CATALOG_MEMBER_DELETE_ENABLED/);
  assert.match(src,/pfMgmtBackupGate_\(\)/);
  assert.match(src,/externalReferencesChecked!==true/);
  assert.match(src,/catalogMemberDeletePlan_/);
  assert.match(src,/catalogAudit_\('MEMBER',mid,'DELETE'/);
  assert.doesNotMatch(src,/finalizeIdReservation_\(.*true/);
});
test('same-group order changes only two DisplayOrder cells',()=>{
  const s=sandbox();
  const result=s.invoke('moveCatalogMemberDisplayOrderForUniverse',{memberId:'102',direction:'UP'});
  assert.equal(result.ok,true);
  assert.equal(s.data.Members[1][3],2);
  assert.equal(s.data.Members[2][3],1);
  assert.equal(s.data.Members[3][3],3);
  assert.deepEqual(s.data.Links[4],['6','101',1]);
  assert.equal(s.audits.at(-1)[2],'REORDER');
});
test('primary group changes only target member and owned home membership',()=>{
  const s=sandbox();
  const result=s.invoke('changeCatalogMemberPrimaryGroupForUniverse',{memberId:'102',primaryGroupId:'2'});
  assert.equal(result.ok,true);
  assert.equal(s.data.Members[2][1],'2');
  assert.equal(s.data.Members[1][1],'1');
  assert.equal(s.data.Links[2][0],'2');
  assert.equal(s.data.Links[2][2],2);
  assert.deepEqual(s.data.Links[4],['6','101',1]);
  assert.equal(s.audits.at(-1)[2],'CHANGE_PRIMARY');
  assert.throws(()=>s.invoke('changeCatalogMemberPrimaryGroupForUniverse',{memberId:'201',primaryGroupId:'6'}),/主所属/);
});
