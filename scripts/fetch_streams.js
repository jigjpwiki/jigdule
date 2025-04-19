'use strict';

const fs    = require('fs').promises;
const fetch = require('node-fetch');

const YT_API_KEY           = process.env.YT_API_KEY;
const TWITCH_CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

/**
 * UTC 文字列 → JST「YYYY/MM/DD HH:mm:ss」形式
 */
function formatJST(utcString) {
  const d = new Date(utcString);
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour12:  false,
    year:    'numeric',
    month:   '2-digit',
    day:     '2-digit',
    hour:    '2-digit',
    minute:  '2-digit',
    second:  '2-digit'
  });
}

/** 当日 00:00 の ISO 文字列 */
function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Twitch OAuth トークン取得 */
async function getTwitchToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token` +
    `?client_id=${TWITCH_CLIENT_ID}` +
    `&client_secret=${TWITCH_CLIENT_SECRET}` +
    `&grant_type=client_credentials`,
    { method: 'POST' }
  );
  const json = await res.json();
  return json.access_token;
}

/** Twitch ライブ中ストリーム取得 */
async function fetchTwitchLive(login, token) {
  const res = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${login}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const { data } = await res.json();
  if (!data || !data[0]) return null;
  const s = data[0];
  const thumb = s.thumbnail_url
    .replace('{width}', '320')
    .replace('{height}', '180');
  return {
    platform:  'Twitch LIVE',
    title:     s.title,
    url:       `https://twitch.tv/${login}`,
    time:      s.started_at,
    status:    'live',
    thumbnail: thumb
  };
}

