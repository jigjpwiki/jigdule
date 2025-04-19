// docs/assets/script.js

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('dayContainer');
  const days      = Array.from(container.querySelectorAll('.day'));
  const prevBtn   = document.getElementById('prevBtn');
  const nextBtn   = document.getElementById('nextBtn');
  const label     = document.getElementById('dateLabel');

  // YYYY-MM-DD → MM/DD (曜) 形式のラベルを作るヘルパー
  function formatDateLabel(dateStr) {
    const [y, m, d] = dateStr.split('-').map(s => parseInt(s, 10));
    const w = ['日','月','火','水','木','金','土'][
      new Date(y, m - 1, d).getDay()
    ];
    return `${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')} (${w})`;
  }

  // container を横スワイプの flex コンテナに
  container.style.display    = 'flex';
  container.style.transition = 'transform 0.3s ease';
  container.style.overflow   = 'hidden';
  days.forEach(day => {
    day.style.flex = '0 0 100%';
  });

  // 今日の日付に対応するセクションを探し、なければ 0
  const today = new Date().toISOString().slice(0, 10);
  let idx = days.findIndex(sec => sec.dataset.date === today);
  if (idx < 0) idx = 0;

  // 表示更新：スライド位置・日付ラベル・ボタン活性
  function update() {
    container.style.transform = `translateX(-${idx * 100}%)`;
    const dateStr = days[idx].dataset.date;
    label.textContent = formatDateLabel(dateStr);
    prevBtn.disabled = (idx === 0);
    nextBtn.disabled = (idx === days.length - 1);
  }

  prevBtn.addEventListener('click', () => {
    if (idx > 0) {
      idx--;
      update();
    }
  });

  nextBtn.addEventListener('click', () => {
    if (idx < days.length - 1) {
      idx++;
      update();
    }
  });

  // 初回レンダー
  update();
});
