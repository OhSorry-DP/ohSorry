// 2-calc-score.js — 호환성용 redirect (legacy gist URL).
// 새 본체 wrapper 는 ohsorry.js. 기존 사용자가 콘솔에 붙여넣어 쓰던 이 URL 은 그대로 유지.
// 내용: ohsorry.js 를 gist 에서 fetch + eval.
// ============================================================

fetch('https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/ohsorry.js?t=' + Date.now(), { cache: 'no-store' })
  .then(r => { if (!r.ok) throw new Error('ohsorry.js 로드 실패: HTTP ' + r.status); return r.text(); })
  .then(text => { (0, eval)(text); })
  .catch(e => { console.error('[2-calc-score.js compat] redirect 실패:', e); alert('오소리 로드 실패: ' + e.message); });
