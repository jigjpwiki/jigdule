document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('dayContainer');
  const days      = Array.from(container.querySelectorAll('.day'));
  const label     = document.getElementById('dateLabel');
  const prevBtn   = document.getElementById('prevBtn');
  const nextBtn   = document.getElementById('nextBtn');

  // 今日の日付文字列（YYYY-MM-DD）
  const today = new Date().toISOString().split('T')[0];

  // 今日に該当するセクションのインデックスを探す
  let idx = days.findIndex(day => day.dataset.date === today);
  if (idx < 0) idx = 0; // 見つからなければ先頭

  // 日付ラベル更新
  function updateLabel() {
    const date = days[idx].dataset.date;          // "YYYY-MM-DD"
    const d    = new Date(date);
    const w    = ['日','月','火','水','木','金','土'][d.getDay()];
    label.textContent = `${date.replace(/-/g,'/')}(${w})`;
  }

  // 指定インデックスへスクロール
  function scrollToIndex(i) {
    if (i < 0 || i >= days.length) return;
    idx = i;
    const width = container.clientWidth;
    container.scrollTo({ left: width * idx, behavior: 'smooth' });
    updateLabel();
  }

  prevBtn.addEventListener('click', () => scrollToIndex(idx - 1));
  nextBtn.addEventListener('click', () => scrollToIndex(idx + 1));

  // 初期表示は「今日」のインデックスへ
  if (days.length > 0) {
    // 瞬間移動（smooth を発火させないため）
    container.scrollLeft = container.clientWidth * idx;
    updateLabel();
  }
});
