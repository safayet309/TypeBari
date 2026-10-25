// TypeBari — হিরোর দৃশ্য স্ক্রিনের বাইরে গেলে অ্যানিমেশন থামায় (ব্যাটারি বাঁচাতে)
(function () {
  var scene = document.querySelector(".hero-scene");
  if (!scene || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(function (entries) {
    scene.classList.toggle("is-paused", !entries[0].isIntersecting);
  }).observe(scene);
})();
