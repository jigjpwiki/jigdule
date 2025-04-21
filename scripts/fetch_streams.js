'use strict';

const fs    = require('fs').promises;
const fetch = require('node-fetch');

const YT_API_KEY           = process.env.YT_API_KEY;
const TWITCH_CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

// キャッシュ用ファイル
const CACHE_FILE = 'data/cache.json';

// キャッシュ読み込み
async function loadCache() {
  try {
    const txt = await fs.readFile(CACHE_FILE, 'utf8');
    return JSON.parse(txt);
  } catch {
    return { live: {}, upcoming: {}, vod: {}, lastFetch: null };
  }
}

// キャッシュ保存
async function saveCache(cache) {
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

/** UTC→JST「HH:mm」 */
function formatTime(utc) {
  return new Date(utc).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false
  });
}

/** YYYY-MM-DD → YYYY/MM/DD (曜) */
function formatDateLabel(iso) {
  const [y,m,d] = iso.split('-').map(n => +n);
  const w = ['日','月','火','水','木','金','土'][
    new Date(y, m - 1, d).getDay()
  ];
  return `${y}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')} (${w})`;
}

/** UTC→JST日付キー「YYYY-MM-DD」 */
function getJstDateKey(utc) {
  const d   = new Date(utc);
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  const Y   = jst.getUTCFullYear();
  const M   = String(jst.getUTCMonth() + 1).padStart(2,'0');
  const D   = String(jst.getUTCDate()).padStart(2,'0');
  return `${Y}-${M}-${D}`;
}

/** ２つの時刻を「分」単位で同じか比較 */
function sameMinute(a, b) {
  if (!a || !b) return false;
  const ta = Math.floor(new Date(a).getTime() / 60000);
  const tb = Math.floor(new Date(b).getTime() / 60000);
  return ta === tb;
}

/** Twitch OAuthトークン取得 */
async function getTwitchToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token` +
    `?client_id=${TWITCH_CLIENT_ID}` +
    `&client_secret=${TWITCH_CLIENT_SECRET}` +
    `&grant_type=client_credentials`,
    { method: 'POST' }
  );
  return (await res.json()).access_token;
}

/** Twitch ライブ中ストリーム取得 */
async function fetchTwitchLive(login, token, name) {
  const res = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${login}`,
    {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const { data = [] } = await res.json();
  if (!data[0]) return null;
  const s = data[0];
  const thumb = s.thumbnail_url
    .replace(/\{width\}/g, '320').replace(/\{height\}/g, '180')
    .replace(/%7Bwidth%7D/g, '320').replace(/%7Bheight%7D/g, '180')
    .replace(/%/g, '');
  return {
    streamerName: name,
    platform:     'Twitch',
    title:        s.title,
    url:          `https://twitch.tv/${login}`,
    time:         s.started_at,
    thumbnail:    thumb,
    status:       'live'
  };
}

