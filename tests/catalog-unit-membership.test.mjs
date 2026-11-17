import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(path.join(import.meta.dirname,'..','CatalogUnitMembership.gs'),'utf8');

function fixture({auditFails=false,registered=true,badOrder=false}={}){
  const store={
    Groups:[
      ['GroupID','GroupName','RecordStatus'],
      ['G1','BE:FIRST','ACTIVE'],
      ['G2','MAZZEL','ACTIVE'],
      ['U6','ShowMinorSavage','ACTIVE'],
      ['U9','BMSG EAST','ACTIVE']],
    Members:[
      ['MemberID','GroupID','DisplayName','RecordStatus'],
      ['M101','G1','SOTA','ACTIVE'],
      ['M102','G1','SHUNTO','ACTIVE'],
      ['M201','G2','KAIRYU','ACTIVE']],
    Links:[
      ['GroupID','MemberID','DisplayOrder'],
      ['G1','M101',1],
      ['G1','M102',2],
      ['G2','M201',1],
      ['U6','M101',1],
      ['U6','M102',2],
      ['U6','M201',badOrder?2:3],
      ['U9','M101',1],
      ['U9','M201',2]
    ]
  };
  const ss={};
  for(const name of Object.keys(store)){
    ss[name]={
      getName:()=>name,
      getRange:(row,col,height=1,width=1)=>({
        getValue:()=>store[name][row-1]?.[col-1],
        setValue:(value)=>{store[name][row-1][col-1]=value;},
        getValues:()=>Array.from({length:height},(_,i)=>store[name][row-1+i].slice(col-1,col-1+width)),
        getFormulas:()=>Array.from({length:height},()=>Array(width).fill('')),
        setValues:(rows)=>{
          for(let i=0;i<rows.length;i++)
            for(let j=0;j<rows[i].length;j++)store[name][row+i-1][col+j-1]=rows[i][j];
        },
        clearContent:()=>{
          for(let i=0;i<height;i++)
            for(let j=0;j<width;j++)store[name][row+i-1][col+j-1]='';
        }
      })
    };
  }
  const audit=[],events=[];
  const ctx={
    BU1:{SHEETS:{GROUPS:'Groups',MEMBERS:'Members',GROUP_MEMBERS:'Links'}},
    clean_:(value)=>value==null?'':String(value).trim(),
    id_:(value)=>value==null?'':String(value).trim(),
    catalogRequireUser_:()=>{
      if(!registered)throw new Error('利用ユーザーが不正です。');
      return 'qa@example.com';
    },
    openCoreSpreadsheet_:()=>({}),
    catalogRequireReady_:()=>{},
    catalogTable_:(_s,name)=>{
      const header=store[name][0];
      return {sheet:ss[name],header:header.slice(),
        map:Object.fromEntries(header.map((v,i)=>[v,i])),
        rows:store[name].slice(1).map((values,i)=>({rowNumber:i+2,values:values.slice()}))};
    },
    catalogRow_:(table,key,id)=>{
      const rows=table.rows.filter(r=>String(r.values[table.map[key]])===id);
      if(rows.length!==1)throw new Error('missing or duplicate id');
      return rows[0];
    },
    catalogEnsureActive_:(table,row)=>{
      if(row.values[table.map.RecordStatus]!=='ACTIVE')throw new Error('inactive');
    },
    withSharedWriterLock_:(_name,fn)=>{
      events.push('lock');
      const result=fn();
      events.push('unlock');
      return result;
    },
    SpreadsheetApp:{flush:()=>events.push('flush')},
    catalogAudit_:(...args)=>{
      if(auditFails)throw new Error('audit refused');
      audit.push(args);
    }
  };
  vm.createContext(ctx);
  vm.runInContext(source,ctx);
  return {store,audit,events,
    call:(fn,payload)=>vm.runInContext(fn+'('+JSON.stringify({userId:'u',...payload})+')',ctx)};
}
const linksOf=(x,groupId)=>x.store.Links.slice(1)
  .filter(r=>r[0]===groupId&&r[1]!=='')
  .map(r=>({id:r[1],order:r[2]}));
