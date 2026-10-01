(function () {
  "use strict";
  function init() {
    var api = window.jingjieWindow;
    if (!api) return;

    var strip = document.createElement("div");
    strip.className = "jj-drag-strip";
    document.body.appendChild(strip);

    var cluster = document.createElement("div");
    cluster.className = "jj-win-controls";

    function svg(paths) {
      var wrap = document.createElement("span");
      wrap.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10">' + paths + "</svg>";
      return wrap.firstChild;
    }

    var minBtn = document.createElement("button");
    minBtn.title = "最小化";
    minBtn.setAttribute("aria-label", "最小化");
    minBtn.appendChild(svg('<path d="M0 5h10" stroke="currentColor" stroke-width="1"/>'));
    minBtn.addEventListener("click", function () { window.jingjieWindow.minimize(); });

    var maxBtn = document.createElement("button");
    maxBtn.title = "最大化 / 还原";
    maxBtn.setAttribute("aria-label", "最大化");
    function renderMax(max) {
      maxBtn.innerHTML = "";
      maxBtn.appendChild(
        max
          ? svg('<path d="M2.5 2.5V1h7v7H8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="0.5" y="2.5" width="6.5" height="6.5" fill="none" stroke="currentColor" stroke-width="1"/>')
          : svg('<rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/>')
      );
    }
    renderMax(false);
    maxBtn.addEventListener("click", function () { window.jingjieWindow.toggleMaximize(); });

    var closeBtn = document.createElement("button");
    closeBtn.className = "jj-close";
    closeBtn.title = "关闭";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.appendChild(svg('<path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1"/>'));
    closeBtn.addEventListener("click", function () { window.jingjieWindow.close(); });

    cluster.appendChild(minBtn);
    cluster.appendChild(maxBtn);
    cluster.appendChild(closeBtn);
    document.body.appendChild(cluster);

    window.jingjieWindow.isMaximized().then(renderMax).catch(function () {});
    window.jingjieWindow.onMaximizedChange(renderMax);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
