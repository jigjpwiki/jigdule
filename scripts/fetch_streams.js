'use strict';

const fs    = require('fs').promises;
const fetch = require('node-fetch');

const YT_API_KEY           = process.env.YT_API_KEY;
const TWITCH_CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

/** UTC時刻文字列 → HH:mm:ss 形式 */
function formatTime(utcString) {
  const d = new Date(utcString);
  return d.toLocaleTimeString('ja-JP', { hour12: false });
}

/** 当日 00:00 の ISO 文字列 */
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
  const userRes = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const userJson = await userRes.json();
  const userId   = userJson.data?.[0]?.id;
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
  const userRes = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const userJson = await userRes.json();
  const userId   = userJson.data?.[0]?.id;
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

/** YouTube 動画検索ヘルパー */
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
 * カード形式 UI 用 HTML を組み立て
 */
function generateHTML(events, streamers) {
  const cards = events.map(e => {
    // streamer 情報を streamers.json から引く
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
      <div class="name">${info.name}</div>
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

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>jigdule</title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <ul class="cards">
    ${cards}
  </ul>
</body>
</html>`;
}

/** メイン処理 */
(async () => {
  try {
    const token = await getTwitchToken();
    const list  = JSON.parse(await fs.readFile('data/streamers.json', 'utf8'));
    let events  = [];

    for (const s of list) {
      // Twitch LIVE
      const tl = await fetchTwitchLive(s.twitchUserLogin, token);
      if (tl) events.push({ ...tl, streamerName: s.name });

      // Twitch 予定
      for (const raw of await fetchTwitchSchedule(s.twitchUserLogin, token)) {
        events.push({ ...raw, streamerName: s.name });
      }

      // Twitch VOD（開始5分以内除外）
      for (const v of await fetchTwitchVods(s.twitchUserLogin, token)) {
        if (!(tl && Math.abs(new Date(v.time) - new Date(tl.time)) < 5*60*1000)) {
          events.push({ ...v, streamerName: s.name });
        }
      }

      // YouTube LIVE
      try {
        const yl = await fetchYouTube(s.youtubeChannelId, 'eventType=live');
        yl.forEach(raw => events.push({ ...raw, streamerName: s.name }));
      } catch (_) {}

      // YouTube 予定
      try {
        const yu = await fetchYouTube(s.youtubeChannelId, 'eventType=upcoming');
        yu.forEach(raw => events.push({ ...raw, streamerName: s.name }));
      } catch (_) {}

      // YouTube 過去3日＆未来1週間
      try {
        const yp = await fetchYouTube(s.youtubeChannelId, `publishedAfter=${todayISO()}`);
        yp.forEach(raw => events.push({ ...raw, streamerName: s.name }));
      } catch (_) {}
    }

    // 時系列ソート
    events.sort((a,b) => new Date(a.time) - new Date(b.time));

    // 期間フィルタ：過去3日〜未来1週間
    const now = Date.now();
    const pastThreshold   = now - 3*24*60*60*1000;
    const futureThreshold = now + 7*24*60*60*1000;
    events = events.filter(e => {
      const t = new Date(e.time).getTime();
      return t >= pastThreshold && t <= futureThreshold;
    });

    // HTML生成＆書き出し
    const html = generateHTML(events, list);
    await fs.writeFile('docs/index.html', html, 'utf8');
  } catch (err) {
    console.error(err);
    const msg = err.message.replace(/</g,'&lt;');
    await fs.writeFile('docs/index.html', `<pre>${msg}</pre>`, 'utf8');
  }
})();
