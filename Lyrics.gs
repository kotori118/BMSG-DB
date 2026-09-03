/**
 * BMSG Universe 本体GAS
 * Lyrics.gs v1.0 - 歌詞自由入力解析・確認登録
 *
 * 入力_歌詞 の貼り付け素材を解析し、
 * 同じシート内の解析ステータス／解析結果へ出力する。
 *
 * プレビュー後の確定操作で06_Songs / 08_LyricsPartsへ保存する。
 */

const BU_LYRICS = {
  SHEETS: {
    INPUT: '入力_歌詞',
    GROUPS: '01_Groups',
    MEMBERS: '02_Members',
    GUESTS: '03_Guests',
    SONGS: '06_Songs',
  },
  TITLE_CELL: 'B2',
  GROUP_CELL: 'D2',
  DATE_CELL: 'F2',
  INPUT_CELL: 'B5',
  STATUS_CELL: 'B18',
  RESULT_CELL: 'B21',
  MAX_PREVIEW_LYRICS: 52,
};

/**
 * 人間向け入口。
 */
function previewLyricsInput() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = requireLyricsSheet_(ss, BU_LYRICS.SHEETS.INPUT);

  try {
    ensureLyricsInputLayout_();

    const raw = inputSheet.getRange(BU_LYRICS.INPUT_CELL).getDisplayValue();
    const metaInput = readLyricsMetadataInput_(inputSheet);

    if (!cleanLyricsText_(raw)) {
      writeLyricsPreviewResult_(
        inputSheet,
        '要確認',
        '歌詞欄が空です。歌詞本文を貼り付けてから解析してください。'
      );
      return;
    }

    let masters = {
      groups: loadLyricsGroups_(ss),
      singers: loadLyricsSingers_(ss),
      songs: loadLyricsSongs_(ss),
    };

    const guestCandidates = findUnknownLyricsGuestCandidates_(raw, masters);
    if (guestCandidates.length) {
      const guestResult = confirmAndRegisterLyricsGuests_(ss, guestCandidates);
      if (guestResult.registered.length) {
        masters = {
          groups: loadLyricsGroups_(ss),
          singers: loadLyricsSingers_(ss),
          songs: loadLyricsSongs_(ss),
        };
      }
    }

    const result = parseLyricsMaterial_(raw, metaInput, masters);
    const output = formatLyricsPreview_(result);
    PropertiesService.getDocumentProperties().setProperty('BU_LYRICS_PREVIEW', JSON.stringify({
      raw: raw,
      metaInput: metaInput,
      result: result,
      at: new Date().toISOString()
    }));

    writeLyricsPreviewResult_(
      inputSheet,
      result.canRegister ? '解析OK（未登録）' : '要確認（登録不可）',
      output
    );

    SpreadsheetApp.getUi().alert(
      '歌詞解析',
      result.canRegister
        ? `${result.parts.length}パートとして解析できました。DBへの登録は行っていません。`
        : `確認事項があります。DBへの登録は行っていません。`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );

  } catch (err) {
    writeLyricsPreviewResult_(
      inputSheet,
      '解析エラー',
      String(err && err.message ? err.message : err)
    );
    throw err;
  }
}
function commitLyricsInput() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), input = requireSheet_(ss, BU1.SHEETS.INPUT_LYRICS);
  withDocumentLock_('歌詞登録', function () {
    const saved = PropertiesService.getDocumentProperties().getProperty('BU_LYRICS_PREVIEW');
    if (!saved) { alert_('歌詞登録', '先に「歌詞｜解析（プレビュー）」を実行してください。'); return; }
    const payload = JSON.parse(saved), raw = input.getRange(BU_LYRICS.INPUT_CELL).getDisplayValue();
    const metaInput = readLyricsMetadataInput_(input);
    if (raw !== payload.raw || JSON.stringify(metaInput) !== JSON.stringify(payload.metaInput || {}) || !payload.result.canRegister) { alert_('歌詞登録', '曲名・Group・発売日・歌詞のいずれかがプレビュー時から変わったか、登録不可の解析結果です。もう一度解析してください。'); return; }
    const result = payload.result;
    if (!confirm_('歌詞登録の確認', result.title + '\n' + result.parts.length + 'パートを登録しますか？\n既存曲の場合は歌詞パートを置き換えます。')) return;
    let songId = result.song && result.song.songId;
    if (!songId) {
      const artist = result.group.name, band = BU1.SONG_BANDS[artist] || BU1.SONG_BANDS.DEFAULT;
      songId = String(issueNumber_(ss, 'NEXT_SONG_ID_' + band));
      appendStyledRow_(requireSheet_(ss, BU1.SHEETS.SONGS), [songId, result.title, artist, normalizeDateForSheet_(result.releaseDate), '', '', false]);
      ensureSongCreditRow_(ss, songId, result.title, artist);
    }
    const partsSheet = requireSheet_(ss, BU1.SHEETS.LYRICS_PARTS), table = readTable_(partsSheet);
    table.rows.filter(r => id_(r.values[table.map.SongID]) === String(songId)).sort((a, b) => b.rowNumber - a.rowNumber).forEach(r => partsSheet.deleteRow(r.rowNumber));
    writeRows_(partsSheet, partsSheet.getLastRow() + 1, 1, result.parts.map(p => [songId, p.partOrder, p.mainSingerIds.join(','), p.lyrics]));
    if (result.group.name === 'BE:FIRST') syncPerformanceMetricRows(ss, true);
    input.getRange(BU_LYRICS.STATUS_CELL).setValue('登録済み SongID ' + songId);
    PropertiesService.getDocumentProperties().deleteProperty('BU_LYRICS_PREVIEW');
    alert_('歌詞登録完了', 'SongID ' + songId + ' を登録しました。');
  });
}

