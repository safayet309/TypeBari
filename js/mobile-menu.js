// মোবাইলে হেডারের মেনু — ডেস্কটপের nav-hide লিংকগুলো কপি করে দেখায়
(function () {
  var btn = document.getElementById("menu-toggle");
  var menu = document.getElementById("mobile-menu");
  if (!btn || !menu) return;

  document.querySelectorAll("nav a.nav-hide").forEach(function (a) {
    var c = document.createElement("a");
    c.href = a.getAttribute("href");
    c.textContent = a.textContent.trim();
    menu.appendChild(c);
  });

  if (!menu.children.length) {
    btn.hidden = true;
    return;
  }

  function setOpen(open) {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", open ? "মেনু বন্ধ করুন" : "মেনু খুলুন");
  }
  setOpen(false);

  btn.addEventListener("click", function () {
    setOpen(menu.hidden);
  });

  // মেনুর লিংকে চাপলে বন্ধ হবে
  menu.addEventListener("click", function (e) {
    if (e.target.closest("a")) setOpen(false);
  });

  // বাইরে চাপলে বা Esc দিলে বন্ধ হবে
  document.addEventListener("click", function (e) {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !menu.hidden) {
      setOpen(false);
      btn.focus();
    }
  });

  // স্ক্রিন বড় হলে (ডেস্কটপ) মেনু বন্ধ করে দেওয়া
  window.matchMedia("(min-width: 561px)").addEventListener("change", function (e) {
    if (e.matches) setOpen(false);
  });
})();
