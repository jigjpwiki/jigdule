'use strict';

const fs    = require('fs').promises;
const fetch = require('node-fetch');

const YT_API_KEY           = process.env.YT_API_KEY;
const TWITCH_CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

//――――――――――――――――――――――――――
// ヘルパー関数
//――――――――――――――――――――――――――

/** UTC時刻 → HH:mm:ss 形式 */
function formatTime(utc) {
  const d = new Date(utc);
  return d.toLocaleTimeString('ja-JP', { hour12: false });
}

/** YYYY-MM-DD → YYYY/MM/DD (曜) */
function formatDateLabel(isoDate) {
  const d = new Date(isoDate);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const w  = ['日','月','火','水','木','金','土'][d.getDay()];
  return `${mm}/${dd} (${w})`;
}

/** 今日 00:00 の ISO */
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
  const j = await res.json();
  return j.access_token;
}

//――――――――――――――――――――――――――
// データ取得関数
//――――――――――――――――――――――――――

async function fetchTwitchLive(login, token) {
  const res = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${login}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const json = await res.json();
  const data = json.data || [];
  if (!data[0]) return null;
  const s = data[0];
  return {
    platform:  'Twitch LIVE',
    title:     s.title,
    url:       `https://twitch.tv/${login}`,
    time:      s.started_at,
    status:    'live',
    thumbnail: s.thumbnail_url.replace('{width}','320').replace('{height}','180')
  };
}

async function fetchTwitchSchedule(login, token) {
  const userRes = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const uidJson = await userRes.json();
  const id      = uidJson.data?.[0]?.id;
  if (!id) return [];
  const res = await fetch(
    `https://api.twitch.tv/helix/schedule?broadcaster_id=${id}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const segs = (await res.json()).data?.segments || [];
  return segs
    .filter(s => s.title && s.title.trim()!=='')
    .map(s => ({
      platform:  'Twitch 予定',
      title:     s.title,
      url:       '',
      time:      s.start_time,
      status:    'upcoming',
      thumbnail: ''
    }));
}

async function fetchTwitchVods(login, token) {
  const userRes = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const uidJson = await userRes.json();
  const id      = uidJson.data?.[0]?.id;
  if (!id) return [];
  const res = await fetch(
    `https://api.twitch.tv/helix/videos?user_id=${id}` +
    `&first=5&broadcast_type=archive&started_at=${todayISO()}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const vids = (await res.json()).data || [];
  return vids.map(v => ({
    platform:  'Twitch 過去配信',
    title:     v.title,
    url:       v.url,
    time:      v.created_at,
    status:    'past',
    thumbnail: v.thumbnail_url.replace('{width}','320').replace('{height}','180')
  }));
}

async function fetchYouTube(channelId, params) {
  const url =
    `https://www.googleapis.com/youtube/v3/search` +
    `?key=${YT_API_KEY}` +
    `&channelId=${channelId}` +
    `&part=snippet&type=video` +
    `&order=date&maxResults=10&${params}`;
  const res  = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return (json.items||[]).map(item => {
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

//――――――――――――――――――――――――――
// HTML組み立て（ナビ＋日付セクション＋カード）
//――――――――――――――――――――――――――

function generateHTML(events, streamers) {
  // グループ化
  const groups = events.reduce((acc,e)=>{
    const d = e.time.split('T')[0];
    (acc[d]||(acc[d]=[])).push(e);
    return acc;
  },{});
  const dates = Object.keys(groups).sort();

  // セクション
  const sections = dates.map(date => {
    const cards = groups[date].map(e => {
      const info = streamers.find(s =>
        e.platform.startsWith('Twitch')
          ? e.url.includes(s.twitchUserLogin)
          : e.url.includes(s.youtubeChannelId)
      )||{};
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
      <div class="name">${info.name||''}</div>
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
  <ul class="cards">${cards}</ul>
</section>`;
  }).join('');

  // ページ全体を返却
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

//――――――――――――――――――――――――――
// メイン処理
//――――――――――――――――――――――――――

(async ()=>{
  try {
    const token = await getTwitchToken();
    const list  = JSON.parse(await fs.readFile('data/streamers.json','utf8'));
    let events  = [];

    for(const s of list) {
      // Twitch LIVE
      const tl = await fetchTwitchLive(s.twitchUserLogin, token);
      if (tl) events.push(tl);

      // Twitch 予定
      (await fetchTwitchSchedule(s.twitchUserLogin, token))
        .forEach(r=>events.push(r));

      // Twitch VOD
      (await fetchTwitchVods(s.twitchUserLogin, token))
        .filter(v=>(!tl)||Math.abs(new Date(v.time)-new Date(tl.time))>=5*60*1000)
        .forEach(r=>events.push(r));

      // YouTube LIVE
      try {
        const yl = await fetchYouTube(s.youtubeChannelId,'eventType=live');
        yl.forEach(r=>events.push(r));
      } catch {}

      // YouTube 予定
      try {
        const yu = await fetchYouTube(s.youtubeChannelId,'eventType=upcoming');
        yu.forEach(r=>events.push(r));
      } catch {}

      // YouTube 投稿
      try {
        const yp = await fetchYouTube(s.youtubeChannelId,`publishedAfter=${todayISO()}`);
        yp.forEach(r=>events.push(r));
      } catch {}
    }

    // ソート＆フィルタ（過去3日〜未来1週）
    events.sort((a,b)=>new Date(a.time)-new Date(b.time));
    const now=Date.now(), past=now-3*24*60*60*1000, fut=now+7*24*60*60*1000;
    events = events.filter(e=>{
      const t=new Date(e.time).getTime();
      return t>=past && t<=fut;
    });

    // 書き出し
    const html = generateHTML(events, list);
    await fs.writeFile('docs/index.html', html, 'utf8');
  } catch (err) {
    console.error(err);
    await fs.writeFile('docs/index.html', `<pre>${err.message}</pre>`, 'utf8');
  }
})();
