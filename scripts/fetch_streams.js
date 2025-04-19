'use strict';

const fs    = require('fs').promises;
const fetch = require('node-fetch');

const YT_API_KEY           = process.env.YT_API_KEY;
const TWITCH_CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

/** UTC → JST フォーマット */
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

/** 当日 00:00 の ISO 文字列 */
function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
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

/** Twitch 配信予定取得（無題除外） */
async function fetchTwitchSchedule(login, token) {
  const ures = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const ujson  = await ures.json();
  const userId = ujson.data?.[0]?.id;
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
  const ures = await fetch(
    `https://api.twitch.tv/helix/users?login=${login}`,
    { headers: { 'Client-ID': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } }
  );
  const ujson  = await ures.json();
  const userId = ujson.data?.[0]?.id;
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

/** YouTube 検索ヘルパー */
async function fetchYouTube(channelId, params) {
  const url =
    `https://www.googleapis.com/youtube/v3/search` +
    `?key=${YT_API_KEY}` +
    `&channelId=${channelId}` +
    `&part=snippet&type=video` +
    `&order=date&maxResults=10&${params}`;
  const res  = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`YouTube API error: ${json.error.code} ${json.error.message}`);
  return (json.items || []).map(item => {
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

/** HTML 生成 */
function generateHTML(events) {
  const header = `
<tr>
  <th>時間 (JST)</th>
  <th>ステータス</th>
  <th>種別</th>
  <th>配信者</th>
  <th>アバター</th>
  <th>サムネイル</th>
  <th>タイトル</th>
</tr>`;
  const rows = events.map(e => `
<tr class="${e.status}">
  <td>${formatJST(e.time)}</td>
  <td>${e.status === 'live'     ? '<strong>LIVE</strong>'
          : e.status === 'upcoming' ? '予定'
          : '過去'}</td>
  <td>${e.platform}</td>
  <td>${e.streamerName}</td>
  <td>${e.avatar
        ? `<img src="assets/${e.avatar}" width="48" height="48" class="avatar" alt="${e.streamerName}">`
        : ''}</td>
  <td>${e.thumbnail
        ? `<img src="${e.thumbnail}" width="120" class="thumb" alt="">`
        : ''}</td>
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
    <thead>${header}</thead>
    <tbody>${rows}</tbody>
  </table>
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
      if (tLive) events.push({ ...tLive, streamerName: s.name, avatar: s.avatar });

      // Twitch 予定
      for (const raw of await fetchTwitchSchedule(s.twitchUserLogin, token)) {
        events.push({ ...raw, streamerName: s.name, avatar: s.avatar });
      }

      // Twitch VOD（開始5分以内は除外）
      for (const v of await fetchTwitchVods(s.twitchUserLogin, token)) {
        if (!(tLive && Math.abs(new Date(v.time) - new Date(tLive.time)) < 5*60*1000)) {
          events.push({ ...v, streamerName: s.name, avatar: s.avatar });
        }
      }

      // YouTube LIVE
      let ytLiveList = [];
      try {
        ytLiveList = await fetchYouTube(s.youtubeChannelId, 'eventType=live');
        ytLiveList.forEach(raw => {
          events.push({ ...raw, streamerName: s.name, avatar: s.avatar });
        });
      } catch (e) {
        console.error('YouTube LIVE error:', e.message);
      }

      // YouTube 予定
      let ytUpList = [];
      try {
        ytUpList = await fetchYouTube(s.youtubeChannelId, 'eventType=upcoming');
        ytUpList.forEach(raw => {
          events.push({ ...raw, streamerName: s.name, avatar: s.avatar });
        });
      } catch (e) {
        console.error('YouTube upcoming error:', e.message);
      }

      // YouTube 当日投稿（重複除外）
      try {
        const ytPastList = await fetchYouTube(s.youtubeChannelId, `publishedAfter=${todayISO()}`);
        ytPastList
          .filter(p =>
            !ytLiveList.some(l => l.title === p.title && l.time.split('T')[0] === p.time.split('T')[0]) &&
            !ytUpList.some(u => u.title === p.title && u.time.split('T')[0] === p.time.split('T')[0])
          )
          .forEach(raw => {
            events.push({ ...raw, streamerName: s.name, avatar: s.avatar });
          });
      } catch (e) {
        console.error('YouTube past error:', e.message);
      }
    }

    // 時系列ソート
    events.sort((a, b) => new Date(a.time) - new Date(b.time));

    // フィルタリング：過去3日分、未来1週間分のみ
    const now = new Date();
    const pastThreshold   = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const futureThreshold = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const filtered = events.filter(e => {
      const t = new Date(e.time);
      return t >= pastThreshold && t <= futureThreshold;
    });

    // HTML 出力
    await fs.writeFile('docs/index.html', generateHTML(filtered), 'utf8');

  } catch (err) {
    console.error(err);
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>更新エラー</title></head>
<body><h1>更新中にエラーが発生しました</h1><pre>${err.message}</pre></body></html>`;
    await fs.writeFile('docs/index.html', html, 'utf8');
  }
})();
