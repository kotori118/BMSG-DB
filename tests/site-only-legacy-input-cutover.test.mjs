import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const code=fs.readFileSync(path.join(import.meta.dirname,'..','Code.gs'),'utf8');
const core=[
 ['01_Groups',['GroupID','GroupName','ColorHex','DisplayOrder']],
 ['02_Members',['MemberID','GroupID','DisplayName','ColorHex','DisplayOrder']],
 ['03_Guests',['GuestID','DisplayName']],
 ['04_GroupMembers',['GroupID','MemberID','DisplayOrder']],
 ['05_Profiles',['MemberID']],
 ['06_Songs',['SongID','Title','Artist','ReleaseDate','Form','CDTitle','IsTitleTrack']],
 ['07_SongCredits',['SongID','Title','Lyricists','Composers','Choreographers']],
 ['08_LyricsParts',['SongID','PartOrder','Singer','Lyrics']],
 ['09_Images',['ImageID','TargetType','TargetID','Rarity','DriveFileID','DisplayOrder','IsProfileMain']],
 ['10_PerformanceMetrics',['SongID']]
];
function make(enabled){
  const menuNames=[];
  const data=new Map(core);
  const ss={
    getSheetByName(name){
      const columns=data.get(name);
      if(!columns)return null;
      return{
        getName:()=>name,getLastColumn:()=>columns.length,
        getRange:()=>({getDisplayValues:()=>[columns]})
      };
    }
  };
  const menu={
    addItem(name){menuNames.push(name);return this;},
    addSeparator(){return this;},
    addToUi(){return this;}
  };
  const env={
    PropertiesService:{getScriptProperties:()=>({getProperty:(k)=>k==='UNIVERSE_SITE_ONLY_WRITES'?(enabled?'true':'false'):' '})},
    SpreadsheetApp:{
      getUi:()=>({createMenu:()=>menu}),
      getActiveSpreadsheet:()=>ss
    },
    requireSheet_:(_ss,name)=>{
      const sheet=ss.getSheetByName(name);if(!sheet)throw Error('missing '+name);return sheet;
    },
    readTable_:(sheet)=>({
      map:Object.fromEntries((data.get(sheet.getName())||[]).map((n,i)=>[n,i])),
      rows:[]
    }),
    idRegistryTable_:()=>{},
    alert_:()=>{},
    ensureLyricsInputLayout_:()=>{throw new Error('legacy input auto-create should not run during cutover')},
    id_:(s)=>String(s??'').trim()
  };
  vm.createContext(env);
  vm.runInContext(code,env);
  // Code.gs declares its own GAS helper functions; replace ONLY dependency
  // functions after evaluating the actual validator under test.
  env.requireSheet_=(_ss,name)=>{
    const sheet=ss.getSheetByName(name);if(!sheet)throw Error('missing '+name);return sheet;
  };
  env.readTable_=(sheet)=>({
    map:Object.fromEntries((data.get(sheet.getName())||[]).map((n,i)=>[n,i])),rows:[]
  });
  env.idRegistryTable_=()=>{};
  env.alert_=()=>{};
  env.ensureLyricsInputLayout_=()=>{throw new Error('legacy initializer must not run in site-only mode');};
  const validate=()=>vm.runInContext('validateUniverseStructure()',env);
  const open=()=>vm.runInContext('onOpen()',env);
  const block=()=>vm.runInContext("blockLegacySheetWrite_('旧シート入力')",env);
  return{validate,open,block,menuNames};
}
test('site-only cutover does not require 入力_歌詞 or 入力_プロフィール sheets',()=>{
  const s=make(true);
  assert.equal(s.validate().ok,true);
  assert.equal(s.menuNames.length,0);
  s.open();
  assert.deepEqual(s.menuNames,['全体｜構成を検証']);
  assert.throws(s.block,/廃止されました/);
});
test('without cutover old inputs remain required; switching flag does not delete them',()=>{
  const s=make(false);
  const status=s.validate();
  assert.equal(status.ok,false);
  assert.ok(status.errors.some(x=>x.includes('入力_歌詞')));
  assert.ok(status.errors.some(x=>x.includes('入力_プロフィール')));
  // Legacy input layout initialization is invoked only when old mode is ON.
  assert.doesNotThrow(s.block);
});
