/** 03_Guests / 06_Songs の直接入力補助。
 * UI確認だけを担当し、実際のGuest / Song書込はUniverseService.gsの共通Writerへ委譲する。
 */
function confirmAndSyncDirectMasters() {
  const plan = getLegacyDirectMastersPlan_();
  if (plan.errors.length) { alert_('登録を中止しました', plan.errors.join('\n')); return; }
  if (!confirm_('Guest・楽曲の登録確認', '新規Guest: ' + plan.guestCount + '件\n新規楽曲: ' + plan.songCount + '件\n\n登録しますか？')) return;
  const result = commitLegacyDirectMasters_();
  alert_('登録完了', 'Guest ' + result.guests + '件・楽曲 ' + result.songs + '件を共通Writerで登録しました。');
}
