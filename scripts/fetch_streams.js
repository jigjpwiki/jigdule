'use strict';

const fs    = require('fs').promises;
const fetch = require('node-fetch');

const YT_API_KEY           = process.env.YT_API_KEY;
const TWITCH_CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

/** UTC→JST「HH:mm」 */
function formatTime(utc) {
  return new Date(utc).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false
  });
}

/** YYYY-MM-DD→YYYY/MM/DD (曜) */
function formatDateLabel(iso) {
  const [y,m,d] = iso.split('-').map(n=>+n);
  const w = ['日','月','火','水','木','金','土'][new Date(y,m-1,d).getDay()];
  return `${y}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')} (${w})`;
}

/** Twitch OAuthトークン */
async function getTwitchToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token` +
    `?client_id=${TWITCH_CLIENT_ID}` +
    `&client_secret=${TWITCH_CLIENT_SECRET}` +
    `&grant_type=client_credentials`,
    { method:'POST' }
  );
  return (await res.json()).access_token;
}

/** Twitch ライブ */
async function fetchTwitchLive(login, token) {
  const res = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${login}`,
    { headers:{ 'Client-ID':TWITCH_CLIENT_ID, Authorization:`Bearer ${token}` } }
  );
  const { data=[] } = await res.json();
  if (!data[0]) return null;
  const s = data[0];
  return {
    platform:  'Twitch',
    title:     s.title,
    url:       `https://twitch.tv/${login}`,
    time:      s.started_at,
    thumbnail: s.thumbnail_url.replace('{width}','320').replace('{height}','180'),
    status:    'live'
  };
}

/** Twitch VOD（過去配信） */
async function fetchTwitchVods(login, token) {
  const ures = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers:{ 'Client-ID':TWITCH_CLIENT_ID, Authorization:`Bearer ${token}` } }
  );
  const uid = (await ures.json()).data?.[0]?.id;
  if (!uid) return [];
  const vres = await fetch(
    `https://api.twitch.tv/helix/videos?user_id=${uid}&first=10&broadcast_type=archive`,
    { headers:{ 'Client-ID':TWITCH_CLIENT_ID, Authorization:`Bearer ${token}` } }
  );
  const vods = (await vres.json()).data || [];
  return vods.map(v => ({
    platform:  'Twitch',
    title:     v.title,
    url:       v.url,
    time:      v.created_at,
    thumbnail: v.thumbnail_url.replace('{width}','320').replace('{height}','180'),
    status:    'past'
  }));
}

/** YouTube 検索 */
async function fetchYouTube(channelId, params) {
  const url = `https://www.googleapis.com/youtube/v3/search` +
    `?key=${YT_API_KEY}` +
    `&channelId=${channelId}` +
    `&part=snippet&type=video&order=date&maxResults=10&${params}`;
  const res  = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return (json.items||[]).map(item => ({
    platform:  'YouTube',
    title:     item.snippet.title,
    url:       `https://youtu.be/${item.id.videoId}`,
    time:      item.snippet.publishedAt,
    thumbnail: item.snippet.thumbnails.medium.url,
    status:    item.snippet.liveBroadcastContent === 'live' ? 'live' : 'past'
  }));
}

/** HTML 組み立て */
function generateHTML(events, streamers) {
  // 日付ごとにグループ化
  const groups = events.reduce((acc,e) => {
    const day = e.time.split('T')[0];
    (acc[day]||(acc[day]=[])).push(e);
    return acc;
  }, {});
  const dates = Object.keys(groups).sort();

  // セクション作成
  const sections = dates.map(date => {
    const cards = groups[date].map(e => {
      const info = streamers.find(s =>
        e.url.includes(s.twitchUserLogin) ||
        e.url.includes(s.youtubeChannelId)
      )||{};
      return `
<div class="card ${e.status}">
  <div class="name">${info.name||''}</div>
  <img class="thumb" src="${e.thumbnail}" alt="${e.title}">
  <div class="title">${e.title}</div>
  <div class="time">${formatTime(e.time)}</div>
</div>`;
    }).join('\n');

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

(async() => {
  try {
    const token = await getTwitchToken();
    const list  = JSON.parse(await fs.readFile('data/streamers.json','utf8'));
    let events  = [];

    for (const s of list) {
      const tl = await fetchTwitchLive(s.twitchUserLogin, token);
      if (tl) events.push(tl);

      (await fetchTwitchVods(s.twitchUserLogin, token))
        .forEach(v => events.push(v));

      try {
        (await fetchYouTube(s.youtubeChannelId, ''))
          .forEach(y => events.push(y));
      } catch {}
    }

    // 時系列ソート（昇順）
    events.sort((a,b) => new Date(a.time) - new Date(b.time));

    // HTML 出力
    const html = generateHTML(events, list);
    await fs.writeFile('docs/index.html', html, 'utf8');
  } catch(err) {
    console.error(err);
    await fs.writeFile('docs/index.html', `<pre>${err.message}</pre>`, 'utf8');
  }
})();
