import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(path.join(import.meta.dirname,'..','UniverseService.gs'),'utf8');

function makeFixture({failAt='' }={}){
  const store={
    Groups:[['GroupID','GroupName'],['G1','BE:FIRST']],
    Members:[['MemberID','GroupID','DisplayName'],['M101','G1','SOTA'],['M102','G1','SHUNTO']],
    Guests:[['GuestID','DisplayName']],
    Songs:[['SongID','Title','Artist','ReleaseDate','Form','CDTitle','IsTitleTrack','ArtistRef']],
    Credits:[['SongID','Title','Lyricists','Composers','Choreographers']],
    Parts:[['SongID','PartOrder','Singer','Lyrics']],
    Metrics:[['SongID','SOTA_Singing','SOTA_Center'],['単位','秒','秒']]
  };
  const sheets={};
  for(const [name,rows] of Object.entries(store)){
    sheets[name]={
      name,
      getLastRow:()=>rows.length,
      getLastColumn:()=>rows[0].length,
      getRange:(row,col,height=1,width=1)=>({
        getValues:()=>Array.from({length:height},(_,i)=>
          (rows[row-1+i]||[]).slice(col-1,col-1+width)),
        setValues:(values)=>{
          for(let i=0;i<values.length;i++)
            for(let j=0;j<values[i].length;j++)rows[row-1+i][col-1+j]=values[i][j];
        },
        getValue:()=>rows[row-1]?.[col-1],
        setValue:(v)=>{rows[row-1][col-1]=v;}
      }),
      deleteRow:(row)=>rows.splice(row-1,1)
    };
  }
  const ctx={};
  const ss={getSheetByName:(name)=>sheets[name]};
  const table=(sheet)=>{
    const header=store[sheet.name][0];
    const map=Object.fromEntries(header.map((h,i)=>[h,i]));
    return{sheet,header,map,rows:store[sheet.name].slice(1).map((values,i)=>
      ({rowNumber:i+2,values:values.slice()})).filter(x=>x.values[0]!==''&&x.values[0]!=null)};
  };
  const reservations=[],finalized=[];
  Object.assign(ctx,{
    BU1:{SHEETS:{SONGS:'Songs',SONG_CREDITS:'Credits',LYRICS_PARTS:'Parts',
      GROUPS:'Groups',MEMBERS:'Members',GUESTS:'Guests',METRICS:'Metrics'},
      SONG_BANDS:{'BE:FIRST':1000,DEFAULT:5000}},
    clean_:(x)=>String(x??'').trim(),
    id_:(x)=>String(x??'').trim(),
    normalizeDateForSheet_:(value)=>String(value||''),
    openCoreSpreadsheet_:()=>ss,
    requireSheet_:(_ss,name)=>{
      if(!sheets[name])throw new Error('missing sheet '+name);
      return sheets[name];
    },
    readTable_:table,
    requireColumns_:(t,cols)=>{
      for(const key of cols)if(t.map[key]==null)throw new Error('missing column '+key);
    },
    withSharedWriterLock_:(_label,fn)=>fn(),
    reserveNumberForKey_:(_ss,key)=>{reservations.push(key);return{numericValue:1099,issuedId:'1099'};},
    finalizeIdReservation_:(_res,success)=>finalized.push(success),
    appendStyledRow_:(sheet,values)=>{
      if(sheet.name===failAt)throw new Error('forced '+failAt+' failure');
      store[sheet.name].push(values.slice());
      return store[sheet.name].length;
    },
    ensurePerformanceMetricRowForSong_:(_ss,songId)=>{
      const row=store.Metrics.findIndex((r,i)=>i>=2&&String(r[0])===String(songId));
      if(row>=0)return{created:false,row:row+1};
      store.Metrics.push([songId,'','']);
      return{created:true,row:store.Metrics.length,sheet:sheets.Metrics};
    },
    SpreadsheetApp:{flush:()=>{}}
  });
  vm.createContext(ctx);
  vm.runInContext(source,ctx);
  const realParse=ctx.parseSongLyricsForUniverse;
  // Only the text-to-parts parser is stubbed; we execute REAL site-facing
  // writer entry points including transaction and row verification.
  ctx.parseSongLyricsForUniverse=({rawLyrics})=>{
    if(!rawLyrics.includes('SOTA'))return{parts:[],unknownGuests:[],errors:['Singer missing'],canRegister:false};
    return{parts:[{singer:'101',lyrics:'Original line'}],unknownGuests:[],errors:[],canRegister:true};
  };
  const call=(fn,payload)=>vm.runInContext(fn+'('+JSON.stringify(payload)+')',ctx);
  const newPayload={userId:'U001',song:{
    title:'QA-Only Song',artist:'BE:FIRST',releaseDate:'2026-11-17',
    form:'シングル',cdTitle:'QA-Only Single',isTitleTrack:true
  },credits:{lyricists:'QA Artist',composers:'QA Producer',choreographers:'QA Dance'},
    rawLyrics:'SOTA\nOriginal line'};
  return{store,sheets,ctx,realParse,reservations,finalized,call,newPayload};
}
test('song writer can create song, credits, lyrics and metrics without old input sheet',()=>{
  const x=makeFixture(),o=x.call('saveNewSongLyricsForUniverse',x.newPayload);
  assert.equal(o.ok,true);
  assert.equal(o.songId,'1099');
  assert.deepEqual(x.reservations,['NEXT_SONG_ID_1000']);
  assert.deepEqual(x.finalized,[true]);
  assert.deepEqual(Array.from(x.store.Songs.at(-1).slice(0,3)),['1099','QA-Only Song','BE:FIRST']);
  assert.deepEqual(Array.from(x.store.Credits.at(-1).slice(0,3)),['1099','QA-Only Song','QA Artist']);
  assert.deepEqual(Array.from(x.store.Parts.at(-1)),['1099',1,'101','Original line']);
  assert.equal(x.store.Metrics.at(-1)[0],'1099');
  assert.equal(Object.hasOwn(x.sheets,'入力_歌詞'),false);
});
test('song duplicate is rejected without adding rows or issuing a second ID',()=>{
  const x=makeFixture();x.call('saveNewSongLyricsForUniverse',x.newPayload);
  const original=JSON.stringify(x.store);
  const dup=x.call('saveNewSongLyricsForUniverse',x.newPayload);
  assert.equal(dup.duplicate,true);
  assert.equal(JSON.stringify(x.store),original);
  assert.equal(x.reservations.length,1);
});
test('credits without Title preserve credit fields across registration, rename, and credit edits',()=>{
  const x=makeFixture();
  x.store.Credits[0].splice(1,1);
  x.store.Songs[0][2]='ArtistID';
  const song={...x.newPayload.song,artist:'G1'};
  assert.equal(x.call('saveNewSongLyricsForUniverse',{...x.newPayload,song}).ok,true);
  assert.deepEqual(Array.from(x.store.Credits[1].slice(0,2)),['1099','QA Artist']);
  const before=x.store.Credits[1].slice();
  assert.equal(x.call('saveSongInfoForUniverse',{userId:'U001',songId:'1099',song:{...song,title:'Renamed'}}).ok,true);
  assert.equal(x.store.Songs[1][1],'Renamed');
  assert.deepEqual(x.store.Credits[1],before);
  assert.equal(x.call('saveSongCreditsForUniverse',{userId:'U001',songId:'1099',credits:{
    lyricists:'Writer B',composers:'Composer B',choreographers:'Choreographer B'
  }}).ok,true);
  assert.deepEqual(Array.from(x.store.Credits[1]),['1099','Writer B','Composer B','Choreographer B']);
});
test('existing song info/credits/parts edit via site writer remains coherent',()=>{
  const x=makeFixture();x.call('saveNewSongLyricsForUniverse',x.newPayload);
  const info=x.call('saveSongInfoForUniverse',{userId:'U001',songId:'1099',song:{
    ...x.newPayload.song,title:'QA-Only Song Edited'
  }});
  assert.equal(info.ok,true);
  assert.equal(x.store.Songs[1][1],'QA-Only Song Edited');
  assert.equal(x.store.Credits[1][1],'QA-Only Song Edited');
  const credit=x.call('saveSongCreditsForUniverse',{userId:'U001',songId:'1099',
    credits:{lyricists:'Writer B',composers:'Composer B',choreographers:'Choreographer B'}});
  assert.equal(credit.ok,true);
  assert.equal(x.store.Credits[1][2],'Writer B');
  const parts=x.call('saveSongPartsForUniverse',{userId:'U001',songId:'1099',parts:[
    {singers:[{id:'M102',role:'MAIN'}],lyrics:'Second singer'},
    {singers:[{id:'M101',role:'UP'}],lyrics:'Harmony'}
  ]});
  assert.equal(parts.ok,true);
  const own=x.store.Parts.slice(1).filter(r=>r[0]==='1099');
  assert.deepEqual(Array.from(own.map(r=>r[1])),[1,2]);
  assert.deepEqual(Array.from(own.map(r=>r[2])),['M102','M101_up']);
  assert.equal(x.store.Metrics.at(-1)[0],'1099');
});
test('song write rejects invalid or missing singers and preserves prior parts',()=>{
  const x=makeFixture();x.call('saveNewSongLyricsForUniverse',x.newPayload);
  const snapshot=JSON.stringify(x.store);
  assert.throws(()=>x.call('saveSongPartsForUniverse',{userId:'U001',songId:'1099',
    parts:[{singers:[{id:'9999',role:'MAIN'}],lyrics:'Invalid'}]}),/未登録のSinger/);
  assert.throws(()=>x.call('saveSongPartsForUniverse',{userId:'U001',songId:'1099',
    parts:[{singers:[{id:'101',role:'MAIN'}],lyrics:''}]}),/歌詞が空/);
  assert.equal(JSON.stringify(x.store),snapshot);
});
test('failed new-song credits append rolls back Songs and aborts reserved ID',()=>{
  const x=makeFixture({failAt:'Credits'});
  assert.throws(()=>x.call('saveNewSongLyricsForUniverse',x.newPayload),/forced Credits failure/);
  assert.equal(x.store.Songs.length,1);
  assert.equal(x.store.Credits.length,1);
  assert.equal(x.store.Parts.length,1);
  assert.deepEqual(x.finalized,[false]);
});
test('song edits cannot change artist or use unknown UserID',()=>{
  const x=makeFixture();x.call('saveNewSongLyricsForUniverse',x.newPayload);
  assert.throws(()=>x.call('saveSongInfoForUniverse',{userId:'U001',songId:'1099',song:{
    ...x.newPayload.song,artist:'HANA'
  }}),/ARTISTは変更/);
  assert.throws(()=>x.call('saveSongCreditsForUniverse',{userId:'invalid',songId:'1099',credits:{}}),/利用ユーザー/);
});

