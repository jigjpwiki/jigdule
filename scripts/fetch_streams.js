'use strict';

const fs    = require('fs').promises;
const fetch = require('node-fetch');

const YT_API_KEY           = process.env.YT_API_KEY;
const TWITCH_CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

function formatTime(utc) {
  return new Date(utc).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function formatDateLabel(iso) {
  const [y,m,d] = iso.split('-').map(n=>+n);
  const w = ['日','月','火','水','木','金','土'][
    new Date(y,m-1,d).getDay()
  ];
  return `${y}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')} (${w})`;
}

async function getTwitchToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}` +
    `&client_secret=${TWITCH_CLIENT_SECRET}` +
    `&grant_type=client_credentials`,
    { method:'POST' }
  );
  return (await res.json()).access_token;
}

async function fetchTwitchLive(login, token, name) {
  const res = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${login}`,
    { headers:{ 'Client-ID':TWITCH_CLIENT_ID, Authorization:`Bearer ${token}` }}
  );
  const { data=[] } = await res.json();
  if (!data[0]) return null;
  const s = data[0];
  return {
    streamerName: name,
    platform:     'Twitch',
    title:        s.title,
    url:          `https://twitch.tv/${login}`,
    time:         s.started_at,
    thumbnail:    s.thumbnail_url.replace('{width}','320').replace('{height}','180'),
    status:       'live'
  };
}

async function fetchTwitchVods(login, token, name) {
  const ures = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers:{ 'Client-ID':TWITCH_CLIENT_ID, Authorization:`Bearer ${token}` }}
  );
  const uid = (await ures.json()).data?.[0]?.id;
  if (!uid) return [];
  const vres = await fetch(
    `https://api.twitch.tv/helix/videos?user_id=${uid}&first=10&broadcast_type=archive`,
    { headers:{ 'Client-ID':TWITCH_CLIENT_ID, Authorization:`Bearer ${token}` }}
  );
  const vods = (await vres.json()).data || [];
  return vods.map(v => ({
    streamerName: name,
    platform:     'Twitch',
    title:        v.title,
    url:          v.url,
    time:         v.created_at,
    thumbnail:    v.thumbnail_url.replace('{width}','320').replace('{height}','180'),
    status:       'past'
  }));
}

async function fetchYouTube(channelId, params, name) {
  const url = `https://www.googleapis.com/youtube/v3/search` +
    `?key=${YT_API_KEY}` +
    `&channelId=${channelId}` +
    `&part=snippet&type=video&order=date&maxResults=10&${params}`;
  const res  = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return (json.items||[]).map(item => ({
    streamerName: name,
    platform:     'YouTube',
    title:        item.snippet.title,
    url:          `https://youtu.be/${item.id.videoId}`,
    time:         item.snippet.publishedAt,
    thumbnail:    item.snippet.thumbnails.medium.url,
    status:       item.snippet.liveBroadcastContent === 'live'
                 ? 'live'
                 : params.includes('eventType=upcoming')
                   ? 'upcoming'
                   : 'past'
  }));
}

function generateHTML(events, streamers) {
  // 日付ごとにグループ化
  const groups = events.reduce((acc,e) => {
    const d = e.time.split('T')[0];
    (acc[d]||(acc[d]=[])).push(e);
    return acc;
  }, {});
  const dates = Object.keys(groups).sort();

  const sections = dates.map(date => {
    const cards = groups[date].map(e => `
<a href="${e.url}" target="_blank" class="card ${e.status}">
  <div class="time">${formatTime(e.time)}</div>
  <div class="name">${e.streamerName}</div>
  <img class="thumb" src="${e.thumbnail}" alt="">
  <div class="title">${e.title}</div>
</a>`).join('\n');
    return `
<h2>${formatDateLabel(date)}</h2>
<hr>
<div class="grid">
  ${cards}
</div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>jigdule</title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <div class="container">
    ${sections}
  </div>
</body>
</html>`;
}

(async () => {
  try {
    const token = await getTwitchToken();
    const list  = JSON.parse(await fs.readFile('data/streamers.json','utf8'));
    let events  = [];

    for (const s of list) {
      // Twitch ライブ
      const tl = await fetchTwitchLive(s.twitchUserLogin, token, s.name);
      if (tl) events.push(tl);

      // Twitch 過去配信
      (await fetchTwitchVods(s.twitchUserLogin, token, s.name))
        .forEach(v => events.push(v));

      // YouTube ライブ中
      try {
        const ytLive = await fetchYouTube(s.youtubeChannelId, 'eventType=live', s.name);
        events.push(...ytLive);
      } catch {}

      // YouTube 予定
      try {
        const ytUp = await fetchYouTube(s.youtubeChannelId, 'eventType=upcoming', s.name);
        events.push(...ytUp);
      } catch {}
    }

    // 時系列ソート
    events.sort((a,b) => new Date(a.time) - new Date(b.time));

    // フィルタ: ライブ or 予定 or 昨日の過去配信のみ
    const today = new Date();
    today.setHours(0,0,0,0);
    const y = new Date(today);
    y.setDate(y.getDate()-1);
    const yISO = y.toISOString().slice(0,10);

    events = events.filter(e =>
      e.status === 'live' ||
      e.status === 'upcoming' ||
      e.time.split('T')[0] === yISO
    );

    // 出力
    const html = generateHTML(events, list);
    await fs.writeFile('docs/index.html', html, 'utf8');

  } catch (err) {
    console.error(err);
    await fs.writeFile('docs/index.html', `<pre>${err.message}</pre>`, 'utf8');
  }
})();
