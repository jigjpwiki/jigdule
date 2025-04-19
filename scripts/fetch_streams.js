'use strict';

const fs = require('fs').promises;
const fetch = require('node-fetch');

const YT_API_KEY           = process.env.YT_API_KEY;
const TWITCH_CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

/**
 * ISO8601 の UTC 時刻文字列を受け取り、
 * 日本時間の「YYYY/MM/DD HH:mm:ss」形式に整形して返す
 */
function formatJST(utcString) {
  const d = new Date(utcString);
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour12: false,
    year:    'numeric',
    month:   '2-digit',
    day:     '2-digit',
    hour:    '2-digit',
    minute:  '2-digit',
    second:  '2-digit'
  });
}

/** 当日00:00の ISO 文字列を返す */
function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Twitch App Token を取得 */
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

/** Twitch のライブ中ストリームを取得 */
async function fetchTwitchLive(login, token) {
  const res = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${login}`,
    {
      headers: {
        'Client-ID':     TWITCH_CLIENT_ID,
        Authorization:  `Bearer ${token}`
      }
    }
  );
  const { data } = await res.json();
  if (!data || data.length === 0) return null;
  const s = data[0];
  return {
    platform: 'Twitch LIVE',
    streamer: login,
    title:    s.title,
    url:      `https://twitch.tv/${login}`,
    time:     s.started_at,
    status:   'live'
  };
}

/** Twitch のスケジュール（予定）を取得 */
async function fetchTwitchSchedule(login, token) {
  // ユーザーID取得
  const userRes = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers: {
        'Client-ID':    TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const userJson = await userRes.json();
  const userId = userJson.data?.[0]?.id;
  if (!userId) return [];
  // スケジュール取得
  const res = await fetch(
    `https://api.twitch.tv/helix/schedule?broadcaster_id=${userId}`,
    { headers: {
        'Client-ID':    TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const segs = (await res.json()).data?.segments || [];
  return segs.map(s => ({
    platform: 'Twitch 予定',
    streamer: login,
    title:    s.title,
    url:      '', // スケジュールAPIには直接URLがない
    time:     s.start_time,
    status:   'upcoming'
  }));
}

/** Twitch の過去配信（VOD）を取得 */
async function fetchTwitchVods(login, token) {
  // ユーザーID取得
  const userRes = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers: {
        'Client-ID':    TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const userJson = await userRes.json();
  const userId = userJson.data?.[0]?.id;
  if (!userId) return [];
  // VOD取得（broadcast_type=archive, 当日以降）
  const res = await fetch(
    `https://api.twitch.tv/helix/videos` +
    `?user_id=${userId}` +
    `&first=5` +
    `&broadcast_type=archive` +
    `&started_at=${todayISO()}`,
    { headers: {
        'Client-ID':    TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const vods = (await res.json()).data || [];
  return vods.map(v => ({
    platform: 'Twitch 過去配信',
    streamer: login,
    title:    v.title,
    url:      v.url,
    time:     v.created_at,
    status:   'past'
  }));
}

/**
 * YouTube データを取得
 * - eventType=live または upcoming を指定するか
 * - publishedAfter=YYYY-MM-DDTHH:MM:SSZ を指定して過去動画を取得
 */
async function fetchYouTube(channelId, params) {
  const url =
    `https://www.googleapis.com/youtube/v3/search` +
    `?key=${YT_API_KEY}` +
    `&channelId=${channelId}` +
    `&part=snippet&type=video` +
    `&order=date&maxResults=10&${params}`;
  const items = (await (await fetch(url)).json()).items || [];
  return items.map(item => {
    const isLive = params.includes('eventType=live');
    const isUpcoming = params.includes('eventType=upcoming');
    return {
      platform: isLive
        ? 'YouTube LIVE'
        : isUpcoming
          ? 'YouTube 予定'
          : 'YouTube 投稿',
      streamer: channelId,
      title:    item.snippet.title,
      url:      `https://youtu.be/${item.id.videoId}`,
      time:     item.snippet.publishedAt,
      status:   isLive
        ? 'live'
        : isUpcoming
          ? 'upcoming'
          : 'past'
    };
  });
}

/** HTML を生成 */
function generateHTML(events) {
  const rows = events.map(e => `
<tr class="${e.status}">
  <td>${formatJST(e.time)}</td>
  <td>${
    e.status === 'live' ? '<strong>LIVE</strong>' :
    e.status === 'upcoming' ? '予定' :
    '過去'
  }</td>
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
        <th>時間 (JST)</th>
        <th>ステータス</th>
        <th>種別</th>
        <th>配信者/チャンネル</th>
        <th>タイトル</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

/** メイン処理 */
(async () => {
  try {
    const token = await getTwitchToken();
    const list  = JSON.parse(await fs.readFile('data/streamers.json', 'utf8'));
    let events = [];

    for (const s of list) {
      // Twitch LIVE
      const tLive = await fetchTwitchLive(s.twitchUserLogin, token);
      if (tLive) events.push(tLive);
      // Twitch 予定
      (await fetchTwitchSchedule(s.twitchUserLogin, token))
        .forEach(e => events.push(e));
      // Twitch 過去配信
      (await fetchTwitchVods(s.twitchUserLogin, token))
        .forEach(e => events.push(e));
      // YouTube LIVE
      (await fetchYouTube(s.youtubeChannelId, 'eventType=live'))
        .forEach(e => events.push(e));
      // YouTube 予定
      (await fetchYouTube(s.youtubeChannelId, 'eventType=upcoming'))
        .forEach(e => events.push(e));
      // YouTube 当日投稿
      (await fetchYouTube(s.youtubeChannelId, `publishedAfter=${todayISO()}`))
        .forEach(e => events.push(e));
    }

    // 時系列でソート
    events.sort((a, b) => new Date(a.time) - new Date(b.time));

    // HTML 出力
    await fs.writeFile('docs/index.html', generateHTML(events), 'utf8');
    console.log(`▶ イベント数: ${events.length}`);
  } catch (err) {
    console.error('Error in fetch_streams.js:', err);
    process.exit(1);
  }
})();
