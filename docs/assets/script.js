// docs/assets/script.js

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('dayContainer');
  const days      = Array.from(container.querySelectorAll('.day'));
  const prevBtn   = document.getElementById('prevBtn');
  const nextBtn   = document.getElementById('nextBtn');
  const label     = document.getElementById('dateLabel');

  // YYYY-MM-DD → MM/DD (曜)
  function formatDateLabel(dateStr) {
    const [y, m, d] = dateStr.split('-').map(n=>+n);
    const w = ['日','月','火','水','木','金','土'][ new Date(y, m-1, d).getDay() ];
    return `${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')} (${w})`;
  }

  // UTC → HH:mm
  function formatTime(utc) {
    const d  = new Date(utc);
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${hh}:${mm}`;
  }

  // flex コンテナ設定
  container.style.display    = 'flex';
  container.style.transition = 'transform 0.3s ease';
  container.style.overflow   = 'hidden';

  // 各 .day の幅を「1列分＝25% (4分割)」に
  days.forEach(day => {
    day.style.flex = '0 0 25%';
  });

  // 今日のセクション index
  const today = new Date().toISOString().slice(0,10);
  let idx = days.findIndex(d => d.dataset.date === today);
  if (idx < 0) idx = 3;  // today が最初なら at least show first as center
  // (dates 配列は past3..today..future7 の11日分なので idx>=3)

  function update() {
    // 日付ラベル
    label.textContent = formatDateLabel(days[idx].dataset.date);
    // current クラス切り替え
    days.forEach((day,i) => day.classList.toggle('current', i === idx));
    // translate: 「(idx - 1) * 25%」だけ左に動かし、today が2列目～3列目をまたぐように
    const offset = Math.min(Math.max(idx - 1, 0), days.length - 4) * 25;
    container.style.transform = `translateX(-${offset}%)`;
    // ナビボタン活性
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === days.length - 1;
  }

  prevBtn.addEventListener('click', () => {
    if (idx > 0) { idx--; update(); }
  });
  nextBtn.addEventListener('click', () => {
    if (idx < days.length - 1) { idx++; update(); }
  });

  // 初期表示
  update();
});
