/**
 * Read-only preflight for the site-only Universe database migration.
 *
 * This file never mutates any Sheet. It validates the existing canonical
 * tables before introducing new columns, disabling input routes or merging.
 * Must be called only through the gated site Catalog API.
 */
function auditCatalogDatabaseForUniverse(payload) {
  catalogRequireAdmin_(payload||{});
  const ss=openCoreSpreadsheet_();
  const groups=catalogTable_(ss,BU1.SHEETS.GROUPS,['GroupID','GroupName']);
  const members=catalogTable_(ss,BU1.SHEETS.MEMBERS,['MemberID','GroupID','DisplayName']);
  const links=catalogTable_(ss,BU1.SHEETS.GROUP_MEMBERS,['GroupID','MemberID']);
  const profiles=catalogTable_(ss,BU1.SHEETS.PROFILES,['MemberID']);
  const songs=catalogTable_(ss,BU1.SHEETS.SONGS,['SongID','Title','Artist']);
  const credits=catalogTable_(ss,BU1.SHEETS.SONG_CREDITS,['SongID','Title']);
  const lyrics=catalogTable_(ss,BU1.SHEETS.LYRICS_PARTS,['SongID','PartOrder']);
  const metrics=catalogTable_(ss,BU1.SHEETS.METRICS,['SongID']);
  const warnings=[];
  const sampleLimit=25;
  function warn(code,message) {
    if(warnings.length<sampleLimit)warnings.push({code:code,detail:message});
  }
  function idSet(table,key) {
    const map=new Map();
    table.rows.forEach(function(r) {
      const id=id_(r.values[table.map[key]]);
      if(!id)return;
      const n=(map.get(id)||0)+1;map.set(id,n);
      if(n===2)warn('DUPLICATE_ID',table.sheet.getName()+'.'+key+'='+id+' が重複');
    });
    return map;
  }
  const groupIds=idSet(groups,'GroupID');
  const memberIds=idSet(members,'MemberID');
  const songIds=idSet(songs,'SongID');
  const profileIds=idSet(profiles,'MemberID');
  function has(map,key){return map.has(key);}
  const groupNames=new Map();
  groups.rows.forEach(function(r) {
    const id=id_(r.values[groups.map.GroupID]),name=clean_(r.values[groups.map.GroupName]);
    if(id&&name)groupNames.set(name,id);
  });
  members.rows.forEach(function(r) {
    const id=id_(r.values[members.map.MemberID]), gid=id_(r.values[members.map.GroupID]);
    if(!id)return;
    if(gid&&!has(groupIds,gid))warn('ORPHAN_GROUP','02_Members '+id+' は存在しないGroupID '+gid+'を参照');
    if(!has(profileIds,id))warn('MISSING_PROFILE','MemberID '+id+' に05_Profilesの行がない');
  });
  const membershipKeys=new Set();
  links.rows.forEach(function(r) {
    const gid=id_(r.values[links.map.GroupID]),mid=id_(r.values[links.map.MemberID]);
    if(!gid&&!mid)return;
    if(!has(groupIds,gid)||!has(memberIds,mid))warn('ORPHAN_MEMBERSHIP','04_GroupMembers '+gid+' / '+mid+' に存在しないID');
    const pair=gid+'|'+mid;
    if(membershipKeys.has(pair))warn('DUPLICATE_MEMBERSHIP','04_GroupMembers '+pair+' が重複');
    membershipKeys.add(pair);
  });
  const nonemptySongs=songs.rows.filter(function(r){return id_(r.values[songs.map.SongID]);});
  const knownNames=new Set(
    groups.rows.map(function(r){return clean_(r.values[groups.map.GroupName]);})
    .concat(members.rows.map(function(r){return clean_(r.values[members.map.DisplayName]);})).concat(['UNIT'])
  );
  nonemptySongs.forEach(function(r) {
    const sid=id_(r.values[songs.map.SongID]),artist=clean_(r.values[songs.map.Artist]);
    if(!knownNames.has(artist))warn('UNKNOWN_ARTIST','06_Songs '+sid+' Artist '+artist+' が管理マスターにない');
  });
  const childStats={credits:0,lyrics:0,metrics:0};
  const seenCredit=new Set(),seenMetrics=new Set(),seenParts=new Set();
  const titles=new Map(nonemptySongs.map(function(r){return [id_(r.values[songs.map.SongID]),clean_(r.values[songs.map.Title])];}));
  credits.rows.forEach(function(r) {
    const sid=id_(r.values[credits.map.SongID]);if(!sid)return;
    childStats.credits++;
    if(!has(songIds,sid))warn('ORPHAN_CREDIT','07_SongCredits '+sid+' の曲が存在しない');
    if(seenCredit.has(sid))warn('DUPLICATE_CREDIT','07_SongCredits '+sid+' が重複');
    seenCredit.add(sid);
    if(titles.has(sid)&&titles.get(sid)!==clean_(r.values[credits.map.Title]))
      warn('CREDIT_TITLE_DRIFT','07_SongCredits '+sid+' の曲名は正本と不一致');
  });
  lyrics.rows.forEach(function(r) {
    const sid=id_(r.values[lyrics.map.SongID]);if(!sid)return;
    childStats.lyrics++;
    if(!has(songIds,sid))warn('ORPHAN_LYRICS','08_LyricsParts '+sid+' の曲が存在しない');
    const order=clean_(r.values[lyrics.map.PartOrder]);
    const key=sid+'|'+order;
    if(seenParts.has(key))warn('DUPLICATE_PART','08_LyricsParts '+key+' が重複');
    seenParts.add(key);
  });
  metrics.rows.forEach(function(r) {
    const sid=id_(r.values[metrics.map.SongID]);if(!sid)return;
    childStats.metrics++;
    if(!has(songIds,sid))warn('ORPHAN_METRICS','10_PerformanceMetrics '+sid+' の曲が存在しない');
    if(seenMetrics.has(sid))warn('DUPLICATE_METRICS','10_PerformanceMetrics '+sid+' が重複');
    seenMetrics.add(sid);
  });
  nonemptySongs.forEach(function(r) {
    const sid=id_(r.values[songs.map.SongID]);
    if(clean_(r.values[songs.map.Artist])==='BE:FIRST'&&!seenMetrics.has(sid))
      warn('MISSING_METRICS','BE:FIRST '+sid+' の秒数行がない');
  });
  const tabs=ss.getSheets().map(function(sh) {
    const name=sh.getName();
    let category='CANONICAL';
    if(name==='00_管理ガイド')category='DOCUMENT';
    else if(name.indexOf('入力_')===0)category='LEGACY_INPUT';
    else if(name.indexOf('削除予定_')===0)category='REVIEW_ARCHIVE';
    else if(name.indexOf('移行_')===0)category='MIGRATION_HISTORY';
    return {name:name,category:category,hidden:sh.isSheetHidden(),
      lastRow:sh.getLastRow(),lastColumn:sh.getLastColumn()};
  });
  const legacy=tabs.filter(function(t){return t.category==='LEGACY_INPUT';}).map(function(t){return t.name;});
  const review=tabs.filter(function(t){return t.category==='REVIEW_ARCHIVE';}).map(function(t){return t.name;});
  const log=SpreadsheetApp.openById(BU1.LOG_DB_ID);
  const schema=catalogSchemaStatus_(ss);
  return {
    ok:true,readOnly:true,schema:schema,coreTabCount:tabs.length,logTabCount:log.getSheets().length,
    tabs:tabs,legacyInputTabs:legacy,reviewTabs:review,
    counts:{groups:groupIds.size,members:memberIds.size,profiles:profileIds.size,
      songs:songIds.size,links:membershipKeys.size,credits:childStats.credits,
      lyrics:childStats.lyrics,metrics:childStats.metrics},
    warnings:warnings,warningsTruncated:warnings.length>=sampleLimit,
    guidance:'診断は読み取りのみ。旧入力タブ、移行履歴、重複Title列や秒数表の構造は、本番移行・依存確認前に削除しない。'
  };
}
