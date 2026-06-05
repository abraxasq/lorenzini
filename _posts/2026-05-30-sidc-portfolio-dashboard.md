---
layout: post
title: "SIDC 포트폴리오 대시보드 — 이전·현재·예정 비교"
date: 2026-05-30
tags: [dashboard]
---

`holdings.yaml`(v3, 2026-05-30) 기준 포트폴리오 배분 현황입니다. 예수금 · Core · Satellite의 금액과 비중을 **5월 1차 조정 전(이전) · 조정 후(현재) · 8월 2차 조정 후(예정·잠정)** 세 시점으로 비교합니다. 출처: holdings.yaml v3, Architect 산출물 2026-05-30, spec-current.yaml v1.2.

[전체화면으로 보기 →]({{ '/assets/dashboards/sidc-2026-05-30.html' | relative_url }})

<iframe
  id="sidc-dash"
  src="{{ '/assets/dashboards/sidc-2026-05-30.html' | relative_url }}"
  title="SIDC 포트폴리오 대시보드"
  loading="lazy"
  style="width:100%;height:2400px;border:0;border-radius:8px;overflow:hidden;"
></iframe>

<script>
(function () {
  var frame = document.getElementById('sidc-dash');
  function resize() {
    try {
      var doc = frame.contentWindow.document;
      var h = Math.max(
        doc.body.scrollHeight,
        doc.documentElement.scrollHeight
      );
      if (h > 0) { frame.style.height = h + 'px'; }
    } catch (e) { /* cross-origin guard — keeps fallback height */ }
  }
  frame.addEventListener('load', function () {
    resize();
    // charts/fonts settle after load; re-measure a few times
    setTimeout(resize, 400);
    setTimeout(resize, 1200);
  });
  window.addEventListener('resize', resize);
})();
</script>
