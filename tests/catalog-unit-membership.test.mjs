import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(path.join(import.meta.dirname,'..','CatalogUnitMembership.gs'),'utf8');

function fixture({auditFails=false,admin=true,badOrder=false}={}){
  const store={
    Groups:[
      ['GroupID','GroupName','GroupKind','RecordStatus'],
      ['1','BE:FIRST','GROUP','ACTIVE'],
      ['2','MAZZEL','GROUP','ACTIVE'],
      ['6','ShowMinorSavage','UNIT','ACTIVE'],
      ['9','BMSG EAST','UNIT','ACTIVE']],
    Members:[
      ['MemberID','GroupID','DisplayName','RecordStatus'],
      ['101','1','SOTA','ACTIVE'],
      ['102','1','SHUNTO','ACTIVE'],
      ['201','2','KAIRYU','ACTIVE']],
    Links:[
      ['GroupID','MemberID','DisplayOrder'],
      ['1','101',1],
      ['1','102',2],
      ['2','201',1],
      ['6','101',1],
      ['6','102',2],
      ['6','201',badOrder?2:3],
      ['9','101',1],
      ['9','201',2]
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
    catalogRequireAdmin_:()=>{
      if(!admin)throw new Error('管理者権限がありません。');
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
  const beforeOthers=otherTables(x),east=JSON.stringify(linksOf(x,'9'));
  const result=x.call('moveCatalogUnitMemberForUniverse',{
    groupId:'6',memberId:'201',direction:'UP',expectedOrder:3
  });
  assert.equal(result.ok,true);
  assert.deepEqual(linksOf(x,'6'),[
    {id:'101',order:1},{id:'102',order:3},{id:'201',order:2}
  ]);
  assert.equal(JSON.stringify(linksOf(x,'9')),east);
  assert.equal(otherTables(x),beforeOthers);
  assert.equal(x.audit[0][2],'REORDER');
});
test('remove clears only one UNIT membership, compacts local orders and leaves other groups untouched',()=>{
  const x=fixture();
  const beforeOthers=otherTables(x),east=JSON.stringify(linksOf(x,'9'));
  const main=JSON.stringify(linksOf(x,'1'));
  const result=x.call('removeCatalogUnitMemberForUniverse',{
    groupId:'6',memberId:'102',expectedOrder:2
  });
  assert.equal(result.removed,true);
  assert.deepEqual(linksOf(x,'6'),[{id:'101',order:1},{id:'201',order:2}]);
  assert.equal(JSON.stringify(linksOf(x,'9')),east);
  assert.equal(JSON.stringify(linksOf(x,'1')),main);
  assert.equal(otherTables(x),beforeOthers);
  assert.equal(x.audit[0][2],'REMOVE');
});
test('stale order, missing membership, GROUP target and invalid order fail without writes',()=>{
  const x=fixture(),before=JSON.stringify(x.store);
  assert.throws(()=>x.call('removeCatalogUnitMemberForUniverse',{
    groupId:'6',memberId:'102',expectedOrder:1
  }),/再読み込み/);
  assert.throws(()=>x.call('removeCatalogUnitMemberForUniverse',{
    groupId:'6',memberId:'999',expectedOrder:1
  }),/所属していません/);
  assert.throws(()=>x.call('moveCatalogUnitMemberForUniverse',{
    groupId:'1',memberId:'101',direction:'UP',expectedOrder:1
  }),/ユニット/);
  assert.throws(()=>x.call('moveCatalogUnitMemberForUniverse',{
    groupId:'6',memberId:'102',direction:'SIDEWAYS',expectedOrder:2
  }),/移動方向/);
  assert.equal(JSON.stringify(x.store),before);
  const invalid=fixture({badOrder:true}),old=JSON.stringify(invalid.store);
  assert.throws(()=>invalid.call('removeCatalogUnitMemberForUniverse',{
    groupId:'6',memberId:'102',expectedOrder:2
  }),/重複/);
  assert.equal(JSON.stringify(invalid.store),old);
});
test('membership removal and reorder roll back when audit fails',()=>{
  for(const fn of ['removeCatalogUnitMemberForUniverse','moveCatalogUnitMemberForUniverse']){
    const x=fixture({auditFails:true}),before=JSON.stringify(x.store);
    assert.throws(()=>x.call(fn,{
      groupId:'6',memberId:'102',expectedOrder:2,direction:'DOWN'
    }),/audit refused/);
    assert.equal(JSON.stringify(x.store),before);
  }
});
test('non-admin cannot change UNIT links and boundary moves are no-ops',()=>{
  const denied=fixture({admin:false}),before=JSON.stringify(denied.store);
  assert.throws(()=>denied.call('removeCatalogUnitMemberForUniverse',{
    groupId:'6',memberId:'102',expectedOrder:2
  }),/管理者権限/);
  assert.equal(JSON.stringify(denied.store),before);
  const x=fixture();
  const res=x.call('moveCatalogUnitMemberForUniverse',{
    groupId:'6',memberId:'101',expectedOrder:1,direction:'UP'
  });
  assert.equal(res.unchanged,true);
  assert.equal(x.audit.length,0);
});
test('removing a member never deletes the member master or other memberships',()=>{
  const x=fixture(),p=JSON.stringify(x.store.Members);
  x.call('removeCatalogUnitMemberForUniverse',{
    groupId:'6',memberId:'101',expectedOrder:1
  });
  assert.equal(JSON.stringify(x.store.Members),p);
  assert.ok(linksOf(x,'1').some(x=>x.id==='101'));
  assert.ok(linksOf(x,'9').some(x=>x.id==='101'));
});
