/**
 * Site-only management of UNIT memberships in Core 04_GroupMembers.
 * Group/Member master tables and all other memberships remain untouched.
 * Uses the existing catalog administrator gate, shared writer lock and audit.
 *
 * Removal clears only one membership row and compacts order within that UNIT.
 * No row is physically deleted: shifting rows could invalidate other references.
 */
function catalogUnitMembershipContext_(ss,groupId) {
  const groups=catalogTable_(ss,BU1.SHEETS.GROUPS,['GroupID','GroupKind','RecordStatus']);
  const group=catalogRow_(groups,'GroupID',groupId);
  catalogEnsureActive_(groups,group);
  if(clean_(group.values[groups.map.GroupKind])!=='UNIT')
    throw new Error('所属の除外・並べ替えはユニットでのみ実行できます。');
  const links=catalogTable_(ss,BU1.SHEETS.GROUP_MEMBERS,['GroupID','MemberID','DisplayOrder']);
  const selected=links.rows.filter(function(r){
    return id_(r.values[links.map.GroupID])===groupId;
  });
  const members=new Map(),orders=new Set();
  const rows=selected.map(function(r){
    const mid=id_(r.values[links.map.MemberID]);
    const order=Number(r.values[links.map.DisplayOrder]);
    if(!mid)throw new Error('このユニットにMemberIDが空の所属行があります。先にDBを点検してください。');
    if(!Number.isSafeInteger(order)||order<1)
      throw new Error('このユニットの表示順が不正です。先にDBを点検してください。');
    if(members.has(mid)||orders.has(order))
      throw new Error('このユニットの所属または表示順が重複しています。先にDBを点検してください。');
    members.set(mid,true);orders.add(order);
    return {rowNumber:r.rowNumber,memberId:mid,order:order,values:r.values};
  }).sort(function(a,b){return a.order-b.order;});
  rows.forEach(function(r,i){
    if(r.order!==i+1)throw new Error('このユニットの表示順に欠番があります。先にDBを点検してください。');
  });
  return {table:links,rows:rows,group:group};
}
function catalogUnitMembershipExpectOrder_(actual,expected) {
  const n=Number(expected);
  if(!Number.isSafeInteger(n)||n!==actual)
    throw new Error('表示順が更新されています。ユニット一覧を再読み込みしてください。');
}
function catalogUnitMembershipSetCell_(cell,value,undo) {
  if(typeof cell.getFormula==='function'&&cell.getFormula())
    throw new Error('表示順のセルに数式があるため変更を止めました。');
  const before=cell.getValue();
  if(String(before)===String(value))return;
  cell.setValue(value);
  undo.push(function(){cell.setValue(before);});
}
function catalogUnitMembershipRollback_(undo,error) {
  const errors=[];
  undo.reverse().forEach(function(fn){
    try{fn();}catch(e){errors.push(e.message||String(e));}
  });
  SpreadsheetApp.flush();
  throw new Error(error.message+(errors.length?'／復旧が必要: '+errors.join(' / '):''));
}
/** Move the selected member up or down within one UNIT. */
function moveCatalogUnitMemberForUniverse(payload) {
  payload=payload||{};
  const actor=catalogRequireAdmin_(payload);
  const groupId=id_(payload.groupId),memberId=id_(payload.memberId);
  const direction=clean_(payload.direction).toUpperCase();
  if(!groupId||!memberId||['UP','DOWN'].indexOf(direction)<0)
    throw new Error('ユニット・メンバー・移動方向を指定してください。');
  return withSharedWriterLock_('ユニット所属の並べ替え',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    const ctx=catalogUnitMembershipContext_(ss,groupId);
    const i=ctx.rows.findIndex(function(r){return r.memberId===memberId;});
    if(i<0)throw new Error('このメンバーは指定ユニットに所属していません。');
    const current=ctx.rows[i];
    catalogUnitMembershipExpectOrder_(current.order,payload.expectedOrder);
    const target=ctx.rows[i+(direction==='UP'?-1:1)];
    if(!target)return {ok:true,unchanged:true,groupId:groupId,memberId:memberId};
    const sheet=ctx.table.sheet,col=ctx.table.map.DisplayOrder+1,undo=[];
    try{
      const first=sheet.getRange(current.rowNumber,col),second=sheet.getRange(target.rowNumber,col);
      catalogUnitMembershipSetCell_(first,target.order,undo);
      catalogUnitMembershipSetCell_(second,current.order,undo);
      SpreadsheetApp.flush();
      if(Number(first.getValue())!==target.order||Number(second.getValue())!==current.order)
        throw new Error('並び順の保存後照合に失敗しました。');
      catalogAudit_('UNIT_MEMBERSHIP',groupId+'_'+memberId,'REORDER',
        {groupId:groupId,memberId:memberId,displayOrder:current.order},
        {groupId:groupId,memberId:memberId,displayOrder:target.order},actor);
      return {ok:true,groupId:groupId,memberId:memberId,displayOrder:target.order};
    }catch(error){catalogUnitMembershipRollback_(undo,error);}
  });
}
/**
 * Remove exactly one UNIT membership, not the Member itself.
 * All surviving members of this UNIT get contiguous 1..N order.
 * Other GROUP/UNIT memberships and 02_Members.GroupID are not edited.
 */
