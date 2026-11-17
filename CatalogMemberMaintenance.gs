/**
 * Shared member maintenance for registered Universe users. Never invoked by legacy Sheet menus.
 * Catalog schema, backup, reference and confirmation checks are retained.
 *
 * MemberID is immutable. Main group changes keep existing member IDs and
 * synchronize only this member's 04_GroupMembers primary membership record.
 */
function memberMaintenanceGate_(payload) {
  return catalogRequireUser_(payload);
}
function memberMaintenanceCellWrite_(cell,value,undo) {
  const old=cell.getValue();
  if(String(old)===String(value))return;
  cell.setValue(value);
  undo.push(function(){cell.setValue(old);});
}
/** Reorder only two members of the same home group, preserving every ID. */
function moveCatalogMemberDisplayOrderForUniverse(payload) {
  const actor=memberMaintenanceGate_(payload);
  const id=id_(payload.memberId);
  const direction=clean_(payload.direction).toUpperCase();
  if(['UP','DOWN'].indexOf(direction)<0)throw new Error('上下の移動方向を選択してください。');
  return withSharedWriterLock_('メンバーの表示順変更',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    const m=catalogTable_(ss,BU1.SHEETS.MEMBERS,['MemberID','GroupID','DisplayOrder','RecordStatus']);
    const current=catalogRow_(m,'MemberID',id);catalogEnsureActive_(m,current);
    const group=id_(current.values[m.map.GroupID]);
    const peers=m.rows.filter(function(r){
      return catalogActive_(r.values[m.map.RecordStatus]) &&
        id_(r.values[m.map.GroupID])===group &&
        id_(r.values[m.map.MemberID]);
    }).sort(function(a,b){
      return Number(a.values[m.map.DisplayOrder]||999999)-Number(b.values[m.map.DisplayOrder]||999999) ||
        a.rowNumber-b.rowNumber;
    });
    const idx=peers.findIndex(function(r){return r.rowNumber===current.rowNumber;});
    const next=peers[idx+(direction==='UP'?-1:1)];
    if(!next)return {ok:true,memberId:id,unchanged:true};
    const links=catalogTable_(ss,BU1.SHEETS.GROUP_MEMBERS,['GroupID','MemberID','DisplayOrder']);
    const primaryLinks=[current,next].map(function(member){return catalogRow_({sheet:links.sheet,map:links.map,rows:links.rows.filter(function(r){return id_(r.values[links.map.GroupID])===group;})},'MemberID',member.values[m.map.MemberID]);});
    const primaryOrders=primaryLinks.map(function(r){return r.values[links.map.DisplayOrder];});
    if(primaryOrders.some(function(n){return !Number.isSafeInteger(Number(n))||Number(n)<1;})||Number(primaryOrders[0])===Number(primaryOrders[1]))throw new Error('主所属の表示順を点検してください。');
    const col=m.map.DisplayOrder+1,sh=m.sheet,undos=[];
    const a=sh.getRange(current.rowNumber,col),z=sh.getRange(next.rowNumber,col);
    const beforeA=a.getValue(),beforeZ=z.getValue();
    const checked=[beforeA,beforeZ].map(Number);
    if(checked.some(function(x){return !Number.isFinite(x)||x<1;})||checked[0]===checked[1])
      throw new Error('表示順が重複または不正です。先にDB監査で修復してください。');
    try{
      memberMaintenanceCellWrite_(a,beforeZ,undos);
      memberMaintenanceCellWrite_(z,beforeA,undos);
      primaryLinks.forEach(function(link,i){memberMaintenanceCellWrite_(links.sheet.getRange(link.rowNumber,links.map.DisplayOrder+1),primaryOrders[1-i],undos);});
      SpreadsheetApp.flush();
      if(String(a.getValue())!==String(beforeZ)||String(z.getValue())!==String(beforeA))
        throw new Error('表示順の保存確認に失敗しました。');
      catalogAudit_('MEMBER',id,'REORDER',
        {displayOrder:beforeA,swappedWith:id_(next.values[m.map.MemberID])},
        {displayOrder:beforeZ,swappedWith:id_(next.values[m.map.MemberID])},actor);
      return {ok:true,memberId:id,displayOrder:beforeZ};
    }catch(error){
      undos.reverse().forEach(function(undo){try{undo();}catch(e){}});
      throw error;
    }
  });
}
/**
 * Move the home group without reissuing MemberID or altering other memberships.
 * Only GROUP destinations are valid; UNIT membership is a distinct operation.
 */
