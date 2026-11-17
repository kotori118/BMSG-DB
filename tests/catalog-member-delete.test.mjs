import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const src=fs.readFileSync(path.join(import.meta.dirname,'..','CatalogMemberMaintenance.gs'),'utf8');

function fixture({profileValue='',lyricsRef=false,logRef=false,unitRef=false,failAudit=false}={}){
  const store={
    Members:[['MemberID','GroupID','DisplayName','DisplayOrder','RecordStatus'],['199','2','QA Member',34,'ACTIVE']],
    Profiles:[['MemberID','P000','P001'],['199','',profileValue]],
    Links:[['GroupID','MemberID','DisplayOrder'],['2','199',9],...(unitRef?[['6','199',1]]:[])],
    LyricsParts:[['SongID','PartOrder','Singer','Lyrics'],...(lyricsRef?[['1000',1,'199','hello']]:[])],
    Scores:[['MemberID','Score'],...(logRef?[['199',10]]:[])],
    IDRegistry:[['Entity','Id'],['MEMBER','199']]
  };
  const sh={};
  const names=Object.keys(store);
  for(const name of names){
    sh[name]={
      getName:()=>name,
      getLastRow:()=>store[name].length,
      getLastColumn:()=>store[name][0].length,
      getDataRange:()=>({getValues:()=>store[name].map(row=>row.slice())}),
      getRange:(row,col,height=1,width=1)=>({
        getValue:()=>store[name][row-1][col-1],
        setValue:(v)=>{store[name][row-1][col-1]=v;},
        getValues:()=>Array.from({length:height},(_,i)=>store[name][row-1+i].slice(col-1,col-1+width)),
        getFormulas:()=>Array.from({length:height},()=>Array(width).fill('')),
        setValues:(m)=>{for(let i=0;i<m.length;i++)for(let j=0;j<m[i].length;j++)store[name][row-1+i][col-1+j]=m[i][j];},
        clearContent:()=>{for(let i=0;i<height;i++)for(let j=0;j<width;j++)store[name][row-1+i][col-1+j]='';}
      })
    };
  }
  const table=(name)=>{
    const header=store[name][0],map=Object.fromEntries(header.map((x,i)=>[x,i]));
    return {sheet:sh[name],header,map,
      rows:store[name].slice(1).map((values,i)=>({rowNumber:i+2,values:values.slice()}))};
  };
  const audits=[];
  const ss={getSheets:()=>['Members','Profiles','Links','LyricsParts'].map(n=>sh[n])};
  const log={getSheets:()=>['Scores','IDRegistry'].map(n=>sh[n])};
  const env={
    id_:(v)=>String(v??'').trim(),clean_:(v)=>String(v??'').trim(),
    catalogRequireAdmin_:()=> 'admin@example.com',
    catalogRequireReady_:()=>{}, catalogActive_:()=>true,
    catalogTable_:(_ss,name)=>table(name),
    catalogRow_:(t,key,id)=>{
      const r=t.rows.filter(x=>String(x.values[t.map[key]])===id);
      if(r.length!==1)throw Error('missing or duplicate');
      return r[0];
    },
    catalogAudit_:(...args)=>{
      if(failAudit)throw Error('audit failed');
      audits.push(args);
    },
    withSharedWriterLock_:(_label,fn)=>fn(),
    openCoreSpreadsheet_:()=>ss,
    SpreadsheetApp:{flush:()=>{},openById:()=>log},
    PropertiesService:{getScriptProperties:()=>({getProperty:(k)=>{
      if(['UNIVERSE_CATALOG_MEMBER_MAINTENANCE_ENABLED','UNIVERSE_CATALOG_MEMBER_DELETE_ENABLED'].includes(k))return 'true';
      return '';
    }})},
    pfMgmtBackupGate_:()=>{},
    BU1:{LOG_DB_ID:'LOG',SHEETS:{MEMBERS:'Members',PROFILES:'Profiles',GROUP_MEMBERS:'Links'}}
  };
  vm.createContext(env);vm.runInContext(src,env);
  const preview=()=>vm.runInContext("getCatalogMemberDeletePreviewForUniverse({memberId:'199'})",env);
  const remove=(overrides={})=>vm.runInContext('deleteCatalogMemberForUniverse('+JSON.stringify({
    memberId:'199',confirm:'199',confirmName:'QA Member',externalReferencesChecked:true,...overrides
  })+')',env);
  return{store,preview,remove,audits};
}

test('deletion blocks when profile has values, lyrics, log usage or unit membership',()=>{
  for(const [name,args,reason] of [
    ['saved profile',{profileValue:'important'},'プロフィール'],
    ['lyrics singer',{lyricsRef:true},'LyricsParts'],
    ['historical score',{logRef:true},'Log Scores'],
    ['unit link',{unitRef:true},'所属情報']
  ]){
    const x=fixture(args),before=JSON.stringify(x.store);
    const res=x.preview();
    assert.equal(res.canDelete,false,name);
    assert.ok(res.blockers.some(s=>s.includes(reason)),name+' blockers: '+res.blockers);
    assert.throws(()=>x.remove(),/他機能に参照/);
    assert.equal(JSON.stringify(x.store),before);
  }
});

test('deletion succeeds only with exact typed id and external check; preserves registry',()=>{
  const x=fixture();
  assert.equal(x.preview().canDelete,true);
  assert.throws(()=>x.remove({confirm:'198'}),/確認が必要/);
  assert.throws(()=>x.remove({externalReferencesChecked:false}),/確認が必要/);
  assert.throws(()=>x.remove({confirmName:'not the same'}),/一致しません/);
  const original=JSON.stringify(x.store.IDRegistry);
  const r=x.remove();
  assert.equal(r.deleted,true);
  assert.equal(x.store.Members[1][0],'');
  assert.equal(x.store.Profiles[1][0],'');
  assert.equal(x.store.Links[1][1],'');
  assert.equal(JSON.stringify(x.store.IDRegistry),original);
  assert.equal(x.audits.length,1);
});

test('audit failure reverts all deletion changes',()=>{
  const x=fixture({failAudit:true}),before=JSON.stringify(x.store);
  assert.throws(()=>x.remove(),/audit failed/);
  assert.equal(JSON.stringify(x.store),before);
});
