// 짭레터넷 사용 안내 페이지 렌더링 스크립트
// guest-readme.md 를 fetch 해서 marked.js 로 HTML 로 변환 후 #content 에 표시
// CSS 도 이 스크립트에서 주입 (html 은 셸만 갖게)
//
// 페이지에서 호출 방식:
//   <script>
//     fetch('https://gist.githubusercontent.com/.../raw/readme-page.js?t='+Date.now())
//       .then(r=>r.text()).then(eval);
//   </script>

(async () => {
  // 페이지 타이틀 변경 (브라우저 탭 + favicon 영역에 표시)
  document.title = '오소리 추천곡 자판기';

  const MD_URL = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/guest-readme.md';
  const MARKED_CDN = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';

  // CSS 주입 (다크 테마)
  const STYLE_ID = '__chap_letter_style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Pretendard", sans-serif;
        max-width: 720px;
        margin: 0 auto;
        padding: 24px 20px 60px;
        color: #e9ecef;
        background: #1a1a1a;
        line-height: 1.6;
      }
      #content h1 { font-size: 28px; margin: 0 0 8px; color: #f8f9fa; }
      #content h2 {
        font-size: 20px; margin: 32px 0 12px; padding-bottom: 6px;
        border-bottom: 2px solid #343a40; color: #f8f9fa;
      }
      #content h3 { font-size: 16px; margin: 20px 0 8px; color: #ced4da; }
      #content p { margin: 8px 0; }
      #content ul, #content ol { padding-left: 24px; margin: 8px 0; }
      #content li { margin: 4px 0; }
      #content code {
        background: #2d2d2d; padding: 2px 6px; border-radius: 3px;
        font-size: 13px; font-family: "SF Mono", Menlo, Consolas, monospace;
        color: #ff9bce;
      }
      #content pre {
        background: #232323; border: none; border-radius: 0 0 6px 6px;
        padding: 14px; overflow-x: auto; font-size: 13px;
        margin: 0;
        scrollbar-width: thin; scrollbar-color: #4a4a4a transparent;
      }
      /* 코드 블록 wrapper - 헤더 + 본문 */
      #content .code-block {
        margin: 12px 0;
        border-radius: 6px;
        overflow: hidden;
        transition: box-shadow 0.2s;
      }
      #content .code-block:hover { box-shadow: 0 0 0 1px #4a4a4a; }
      #content .code-header {
        display: flex; justify-content: space-between; align-items: center;
        background: #1f1f1f; padding: 8px 14px;
        font-size: 11px; letter-spacing: 0.5px; font-weight: 600;
        border-bottom: 1px solid #343a40;
      }
      #content .code-lang { color: #6c757d; }
      #content .code-copy { color: #ff6b9d; }
      #content .code-block:hover .code-copy { color: #ff8eb1; }
      /* 코드 블록 스크롤바 (Webkit) */
      #content pre::-webkit-scrollbar { height: 6px; }
      #content pre::-webkit-scrollbar-track { background: transparent; }
      #content pre::-webkit-scrollbar-thumb { background: #4a4a4a; border-radius: 3px; }
      #content pre::-webkit-scrollbar-thumb:hover { background: #5a5a5a; }
      #content pre code {
        background: transparent; padding: 0; color: #e9ecef; font-size: 13px;
      }
      /* 토스트 알림 */
      #__chap_toast {
        position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%) translateY(20px);
        padding: 10px 20px; border-radius: 6px; border: 1px solid;
        font-size: 14px; font-weight: 600;
        opacity: 0; pointer-events: none;
        transition: opacity 0.2s, transform 0.2s;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Pretendard", sans-serif;
      }
      #__chap_toast.show {
        opacity: 1; transform: translateX(-50%) translateY(0);
      }
      #content blockquote {
        border-left: 4px solid #fab005; background: #2d2818;
        margin: 12px 0; padding: 8px 14px; color: #ced4da;
      }
      #content blockquote p { margin: 4px 0; }
      #content hr { border: none; border-top: 1px solid #343a40; margin: 24px 0; }
      #content a { color: #74c0fc; text-decoration: none; }
      #content a:hover { text-decoration: underline; }
      #content strong { color: #f8f9fa; }
      footer {
        margin-top: 48px; padding-top: 16px; border-top: 1px solid #343a40;
        font-size: 12px; color: #6c757d; text-align: center; line-height: 1.5;
      }
    `;
    document.head.appendChild(style);
  }

  const container = document.getElementById('content');
  if (!container) {
    console.error('[짭레터넷] #content 요소를 찾을 수 없어요');
    return;
  }

  // 1. marked.js 로드 (이미 로드돼있으면 스킵)
  const loadMarked = () => new Promise((resolve, reject) => {
    if (window.marked) return resolve();
    const s = document.createElement('script');
    s.src = MARKED_CDN;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('marked.js 로드 실패'));
    document.head.appendChild(s);
  });

  try {
    container.innerHTML = '<p style="color:#888;text-align:center;padding:40px">불러오는 중...</p>';

    // 2. marked.js 로드 + 마크다운 fetch (병렬)
    const [, mdRes] = await Promise.all([
      loadMarked(),
      fetch(MD_URL + '?t=' + Date.now(), { cache: 'no-store' })
    ]);
    if (!mdRes.ok) throw new Error('마크다운 데이터 로드 실패: ' + mdRes.status);
    const md = await mdRes.text();

    // 3. 마크다운 → HTML 변환 후 표시
    container.innerHTML = window.marked.parse(md);

    // 4. 외부 링크는 새 탭으로 열리게
    container.querySelectorAll('a[href^="http"]').forEach(a => {
      a.target = '_blank';
      a.rel = 'noopener';
    });

    // 5. 코드 블록을 헤더 + 본문 구조로 감싸기 + 클릭 복사 + 토스트
    container.querySelectorAll('pre > code').forEach(code => {
      const pre = code.parentElement;
      // 언어 추측 (javascript / json / bash 등). marked 가 class="language-xxx" 붙임
      const lang = (code.className.match(/language-(\w+)/) || [, 'code'])[1].toUpperCase();
      const subtitle = lang === 'JAVASCRIPT' ? 'CONSOLE' : '';

      // wrapper 로 감싸서 헤더 추가
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block';
      const header = document.createElement('div');
      header.className = 'code-header';
      header.innerHTML = `
        <span class="code-lang">${lang}${subtitle ? ' — ' + subtitle : ''}</span>
        <span class="code-copy">CLICK TO COPY</span>
      `;
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);

      wrapper.style.cursor = 'pointer';
      wrapper.title = '클릭하면 복사됩니다';
      wrapper.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code.textContent);
          showToast('복사됐어요!');
        } catch (e) {
          console.error('복사 실패:', e);
          showToast('복사 실패', true);
        }
      });
    });

    // 토스트 함수: 화면 하단 중앙에 메시지 띄우고 자동 사라짐
    function showToast(msg, isError) {
      let toast = document.getElementById('__chap_toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = '__chap_toast';
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.background = isError ? '#5c2828' : '#2d4a2d';
      toast.style.borderColor = isError ? '#ff6b6b' : '#51cf66';
      toast.style.color = isError ? '#ffc9c9' : '#b2f2bb';
      // 표시 (이미 떠있으면 다시 풀로)
      toast.classList.remove('show');
      void toast.offsetWidth;  // reflow 강제 (재실행 시 transition 다시 트리거)
      toast.classList.add('show');
      // 1.5초 후 사라짐
      clearTimeout(toast.__timer);
      toast.__timer = setTimeout(() => toast.classList.remove('show'), 1500);
    }
  } catch (e) {
    console.error('[짭레터넷] 페이지 렌더링 오류:', e);
    container.innerHTML = `
      <div style="color:#ff6b6b;padding:20px;background:#2d1818;border:1px solid #5c2828;border-radius:8px">
        <strong>페이지를 불러오지 못했습니다.</strong><br>
        ${e.message}
      </div>
    `;
  }
})();