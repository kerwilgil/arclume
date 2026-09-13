/**
 * The inline viewer runtime, as a string. It is emitted once inside a single
 * `<script>` element.
 *
 * It reads only the DOM the renderer produced — it never parses deck JSON, never
 * assigns `innerHTML`, never calls `eval` / `new Function` / `document.write`,
 * and never touches the network. It toggles a class and a few attributes.
 */

export const VIEWER_RUNTIME = String.raw`
(function () {
  "use strict";
  var deck = document.querySelector(".arclume-deck");
  if (!deck) return;
  var slides = Array.prototype.slice.call(deck.querySelectorAll(".arclume-slide"));
  if (slides.length === 0) return;
  document.body.classList.add("arclume-viewing");

  var counterCurrent = deck.querySelector(".arclume-counter-current");
  var counter = deck.querySelector(".arclume-counter");
  var bar = deck.querySelector(".arclume-progress-bar");
  var btnPrev = deck.querySelector(".arclume-prev");
  var btnNext = deck.querySelector(".arclume-next");
  var index = 0;

  function idOf(el) { return el.getAttribute("data-slide-id") || ""; }

  function indexFromHash() {
    var m = /^#slide=(.+)$/.exec(window.location.hash || "");
    if (!m) return -1;
    var want;
    try { want = decodeURIComponent(m[1]); } catch (e) { want = m[1]; }
    for (var i = 0; i < slides.length; i += 1) {
      if (idOf(slides[i]) === want) return i;
    }
    return -1;
  }

  function render(moveFocus) {
    for (var i = 0; i < slides.length; i += 1) {
      var active = i === index;
      slides[i].classList.toggle("is-active", active);
      if (active) { slides[i].removeAttribute("aria-hidden"); }
      else { slides[i].setAttribute("aria-hidden", "true"); }
    }
    if (counterCurrent) { counterCurrent.textContent = String(index + 1); }
    if (counter) { counter.setAttribute("data-current", String(index + 1)); }
    if (bar) { bar.style.width = ((index + 1) / slides.length * 100).toFixed(2) + "%"; }
    if (btnPrev) { btnPrev.disabled = index === 0; }
    if (btnNext) { btnNext.disabled = index === slides.length - 1; }
    var id = idOf(slides[index]);
    var target = "#slide=" + encodeURIComponent(id);
    if (window.location.hash !== target) {
      try { history.replaceState(null, "", target); }
      catch (e) { window.location.hash = target; }
    }
    if (moveFocus && typeof slides[index].focus === "function") {
      slides[index].focus({ preventScroll: false });
    }
  }

  function go(next, moveFocus) {
    var clamped = Math.max(0, Math.min(slides.length - 1, next));
    if (clamped === index) { render(moveFocus); return; }
    index = clamped;
    render(moveFocus);
  }

  if (btnPrev) { btnPrev.addEventListener("click", function () { go(index - 1, true); }); }
  if (btnNext) { btnNext.addEventListener("click", function () { go(index + 1, true); }); }

  window.addEventListener("hashchange", function () {
    var i = indexFromHash();
    go(i < 0 ? 0 : i, false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && t.closest && t.closest("input, textarea, select, button, [contenteditable]")) return;
    switch (e.key) {
      case "ArrowRight": case "ArrowDown": case "PageDown": case " ": case "Spacebar":
        go(index + 1, true); e.preventDefault(); break;
      case "ArrowLeft": case "ArrowUp": case "PageUp":
        go(index - 1, true); e.preventDefault(); break;
      case "Home":
        go(0, true); e.preventDefault(); break;
      case "End":
        go(slides.length - 1, true); e.preventDefault(); break;
      default: break;
    }
  });

  var start = indexFromHash();
  index = start < 0 ? 0 : start;
  render(false);
})();
`;
