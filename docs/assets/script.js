// docs/assets/script.js

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('dayContainer');
  const days      = Array.from(container.querySelectorAll('.day'));
  const prevBtn   = document.getElementById('prevBtn');
  const nextBtn   = document.getElementById('nextBtn');
  const label     = document.getElementById('dateLabel');

  // 日付ラベル生成
  function formatDateLabel(dateStr) {
    const [y, m, d] = dateStr.split('-').map(n=>+n);
    const w = ['日','月','火','水','木','金','土'][ new Date(y, m-1, d).getDay() ];
    return `${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')} (${w})`;
  }

  // 横スワイプコンテナ設定
  container.style.display    = 'flex';
  container.style.transition = 'transform 0.3s ease';
  container.style.overflow   = 'hidden';

  // 各.day の幅を「25%」、後で .current を「50%」にする
  days.forEach(day => {
    day.style.flex = '0 0 25%';
  });

  // 今日の index を決定
  const today = new Date().toISOString().slice(0,10);
  let idx = days.findIndex(d => d.dataset.date === today);
  if (idx < 0) idx = 3; // 日付リストのうち、4番目(過去3日を飛ばして)を中心に

  function update() {
    // currentクラス切替→CSSで幅50%に
    days.forEach((day,i) => {
      day.classList.toggle('current', i === idx);
    });

    // translateX を「(idx-1)*25%」にして、常に中央にtodayが来るよう調整
    const maxOffset = days.length - 3;
    let offsetIdx = idx - 1;
    if (offsetIdx < 0) offsetIdx = 0;
    if (offsetIdx > maxOffset) offsetIdx = maxOffset;
    container.style.transform = `translateX(-${offsetIdx * 25}%)`;

    // 日付ラベル／ボタン活性
    label.textContent = formatDateLabel(days[idx].dataset.date);
    prevBtn.disabled  = idx === 0;
    nextBtn.disabled  = idx === days.length - 1;
  }

  prevBtn.addEventListener('click', () => {
    if (idx > 0) { idx--; update(); }
  });
  nextBtn.addEventListener('click', () => {
    if (idx < days.length - 1) { idx++; update(); }
  });

  // 初期レンダー
  update();
});
