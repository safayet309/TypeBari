(function () {
  var cfg = window.TYPEBARI_LINKS || {};

  function isPlaceholder(v) {
    return !v || /XXXX|YOUR_|VIDEO_ID/.test(v);
  }

  function youtubeId(url) {
    var m = String(url).match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function waNumber(raw) {
    var d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("880") === 0) return d;
    if (d.indexOf("0") === 0) return "880" + d.slice(1);
    return d;
  }

  // ---------- ভিডিও ----------
  var grid = document.getElementById("video-grid");
  var section = document.getElementById("tutorials");
  var videos = (cfg.videos || []).filter(function (v) { return v && !isPlaceholder(v.url); });
  if (grid && section && videos.length) {
    videos.forEach(function (v, i) {
      var a = document.createElement("a");
      a.className = "video-card";
      a.href = v.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";

      var thumb = document.createElement("div");
      thumb.className = "video-thumb";
      var id = youtubeId(v.url);
      if (id) thumb.style.backgroundImage = "url(https://i.ytimg.com/vi/" + id + "/hqdefault.jpg)";
      thumb.innerHTML =
        '<span class="video-num">ভিডিও ' + (i + 1) + '</span>' +
        '<span class="video-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>';

      var body = document.createElement("div");
      body.className = "video-body";
      var h = document.createElement("h3");
      h.textContent = v.title || "ভিডিও টিউটোরিয়াল";
      var p = document.createElement("p");
      p.textContent = v.desc || "";
      var w = document.createElement("span");
      w.className = "video-watch";
      w.textContent = "YouTube-এ দেখুন →";
      body.appendChild(h);
      if (v.desc) body.appendChild(p);
      body.appendChild(w);

      a.appendChild(thumb);
      a.appendChild(body);
      grid.appendChild(a);
    });
    section.hidden = false;
  }

  // ---------- WhatsApp ----------
  var waUrl = null;
  if (!isPlaceholder(cfg.whatsapp)) {
    waUrl = "https://wa.me/" + waNumber(cfg.whatsapp);
    if (cfg.whatsappMessage) waUrl += "?text=" + encodeURIComponent(cfg.whatsappMessage);
    var waCard = document.getElementById("contact-wa");
    waCard.href = waUrl;
    waCard.hidden = false;
    document.getElementById("contact-wa-number").textContent = cfg.whatsapp;
    var fl = document.getElementById("wa-float");
    fl.href = waUrl;
    fl.hidden = false;
  }

  // ---------- Facebook ----------
  var fbOk = !isPlaceholder(cfg.facebook);
  if (fbOk) {
    var fb = document.getElementById("contact-fb");
    fb.href = cfg.facebook;
    fb.hidden = false;
  }

  if (!waUrl && !fbOk) {
    var cs = document.getElementById("contact");
    if (cs) cs.hidden = true;
  }

  // ---------- ফুটার ----------
  var fl2 = document.getElementById("footer-links");
  if (fl2 && (waUrl || fbOk)) {
    if (fbOk) fl2.insertAdjacentHTML("beforeend", '<a href="' + cfg.facebook + '" target="_blank" rel="noopener noreferrer">Facebook</a>');
    if (waUrl) fl2.insertAdjacentHTML("beforeend", '<a href="' + waUrl + '" target="_blank" rel="noopener noreferrer">WhatsApp</a>');
    if (videos.length) fl2.insertAdjacentHTML("beforeend", '<a href="#tutorials">ভিডিও গাইড</a>');
    fl2.hidden = false;
  }
})();