/**
 * 自由形式素材を解析する。
 *
 * 安全思想:
 * - メタ情報は最初のSinger行より前だけから解析する
 * - Singerは正式名/登録済み候補の完全一致のみ
 * - 複数Singerは、分割した全要素が既知Singerのときだけ確定
 * - Singer行以外はLyricsとして保持
 * - Lyrics内部の改行・括弧は保持
 * - 分からないメタ情報は推測しない
 */
function parseLyricsMaterial_(raw, metaInput, masters) {
  const normalized = normalizeLineEndings_(raw);
  const lines = normalized.split('\n');
  const warnings = [];
  const errors = [];

  const meta = resolveLyricsMetadataInput_(metaInput, masters, errors, warnings);
  const parts = parseLyricsParts_(lines, masters.singers, errors);

  if (parts.length === 0) errors.push('歌詞パートを作成できませんでした。');

  parts.forEach((part, i) => {
    if (!part.mainSingerIds.length) errors.push(`Part ${i + 1}: Singerを確定できません。`);
    if (part.lyrics === '') errors.push(`Part ${i + 1}: Lyricsが空です。`);
  });

  return {
    title: meta.title,
    group: meta.group,
    releaseDate: meta.releaseDate,
    song: meta.song,
    parts,
    warnings,
    errors,
    canRegister: errors.length === 0,
  };
}

function readLyricsMetadataInput_(sheet) {
  return {
    title: cleanLyricsText_(sheet.getRange(BU_LYRICS.TITLE_CELL).getDisplayValue()),
    group: cleanLyricsText_(sheet.getRange(BU_LYRICS.GROUP_CELL).getDisplayValue()),
    releaseDate: cleanLyricsText_(sheet.getRange(BU_LYRICS.DATE_CELL).getDisplayValue()),
  };
}