function changeCatalogMemberPrimaryGroupForUniverse(payload) {
  const actor=memberMaintenanceGate_(payload);
  const mid=id_(payload.memberId),gid=id_(payload.primaryGroupId);
  if(!mid||!gid)throw new Error('メンバーと新しい主所属を選択してください。');
  return withSharedWriterLock_('メンバー主所属変更',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    const members=catalogTable_(ss,BU1.SHEETS.MEMBERS,['MemberID','GroupID','RecordStatus']);
    const m=catalogRow_(members,'MemberID',mid);catalogEnsureActive_(members,m);
    const oldGroup=id_(m.values[members.map.GroupID]);
    if(oldGroup===gid)return {ok:true,memberId:mid,unchanged:true};
    const groups=catalogTable_(ss,BU1.SHEETS.GROUPS,['GroupID','RecordStatus']);
    const g=catalogRow_(groups,'GroupID',gid);catalogEnsureActive_(groups,g);
    if(!gid.startsWith('G'))
      throw new Error('主所属はグループのみ指定できます。ユニットは別管理です。');
    const links=catalogTable_(ss,BU1.SHEETS.GROUP_MEMBERS,['GroupID','MemberID','DisplayOrder']);
    const own=links.rows.filter(function(r){return id_(r.values[links.map.MemberID])===mid;});
    const oldLinks=own.filter(function(r){return id_(r.values[links.map.GroupID])===oldGroup;});
    const newLinks=own.filter(function(r){return id_(r.values[links.map.GroupID])===gid;});
    if(oldLinks.length>1||newLinks.length>1)
      throw new Error('所属行が重複しています。DB監査で確認してください。');
    const undo=[],sh=links.sheet,mcell=members.sheet.getRange(m.rowNumber,members.map.GroupID+1);
    let appended=0;
    try{
      // Update link FIRST, then the home group cell, so the member never
      // points to a group without a corresponding membership.
      if(!newLinks.length && oldLinks.length){
        const cell=sh.getRange(oldLinks[0].rowNumber,links.map.GroupID+1);
        const nextOrder=1+links.rows.filter(function(r){
          return id_(r.values[links.map.GroupID])===gid;
        }).reduce(function(n,r){return Math.max(n,Number(r.values[links.map.DisplayOrder])||0);},0);
        memberMaintenanceCellWrite_(cell,gid,undo);
        memberMaintenanceCellWrite_(sh.getRange(oldLinks[0].rowNumber,links.map.DisplayOrder+1),nextOrder,undo);
      }else if(!newLinks.length){
        const values=new Array(links.header.length).fill('');
        values[links.map.GroupID]=gid;
        values[links.map.MemberID]=mid;
        values[links.map.DisplayOrder]=1+links.rows
          .filter(function(r){return id_(r.values[links.map.GroupID])===gid;})
          .reduce(function(n,r){return Math.max(n,Number(r.values[links.map.DisplayOrder])||0);},0);
        appended=appendStyledRow_(sh,values);
      }
      if(newLinks.length && oldLinks.length){
        const row=oldLinks[0].rowNumber;
        const range=sh.getRange(row,1,1,links.header.length);
        const values=range.getValues()[0],formulas=range.getFormulas()[0];
        range.clearContent();
        undo.push(function(){range.setValues([values.map(function(v,i){return formulas[i]||v;})]);});
      }
      memberMaintenanceCellWrite_(mcell,gid,undo);
      SpreadsheetApp.flush();
      const latest=readTable_(sh);
      const hasNew=latest.rows.some(function(r){return id_(r.values[latest.map.MemberID])===mid&&id_(r.values[latest.map.GroupID])===gid;});
      const hasOld=latest.rows.some(function(r){return oldGroup&&id_(r.values[latest.map.MemberID])===mid&&id_(r.values[latest.map.GroupID])===oldGroup;});
      if(id_(mcell.getValue())!==gid||!hasNew||hasOld)
        throw new Error('所属の更新後照合に失敗しました。');
      catalogAudit_('MEMBER',mid,'CHANGE_PRIMARY',
        {groupId:oldGroup},{groupId:gid},actor);
      return {ok:true,memberId:mid,primaryGroupId:gid};
    }catch(error){
      undo.reverse().forEach(function(fn){try{fn();}catch(e){}});
      if(appended)try{
        if(id_(sh.getRange(appended,links.map.MemberID+1).getValue())===mid)
          sh.deleteRow(appended);
      }catch(ignore){}
      SpreadsheetApp.flush();
      throw error;
    }
  });
}
/**
 * Conservative deletion preview. The only owned rows eligible to be removed
 * are 02_Members, a blank 05_Profiles row and one home-group membership.
 * All other Core or Log references block deletion.  IDRegistry and Audit
 * remain as immutable evidence of the issued ID and previous changes.
 */