function removeCatalogUnitMemberForUniverse(payload) {
  payload=payload||{};
  const actor=catalogRequireAdmin_(payload);
  const groupId=id_(payload.groupId),memberId=id_(payload.memberId);
  if(!groupId||!memberId)throw new Error('ユニットと所属解除するメンバーを指定してください。');
  return withSharedWriterLock_('ユニット所属の解除',function(){
    const ss=openCoreSpreadsheet_();catalogRequireReady_(ss);
    const ctx=catalogUnitMembershipContext_(ss,groupId);
    const current=ctx.rows.find(function(r){return r.memberId===memberId;});
    if(!current)throw new Error('このメンバーは指定ユニットに所属していません。');
    catalogUnitMembershipExpectOrder_(current.order,payload.expectedOrder);
    const members=catalogTable_(ss,BU1.SHEETS.MEMBERS,['MemberID','GroupID','RecordStatus']);
    const member=catalogRow_(members,'MemberID',memberId);
    catalogEnsureActive_(members,member);
    if(id_(member.values[members.map.GroupID])===groupId)
      throw new Error('主所属はユニット所属解除から変更できません。');
    const sheet=ctx.table.sheet,undo=[],row=current.rowNumber,columns=ctx.table.header.length;
    const rowRange=sheet.getRange(row,1,1,columns);
    const original=rowRange.getValues()[0];
    const originalFormulas=rowRange.getFormulas()[0];
    if(originalFormulas.some(function(x){return !!x;}))
      throw new Error('所属行に数式があるため安全に解除できません。');
    // Do not modify additional columns beyond this canonical membership row.
    try{
      rowRange.clearContent();
      undo.push(function(){rowRange.setValues([original]);});
      const col=ctx.table.map.DisplayOrder+1;
      ctx.rows.filter(function(r){return r.order>current.order;}).forEach(function(r){
        catalogUnitMembershipSetCell_(sheet.getRange(r.rowNumber,col),r.order-1,undo);
      });
      SpreadsheetApp.flush();
      if(rowRange.getValues()[0].some(function(v){return v!==''&&v!==null;}))
        throw new Error('所属解除後の空行確認に失敗しました。');
      const verify=catalogUnitMembershipContext_(ss,groupId);
      if(verify.rows.some(function(r){return r.memberId===memberId})||
         verify.rows.length!==ctx.rows.length-1)
        throw new Error('所属解除後の整合確認に失敗しました。');
      catalogAudit_('UNIT_MEMBERSHIP',groupId+'_'+memberId,'REMOVE',
        {groupId:groupId,memberId:memberId,displayOrder:current.order},null,actor);
      return {ok:true,groupId:groupId,memberId:memberId,removed:true};
    }catch(error){catalogUnitMembershipRollback_(undo,error);}
  });
}
