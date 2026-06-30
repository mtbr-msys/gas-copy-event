// 1. 同期元のカレンダーIDと別名をオブジェクトの配列で指定
const FROM_CALENDAR_CONFIG = [
  { id: 'XXXX', name: 'XXXX' },
];

// 同期先のカレンダーID
const TO_CALENDAR_ID = 'XXXX';
const toCalendar = CalendarApp.getCalendarById(TO_CALENDAR_ID);

function initSync() {
  const ranges = [
    [0, 2],   // 今日・明日
    [2, 14],  // 2日後〜2週間後
    [15, 60]  // 15日後〜60日後
  ];

  // 同期先の指定範囲の予定をすべて削除
  ranges.forEach(range => {
    const period = getStartEndDates(range[0], range[1]);
    const oldEvents = toCalendar.getEvents(period.start, period.end);
    oldEvents.forEach(event => event.deleteEvent());
  });

  // 2. 各同期元カレンダーから予定を取得してコピー
  FROM_CALENDAR_CONFIG.forEach(config => {
    const fromCalendar = CalendarApp.getCalendarById(config.id);
    if (!fromCalendar) {
      console.log(`カレンダーが見つかりません: ${config.id}`);
      return;
    }

    ranges.forEach(range => {
      syncRange(fromCalendar, range[0], range[1], config.name);
    });
  });
}

/**
 * 特定の範囲の予定をコピーする内部関数
 */
function syncRange(fromCalendar, startOffset, endOffset, sourceName) {
  const period = getStartEndDates(startOffset, endOffset);
  const events = fromCalendar.getEvents(period.start, period.end);

  events.forEach(event => {
    // 【修正点】件名の頭に [別名] を追加
    const newTitle = "[" + sourceName + "] " + event.getTitle();
    
    const options = {
      description: event.getDescription(), // 本文はそのままコピー
      location: event.getLocation()
    };

    if (event.isAllDayEvent()) {
      toCalendar.createAllDayEvent(newTitle, event.getStartTime(), event.getEndTime(), options);
    } else {
      toCalendar.createEvent(newTitle, event.getStartTime(), event.getEndTime(), options);
    }
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
