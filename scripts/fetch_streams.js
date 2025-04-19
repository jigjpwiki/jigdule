'use strict';

const fs    = require('fs').promises;
const fetch = require('node-fetch');

const YT_API_KEY           = process.env.YT_API_KEY;
const TWITCH_CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

/**
 * UTC文字列 → 日本時間「HH:mm」形式
 */
function formatTime(utcString) {
  return new Date(utcString)
    .toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   false
    });
}

/**
 * YYYY-MM-DD → MM/DD (曜) 形式
 */
function formatDateLabel(isoDate) {
  const [y, m, d] = isoDate.split('-').map(n => parseInt(n, 10));
  const w = ['日','月','火','水','木','金','土'][
    new Date(y, m - 1, d).getDay()
  ];
  return `${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')} (${w})`;
}

/** 今日の00:00 ISO */
function todayISO() {
  const d = new Date();
  d.setHours(0,0,0,0);
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
    {
      headers: {
        'Client-ID':     TWITCH_CLIENT_ID,
        Authorization:   `Bearer ${token}`
      }
    }
  );
  const { data = [] } = await res.json();
  if (!data[0]) return null;
  const s = data[0];
  return {
    platform:  'Twitch LIVE',
    title:     s.title,
    url:       `https://twitch.tv/${login}`,
    time:      s.started_at,
    status:    'live',
    thumbnail: s.thumbnail_url
                  .replace('{width}','320')
                  .replace('{height}','180')
  };
}

/** Twitch 配信予定取得（無題タイトル除外） */
async function fetchTwitchSchedule(login, token) {
  const userRes = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    {
      headers: {
        'Client-ID':   TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const userJson = await userRes.json();
  const userId   = userJson.data?.[0]?.id;
  if (!userId) return [];
  const res = await fetch(
    `https://api.twitch.tv/helix/schedule?broadcaster_id=${userId}`,
    {
      headers: {
        'Client-ID':   TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const segs = (await res.json()).data?.segments || [];
  return segs
    .filter(s => s.title && s.title.trim() !== '')
    .map(s => ({
      platform:  'Twitch 予定',
      title:     s.title,
      url:       '',
      time:      s.start_time,
      status:    'upcoming',
      thumbnail: ''
    }));
}

/** Twitch 過去配信（VOD）取得 */
async function fetchTwitchVods(login, token) {
  const userRes = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    {
      headers: {
        'Client-ID':   TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const userJson = await userRes.json();
  const userId   = userJson.data?.[0]?.id;
  if (!userId) return [];
  const res = await fetch(
    `https://api.twitch.tv/helix/videos` +
    `?user_id=${userId}` +
    `&first=5&broadcast_type=archive&started_at=${todayISO()}`,
    {
      headers: {
        'Client-ID':   TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const vods = (await res.json()).data || [];
  return vods.map(v => ({
    platform:  'Twitch 過去配信',
    title:     v.title,
    url:       v.url,
    time:      v.created_at,
    status:    'past',
    thumbnail: v.thumbnail_url
                  .replace('{width}','320')
                  .replace('{height}','180')
  }));
}

/** YouTube 動画検索ヘルパー */
async function fetchYouTube(channelId, params) {
  const url = `https://www.googleapis.com/youtube/v3/search` +
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
      platform:  isLive     ? 'YouTube LIVE'
                : isUpcoming ? 'YouTube 予定'
                : 'YouTube 投稿',
      title:     item.snippet.title,
      url:       `https://youtu.be/${item.id.videoId}`,
      time:      item.snippet.publishedAt,
      status:    isLive     ? 'live'
                : isUpcoming ? 'upcoming'
                : 'past',
      thumbnail: thumb
    };
  });
}

/**
 * HTML 組み立て
 * - 過去3日～未来7日を必ずセクション化
 * - イベントなし日は「配信なし」
 */
function generateHTML(events, streamers) {
  // イベントを日付ごとにグループ
  const map = events.reduce((acc, e) => {
    const day = e.time.split('T')[0];
    (acc[day] || (acc[day] = [])).push(e);
    return acc;
  }, {});

  // 過去3日～未来7日を配列で生成
  const today = new Date();
  const dates = [];
  for (let i = -3; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  // 各日セクションを生成
  const sections = dates.map(date => {
    const cardsHtml = (map[date] || []).map(e => {
      const info = streamers.find(s =>
        e.platform.startsWith('Twitch')
          ? e.url.includes(s.twitchUserLogin)
          : e.url.includes(s.youtubeChannelId)
      ) || {};
      return `
<li class="card ${e.status}">
  <div class="time-badge">${formatTime(e.time)}</div>
  <div class="inner">
    <div class="left">
      ${info.avatar
        ? `<img class="avatar" src="assets/${info.avatar}" alt="${info.name}">`
        : `<div class="avatar placeholder"></div>`}
    </div>
    <div class="center">
      <div class="name">${info.name || ''}</div>
      <div class="title">${e.title}</div>
    </div>
    <div class="right">
      ${e.thumbnail
        ? `<img class="thumb" src="${e.thumbnail}" alt="">`
        : `<div class="thumb placeholder"></div>`}
    </div>
  </div>
</li>`;
    }).join('');

    return `
<section class="day" data-date="${date}">
  <h2>${formatDateLabel(date)}</h2>
  <ul class="cards">
    ${cardsHtml || '<li class="no-events">配信なし</li>'}
  </ul>
</section>`;
  }).join('');

  // 最終 HTML
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
      <button id="prevBtn" class="nav-btn">&lt;</button>
      <span id="dateLabel" class="date-label"></span>
      <button id="nextBtn" class="nav-btn">&gt;</button>
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

// メイン処理
(async () => {
  try {
    const token = await getTwitchToken();
    const list  = JSON.parse(await fs.readFile('data/streamers.json', 'utf8'));
    let events  = [];

    for (const s of list) {
      // Twitch LIVE
      const tl = await fetchTwitchLive(s.twitchUserLogin, token);
      if (tl) events.push(tl);

      // Twitch 予定
      (await fetchTwitchSchedule(s.twitchUserLogin, token))
        .forEach(r => events.push(r));

      // Twitch 過去配信
      (await fetchTwitchVods(s.twitchUserLogin, token))
        .filter(v => !tl || Math.abs(new Date(v.time) - new Date(tl.time)) >= 5*60*1000)
        .forEach(r => events.push(r));

      // YouTube LIVE
      try {
        const yl = await fetchYouTube(s.youtubeChannelId, 'eventType=live');
        yl.forEach(r => events.push(r));
      } catch {}

      // YouTube 予定
      try {
        const yu = await fetchYouTube(s.youtubeChannelId, 'eventType=upcoming');
        yu.forEach(r => events.push(r));
      } catch {}

      // YouTube 過去3日～未来1週間の投稿
      try {
        const yp = await fetchYouTube(s.youtubeChannelId, `publishedAfter=${todayISO()}`);
        yp.forEach(r => events.push(r));
      } catch {}
    }

    // 時系列ソート
    events.sort((a, b) => new Date(a.time) - new Date(b.time));

    // HTML生成＆書き出し
    const html = generateHTML(events, list);
    await fs.writeFile('docs/index.html', html, 'utf8');
  } catch (err) {
    console.error(err);
    await fs.writeFile('docs/index.html', `<pre>${err.message}</pre>`, 'utf8');
  }
})();
