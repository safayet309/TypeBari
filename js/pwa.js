// TypeBari — অ্যাপ হিসেবে ইনস্টল (PWA) ও ভাসমান ইনস্টল নোটিফিকেশন
(function () {
  function addTag(tag, attrs) {
    var n = document.createElement(tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    document.head.appendChild(n);
  }
  if (!document.querySelector('link[rel="manifest"]')) addTag("link", { rel: "manifest", href: "manifest.json" });
  if (!document.querySelector('meta[name="theme-color"]')) addTag("meta", { name: "theme-color", content: "#0f3d2e" });
  if (!document.querySelector('link[rel="apple-touch-icon"]')) addTag("link", { rel: "apple-touch-icon", href: "icons/apple-touch-icon.png" });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function (err) { console.error("SW error:", err); });
    });
  }

  // অ্যাপ হিসেবে খোলা থাকলে নোটিফিকেশন দরকার নেই
  var installed = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (installed) return;

  var KEY = "typebari-install-dismissed";
  function recentlyDismissed() {
    try {
      var t = Number(localStorage.getItem(KEY));
      return t && Date.now() - t < 7 * 24 * 60 * 60 * 1000;
    } catch (e) { return false; }
  }
  if (recentlyDismissed()) return;

  var style = document.createElement("style");
  style.textContent =
    ".pwa-banner{position:fixed;left:16px;right:16px;bottom:88px;max-width:440px;z-index:40;" +
    "display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:16px;" +
    "background:#0f3d2e;color:#fbfaf6;box-shadow:0 14px 34px rgba(0,0,0,.28);font-family:inherit}" +
    ".pwa-banner img{width:44px;height:44px;border-radius:10px;flex:none}" +
    ".pwa-text{flex:1;min-width:0}" +
    ".pwa-text strong{display:block;font-size:16px;line-height:1.4}" +
    ".pwa-text span{display:block;font-size:13.5px;line-height:1.5;color:#c9d8cf}" +
    ".pwa-actions{display:flex;flex-direction:column;gap:6px;flex:none}" +
    ".pwa-btn{border:0;border-radius:10px;padding:9px 16px;font:inherit;font-size:15px;font-weight:600;cursor:pointer;background:#e8d3a2;color:#0f3d2e}" +
    ".pwa-later{background:transparent;color:#c9d8cf;font-weight:500;padding:4px 8px}";
  document.head.appendChild(style);

  function show(message, canInstall, onInstall) {
    if (document.getElementById("pwa-banner")) return;
    var box = document.createElement("div");
    box.id = "pwa-banner";
    box.className = "pwa-banner";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "অ্যাপ ইনস্টল করুন");

    var icon = document.createElement("img");
    icon.src = "icons/icon-192.png";
    icon.alt = "";

    var text = document.createElement("div");
    text.className = "pwa-text";
    var title = document.createElement("strong");
    title.textContent = "TypeBari অ্যাপ ইনস্টল করুন";
    var sub = document.createElement("span");
    sub.textContent = message;
    text.appendChild(title);
    text.appendChild(sub);

    var actions = document.createElement("div");
    actions.className = "pwa-actions";

    function close() {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      box.remove();
    }

    if (canInstall) {
      var go = document.createElement("button");
      go.type = "button";
      go.className = "pwa-btn";
      go.textContent = "ইনস্টল";
      go.addEventListener("click", function () { onInstall(); box.remove(); });
      actions.appendChild(go);
    }
    var later = document.createElement("button");
    later.type = "button";
    later.className = "pwa-btn pwa-later";
    later.textContent = canInstall ? "পরে" : "বুঝেছি";
    later.addEventListener("click", close);
    actions.appendChild(later);

    box.appendChild(icon);
    box.appendChild(text);
    box.appendChild(actions);
    document.body.appendChild(box);
  }

  // অ্যান্ড্রয়েড / ক্রোম / কম্পিউটার
  var deferred = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    setTimeout(function () {
      show("ফোনের হোম স্ক্রিন থেকে এক ট্যাপে TypeBari খুলুন।", true, function () {
        deferred.prompt();
        deferred = null;
      });
    }, 2500);
  });
  window.addEventListener("appinstalled", function () {
    var b = document.getElementById("pwa-banner");
    if (b) b.remove();
  });
  

  // আইফোন / আইপ্যাড: ইনস্টল বাটন নেই, নিয়ম দেখাতে হয়
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS) {
    setTimeout(function () {
      show("Share বাটনে চেপে \"Add to Home Screen\" বেছে নিন।", false, null);
    }, 3000);
  }
})();
