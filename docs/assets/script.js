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
    const d = new Date(utc);
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${hh}:${mm}`;
  }

  // コンテナを横スワイプ用に設定
  container.style.display    = 'flex';
  container.style.transition = 'transform 0.3s ease';
  container.style.overflow   = 'hidden';
  days.forEach(day => { day.style.flex = '0 0 100%'; });

  // 今日を初期 idx
  const today = new Date().toISOString().slice(0,10);
  let idx = days.findIndex(d => d.dataset.date === today);
  if (idx < 0) idx = 0;

  // 更新：スライド・ラベル・ボタン・currentクラス付与
  function update() {
    // スライド
    container.style.transform = `translateX(-${idx * 100}%)`;
    // 日付ラベル
    const dateStr = days[idx].dataset.date;
    label.textContent = formatDateLabel(dateStr);
    // ボタン活性
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === days.length - 1;
    // currentクラス切り替え
    days.forEach((day,i) => {
      day.classList.toggle('current', i === idx);
    });
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