const otherTables=(x)=>JSON.stringify({Groups:x.store.Groups,Members:x.store.Members});
test('unit maintenance source parses as GAS-compatible JavaScript',()=>{
  assert.doesNotThrow(()=>new vm.Script(source));
  assert.match(source,/withSharedWriterLock_/);
  assert.match(source,/catalogAudit_/);
});
test('move swaps adjacent order inside selected unit, preserving other unit and home groups',()=>{
  const x=fixture();
  const beforeOthers=otherTables(x),east=JSON.stringify(linksOf(x,'U9'));
  const result=x.call('moveCatalogUnitMemberForUniverse',{
    groupId:'U6',memberId:'M201',direction:'UP',expectedOrder:3
  });
  assert.equal(result.ok,true);
  assert.deepEqual(linksOf(x,'U6'),[
    {id:'M101',order:1},{id:'M102',order:3},{id:'M201',order:2}
  ]);
  assert.equal(JSON.stringify(linksOf(x,'U9')),east);
  assert.equal(otherTables(x),beforeOthers);
  assert.equal(x.audit[0][2],'REORDER');
});
test('remove clears only one UNIT membership, compacts local orders and leaves other groups untouched',()=>{
  const x=fixture();
  const beforeOthers=otherTables(x),east=JSON.stringify(linksOf(x,'U9'));
  const main=JSON.stringify(linksOf(x,'G1'));
  const result=x.call('removeCatalogUnitMemberForUniverse',{
    groupId:'U6',memberId:'M102',expectedOrder:2
  });
  assert.equal(result.removed,true);
  assert.deepEqual(linksOf(x,'U6'),[{id:'M101',order:1},{id:'M201',order:2}]);
  assert.equal(JSON.stringify(linksOf(x,'U9')),east);
  assert.equal(JSON.stringify(linksOf(x,'G1')),main);
  assert.equal(otherTables(x),beforeOthers);
  assert.equal(x.audit[0][2],'REMOVE');
});
test('stale order, missing membership, GROUP target and invalid order fail without writes',()=>{
  const x=fixture(),before=JSON.stringify(x.store);
  assert.throws(()=>x.call('removeCatalogUnitMemberForUniverse',{
    groupId:'U6',memberId:'M102',expectedOrder:1
  }),/再読み込み/);
  assert.throws(()=>x.call('removeCatalogUnitMemberForUniverse',{
    groupId:'U6',memberId:'999',expectedOrder:1
  }),/所属していません/);
  assert.throws(()=>x.call('moveCatalogUnitMemberForUniverse',{
    groupId:'G1',memberId:'M101',direction:'UP',expectedOrder:1
  }),/ユニット/);
  assert.throws(()=>x.call('moveCatalogUnitMemberForUniverse',{
    groupId:'U6',memberId:'M102',direction:'SIDEWAYS',expectedOrder:2
  }),/移動方向/);
  assert.equal(JSON.stringify(x.store),before);
  const invalid=fixture({badOrder:true}),old=JSON.stringify(invalid.store);
  assert.throws(()=>invalid.call('removeCatalogUnitMemberForUniverse',{
    groupId:'U6',memberId:'M102',expectedOrder:2
  }),/重複/);
  assert.equal(JSON.stringify(invalid.store),old);
});
test('membership removal and reorder roll back when audit fails',()=>{
  for(const fn of ['removeCatalogUnitMemberForUniverse','moveCatalogUnitMemberForUniverse']){
    const x=fixture({auditFails:true}),before=JSON.stringify(x.store);
    assert.throws(()=>x.call(fn,{
      groupId:'U6',memberId:'M102',expectedOrder:2,direction:'DOWN'
    }),/audit refused/);
    assert.equal(JSON.stringify(x.store),before);
  }
});
test('an unknown user cannot change UNIT links and boundary moves are no-ops',()=>{
  const denied=fixture({registered:false}),before=JSON.stringify(denied.store);
  assert.throws(()=>denied.call('removeCatalogUnitMemberForUniverse',{
    groupId:'U6',memberId:'M102',expectedOrder:2
  }),/利用ユーザー/);
  assert.equal(JSON.stringify(denied.store),before);
  const x=fixture();
  const res=x.call('moveCatalogUnitMemberForUniverse',{
    groupId:'U6',memberId:'M101',expectedOrder:1,direction:'UP'
  });
  assert.equal(res.unchanged,true);
  assert.equal(x.audit.length,0);
});
test('removing a member never deletes the member master or other memberships',()=>{
  const x=fixture(),p=JSON.stringify(x.store.Members);
  x.call('removeCatalogUnitMemberForUniverse',{
    groupId:'U6',memberId:'M101',expectedOrder:1
  });
  assert.equal(JSON.stringify(x.store.Members),p);
  assert.ok(linksOf(x,'G1').some(x=>x.id==='M101'));
  assert.ok(linksOf(x,'U9').some(x=>x.id==='M101'));
});