function catalogMemberDeletePlan_(ss,mid) {
  const members=catalogTable_(ss,BU1.SHEETS.MEMBERS,['MemberID','GroupID','DisplayName']);
  const m=catalogRow_(members,'MemberID',mid);
  const profiles=catalogTable_(ss,BU1.SHEETS.PROFILES,['MemberID']);
  const profile=catalogRow_(profiles,'MemberID',mid);
  const links=catalogTable_(ss,BU1.SHEETS.GROUP_MEMBERS,['MemberID','GroupID']);
  const ownLinks=links.rows.filter(function(r){return id_(r.values[links.map.MemberID])===mid;});
  const home=id_(m.values[members.map.GroupID]);
  const blockers=[];
  if(ownLinks.length!==1||id_(ownLinks[0].values[links.map.GroupID])!==home)
    blockers.push('所属情報が1件の主所属だけではありません');
  const ownedProfile=profiles.sheet.getRange(profile.rowNumber,1,1,profiles.header.length).getValues()[0];
  if(ownedProfile.some(function(v,i){return i!==profiles.map.MemberID&&v!==''&&v!==null;}))
    blockers.push('プロフィールに保存済みの値があります');
  const token=new RegExp('(^|[^0-9])'+mid+'([^0-9]|$)');
  const countMatches=function(sheet,exceptRows){
    if(sheet.getLastRow()<2)return 0;
    const rows=sheet.getDataRange().getValues();let count=0;
    for(let i=1;i<rows.length;i++){
      if(exceptRows && exceptRows.has(i+1))continue;
      if(rows[i].some(function(value){
        if(value==null||value==='')return false;
        const text=String(value);
        return text===mid||token.test(text);
      }))count++;
    }
    return count;
  };
  ss.getSheets().forEach(function(sheet){
    let except=null;
    if(sheet.getName()===members.sheet.getName())except=new Set([m.rowNumber]);
    if(sheet.getName()===profiles.sheet.getName())except=new Set([profile.rowNumber]);
    if(sheet.getName()===links.sheet.getName())except=new Set(ownLinks.map(function(r){return r.rowNumber;}));
    const used=countMatches(sheet,except);
    if(used)blockers.push(sheet.getName()+'に参照 '+used+'件');
  });
  const log=SpreadsheetApp.openById(BU1.LOG_DB_ID);
  log.getSheets().forEach(function(sheet){
    if(['IDRegistry','CATALOG_Audit'].indexOf(sheet.getName())>=0)return;
    const used=countMatches(sheet,null);
    if(used)blockers.push('Log '+sheet.getName()+'に参照 '+used+'件');
  });
  return {
    memberId:mid,name:clean_(m.values[members.map.DisplayName]),
    homeGroupId:home,blockers:blockers,canDelete:blockers.length===0,
    rows:[{sheet:members.sheet,row:m.rowNumber},{sheet:profiles.sheet,row:profile.rowNumber}]
      .concat(ownLinks.map(function(r){return {sheet:links.sheet,row:r.rowNumber};}))
  };
}
function getCatalogMemberDeletePreviewForUniverse(payload) {
  memberMaintenanceGate_(payload);
  const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
  const plan=catalogMemberDeletePlan_(ss,id_(payload.memberId));
  return {ok:true,memberId:plan.memberId,name:plan.name,canDelete:plan.canDelete,blockers:plan.blockers};
}
function deleteCatalogMemberForUniverse(payload) {
  const actor=memberMaintenanceGate_(payload);
  const mid=id_(payload.memberId);
  if(!mid||id_(payload.confirm)!==mid||payload.externalReferencesChecked!==true)
    throw new Error('MemberIDと外部参照の確認が必要です。');
  // Core and Log independently backed up, with required tab validation.
  pfMgmtBackupGate_();
  return withSharedWriterLock_('メンバーの完全削除',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    const plan=catalogMemberDeletePlan_(ss,mid);
    if(clean_(payload.confirmName)!==plan.name)
      throw new Error('メンバー名が一致しません。最新情報を読み直してください。');
    if(!plan.canDelete)
      throw new Error('他機能に参照があります。削除はできません: '+plan.blockers.join(' / '));
    const snapshots=plan.rows.map(function(entry){
      const range=entry.sheet.getRange(entry.row,1,1,entry.sheet.getLastColumn());
      return {range:range,
        values:range.getValues()[0],formulas:range.getFormulas()[0]};
    });
    try{
      snapshots.forEach(function(item){item.range.clearContent();});
      SpreadsheetApp.flush();
      snapshots.forEach(function(item){
        if(item.range.getValues()[0].some(function(v){return v!==''&&v!==null;}))
          throw new Error('削除した行に値が残っています。');
      });
      catalogAudit_('MEMBER',mid,'DELETE',{name:plan.name,groupId:plan.homeGroupId},null,actor);
      return {ok:true,deleted:true,memberId:mid};
    }catch(error){
      const failed=[];
      snapshots.forEach(function(item){
        try{item.range.setValues([item.values.map(function(v,i){return item.formulas[i]||v;})]);}
        catch(e){failed.push(e.message);}
      });
      throw new Error('削除中止: '+error.message+(failed.length?'／復旧に失敗: '+failed.join(' / '):''));
    }
  });
}
