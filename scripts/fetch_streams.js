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
  return new Date(utcString).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false
  });
}

/**
 * YYYY-MM-DD → YYYY/MM/DD (曜) 形式
 */
function formatDateLabel(isoDate) {
  const [y, m, d] = isoDate.split('-').map(n => parseInt(n, 10));
  const w = ['日','月','火','水','木','金','土'][
    new Date(y, m - 1, d).getDay()
  ];
  return `${y}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')} (${w})`;
}

/** 今日の00:00 ISO日付 */
function todayStartISO() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
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
        'Client-ID':   TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const { data = [] } = await res.json();
  if (!data[0]) return null;
  const s = data[0];
  return {
    platform:  'Twitch',
    title:     s.title,
    url:       `https://twitch.tv/${login}`,
    time:      s.started_at,
    thumbnail: s.thumbnail_url
                   .replace('{width}','320')
                   .replace('{height}','180')
  };
}

/** Twitch VOD（過去配信）取得 */
async function fetchTwitchVods(login, token) {
  // ユーザーIDを取得
  const ures = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    {
      headers: {
        'Client-ID':   TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const uid = (await ures.json()).data?.[0]?.id;
  if (!uid) return [];
  const res = await fetch(
    `https://api.twitch.tv/helix/videos` +
    `?user_id=${uid}` +
    `&first=10&broadcast_type=archive`,
    {
      headers: {
        'Client-ID':   TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const vods = (await res.json()).data || [];
  return vods.map(v => ({
    platform:  'Twitch',
    title:     v.title,
    url:       v.url,
    time:      v.created_at,
    thumbnail: v.thumbnail_url
                   .replace('{width}','320')
                   .replace('{height}','180')
  }));
}

/** YouTube API 動画検索ヘルパー */
async function fetchYouTube(channelId, params) {
  const url = `https://www.googleapis.com/youtube/v3/search` +
    `?key=${YT_API_KEY}` +
    `&channelId=${channelId}` +
    `&part=snippet&type=video` +
    `&order=date&maxResults=10&${params}`;
  const res  = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return (json.items || []).map(item => ({
    platform:  'YouTube',
    title:     item.snippet.title,
    url:       `https://youtu.be/${item.id.videoId}`,
    time:      item.snippet.publishedAt,
    thumbnail: item.snippet.thumbnails.medium.url
  }));
}

/**
 * HTML 組み立て
 * - 過去1日（昨日）までの配信を日付ごとに
 * - 各セクションを見やすく区切り
 */
function generateHTML(events, streamers) {
  // 「昨日」のISO日付
  const todayISO = todayStartISO();
  const yester    = new Date(todayISO);
  yester.setDate(yester.getDate() - 1);
  const yesterISO = yester.toISOString().slice(0,10);

  // 昨日までのイベントだけをフィルタ
  events = events.filter(e => e.time.split('T')[0] <= yesterISO);

  // 日付ごとにグループ化
  const groups = {};
  for (const e of events) {
    const day = e.time.split('T')[0];
    (groups[day] ||= []).push(e);
  }
  const dates = Object.keys(groups).sort();

  // セクションHTMLを構築
  const sections = dates.map(date => {
    const cards = groups[date].map(e => {
      const info = streamers.find(s =>
        e.url.includes(s.twitchUserLogin) ||
        e.url.includes(s.youtubeChannelId)
      ) || {};
      return `
<div class="card">
  <a href="${e.url}" target="_blank">
    <img class="thumb" src="${e.thumbnail}" alt="">
  </a>
  <div class="info">
    <div class="time">${formatTime(e.time)}</div>
    <div class="name">${info.name || ''}</div>
    <div class="title">${e.title}</div>
  </div>
</div>`;
    }).join('\n');

    return `
<h2>${formatDateLabel(date)}</h2>
<hr>
<div class="grid">
  ${cards}
</div>`;
  }).join('\n');

  // 完成HTML
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
    const token   = await getTwitchToken();
    const list    = JSON.parse(await fs.readFile('data/streamers.json','utf8'));
    let events    = [];

    for (const s of list) {
      // Twitchライブ
      const tl = await fetchTwitchLive(s.twitchUserLogin, token);
      if (tl) events.push(tl);

      // Twitch過去配信
      (await fetchTwitchVods(s.twitchUserLogin, token))
        .forEach(v => events.push(v));

      // YouTube新着動画
      try {
        (await fetchYouTube(s.youtubeChannelId, ''))
          .forEach(y => events.push(y));
      } catch {}
    }

    // 新しい順にソート（日付昇順に変えたい場合は reverse() を外してください）
    events.sort((a,b)=> new Date(a.time) - new Date(b.time));

    const html = generateHTML(events, list);
    await fs.writeFile('docs/index.html', html, 'utf8');
  } catch (err) {
    console.error(err);
    await fs.writeFile('docs/index.html', `<pre>${err.message}</pre>`, 'utf8');
  }
})();