function resolveLyricsMetadataInput_(metaInput, masters, errors, warnings) {
  const title = cleanLyricsText_(metaInput && metaInput.title);
  const selectedGroup = cleanLyricsText_(metaInput && metaInput.group);
  const releaseDate = parseLyricsDate_(metaInput && metaInput.releaseDate);

  if (!title) errors.push('曲名セルが空です。');
  if (!selectedGroup) errors.push('Groupセルが空です。');
  if (!releaseDate) errors.push('発売日セルを日付として解析できません。');

  let group = null;
  if (selectedGroup === 'UNIT') {
    group = { groupId: 'UNIT', name: 'UNIT', isUnit: true };
  } else if (selectedGroup) {
    const matches = masters.groups.byName[selectedGroup] || [];
    if (matches.length === 1) group = matches[0];
    else if (matches.length === 0) errors.push(`Group「${selectedGroup}」は選択可能な登録Groupに一致しません。`);
    else errors.push(`Group「${selectedGroup}」が01_Groupsで重複しています。`);
  }

  let song = null;
  if (title) {
    const sameTitle = masters.songs.byTitle[title] || [];
    const sameArtist = sameTitle.filter(x => cleanLyricsText_(x.artist) === selectedGroup);
    if (sameArtist.length === 1) {
      song = sameArtist[0];
      if (releaseDate && song.releaseDate && song.releaseDate !== releaseDate) {
        errors.push(`発売日が06_Songsと一致しません。入力=${releaseDate} / 06_Songs=${song.releaseDate}`);
      }
    } else if (sameArtist.length > 1) {
      errors.push(`曲名「${title}」＋Artist「${selectedGroup}」が06_Songsで重複しています。`);
    } else if (sameTitle.length) {
      warnings.push(`同名曲はありますがArtistが異なるため、新規曲候補として扱います: ${title}`);
    } else {
      warnings.push(`06_Songs未登録の新規曲候補です: ${title}`);
    }
  }

  return { title, group, releaseDate, song };
}
function parseLyricsParts_(bodyLines, singers, errors) {
  const parts = [];
  let current = null;

  bodyLines.forEach((rawLine, index) => {
    const singer = resolveSingerLine_(rawLine, singers);

    if (singer) {
      if (current) {
        finalizeLyricsPart_(current, parts, errors);
      }

      current = {
        singerDisplay: singer.displayNames.join(', '),
        mainSingerIds: singer.ids,
        rawLyricsLines: [],
        bodyLineNumber: index + 1,
      };
      return;
    }

    if (!current) {
      // 最初のSinger前はbodyに来ない想定。
      // 万一あっても推測で扱わない。
      if (cleanLyricsText_(rawLine) !== '') {
        errors.push(
          `歌唱者を確定する前に未分類行があります: ${cleanLyricsText_(rawLine)}`
        );
      }
      return;
    }

    current.rawLyricsLines.push(rawLine);
  });

  if (current) {
    finalizeLyricsPart_(current, parts, errors);
  }

  return parts;
}

function finalizeLyricsPart_(current, parts, errors) {
  const lyrics = trimBoundaryBlankLines_(current.rawLyricsLines).join('\n');

  parts.push({
    partOrder: parts.length + 1,
    mainSingerIds: current.mainSingerIds,
    singerDisplay: current.singerDisplay,
    lyrics,
  });
}

function normalizeSingerLabel_(rawLine) {
  let text = cleanLyricsText_(rawLine);
  if (!text) return { text: '', wrapped: false, wrapper: '' };

  const wrappers = [
    ['[', ']'], ['【', '】'], ['(', ')'], ['（', '）'],
    ['「', '」'], ['『', '』'], ['｢', '｣'], ['〈', '〉'],
    ['《', '》'], ['＜', '＞'], ['<', '>'], ['“', '”'], ['\"', '\"']
  ];

  let wrapped = false;
  let wrapper = '';
  let changed = true;
  while (changed && text) {
    changed = false;
    for (const pair of wrappers) {
      if (text.startsWith(pair[0]) && text.endsWith(pair[1]) && text.length > pair[0].length + pair[1].length) {
        wrapper = pair[0] + pair[1];
        text = cleanLyricsText_(text.slice(pair[0].length, text.length - pair[1].length));
        wrapped = true;
        changed = true;
        break;
      }
    }
  }

  text = text.replace(/[：:]\s*$/, '').trim();
  return { text, wrapped, wrapper };
}

