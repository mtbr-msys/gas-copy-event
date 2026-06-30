// 1. 同期元のカレンダーIDと別名をオブジェクトの配列で指定
const FROM_CALENDAR_CONFIG = [
  { id: 'XXXX', name: 'XXXX' },
];

// 同期先のカレンダーID
const TO_CALENDAR_ID = 'XXXX';
const toCalendar = CalendarApp.getCalendarById(TO_CALENDAR_ID);

// 同期状態を保存するスプレッドシートID。
// このスクリプトをスプレッドシートに紐づけて使う場合は空文字のままでOK。
const STAGING_SPREADSHEET_ID = '';
const STAGING_SHEET_NAME_PREFIX = 'calendar_sync_';
const CLEANUP_UNTRACKED_COPIES_ON_FIRST_RUN = true;
const STAGING_HEADERS = [
  'syncKey',
  'sourceCalendarId',
  'sourceName',
  'sourceEventId',
  'destinationEventId',
  'title',
  'startTime',
  'endTime',
  'isAllDay',
  'description',
  'location',
  'fingerprint',
  'lastSeenAt'
];

function initSync() {
  const ranges = getSyncRanges();

  const spreadsheet = getStagingSpreadsheet();
  const activeMonthKeys = getMonthKeysForRanges(ranges);
  const sheetsByMonth = getStagingSheetsByMonth(spreadsheet, activeMonthKeys);
  deleteOldStagingSheets(spreadsheet, activeMonthKeys);

  const previousRows = loadSyncRowsFromSheets(sheetsByMonth);
  const previousByKey = buildRowMap(previousRows);
  const currentByKey = {};

  if (CLEANUP_UNTRACKED_COPIES_ON_FIRST_RUN && previousRows.length === 0) {
    cleanupUntrackedCopiedEvents(ranges);
  }

  FROM_CALENDAR_CONFIG.forEach(config => {
    const fromCalendar = CalendarApp.getCalendarById(config.id);
    if (!fromCalendar) {
      console.log(`カレンダーが見つかりません: ${config.id}`);
      return;
    }

    ranges.forEach(range => {
      collectRangeEvents(fromCalendar, range[0], range[1], config, currentByKey);
    });
  });

  Object.keys(currentByKey).forEach(syncKey => {
    const record = currentByKey[syncKey];
    const previous = previousByKey[syncKey];

    if (!previous) {
      const destinationEvent = createDestinationEvent(record);
      record.destinationEventId = destinationEvent.getId();
      return;
    }

    record.destinationEventId = previous.destinationEventId;
    if (record.fingerprint !== previous.fingerprint) {
      const destinationEvent = getDestinationEvent(previous.destinationEventId);
      if (destinationEvent) {
        updateDestinationEvent(destinationEvent, record);
      } else {
        record.destinationEventId = createDestinationEvent(record).getId();
      }
    }
  });

  Object.keys(previousByKey).forEach(syncKey => {
    if (currentByKey[syncKey]) {
      return;
    }

    const destinationEvent = getDestinationEvent(previousByKey[syncKey].destinationEventId);
    if (destinationEvent) {
      destinationEvent.deleteEvent();
    }
  });

  saveSyncRowsByMonth(sheetsByMonth, Object.keys(currentByKey).map(syncKey => currentByKey[syncKey]));
}

/**
 * 緊急用: シートの記録と同期先カレンダーのコピー予定をすべて削除する。
 */
function emergencyResetAllSyncedEvents() {
  const spreadsheet = getStagingSpreadsheet();
  const stagingSheets = getAllStagingSheets(spreadsheet);
  const rows = loadSyncRowsFromSheets(stagingSheets);
  const deletedEventIds = {};

  rows.forEach(row => {
    const eventId = row.destinationEventId;
    if (!eventId || deletedEventIds[eventId]) {
      return;
    }

    const destinationEvent = getDestinationEvent(eventId);
    if (destinationEvent) {
      destinationEvent.deleteEvent();
    }
    deletedEventIds[eventId] = true;
  });

  deleteCopiedEventsFromCalendar(getSyncRanges(), deletedEventIds);
  deleteStagingSheets(spreadsheet, stagingSheets);
}

