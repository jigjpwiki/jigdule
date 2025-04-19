'use strict';

const fs    = require('fs').promises;
const fetch = require('node-fetch');

const YT_API_KEY           = process.env.YT_API_KEY;
const TWITCH_CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

/**
 * UTC文字列 → JST「YYYY/MM/DD HH:mm:ss」形式に整形
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

/** 当日 00:00 の ISO フォーマット */
function todayISO() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString();
}

/** Twitch API トークン取得 */
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

/** Twitch ライブ中取得 */
async function fetchTwitchLive(login, token) {
  const res = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${login}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const { data } = await res.json();
  if (!data || !data[0]) return null;
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

/** Twitch 予定取得 */
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
  const segs = (await res.json()).data?.segments || [];
  return segs.map(s => ({
    platform: 'Twitch 予定',
    streamer: login,
    title:    s.title,
    url:      '',
    time:     s.start_time,
    status:   'upcoming'
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
    `&first=5` +
    `&broadcast_type=archive` +
    `&started_at=${todayISO()}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
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
 * YouTube API 呼び出し。
 * error が返ってきたら throw してキャッチ側で処理します。
 */
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
  const items = json.items || [];
  return items.map(item => {
    const isLive     = params.includes('eventType=live');
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

/** HTML 生成 */
function generateHTML(events) {
  const rows = events.map(e => `
<tr class="${e.status}">
  <td>${formatJST(e.time)}</td>
  <td>${
    e.status === 'live'     ? '<strong>LIVE</strong>' :
    e.status === 'upcoming' ? '予定'            : '過去'
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

/** エラー専用 HTML 生成 */
function generateErrorHTML(err) {
  const msg = err.message || String(err);
  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>更新エラー</title></head>
<body>
  <h1>更新中にエラーが発生しました</h1>
  <pre>${msg}</pre>
</body>
</html>`;
}

/** メイン処理 */
(async () => {
  try {
    const token  = await getTwitchToken();
    const list   = JSON.parse(await fs.readFile('data/streamers.json', 'utf8'));
    const events = [];

    for (const s of list) {
      // Twitch LIVE
      const tLive = await fetchTwitchLive(s.twitchUserLogin, token);
      if (tLive) events.push(tLive);

      // Twitch 予定
      (await fetchTwitchSchedule(s.twitchUserLogin, token))
        .forEach(e => events.push(e));

      // Twitch 過去配信（重複排除）
      (await fetchTwitchVods(s.twitchUserLogin, token))
        .filter(v =>
          !(tLive &&
            v.title === tLive.title &&
            v.time.split('T')[0] === tLive.time.split('T')[0]
          )
        )
        .forEach(v => events.push(v));

      // YouTube LIVE
      const ytLiveList = await fetchYouTube(s.youtubeChannelId, 'eventType=live');
      ytLiveList.forEach(e => events.push(e));

      // YouTube 予定
      const ytUpList = await fetchYouTube(s.youtubeChannelId, 'eventType=upcoming');
      ytUpList.forEach(e => events.push(e));

      // YouTube 当日投稿（重複排除）
      (await fetchYouTube(s.youtubeChannelId, `publishedAfter=${todayISO()}`))
        .filter(p =>
          !ytLiveList.some(l =>
            l.title === p.title &&
            l.time.split('T')[0] === p.time.split('T')[0]
          ) &&
          !ytUpList.some(u =>
            u.title === p.title &&
            u.time.split('T')[0] === p.time.split('T')[0]
          )
        )
        .forEach(p => events.push(p));
    }

    // 時系列ソート
    events.sort((a, b) => new Date(a.time) - new Date(b.time));

    // HTML 出力
    await fs.writeFile('docs/index.html', generateHTML(events), 'utf8');
  } catch (err) {
    console.error(err);
    await fs.writeFile('docs/index.html', generateErrorHTML(err), 'utf8');
    process.exit(1);
  }
})();