function splitSingerTokens_(text) {
  return cleanLyricsText_(text)
    .split(/\s*(?:、|,|，|､|＆|&|＋|\+|／|\/|・|×)\s*/)
    .map(cleanLyricsText_)
    .filter(Boolean);
}

function resolveSingerLine_(rawLine, singers) {
  const label = normalizeSingerLabel_(rawLine);
  const line = label.text;
  if (!line) return null;

  const direct = singers.byName[line] || [];
  if (direct.length === 1) {
    return { ids: [String(direct[0].id)], displayNames: [direct[0].name] };
  }
  if (direct.length > 1) return null;

  const tokens = splitSingerTokens_(line);
  if (tokens.length < 2) return null;

  const resolved = [];
  for (const token of tokens) {
    const matches = singers.byName[token] || [];
    if (matches.length !== 1) return null;
    resolved.push(matches[0]);
  }

  return {
    ids: resolved.map(x => String(x.id)),
    displayNames: resolved.map(x => x.name),
  };
}
function looksLikeUnknownSingerName_(name) {
  const text = cleanLyricsText_(name);
  if (!text || text.length > 48) return false;
  if (parseLyricsDate_(text)) return false;
  if (/[!?！？。]/.test(text)) return false;
  if (/\b(?:the|and|but|cause|because|when|what|your|you|me|my|we|our|is|are|to|of|in|on|for|with)\b/i.test(text) && /\s/.test(text)) return false;
  if (!/^[A-Za-z0-9À-ÖØ-öø-ÿĀ-ž一-龠ぁ-んァ-ヶ々ー・.'’\- ]+$/.test(text)) return false;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 5) return false;

  if (/^[A-Za-z0-9À-ÖØ-öø-ÿĀ-ž.'’\- ]+$/.test(text) && words.length >= 2) {
    const nameLike = words.every(w => /^[A-Z0-9À-ÖØ-Þ]/.test(w) || /^[A-Z0-9.'’\-]+$/.test(w));
    if (!nameLike) return false;
  }

  return true;
}

function isStrongUnknownSingerLine_(rawLine, singers) {
  const label = normalizeSingerLabel_(rawLine);
  if (!label.text || resolveSingerLine_(rawLine, singers)) return false;
  const tokens = splitSingerTokens_(label.text);
  const knownCount = tokens.filter(token => (singers.byName[token] || []).length === 1).length;
  if (knownCount > 0) return true;
  if (label.wrapped && label.wrapper !== '()' && label.wrapper !== '（）') return true;
  return false;
}

function getUnknownSingerTokensFromLine_(rawLine, singers, context) {
  const label = normalizeSingerLabel_(rawLine);
  if (!label.text || resolveSingerLine_(rawLine, singers)) return [];

  const tokens = splitSingerTokens_(label.text);
  if (!tokens.length) return [];
  const knownCount = tokens.filter(token => (singers.byName[token] || []).length === 1).length;
  const unknown = tokens.filter(token => {
    const matches = singers.byName[token] || [];
    return matches.length === 0 && looksLikeUnknownSingerName_(token);
  });
  if (!unknown.length) return [];

  if (knownCount > 0) return unknown;
  if (label.wrapped && label.wrapper !== '()' && label.wrapper !== '（）') return unknown;

  const prevBlank = !context || context.prevBlank;
  const nextHasText = !context || context.nextHasText;
  const separatedLikeHeader = prevBlank && nextHasText;
  if (separatedLikeHeader && looksLikeUnknownSingerName_(label.text)) return unknown;

  // 丸括弧は歌詞にも頻出するため、独立ヘッダーらしい場合だけ候補にする。
  if ((label.wrapper === '()' || label.wrapper === '（）') && separatedLikeHeader && looksLikeUnknownSingerName_(label.text)) {
    return unknown;
  }

  return [];
}

function findUnknownLyricsGuestCandidates_(raw, masters) {
  const lines = normalizeLineEndings_(raw).split('\n');
  const seen = {};
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const context = {
      prevBlank: i === 0 || cleanLyricsText_(lines[i - 1]) === '',
      nextHasText: i + 1 < lines.length && cleanLyricsText_(lines[i + 1]) !== '',
    };
    getUnknownSingerTokensFromLine_(lines[i], masters.singers, context).forEach(name => {
      if (seen[name]) return;
      seen[name] = true;
      out.push(name);
    });
  }
  return out;
}

function confirmAndRegisterLyricsGuests_(ss, names) {
  const result = { registered: [], ignored: [] };
  if (!names.length) return result;
  const sheet = requireLyricsSheet_(ss, BU_LYRICS.SHEETS.GUESTS);

  names.forEach(name => {
    const yes = confirm_(
      '未登録Guest候補',
      '歌唱者候補「' + name + '」は02_Members／03_Guestsに未登録です。\n\n' +
      '［はい］Guestとして03_Guestsへ登録し、この行を歌唱者の区切りとして扱う\n' +
      '［いいえ］Guestではない。この行は区切らずLyrics本文として残す'
    );
    if (!yes) {
      result.ignored.push(name);
      return;
    }
    appendStyledRow_(sheet, [String(issueNumber_(ss, 'NEXT_GUEST_ID')), name]);
    result.registered.push(name);
  });
  return result;
}
function loadLyricsGroups_(ss) {
  const sheet = requireLyricsSheet_(ss, BU_LYRICS.SHEETS.GROUPS);
  const values = sheet.getDataRange().getDisplayValues();
  const header = values[0];

  const idCol = header.indexOf('GroupID');
  const nameCol = header.indexOf('GroupName') >= 0
    ? header.indexOf('GroupName')
    : header.indexOf('DisplayName');

  if (idCol < 0 || nameCol < 0) {
    throw new Error('01_GroupsのGroupID / GroupName列を確認できません。');
  }

  const byName = {};

  values.slice(1).forEach(row => {
    const groupId = cleanLyricsText_(row[idCol]);
    const name = cleanLyricsText_(row[nameCol]);
    if (!groupId || !name) return;

    if (!byName[name]) byName[name] = [];
    byName[name].push({ groupId, name });
  });

  return { byName };
}

function loadLyricsSingers_(ss) {
  const byName = {};

  const memberSheet = requireLyricsSheet_(ss, BU_LYRICS.SHEETS.MEMBERS);
  const memberValues = memberSheet.getDataRange().getDisplayValues();
  const mh = memberValues[0];

  const memberIdCol = mh.indexOf('MemberID');
  const memberNameCol = mh.indexOf('DisplayName');

  memberValues.slice(1).forEach(row => {
    const id = cleanLyricsText_(row[memberIdCol]);
    const name = cleanLyricsText_(row[memberNameCol]);
    if (!id || !name) return;
    addSingerName_(byName, name, { id, name, type: 'MEMBER' });
  });

  const guestSheet = requireLyricsSheet_(ss, BU_LYRICS.SHEETS.GUESTS);
  const guestValues = guestSheet.getDataRange().getDisplayValues();
  const gh = guestValues[0];

  const guestIdCol = gh.indexOf('GuestID');
  const guestNameCol = gh.indexOf('DisplayName');

  guestValues.slice(1).forEach(row => {
    const id = cleanLyricsText_(row[guestIdCol]);
    const name = cleanLyricsText_(row[guestNameCol]);
    if (!id || !name) return;
    addSingerName_(byName, name, { id, name, type: 'GUEST' });
  });

  // Universeで確定済みの疑似Singer。
  addSingerName_(byName, 'ALL', { id: '99', name: 'ALL', type: 'PSEUDO' });
  addSingerName_(byName, 'その他', { id: '109', name: 'その他', type: 'PSEUDO' });

  return { byName };
}

function addSingerName_(byName, name, singer) {
  if (!byName[name]) byName[name] = [];
  byName[name].push(singer);
}

function loadLyricsSongs_(ss) {
  const sheet = requireLyricsSheet_(ss, BU_LYRICS.SHEETS.SONGS);
  const values = sheet.getDataRange().getDisplayValues();
  const header = values[0];

  const songIdCol = header.indexOf('SongID');
  const titleCol = header.indexOf('Title');
  const artistCol = header.indexOf('Artist');
  const dateCol = header.indexOf('ReleaseDate');

  if (songIdCol < 0 || titleCol < 0 || artistCol < 0 || dateCol < 0) {
    throw new Error('06_SongsのSongID / Title / Artist / ReleaseDate列を確認できません。');
  }

  const byTitle = {};

  values.slice(1).forEach(row => {
    const songId = cleanLyricsText_(row[songIdCol]);
    const title = cleanLyricsText_(row[titleCol]);
    const artist = cleanLyricsText_(row[artistCol]);
    const releaseDate = normalizeMasterDate_(row[dateCol]);
    if (!songId || !title) return;

    const song = { songId, title, artist, releaseDate };

    if (!byTitle[title]) byTitle[title] = [];
    byTitle[title].push(song);
  });

  return { byTitle };
}

function formatLyricsPreview_(result) {
  const lines = [];

  lines.push('【解析結果】');
  lines.push(
    `曲名：${result.title || '未確定'}` +
    (result.song ? `（既存 SongID ${result.song.songId}）` : '（新規候補）')
  );
  lines.push(
    `Group：${result.group ? (result.group.isUnit ? 'UNIT' : `${result.group.name}（GroupID ${result.group.groupId}）`) : '未確定'}`
  );
  lines.push(`発売日：${result.releaseDate || '未確定'}`);
  lines.push(`パート数：${result.parts.length}`);

  lines.push('');
  lines.push('【パート確認】');

  result.parts.forEach(part => {
    const preview = makeLyricsExcerpt_(part.lyrics);
    lines.push(
      `${pad2_(part.partOrder)}  ${part.singerDisplay} ` +
      `[${part.mainSingerIds.join(',')}]｜${preview}`
    );
  });

  if (result.warnings.length) {
    lines.push('');
    lines.push('【注意】');
    result.warnings.forEach(x => lines.push(`・${x}`));
  }

  if (result.errors.length) {
    lines.push('');
    lines.push('【確認事項】');
    result.errors.forEach(x => lines.push(`・${x}`));
  } else {
    lines.push('');
    lines.push('【確認事項】なし');
  }

  lines.push('');
  lines.push('※この解析ではDBへ登録していません。');
  lines.push('※括弧・歌詞内改行はLyrics本文として保持します。');

  return lines.join('\n');
}

function makeLyricsExcerpt_(lyrics) {
  const oneLine = String(lyrics || '').replace(/\n/g, ' ↵ ');
  if (oneLine.length <= BU_LYRICS.MAX_PREVIEW_LYRICS) return oneLine;
  return oneLine.slice(0, BU_LYRICS.MAX_PREVIEW_LYRICS) + '…';
}

function writeLyricsPreviewResult_(sheet, status, resultText) {
  sheet.getRange(BU_LYRICS.STATUS_CELL).setValue(status);
  sheet.getRange(BU_LYRICS.RESULT_CELL).setValue(resultText);
}

function ensureLyricsInputLayout_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = requireLyricsSheet_(ss, BU_LYRICS.SHEETS.INPUT);

  sheet.getRange('A3').setValue('① 曲名・Group・発売日を上の黄色セルへ入力 → ② 歌詞本文だけ貼り付け → ③ 解析 → ④ 確認して登録');
  sheet.getRange('A4').setValue('STEP 1｜歌詞本文をそのまま貼り付け');
  sheet.getRange('A2').setValue('曲名');
  sheet.getRange('C2').setValue('Group');
  sheet.getRange('E2').setValue('発売日');

  ['A2', 'C2', 'E2'].forEach(a1 => {
    sheet.getRange(a1).setFontWeight('bold').setBackground(BU1.COLORS.AUTO);
  });
  [BU_LYRICS.TITLE_CELL, BU_LYRICS.GROUP_CELL, BU_LYRICS.DATE_CELL].forEach(a1 => {
    sheet.getRange(a1).setBackground(BU1.COLORS.INPUT);
  });

  const choices = getLyricsArtistChoices_(ss);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(choices, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(BU_LYRICS.GROUP_CELL).setDataValidation(rule);
  sheet.getRange(BU_LYRICS.DATE_CELL).setNumberFormat('yyyy/m/d');
  sheet.getRange(BU_LYRICS.TITLE_CELL).setNote('曲名は歌詞本文から推測せず、このセルを正本として使用します。');
  sheet.getRange(BU_LYRICS.GROUP_CELL).setNote('登録済みの名のあるGroup、またはUNITを選択します。');
  sheet.getRange(BU_LYRICS.DATE_CELL).setNote('発売日はこのセルを正本として使用します。');
}

function getLyricsArtistChoices_(ss) {
  const groups = loadLyricsGroups_(ss);
  const names = Object.keys(groups.byName)
    .filter(name => name && name !== 'BMSG ALLSTARS')
    .sort((a, b) => a.localeCompare(b, 'ja'));
  if (names.indexOf('UNIT') < 0) names.push('UNIT');
  return names;
}

function parseLyricsDate_(value) {
  const text = cleanLyricsText_(value);
  if (!text) return '';

  let m = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return formatYmd_(m[1], m[2], m[3]);

  m = text.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return formatYmd_(m[1], m[2], m[3]);

  return '';
}

function normalizeMasterDate_(value) {
  const parsed = parseLyricsDate_(value);
  return parsed || cleanLyricsText_(value);
}

function formatYmd_(y, m, d) {
  const yy = String(Number(y)).padStart(4, '0');
  const mm = String(Number(m)).padStart(2, '0');
  const dd = String(Number(d)).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function trimBoundaryBlankLines_(lines) {
  const out = lines.slice();

  while (out.length && cleanLyricsText_(out[0]) === '') out.shift();
  while (out.length && cleanLyricsText_(out[out.length - 1]) === '') out.pop();

  return out;
}

function normalizeLineEndings_(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function cleanLyricsText_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseLyricsBool_(value) {
  if (typeof value === 'boolean') return value;
  const s = cleanLyricsText_(value).toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'YES';
}

function uniqueBy_(items, keyFn) {
  const seen = new Set();
  const out = [];

  items.forEach(item => {
    const key = keyFn(item);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });

  return out;
}

function pad2_(n) {
  return String(n).padStart(2, '0');
}

function requireLyricsSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`必要なシート「${name}」がありません。`);
  return sheet;
}

/**
 * 非著作物の合成データで15パート境界と括弧保持を確認する自己テスト。
 * DB・Spreadsheetへ書き込まない。
 */
function runLyricsParserSelfTest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const masters = {
    groups: loadLyricsGroups_(ss),
    singers: loadLyricsSingers_(ss),
    songs: loadLyricsSongs_(ss),
  };

  const singerCycle = ['MANATO', 'Aile The Shota', 'SOTA'];
  const blocks = [];

  for (let i = 0; i < 15; i++) {
    const singer = singerCycle[i % singerCycle.length];
    let lyric = `TEST LINE ${i + 1}`;
    if (i === 9) lyric += '\n(KEEP PARENTHESIS AS LYRICS)';
    blocks.push(`${singer}\n${lyric}`);
  }

  const sample = blocks.join('\n\n');
  const metaInput = { title: 'Gradation', group: 'ShowMinorSavage', releaseDate: '2026年8月12日' };

  const result = parseLyricsMaterial_(sample, metaInput, masters);

  if (result.parts.length !== 15) {
    throw new Error(`自己テスト失敗: 15パートではなく${result.parts.length}パート`);
  }

  if (!result.parts[9].lyrics.includes('(KEEP PARENTHESIS AS LYRICS)')) {
    throw new Error('自己テスト失敗: 括弧行がLyricsとして保持されていません');
  }

  if (result.errors.length) {
    throw new Error('自己テスト失敗: ' + result.errors.join(' / '));
  }

  return 'OK: 15 parts / parentheses preserved / DB write = none';
}