/**
 * 特定の範囲の予定を同期候補として集める内部関数
 */
function collectRangeEvents(fromCalendar, startOffset, endOffset, config, currentByKey) {
  const period = getStartEndDates(startOffset, endOffset);
  const events = fromCalendar.getEvents(period.start, period.end);

  events.forEach(event => {
    const record = buildSyncRecord(config, event);
    currentByKey[record.syncKey] = record;
  });
}

/**
 * 開始日と終了日のDateオブジェクトを生成する補助関数
 */
function getStartEndDates(startOffset, endOffset) {
  const start = new Date();
  start.setDate(start.getDate() + startOffset);
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setDate(end.getDate() + endOffset);
  end.setHours(23, 59, 59, 999);

  return { start: start, end: end };
}

function cleanupUntrackedCopiedEvents(ranges) {
  deleteCopiedEventsFromCalendar(ranges, {});
}

function deleteCopiedEventsFromCalendar(ranges, deletedEventIds) {
  const copiedTitlePrefixes = FROM_CALENDAR_CONFIG.map(config => '[' + config.name + '] ');

  ranges.forEach(range => {
    const period = getStartEndDates(range[0], range[1]);
    const events = toCalendar.getEvents(period.start, period.end);

    events.forEach(event => {
      const eventId = event.getId();
      if (deletedEventIds[eventId]) {
        return;
      }

      const title = event.getTitle();
      const isCopiedEvent = copiedTitlePrefixes.some(prefix => title.indexOf(prefix) === 0);
      if (!isCopiedEvent) {
        return;
      }

      event.deleteEvent();
      deletedEventIds[eventId] = true;
    });
  });
}

function getSyncRanges() {
  return [
    [0, 2],   // 今日・明日
    [2, 14],  // 2日後〜2週間後
    [15, 60]  // 15日後〜60日後
  ];
}

function buildSyncRecord(config, event) {
  const title = '[' + config.name + '] ' + event.getTitle();
  const startTime = event.getStartTime();
  const endTime = event.getEndTime();
  const record = {
    syncKey: [
      config.id,
      event.getId(),
      startTime.toISOString()
    ].join('|'),
    sourceCalendarId: config.id,
    sourceName: config.name,
    sourceEventId: event.getId(),
    destinationEventId: '',
    title: title,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    isAllDay: event.isAllDayEvent(),
    description: event.getDescription(),
    location: event.getLocation(),
    fingerprint: '',
    lastSeenAt: new Date().toISOString()
  };

  record.fingerprint = buildFingerprint(record);
  return record;
}

function buildFingerprint(record) {
  return JSON.stringify({
    title: record.title,
    startTime: record.startTime,
    endTime: record.endTime,
    isAllDay: record.isAllDay,
    description: record.description,
    location: record.location
  });
}

function createDestinationEvent(record) {
  const options = {
    description: record.description,
    location: record.location
  };

  if (record.isAllDay) {
    return toCalendar.createAllDayEvent(
      record.title,
      new Date(record.startTime),
      new Date(record.endTime),
      options
    );
  }

  return toCalendar.createEvent(
    record.title,
    new Date(record.startTime),
    new Date(record.endTime),
    options
  );
}

function updateDestinationEvent(destinationEvent, record) {
  destinationEvent.setTitle(record.title);
  destinationEvent.setDescription(record.description);
  destinationEvent.setLocation(record.location);

  if (record.isAllDay) {
    destinationEvent.setAllDayDates(new Date(record.startTime), new Date(record.endTime));
  } else {
    destinationEvent.setTime(new Date(record.startTime), new Date(record.endTime));
  }
}

function getDestinationEvent(eventId) {
  if (!eventId) {
    return null;
  }

  try {
    return toCalendar.getEventById(eventId);
  } catch (e) {
    console.log(`同期先イベントを取得できません: ${eventId} / ${e}`);
    return null;
  }
}

function getStagingSpreadsheet() {
  const spreadsheet = STAGING_SPREADSHEET_ID
    ? SpreadsheetApp.openById(STAGING_SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error('STAGING_SPREADSHEET_ID を設定するか、スプレッドシートに紐づくスクリプトとして実行してください。');
  }

  return spreadsheet;
}

