/**
 * BMSG Universe の歌詞登録で、ユーザーが「ゲストではない」と確認した
 * 未登録Singer候補を歌詞として扱ったまま保存するためのWriter拡張。
 * 通常の未登録Singer候補は従来どおり保存をブロックする。
 */
function saveNewSongLyricsWithIgnoredGuestsForUniverse(payload) {
  payload = payload || {};
  requireUniverseServiceUser_(payload.userId);
  const song = normalizeUniverseServiceSong_(payload.song || {});
  const credits = normalizeUniverseServiceCredits_(payload.credits || {});
  const rawLyrics = String(payload.rawLyrics || '');
  if (!rawLyrics.trim()) throw new Error('歌詞を入力してください。');

  const parsed = parseSongLyricsForUniverse({ userId:payload.userId, rawLyrics:rawLyrics });
  const ignored = universeIgnoredGuestCandidateMap_(payload.ignoredGuestCandidates);
  const unknownGuests = (parsed.unknownGuests || []).filter(function(name) {
    return !ignored[universeGuestCandidateKey_(name)];
  });
  if (unknownGuests.length) throw new Error('未登録のSingerがあります: ' + unknownGuests.join('、'));
  if ((parsed.errors || []).length || !parsed.parts || !parsed.parts.length) {
    throw new Error((parsed.errors || ['歌詞を解析できませんでした。']).join('\n'));
  }

  return withSharedWriterLock_('新規楽曲登録', function() {
    return createSongWithPartsCore_(openCoreSpreadsheet_(), song, credits, parsed.parts, {
      source:'BMSG-DB_UNIVERSE',
      notePrefix:'Universe 新規曲'
    });
  });
}

function universeGuestCandidateKey_(value) {
  const text = String(value == null ? '' : value).trim();
  return typeof text.normalize === 'function' ? text.normalize('NFKC') : text;
}

function universeIgnoredGuestCandidateMap_(values) {
  const out = Object.create(null);
  (Array.isArray(values) ? values : []).forEach(function(value) {
    const key = universeGuestCandidateKey_(value);
    if (key) out[key] = true;
  });
  return out;
}