/** Twitch VOD（過去配信）取得 */
async function fetchTwitchVods(login, token, name, liveTime) {
  const ures = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const uid = (await ures.json()).data?.[0]?.id;
  if (!uid) return [];
  const vres = await fetch(
    `https://api.twitch.tv/helix/videos?user_id=${uid}&first=10&broadcast_type=archive`,
    {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const vods = (await vres.json()).data || [];
  return vods
    .filter(v => v.type === 'archive' && !sameMinute(v.created_at, liveTime))
    .map(v => {
      const thumb = v.thumbnail_url
        .replace(/\{width\}/g, '320').replace(/\{height\}/g, '180')
        .replace(/%7Bwidth%7D/g, '320').replace(/%7Bheight%7D/g, '180')
        .replace(/%/g, '')
        .replace(/\d+x\d+\.jpg/, '320x180.jpg');
      return {
        streamerName: name,
        platform:     'Twitch',
        title:        v.title,
        url:          v.url,
        time:         v.created_at,
        thumbnail:    thumb,
        status:       'past'
      };
    });
}

/** YouTube 検索＋詳細取得 */
async function fetchYouTube(channelId, params, name) {
  const url = `https://www.googleapis.com/youtube/v3/search` +
    `?key=${YT_API_KEY}` +
    `&channelId=${channelId}` +
    `&part=snippet&type=video&order=date&maxResults=10&${params}`;
  const res  = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  let results = (json.items || []).map(item => ({
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
  // upcoming は scheduledStartTime で上書き
  if (params.includes('eventType=upcoming') && results.length) {
    const ids = results.map(r => r.url.split('/').pop()).join(',');
    const detail = await fetch(
      `https://www.googleapis.com/youtube/v3/videos` +
      `?key=${YT_API_KEY}` +
      `&id=${ids}` +
      `&part=liveStreamingDetails`
    ).then(r => r.json());
    const map = {};
    (detail.items || []).forEach(v => {
      const sdt = v.liveStreamingDetails?.scheduledStartTime;
      if (sdt) map[v.id] = sdt;
    });
    results = results.map(r => {
      const vid = r.url.split('/').pop();
      if (map[vid]) r.time = map[vid];
      return r;
    });
  }
  return results;
}

/** HTML 組み立て */
function generateHTML(events, streamers) {
  const groups = events.reduce((acc, e) => {
    const key = getJstDateKey(e.time);
    (acc[key] || (acc[key] = [])).push(e);
    return acc;
  }, {});
  const dates = Object.keys(groups).sort();
  const sections = dates.map(date => `
<h2>${formatDateLabel(date)}</h2>
<hr>
<div class="grid">
  ${groups[date].map(e => `
<a href="${e.url}" target="_blank" class="card ${e.status}">
  <div class="card-header">
    <span class="time">${formatTime(e.time)}</span>
    <span class="name">${e.streamerName}</span>
  </div>
  <img class="thumb" src="${e.thumbnail}" alt="">
  <div class="title">${e.title}</div>
</a>`).join('')}
</div>`).join('\n');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>じぐじゅーる | jig.jp(Vtuber事業)非公式Wiki</title>
  <link rel="icon" href="assets/favicon.ico" type="image/x-icon">
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <header class="logo-header">
    <img src="assets/jigdule_logo.png" alt="jigdule ロゴ" class="logo">
  </header>
  <div class="container">
    ${sections}
  </div>
  <footer class="footer">
    <p>
      <a href="https://wikiwiki.jp/jigjp/" target="_blank">jig.jpWikiトップ</a> |
      管理者X・お問い合わせ窓口: <a href="https://x.com/Jigjpwiki" target="_blank">@Jigjpwiki</a>
    </p>
  </footer>
</body>
</html>`;
}

(async () => {
  try {
    const cache = await loadCache();
    const token = await getTwitchToken();
    const list  = JSON.parse(await fs.readFile('data/streamers.json', 'utf8'));
    const now   = new Date();
    const jstNow = new Date(now.getTime() + 9 * 3600 * 1000);
    const todayKey = jstNow.toISOString().slice(0,10);
    const yest     = new Date(jstNow);
    yest.setUTCDate(yest.getUTCDate() - 1);
    const yestKey  = yest.toISOString().slice(0,10);
    const oneMonthLater = new Date(now);
    oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);

    let events = [];

    for (const s of list) {
      // Twitch ライブ
      const tl = await fetchTwitchLive(s.twitchUserLogin, token, s.name);
      if (tl) events.push(tl);

      // Twitch VOD
      const vods = await fetchTwitchVods(s.twitchUserLogin, token, s.name, tl?.time);
      events.push(...vods);

      // YouTube ライブ中（エラー時は無視）
      let ytLive = [];
      try {
        ytLive = await fetchYouTube(s.youtubeChannelId, 'eventType=live', s.name);
      } catch (err) {
        console.error(`YouTube live error for ${s.name}:`, err.message);
      }
      ytLive.forEach(e => cache.live[e.url] = e);
      events.push(...ytLive);

      // YouTube 予定（エラー時は無視）
      let ytUp = [];
      try {
        ytUp = await fetchYouTube(s.youtubeChannelId, 'eventType=upcoming', s.name);
      } catch (err) {
        console.error(`YouTube upcoming error for ${s.name}:`, err.message);
      }
      ytUp.forEach(e => cache.upcoming[e.url] = e);
      events.push(...ytUp);
    }

    // キャッシュ更新
    cache.lastFetch = now.toISOString();
    await saveCache(cache);

    // 時系列ソート＆フィルタ
    events.sort((a, b) => new Date(a.time) - new Date(b.time));
    events = events.filter(e => {
      if (e.status === 'live') return true;
      if (e.status === 'upcoming') return new Date(e.time) <= oneMonthLater;
      if (e.status === 'past') {
        const key = getJstDateKey(e.time);
        return key === todayKey || key === yestKey;
      }
      return false;
    });

    const html = generateHTML(events, list);
    await fs.writeFile('docs/index.html', html, 'utf8');

  } catch (err) {
    console.error(err);
    await fs.writeFile('docs/index.html', `<pre>${err.message}</pre>`, 'utf8');
  }
})();