function getStagingSheetsByMonth(spreadsheet, monthKeys) {
  return monthKeys.reduce((sheetsByMonth, monthKey) => {
    const sheetName = getStagingSheetName(monthKey);
    const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
    setupStagingSheet(sheet);
    sheetsByMonth[monthKey] = sheet;
    return sheetsByMonth;
  }, {});
}

function getAllStagingSheets(spreadsheet) {
  return spreadsheet.getSheets().reduce((sheetsByName, sheet) => {
    const sheetName = sheet.getName();
    if (sheetName.indexOf(STAGING_SHEET_NAME_PREFIX) === 0) {
      sheetsByName[sheetName] = sheet;
    }
    return sheetsByName;
  }, {});
}

function getStagingSheetName(monthKey) {
  return STAGING_SHEET_NAME_PREFIX + monthKey;
}

function deleteOldStagingSheets(spreadsheet, activeMonthKeys) {
  const activeSheetNames = activeMonthKeys.reduce((map, monthKey) => {
    map[getStagingSheetName(monthKey)] = true;
    return map;
  }, {});

  spreadsheet.getSheets().forEach(sheet => {
    const sheetName = sheet.getName();
    if (sheetName.indexOf(STAGING_SHEET_NAME_PREFIX) !== 0 || activeSheetNames[sheetName]) {
      return;
    }

    spreadsheet.deleteSheet(sheet);
  });
}

function deleteStagingSheets(spreadsheet, sheetsByName) {
  Object.keys(sheetsByName).forEach(sheetName => {
    const sheet = sheetsByName[sheetName];
    if (spreadsheet.getSheets().length <= 1) {
      sheet.clear();
      return;
    }

    spreadsheet.deleteSheet(sheet);
  });
}

function getMonthKeysForRanges(ranges) {
  const monthKeyMap = {};

  ranges.forEach(range => {
    const period = getStartEndDates(range[0], range[1]);
    const cursor = new Date(period.start);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);

    while (cursor <= period.end) {
      monthKeyMap[getMonthKey(cursor)] = true;
      cursor.setMonth(cursor.getMonth() + 1);
    }
  });

  return Object.keys(monthKeyMap).sort();
}

function getMonthKey(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM');
}

function setupStagingSheet(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, STAGING_HEADERS.length);
  const currentHeaders = headerRange.getValues()[0];
  const needsSetup = STAGING_HEADERS.some((header, index) => currentHeaders[index] !== header);

  if (needsSetup) {
    headerRange.setValues([STAGING_HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function loadSyncRowsFromSheets(sheetsByMonth) {
  return Object.keys(sheetsByMonth).reduce((rows, monthKey) => {
    return rows.concat(loadSyncRows(sheetsByMonth[monthKey]));
  }, []);
}

function loadSyncRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  return sheet.getRange(2, 1, lastRow - 1, STAGING_HEADERS.length)
    .getValues()
    .filter(row => row[0])
    .map(row => rowToRecord(row));
}

function rowToRecord(row) {
  const record = {};
  STAGING_HEADERS.forEach((header, index) => {
    record[header] = row[index];
  });
  record.isAllDay = record.isAllDay === true || record.isAllDay === 'TRUE';
  return record;
}

function buildRowMap(rows) {
  return rows.reduce((map, row) => {
    map[row.syncKey] = row;
    return map;
  }, {});
}

function saveSyncRowsByMonth(sheetsByMonth, records) {
  const recordsByMonth = records.reduce((map, record) => {
    const monthKey = getMonthKey(new Date(record.startTime));
    if (!map[monthKey]) {
      map[monthKey] = [];
    }
    map[monthKey].push(record);
    return map;
  }, {});

  Object.keys(sheetsByMonth).forEach(monthKey => {
    saveSyncRows(sheetsByMonth[monthKey], recordsByMonth[monthKey] || []);
  });
}

function saveSyncRows(sheet, records) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, STAGING_HEADERS.length).clearContent();
  }

  if (!records.length) {
    return;
  }

  const rows = records
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map(recordToRow);

  sheet.getRange(2, 1, rows.length, STAGING_HEADERS.length).setValues(rows);
}

function recordToRow(record) {
  return STAGING_HEADERS.map(header => record[header]);
}
