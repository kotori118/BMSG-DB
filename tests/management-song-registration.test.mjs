import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=fs.readFileSync(new URL('../CatalogManagement.gs',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('function createCatalogSongDraftForUniverse('));
function fixture(){
  const writes=[],audits=[];
  const env={catalogRequireAdmin_:()=> 'admin@example.test',normalizeUniverseServiceSong_:x=>x,normalizeUniverseServiceCredits_:x=>x,clean_:x=>String(x||''),id_:x=>String(x||''),withSharedWriterLock_:(_,f)=>f(),openCoreSpreadsheet_:()=>({}),catalogRequireReady_:()=>{},BU1:{SHEETS:{MEMBERS:'members',GROUPS:'groups'}},catalogTable_:(_,sheet)=>sheet==='members'?{map:{GroupID:0},row:{values:['1']}}:{map:{GroupName:0},row:{values:['BE:FIRST']}},catalogRow_:t=>t.row,catalogEnsureActive_:()=>{},parseSongLyricsForUniverse:()=>({canRegister:true,unknownGuests:[],parts:[{lyrics:'Test',singer:'101'}]}),createSongWithPartsCore_:(ss,song,credits,parts,context)=>{writes.push({song,credits,parts,context});return {ok:true,songId:'1998'};},catalogAudit_:(...args)=>audits.push(args)};
  vm.createContext(env);vm.runInContext(fn,env);
  return{env,writes,audits,save:p=>env.createCatalogSongDraftForUniverse(p)};
}
test('solo song with lyrics is created in one shared writer transaction with credits and classification',()=>{
  const f=fixture();f.save({userId:'U001',song:{title:'Test',artist:'BE:FIRST'},credits:{lyricists:'Writer'},songType:'SOLO',soloMemberId:'101',includeLyrics:true,rawLyrics:'SOTA\nTest'});
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].parts.length,1);
  assert.equal(f.writes[0].context.songType,'SOLO');assert.equal(f.writes[0].context.soloMemberId,'101');assert.equal(f.writes[0].context.allowEmptyParts,false);
  assert.equal(f.writes[0].credits.lyricists,'Writer');assert.equal(f.audits[0][2],'CREATE_WITH_LYRICS');
});
test('invalid lyrics and non-BEFIRST solo songs fail before the core writer is called',()=>{
  const f=fixture();f.env.parseSongLyricsForUniverse=()=>({canRegister:false,unknownGuests:['Unknown'],parts:[]});
  assert.throws(()=>f.save({song:{artist:'BE:FIRST'},includeLyrics:true}),/歌詞/);
  assert.throws(()=>f.save({song:{artist:'Other'},songType:'SOLO',soloMemberId:'101'}),/BE:FIRST/);
  assert.equal(f.writes.length,0);
});
test('existing lyricless registration remains compatible and allows zero parts explicitly',()=>{
  const f=fixture();f.save({song:{title:'Test',artist:'BE:FIRST'},credits:{},songType:'NORMAL'});
  assert.equal(f.writes[0].parts.length,0);assert.equal(f.writes[0].context.allowEmptyParts,true);
  assert.equal(f.audits[0][2],'CREATE_NO_LYRICS');
});