/** Twitch 配信予定取得（無題タイトル除外） */
async function fetchTwitchSchedule(login, token) {
  const ures = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const ujson  = await ures.json();
  const userId = ujson.data?.[0]?.id;
  if (!userId) return [];
  const res = await fetch(
    `https://api.twitch.tv/helix/schedule?broadcaster_id=${userId}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const segs  = (await res.json()).data?.segments || [];
  const valid = segs.filter(s => s.title && s.title.trim() !== '');
  return valid.map(s => ({
    platform:  'Twitch 予定',
    title:     s.title,
    url:       '',
    time:      s.start_time,
    status:    'upcoming',
    thumbnail: ''
  }));
}

/** Twitch VOD（過去配信）取得 */
async function fetchTwitchVods(login, token) {
  const ures = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const ujson  = await ures.json();
  const userId = ujson.data?.[0]?.id;
  if (!userId) return [];
  const res = await fetch(
    `https://api.twitch.tv/helix/videos` +
    `?user_id=${userId}` +
    `&first=5&broadcast_type=archive&started_at=${todayISO()}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const vods = (await res.json()).data || [];
  return vods.map(v => ({
    platform:  'Twitch 過去配信',
    title:     v.title,
    url:       v.url,
    time:      v.created_at,
    status:    'past',
    thumbnail: v.thumbnail_url
      ? v.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
      : ''
  }));
}

/** YouTube 検索ヘルパー */
async function fetchYouTube(channelId, params) {
  const url =
    `https://www.googleapis.com/youtube/v3/search` +
    `?key=${YT_API_KEY}` +
    `&channelId=${channelId}` +
    `&part=snippet&type=video` +
    `&order=date&maxResults=10&${params}`;
  const res  = await fetch(url);
  const json = await res.json();
  if (json.error) {
    throw new Error(`YouTube API error: ${json.error.code} ${json.error.message}`);
  }
  return (json.items || []).map(item => {
    const thumb     = item.snippet.thumbnails.medium.url;
    const isLive     = params.includes('eventType=live');
    const isUpcoming = params.includes('eventType=upcoming');
    return {
      platform:  isLive ? 'YouTube LIVE'
                : isUpcoming ? 'YouTube 予定'
                : 'YouTube 投稿',
      title:     item.snippet.title,
      url:       `https://youtu.be/${item.id.videoId}`,
      time:      item.snippet.publishedAt,
      status:    isLive ? 'live'
                : isUpcoming ? 'upcoming'
                : 'past',
      thumbnail: thumb
    };
  });
}

/**
 * 全イベントを日付ごとのセクションにまとめ、
 * jigdule UI の HTML を返す
 */
function generateHTML(events, streamers) {
  // グルーピング：date → イベント配列
  const groups = events.reduce((acc, e) => {
    const date = e.time.split('T')[0];
    if (!acc[date]) acc[date] = [];
    acc[date].push(e);
    return acc;
  }, {});
  const dates = Object.keys(groups).sort();

  // セクションごとに HTML 組立
  const sections = dates.map(date => {
    const d = new Date(date);
    const mm = String(d.getMonth()+1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const w  = ['日','月','火','水','木','金','土'][d.getDay()];
    const heading = `${mm}/${dd} (${w})`;

    const items = groups[date].map(e => {
      // avatar は streamers.json から引く
      const info = streamers.find(s => (
        e.platform.startsWith('Twitch')
          ? s.twitchUserLogin && e.url.includes(s.twitchUserLogin)
          : s.youtubeChannelId && e.url.includes(s.youtubeChannelId)
      )) || {};
      const avatar = info.avatar ? `assets/${info.avatar}` : '';
      return `
<li class="event">
  ${avatar 
    ? `<img class="avatar" src="${avatar}" alt="${info.name}">` 
    : ''}
  <div class="info">
    <div class="meta">
      <span class="time">${formatJST(e.time).slice(11,19)}</span>
      <span class="status">${e.status==='live'?'LIVE': e.status==='upcoming'?'予定':'過去'}</span>
      <span class="platform">${e.platform}</span>
    </div>
    <div class="body">
      ${e.thumbnail 
        ? `<img class="thumb" src="${e.thumbnail}" alt="">` 
        : ''}
      <a href="${e.url}" target="_blank" class="title">${e.title}</a>
    </div>
  </div>
</li>`;
    }).join('');

    return `
<section class="day" data-date="${date}">
  <h2>${heading}</h2>
  <ul class="events">
    ${items}
  </ul>
</section>`;
  }).join('');

  // フル HTML
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>jigdule</title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <header class="header">
    <h1 class="title">jigdule</h1>
    <div class="nav-buttons">
      <button id="prevBtn" class="nav-btn" aria-label="前の日">&lt;</button>
      <span id="dateLabel" class="date-label"></span>
      <button id="nextBtn" class="nav-btn" aria-label="次の日">&gt;</button>
    </div>
  </header>
  <main>
    <div id="dayContainer" class="day-container">
      ${sections}
    </div>
  </main>
  <script src="assets/script.js"></script>
</body>
</html>`;
}

/** メイン処理 */
(async () => {
  try {
    const token   = await getTwitchToken();
    const list    = JSON.parse(await fs.readFile('data/streamers.json', 'utf8'));
    let events    = [];

    // 全配信者について Twitch/YouTube を取得
    for (const s of list) {
      // Twitch LIVE
      const tl = await fetchTwitchLive(s.twitchUserLogin, token);
      if (tl) events.push({ ...tl, streamerName: s.name });

      // Twitch 予定
      (await fetchTwitchSchedule(s.twitchUserLogin, token))
        .forEach(e => events.push({ ...e, streamerName: s.name }));

      // Twitch VOD（開始5分以内は除外）
      (await fetchTwitchVods(s.twitchUserLogin, token))
        .filter(v => !(tl && Math.abs(new Date(v.time) - new Date(tl.time)) < 5*60*1000))
        .forEach(v => events.push({ ...v, streamerName: s.name }));

      // YouTube LIVE
      let yl = [];
      try {
        yl = await fetchYouTube(s.youtubeChannelId, 'eventType=live');
        yl.forEach(e => events.push({ ...e, streamerName: s.name }));
      } catch (_) {}

      // YouTube 予定
      let yu = [];
      try {
        yu = await fetchYouTube(s.youtubeChannelId, 'eventType=upcoming');
        yu.forEach(e => events.push({ ...e, streamerName: s.name }));
      } catch (_) {}

      // YouTube 過去3日／今後1週間
      try {
        const yp = await fetchYouTube(s.youtubeChannelId, `publishedAfter=${todayISO()}`);
        yp.forEach(e => events.push({ ...e, streamerName: s.name }));
      } catch (_) {}
    }

    // 期間フィルタ：過去3日〜未来1週間
    const now = Date.now();
    const pastThreshold   = now - 3*24*60*60*1000;
    const futureThreshold = now + 7*24*60*60*1000;
    events = events.filter(e => {
      const t = new Date(e.time).getTime();
      return t >= pastThreshold && t <= futureThreshold;
    });

    // 時系列ソート
    events.sort((a, b) => new Date(a.time) - new Date(b.time));

    // HTML 出力
    const html = generateHTML(events, list);
    await fs.writeFile('docs/index.html', html, 'utf8');
  } catch (err) {
    console.error(err);
    const errPage = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>更新エラー</title></head>
<body><h1>更新中にエラーが発生しました</h1><pre>${err.message}</pre></body></html>`;
    await fs.writeFile('docs/index.html', errPage, 'utf8');
  }
})();
