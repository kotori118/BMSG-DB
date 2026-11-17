import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
function fixture(){
  const store={
    '01_Groups':[['GroupID'],['G1'],['U16'],['G9']],
    '02_Members':[['MemberID'],['M101'],['M507']],
    '06_Songs':[['SongID'],['1001'],['1099']],
    'IDRegistry':[['EntityType','Scope','IssuedID','NumericValue','Status','RequestID','Source','IssuedAt','UpdatedAt','Note'],
      ['GROUP','GLOBAL','19',19,'COMMITTED','oldg','OLD','','',''],
      ['MEMBER','500','509',509,'ABORTED','oldm','OLD','','','']]
  };
  const table=(name)=>{
    const v=store[name],h=v[0],m=Object.fromEntries(h.map((x,i)=>[x,i]));
    return {sheet:{name},header:h,map:m,rows:v.slice(1).map((values,i)=>({rowNumber:i+2,values}))};
  };
  let issued=0;
  const ctx={Utilities:{getUuid:()=> 'uuid_'+(++issued)},console};
  vm.createContext(ctx);
  vm.runInContext(read('Code.gs'),ctx);
  ctx.requireSheet_=(_ss,n)=>({name:n,getName:()=>n});
  ctx.readTable_=(sh)=>table(sh.name);
  ctx.idRegistryTable_=()=>table('IDRegistry');
  ctx.appendStyledRow_=(_sheet,values)=>{store.IDRegistry.push(values.slice());return store.IDRegistry.length};
  ctx.id_=(x)=>String(x??'').trim();
  ctx.clean_=(x)=>String(x??'').trim();
  const ss={};
  return {ctx,store,ss};
}
test('G/U issue a common unbounded sequence and do not collide with retired reservations',()=>{
  const {ctx,store,ss}=fixture();
  const first=ctx.reserveNumberForKey_(ss,'NEXT_GROUP_ID_UNIT','staging','test unit');
  assert.equal(first.issuedId,'U20');
  assert.equal(first.numericValue,20);
  assert.equal(first.scope,'GLOBAL');
  const second=ctx.reserveNumberForKey_(ss,'NEXT_GROUP_ID_GROUP','staging','test group');
  assert.equal(second.issuedId,'G21');
  assert.equal(store.IDRegistry.at(-1)[2],'G21');
  assert.equal(store.IDRegistry.at(-2)[2],'U20');
});
test('M uses global suffix and counts legacy reserved IDs from every band',()=>{
  const {ctx,store,ss}=fixture();
  const first=ctx.reserveNumberForKey_(ss,'NEXT_MEMBER_ID_GLOBAL','staging','test member');
  assert.equal(first.issuedId,'M510');
  assert.equal(first.numericValue,510);
  const second=ctx.reserveNumberForKey_(ss,'NEXT_MEMBER_ID_GLOBAL','staging','second');
  assert.equal(second.issuedId,'M511');
  assert.equal(store.IDRegistry.at(-1)[1],'GLOBAL');
});
test('old member/group band allocation is blocked but SongID retains its established format',()=>{
  const {ctx,ss}=fixture();
  assert.throws(()=>ctx.resolveIssueSpec_(ss,'NEXT_GROUP_ID'),/廃止/);
  assert.throws(()=>ctx.resolveIssueSpec_(ss,'NEXT_MEMBER_ID_100'),/廃止/);
  const song=ctx.resolveIssueSpec_({...ss},'NEXT_SONG_ID_1000');
  assert.equal(song.entity,'SONG');
  assert.equal(song.formatter,undefined);
});
test('historical audit JSON adapts typed keys without changing stored source',()=>{
  const env={};vm.createContext(env);vm.runInContext(read('CatalogMaintenance.gs'),env);
  const original={
    EntityType:'MEMBER',EntityID:'101',
    BeforeJSON:JSON.stringify({memberId:'101',groupId:'1',note:'Legacy ref 101',SongID:'1001'}),
    AfterJSON:JSON.stringify({primaryGroupId:'1',related:{memberId:'102'},count:101})
  };
  const immutable=JSON.stringify(original);
  const converted=env.catalogAdaptAuditHistory_(original,{group:{'1':'G1'},member:{'101':'M101','102':'M102'}});
  assert.equal(converted.EntityID,'M101');
  assert.deepEqual(JSON.parse(converted.BeforeJSON),{memberId:'M101',groupId:'G1',note:'Legacy ref 101',SongID:'1001'});
  assert.deepEqual(JSON.parse(converted.AfterJSON),{primaryGroupId:'G1',related:{memberId:'M102'},count:101});
  assert.equal(JSON.stringify(original),immutable);
});
