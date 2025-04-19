'use strict';

const fs    = require('fs').promises;
const fetch = require('node-fetch');

const YT_API_KEY           = process.env.YT_API_KEY;
const TWITCH_CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

/** JST で整形 */
function formatJST(utcString) {
  const d = new Date(utcString);
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour12: false,
    year:   'numeric',
    month:  '2-digit',
    day:    '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/** Twitch Token 取得 */
async function getTwitchToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?` +
    `client_id=${TWITCH_CLIENT_ID}` +
    `&client_secret=${TWITCH_CLIENT_SECRET}` +
    `&grant_type=client_credentials`,
    { method: 'POST' }
  );
  return (await res.json()).access_token;
}

/** Twitch のライブ */
async function fetchTwitchLive(login, token) {
  const res = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${login}`,
    { headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const { data } = await res.json();
  if (!data || !data[0]) return null;
  const s = data[0];
  return {
    platform:   'Twitch LIVE',
    streamer:   login,
    title:      s.title,
    url:        `https://twitch.tv/${login}`,
    time:       s.started_at
  };
}

/** Twitch のスケジュール */
async function fetchTwitchSchedule(login, token) {
  // ユーザーID
  const u = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  ).then(r => r.json());
  const id = u.data?.[0]?.id;
  if (!id) return [];
  // 予定
  const res = await fetch(
    `https://api.twitch.tv/helix/schedule?broadcaster_id=${id}`,
    { headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const segs = (await res.json()).data?.segments || [];
  return segs.map(s => ({
    platform: 'Twitch 予定',
    streamer: login,
    title:    s.title,
    url:      '',            // URL は無いため省略可
    time:     s.start_time
  }));
}

/** YouTube の現在／予定／過去動画 */
async function fetchYouTube(channelId, params) {
  const url =
    `https://www.googleapis.com/youtube/v3/search?` +
    `key=${YT_API_KEY}` +
    `&channelId=${channelId}` +
    `&part=snippet&type=video&order=date&maxResults=10&${params}`;
  const items = (await (await fetch(url)).json()).items || [];
  return items.map(item => ({
    platform: params.includes('eventType')
      ? `YouTube ${params.includes('live') ? 'LIVE' : '予定'}`
      : 'YouTube 投稿',
    streamer: channelId,
    title:    item.snippet.title,
    url:      `https://youtu.be/${item.id.videoId}`,
    time:     item.snippet.publishedAt
  }));
}

/** 当日投稿動画のみ取得するヘルパー */
function todayISO() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString();
}

function generateHTML(events) {
  // テーブルのヘッダー＋行を生成
  const rows = events.map(e => `
<tr>
  <td>${formatJST(e.time)}</td>
  <td>${e.platform}</td>
  <td>${e.streamer}</td>
  <td><a href="${e.url}" target="_blank">${e.title}</a></td>
</tr>`).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="assets/style.css">
  <title>当日のライブ＆動画タイムテーブル</title>
</head>
<body>
  <h1>当日のライブ & 動画タイムテーブル</h1>
  <table>
    <thead>
      <tr>
        <th>時間 (JST)</th><th>種別</th><th>配信者/チャンネル</th><th>タイトル</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

(async () => {
  const token = await getTwitchToken();
  const list  = JSON.parse(await fs.readFile('data/streamers.json','utf8'));
  const evs   = [];

  for (const s of list) {
    // Twitch live
    const tLive = await fetchTwitchLive(s.twitchUserLogin, token);
    if (tLive) evs.push(tLive);
    // Twitch 予定
    (await fetchTwitchSchedule(s.twitchUserLogin, token))
      .forEach(e => evs.push(e));
    // YouTube LIVE 現状
    (await fetchYouTube(s.youtubeChannelId, 'eventType=live'))
      .forEach(e => evs.push(e));
    // YouTube 予定
    (await fetchYouTube(s.youtubeChannelId, 'eventType=upcoming'))
      .forEach(e => evs.push(e));
    // YouTube 当日投稿動画
    (await fetchYouTube(s.youtubeChannelId, `publishedAfter=${todayISO()}`))
      .forEach(e => evs.push(e));
  }

  // JST 時間でソート
  evs.sort((a,b) => new Date(a.time) - new Date(b.time));

  // HTML 出力
  await fs.writeFile('docs/index.html', generateHTML(evs), 'utf8');
})();