test('real lyrics parser resolves named singers and preserves parenthesized lyric lines',()=>{
  const lyricsSource=fs.readFileSync(path.join(import.meta.dirname,'..','Lyrics.gs'),'utf8');
  const x=makeFixture();
  vm.runInContext(lyricsSource,x.ctx);
  x.ctx.parseSongLyricsForUniverse=x.realParse;
  const masters={
    byName:{
      SOTA:[{id:'101',name:'SOTA'}],
      SHUNTO:[{id:'102',name:'SHUNTO'}]
    }
  };
  x.ctx.loadLyricsSingers_=()=>masters;
  x.ctx.findUnknownLyricsGuestCandidates_=()=>[];
  const raw='SOTA\nFIRST QA LINE\n(KEEP THIS LYRIC)\n\nSHUNTO\nSECOND QA LINE';
  const parsed=x.call('parseSongLyricsForUniverse',{userId:'U001',rawLyrics:raw});
  assert.equal(parsed.canRegister,true);
  assert.equal(parsed.parts.length,2);
  assert.deepEqual(Array.from(parsed.parts.map(p=>p.singer)),['101','102']);
  assert.match(parsed.parts[0].lyrics,/KEEP THIS LYRIC/);
  assert.equal(parsed.parts[1].lyrics,'SECOND QA LINE');
  assert.equal(Object.hasOwn(x.sheets,'入力_歌詞'),false);
});
