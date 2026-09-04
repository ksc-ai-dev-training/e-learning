/*
 * 社内学習管理システム（Manabi）設計ドキュメント サイドナビ共通スクリプト
 *
 * 各HTMLは <body> 直下に <script src="_sidenav.js"></script> を1行追加するだけ。
 * （docs/ 直下から1階層下（03_画面モックアップ/, 05_成果物資料/）で読み込む場合は
 *  <script src="../_sidenav.js"></script>）
 *
 * このファイルが:
 *   - サイドナビのHTMLを各ページに注入
 *   - サイドナビ用CSSを <head> に注入
 *   - 現在開いているページを location.pathname から判定して自動ハイライト
 *   - 本文の左マージンをサイドナビ分だけ確保
 *   - 印刷時はサイドナビを非表示にして本文を中央寄せに戻す
 *
 * 新しいドキュメントを追加するとき:
 *   下の DOCS 配列に { href, title } を追加するだけ（hrefは docs/ からの相対パス）。
 *   ※画面モックアップ本体（S-0x）は画面自体が固定サイドバーを持つため、
 *     サイドナビは読み込まない（リンクのみ張り、別ウィンドウで開く）。
 *   ※グループに newWindow: true を付けると、その中のリンクは別ウィンドウで開く。
 */
(function () {
  const DOCS = [
    {
      group: '要求・要件',
      docs: [
        { href: '01_要求仕様書.html', title: '01 要求仕様書' },
        { href: '02_要件定義書.html', title: '02 要件定義書' },
      ],
    },
    {
      group: '画面モックアップ',
      newWindow: true, // モックアップは実画面に近い見え方を確認するため別ウィンドウで開く
      collapsible: true, // 19画面分あり長くなるため、既定は折りたたみ、クリックで展開する
      docs: [
        { href: '03_画面モックアップ/index.html', title: '03 モックアップ一覧' },
        { href: '03_画面モックアップ/S-01_login.html', title: 'S-01 ログイン' },
        { href: '03_画面モックアップ/S-02_my-learning.html', title: 'S-02 マイ学習' },
        { href: '03_画面モックアップ/S-03_materials-list.html', title: 'S-03 教材一覧・検索' },
        { href: '03_画面モックアップ/S-04_material-view.html', title: 'S-04 教材受講：目次' },
        { href: '03_画面モックアップ/S-05_material-edit.html', title: 'S-05 教材編集：目次編集' },
        { href: '03_画面モックアップ/S-06_assignment-settings.html', title: 'S-06 配信設定' },
        { href: '03_画面モックアップ/S-07_org-management.html', title: 'S-07 組織管理（廃止）' },
        { href: '03_画面モックアップ/S-08_dashboard.html', title: 'S-08 受講状況ダッシュボード' },
        { href: '03_画面モックアップ/S-09_my-report.html', title: 'S-09 個人学習レポート' },
        { href: '03_画面モックアップ/S-10_admin.html', title: 'S-10 管理' },
        { href: '03_画面モックアップ/S-11_project-create.html', title: 'S-11 プロジェクト作成' },
        { href: '03_画面モックアップ/S-12_project-management.html', title: 'S-12 プロジェクト管理' },
        { href: '03_画面モックアップ/S-13_material-edit-project-select.html', title: 'S-13 教材編集：プロジェクト選択' },
        { href: '03_画面モックアップ/S-14_material-edit-list.html', title: 'S-14 教材編集：教材一覧' },
        { href: '03_画面モックアップ/S-15_profile-edit.html', title: 'S-15 プロフィール編集' },
        { href: '03_画面モックアップ/S-16_material-page-view.html', title: 'S-16 教材受講：ページ' },
        { href: '03_画面モックアップ/S-17_material-page-edit.html', title: 'S-17 教材編集：ページ編集' },
        { href: '03_画面モックアップ/S-18_ai-draft-session.html', title: 'S-18 Claude Code下書き作成（廃止）' },
        { href: '03_画面モックアップ/S-19_question-answers.html', title: 'S-19 設問別の回答・結果一覧' },
      ],
    },
    {
      group: '基本設計書',
      collapsible: true,
      docs: [
        { href: '04_基本設計書/index.html', title: '04 基本設計書' },
        { href: '04_基本設計書/03_認証認可設計.html', title: '　3. 認証・認可設計' },
        { href: '04_基本設計書/04_画面設計.html', title: '　4. 画面設計' },
        { href: '04_基本設計書/05_機能設計.html', title: '　5. 機能設計' },
        { href: '04_基本設計書/06_データベース設計.html', title: '　6. データベース設計' },
        { href: '04_基本設計書/07_API設計.html', title: '　7. API設計' },
        { href: '04_基本設計書/08_教材連携設計.html', title: '　8. 教材連携設計' },
        { href: '04_基本設計書/09_AI機能設計.html', title: '　9. AI機能設計' },
        { href: '04_基本設計書/10_非機能設計.html', title: '　10. 非機能設計' },
        { href: '04_基本設計書/11_前提制約.html', title: '　11. 前提・制約' },
      ],
    },
    {
      group: '詳細設計書',
      collapsible: true,
      docs: [
        { href: '05_成果物資料/index.html', title: '05 詳細設計書' },
        { href: '05_成果物資料/03_テーブル定義.html', title: '　3. テーブル定義' },
        { href: '05_成果物資料/04_API詳細設計.html', title: '　4. API詳細設計' },
        { href: '05_成果物資料/05_権限制御詳細.html', title: '　5. 権限制御詳細' },
        { href: '05_成果物資料/06_検索受講対象判定処理詳細.html', title: '　6. 検索・受講対象判定処理' },
        { href: '05_成果物資料/07_教材連携詳細.html', title: '　7. 教材連携詳細' },
        { href: '05_成果物資料/08_AI機能実装詳細.html', title: '　8. AI機能実装詳細' },
        { href: '05_成果物資料/09_エラーハンドリングログ設計.html', title: '　9. エラーハンドリング・ログ設計' },
        { href: '05_成果物資料/10_画面項目定義.html', title: '　10. 画面項目定義' },
        { href: '05_成果物資料/11_処理シーケンス.html', title: '　11. 処理シーケンス' },
      ],
    },
    {
      group: '参考資料',
      docs: [
        { href: '参考資料_環境構築手順.html', title: '開発環境構築手順' },
      ],
    },
  ];

  // ---- 現在位置の判定（docs/ 直下か、1階層下の03_画面モックアップ/・05_成果物資料/かで判定） ----
  const path = decodeURIComponent(location.pathname);
  const inSubdir = path.indexOf('03_画面モックアップ') !== -1 || path.indexOf('05_成果物資料') !== -1;
  const prefix = inSubdir ? '../' : '';
  const pathLower = path.toLowerCase();
  const isCurrent = (href) => {
    const hrefLower = href.toLowerCase();
    return pathLower.endsWith('/' + hrefLower) || pathLower === hrefLower;
  };

  // ---- CSS 注入 ----
  const css = `
.sidenav {
  position: fixed; top: 0; left: 0;
  width: 220px; height: 100vh;
  background: #fafbfc;
  border-right: 1px solid #e7eaee;
  padding: 16px 14px;
  overflow-y: auto;
  z-index: 100;
  font-size: 12px;
  font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif;
  box-sizing: border-box;
}
.sidenav-title {
  font-size: 13px; font-weight: 700; color: #1e3a8a;
  border-bottom: 2px solid #1e40af;
  padding-bottom: 6px; margin-bottom: 12px;
  line-height: 1.4;
}
.sidenav-group { margin-bottom: 14px; }
.sidenav-group-title {
  font-size: 10.5px; font-weight: 600; color: #8a8f98;
  letter-spacing: 0.04em;
  margin-bottom: 4px; padding-left: 4px;
}
summary.sidenav-group-title {
  cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 4px;
}
summary.sidenav-group-title::-webkit-details-marker { display: none; }
summary.sidenav-group-title::before {
  content: '▶'; font-size: 8px; color: #8a8f98; flex: none;
  transition: transform 0.15s ease;
}
details[open] > summary.sidenav-group-title::before { transform: rotate(90deg); }
summary.sidenav-group-title:hover { color: #1e3a8a; }
summary.sidenav-group-title:hover::before { color: #1e3a8a; }
.sidenav ul { list-style: none; margin: 0; padding: 0 0 0 4px; }
.sidenav li { margin: 1px 0; }
.sidenav a {
  color: #1a1d21; text-decoration: none;
  display: flex; align-items: baseline; gap: 4px;
  padding: 4px 8px; border-radius: 6px;
  line-height: 1.5;
}
.sidenav-label {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0; flex: 1;
}
.sidenav a:hover { background: #eff6ff; color: #1e3a8a; text-decoration: none; }
.sidenav li.current a { background: #1e40af; color: #fff; font-weight: 600; }
.sidenav-ext { font-size: 9px; color: #9aa0a8; flex: none; }
.sidenav a:hover .sidenav-ext { color: #1e3a8a; }
.sidenav li.current a .sidenav-ext { color: #c7d2fe; }

/* 本文左マージン（サイドナビ幅 + 余白） */
body { margin-left: 240px; }
@media print {
  body { margin-left: auto; }
  .sidenav { display: none; }
}
`;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---- nav HTML 構築 ----
  const escape = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));

  let html = '<nav class="sidenav">';
  html += '<div class="sidenav-title">Manabi<br>設計ドキュメント</div>';
  for (const g of DOCS) {
    const groupHasCurrent = g.docs.some((d) => isCurrent(d.href));
    const wrapTag = g.collapsible ? 'details' : 'div';
    const titleTag = g.collapsible ? 'summary' : 'div';
    const openAttr = g.collapsible && groupHasCurrent ? ' open' : '';
    html += '<' + wrapTag + ' class="sidenav-group"' + openAttr + '>';
    html += '<' + titleTag + ' class="sidenav-group-title">' + escape(g.group) + '</' + titleTag + '>';
    html += '<ul>';
    for (const d of g.docs) {
      const cls = isCurrent(d.href) ? ' class="current"' : '';
      const attrs = g.newWindow ? ' target="_blank" rel="noopener"' : '';
      const mark = g.newWindow ? '<span class="sidenav-ext">↗</span>' : '';
      html +=
        '<li' + cls + '><a href="' + escape(prefix + d.href) + '"' + attrs + ' title="' + escape(d.title) + '">' +
        '<span class="sidenav-label">' + escape(d.title) + '</span>' + mark + '</a></li>';
    }
    html += '</ul></' + wrapTag + '>';
  }
  html += '</nav>';

  // ---- DOM 挿入（script タグの直後） ----
  const inject = () => {
    const target = document.currentScript || document.body.firstElementChild;
    if (target && target.insertAdjacentHTML) {
      target.insertAdjacentHTML('afterend', html);
    } else {
      document.body.insertAdjacentHTML('afterbegin', html);
    }
  };

  if (document.currentScript) {
    inject();
  } else {
    document.addEventListener('DOMContentLoaded', inject);
  }
})();
