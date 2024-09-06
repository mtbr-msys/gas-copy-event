
const fromCalender = CalendarApp.getCalendarById('');
const googleCalender = CalendarApp.getCalendarById('');

//   バッチ実行用

// 予定をすべてコピーして上書きする
function initSync() {
  syncEventsForToday();
  syncEventsForTommorow();
  syncEventsAfter2To14Days();
  syncEventsAfter15To60Days();
}

// 当日の予定をコピー
function syncEventsForToday() {
  var today = new Date();
  syncEventsForDay(today, 0);
}

// 明日の予定をコピー
function syncEventsForTommorow() {
  var today = new Date();
  var tomorrow = new Date(today.getTime() + (1 * 24 * 60 * 60 * 1000));
  syncEventsForDay(tomorrow, 0);
}

// 明後日から2週間後の予定をコピー
function syncEventsAfter2To14Days() {
  var today = new Date();
  var two_days_after = new Date(today.getTime() + (2 * 24 * 60 * 60 * 1000));
  syncEventsForDay(two_days_after, 14);
}

// 2週間後から2か月後の予定をコピー
function syncEventsAfter15To60Days() {
  var today = new Date();
  var fiften_days_after = new Date(today.getTime(), (15 * 24 * 60 * 60 * 1000));
  syncEventsForDay(fiften_days_after, 60);
}


//  内部で使う処理



//指定日から指定日数の予定を取得する
function getEventsForDays(target_calender, start_date, days) {
  if (days == 0) {
    let events = target_calender.getEventsForDay(start_date);
    return events;
  } else {
    let end_time = new Date(start_date.getTime() + (days * 24 * 60 * 60 * 1000));
    var events = target_calender.getEvents(start_date, end_time);
    return events;
  }
}


// 指定日から指定日までの予定をコピーする
function syncEventsForDay(start_date, days) {
  // まず予定を削除する
  let delete_target = getEventsForDays(googleCalender, start_date, days);
  for (let event of delete_target) {
    event.deleteEvent();
  }

  //予定をコピーする
  let copy_target = getEventsForDays(fromCalender, start_date, days);
  let last_event_id = '';
  for (let event of copy_target) {
    //終日予定の場合
    if (event.isAllDayEvent()) {
      if (last_event_id == event.getId()) {
        break;
      }
      last_event_id = event.getId();
      googleCalender.createAllDayEvent(event.getTitle(), event.getStartTime(), event.getEndTime(), { description: event.getDescription(), location: event.getLocation() });
    } else {
      googleCalender.createEvent(event.getTitle(), event.getStartTime(), event.getEndTime(), { description: event.getDescription(), location: event.getLocation() });
    }
  }
}


// カレンダー名/ID取得用
function showAllCallenderInfo() {
  let calendars = CalendarApp.getAllCalendars();
  for (let calendar of calendars) {
    console.log(calendar.getId());
    console.log(calendar.getName());
  }
}
