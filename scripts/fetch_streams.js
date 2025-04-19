function generateHTML(streamers) {
  const items = streamers.map(s => {
    const ytLive = s.youtube.live[0];
    const ytUp   = s.youtube.upcoming;
    const twLive = s.twitch.live;
    const twSch  = s.twitch.schedule;
    return `
<li class="streamer">
  <h2>${s.name}</h2>
  <div class="platform">
    <h3>YouTube</h3>
    <p>${
      ytLive
        ? `LIVE: <a href="${ytLive.url}" target="_blank">${ytLive.title}</a> (${formatJST(ytLive.time)})`
        : '現在配信中なし'
    }</p>
    ${
      ytUp.length
        ? '<ul>' +
            ytUp
              .map(u =>
                `<li>予定: <a href="${u.url}" target="_blank">${u.title}</a> (${formatJST(u.time)})</li>`
              )
              .join('') +
            '</ul>'
        : ''
    }
  </div>
  <div class="platform">
    <h3>Twitch</h3>
    <p>${
      twLive
        ? `LIVE: <a href="${twLive.url}" target="_blank">${twLive.title}</a> (${formatJST(twLive.startTime)})`
        : '現在配信中なし'
    }</p>
    ${
      twSch.length
        ? '<ul>' +
            twSch
              .map(u =>
                `<li>予定: <a href="${u.url ||
                  `https://twitch.tv/${s.twitchUserLogin}`}" target="_blank">${u.title}</a> (${formatJST(
                  u.startTime
                )})</li>`
              )
              .join('') +
            '</ul>'
        : ''
    }
  </div>
</li>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="assets/style.css">
  <title>ライブ & 近日配信予定</title>
</head>
<body>
  <h1>ライブ & 近日配信予定</h1>
  <ul class="streamers">
    ${items}
  </ul>
</body>
</html>`;
}
