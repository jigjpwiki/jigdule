import fs from 'fs/promises';
import fetch from 'node-fetch';

const YT_API_KEY = process.env.YT_API_KEY;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

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

async function fetchTwitchUserId(login, token) {
  const res = await fetch(`https://api.twitch.tv/helix/users?login=${login}`, {
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`
    }
  });
  const { data } = await res.json();
  return data[0]?.id || null;
}

async function fetchTwitchLive(login, token) {
  const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${login}`, {
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`
    }
  });
  const { data } = await res.json();
  if (!data.length) return null;
  const s = data[0];
  return {
    title: s.title,
    startTime: s.started_at,
    url: `https://twitch.tv/${login}`
  };
}

async function fetchTwitchSchedule(login, token) {
  const userId = await fetchTwitchUserId(login, token);
  if (!userId) return [];
  const res = await fetch(
    `https://api.twitch.tv/helix/schedule?broadcaster_id=${userId}`,
    {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );
  const json = await res.json();
  const segs = json.data?.segments || [];
  return segs.map(s => ({
    title: s.title,
    startTime: s.start_time
  }));
}

async function fetchYouTube(channelId, eventType, maxResults = 5) {
  const url =
    `https://www.googleapis.com/youtube/v3/search` +
    `?key=${YT_API_KEY}` +
    `&channelId=${channelId}` +
    `&part=snippet&type=video` +
    `&eventType=${eventType}` +
    `&maxResults=${maxResults}`;
  const res = await fetch(url);
  const json = await res.json();
  return (json.items || []).map(item => ({
    title: item.snippet.title,
    time: item.snippet.publishedAt,
    url: `https://youtu.be/${item.id.videoId}`
  }));
}

function generateHTML(streamers) {
  const listItems = streamers
    .map(s => {
      const ytLive = s.youtube.live[0];
      const ytUp = s.youtube.upcoming;
      const twLive = s.twitch.live;
      const twSch = s.twitch.schedule;
      return `
<li class="streamer">
  <h2>${s.name}</h2>
  <div class="platform">
    <h3>YouTube</h3>
    <p>${ytLive
      ? `LIVE: <a href="${ytLive.url}" target="_blank">${ytLive.title}</a> (${ytLive.time})`
      : '現在配信中なし'}</p>
    ${
      ytUp.length
        ? '<ul>' +
          ytUp
            .map(
              u =>
                `<li>予定: <a href="${u.url}" target="_blank">${u.title}</a> (${u.time})</li>`
            )
            .join('') +
          '</ul>'
        : ''
    }
  </div>
  <div class="platform">
    <h3>Twitch</h3>
    <p>${twLive
      ? `LIVE: <a href="${twLive.url}" target="_blank">${twLive.title}</a> (${twLive.startTime})`
      : '現在配信中なし'}</p>
    ${
      twSch.length
        ? '<ul>' +
          twSch
            .map(
              s =>
                `<li>予定: <a href="${s.url || `https://twitch.tv/${s.user}`}">${
                  s.title
                }</a> (${s.startTime})</li>`
            )
            .join('') +
          '</ul>'
        : ''
    }
  </div>
</li>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="assets/style.css">
  <title>配信状況一覧</title>
</head>
<body>
  <h1>ライブ & 近日配信予定</h1>
  <ul class="streamers">
    ${listItems}
  </ul>
</body>
</html>`;
}

(async () => {
  const token = await getTwitchToken();
  const list = JSON.parse(await fs.readFile('data/streamers.json', 'utf8'));
  const results = [];
  for (const s of list) {
    const ytLive = await fetchYouTube(s.youtubeChannelId, 'live', 1);
    const ytUp = await fetchYouTube(s.youtubeChannelId, 'upcoming', 5);
    const twLive = await fetchTwitchLive(s.twitchUserLogin, token);
    const twSch = await fetchTwitchSchedule(s.twitchUserLogin, token);
    results.push({
      name: s.name,
      youtube: { live: ytLive, upcoming: ytUp },
      twitch: { live: twLive, schedule: twSch }
    });
  }
  const html = generateHTML(results);
  await fs.writeFile('docs/index.html', html, 'utf8');
})();
