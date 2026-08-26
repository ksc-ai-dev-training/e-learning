/*
 * 画面モックアップ共通: サイドバーの開閉（アイコンのみの帯に折りたためる）。
 * 各S-xxのHTMLは<body>の最後で <script src="mock-sidebar.js"></script> を読み込むだけでよい。
 * HTML側の書き換えは不要（ラベルテキストの折りたたみ対応もこのスクリプトがDOM操作で行う）。
 * 開閉状態は localStorage に保存し、モックアップを跨いで維持する（実装側のSidebar.tsxと同じ方針）。
 */
(function () {
  const KEY = 'manabi-mock-sidebar-collapsed';
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  function markHideable(el) {
    if (el) el.classList.add('collapsible-text');
  }

  // ブランド名部分（アイコン以外）を隠せるようにする
  markHideable(sidebar.querySelector('.sidebar-brand > div:not(.brand-mark)'));

  // セクション見出し（「メニュー」「管理者メニュー」等）
  sidebar.querySelectorAll('.nav-label').forEach(markHideable);

  // ナビ項目・ログアウト系リンクの末尾テキストを <span> で包んで隠せるようにする
  sidebar.querySelectorAll('.nav-item, .sidebar-logout').forEach((el) => {
    for (let i = el.childNodes.length - 1; i >= 0; i--) {
      const node = el.childNodes[i];
      if (node.nodeType === 3 && node.textContent.trim()) {
        const span = document.createElement('span');
        span.className = 'collapsible-text';
        span.textContent = node.textContent.trim();
        el.replaceChild(span, node);
        break;
      }
    }
  });

  // ユーザー情報（氏名・メール）
  markHideable(sidebar.querySelector('.sidebar-user-row > div'));

  // 開閉ボタンはサイドバー右端の境界線上に配置する（実装側Sidebar.tsxと同じ方針）
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'sidebar-toggle';
  toggleBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  sidebar.appendChild(toggleBtn);

  function applyState(collapsed) {
    sidebar.classList.toggle('collapsed', collapsed);
    toggleBtn.title = collapsed ? 'サイドバーを開く' : 'サイドバーを閉じる';
    toggleBtn.querySelector('svg').style.transform = collapsed ? 'rotate(180deg)' : 'none';
  }

  applyState(localStorage.getItem(KEY) === '1');

  toggleBtn.addEventListener('click', () => {
    const next = !sidebar.classList.contains('collapsed');
    localStorage.setItem(KEY, next ? '1' : '0');
    applyState(next);
  });
})();
