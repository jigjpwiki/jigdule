// docs/assets/script.js

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('dayContainer');
  const days      = Array.from(container.querySelectorAll('.day'));
  const prevBtn   = document.getElementById('prevBtn');
  const nextBtn   = document.getElementById('nextBtn');
  const label     = document.getElementById('dateLabel');

  // YYYY-MM-DD → MM/DD (曜)
  function formatDateLabel(dateStr) {
    const [y, m, d] = dateStr.split('-').map(n => +n);
    const w = ['日','月','火','水','木','金','土'][
      new Date(y, m - 1, d).getDay()
    ];
    return `${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')} (${w})`;
  }

  // コンテナを横スワイプ用に設定
  container.style.display    = 'flex';
  container.style.transition = 'transform 0.3s ease';
  container.style.overflow   = 'hidden';

  // 各 .day を 1/3 幅に
  days.forEach(day => {
    day.style.flex = '0 0 33.333%';
  });

  // 今日の日付を持つセクションに .today を付与
  const today = new Date().toISOString().slice(0, 10);
  days.forEach(day => {
    if (day.dataset.date === today) {
      day.classList.add('today');
    }
  });

  // 今日を中心に見せるための初期 idx（today の位置を 2番目に）
  let idx = days.findIndex(d => d.dataset.date === today);
  if (idx < 0) idx = 1;  // 見つからなければ 1
  // スライドは (idx - 1) * 33.333%
  function update() {
    const offsetIdx = Math.min(
      Math.max(idx - 1, 0),
      days.length - 3
    );
    container.style.transform = `translateX(-${offsetIdx * 33.333}%)`;
    // ラベル更新
    label.textContent = formatDateLabel(days[idx].dataset.date);
    // ボタン活性
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
