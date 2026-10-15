// পাসওয়ার্ড রিসেট: forgot-password.html ও reset-password.html এর জন্য
// (auth.js আগে লোড হতে হবে)

async function handleForgotPassword(event) {
  event.preventDefault();
  const email = document.getElementById("email").value.trim();
  if (!email) return showMessage("ইমেইল লিখুন।", "error");

  // বর্তমান ফোল্ডারের reset-password.html (GitHub Pages সাবফোল্ডারেও কাজ করবে)
  const redirectTo = new URL("reset-password.html", window.location.href).href;

  setLoading(true, "অপেক্ষা করুন...");
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
  setLoading(false, "রিসেট লিংক পাঠান");

  if (error) return showMessage(friendlyError(error), "error");
  showMessage("যদি এই ইমেইলে অ্যাকাউন্ট থাকে, রিসেট লিংক পাঠানো হয়েছে। ইনবক্স ও স্প্যাম ফোল্ডার দেখুন।", "success");
}

async function handleResetPassword(event) {
  event.preventDefault();
  const password = document.getElementById("password").value;
  const confirm = document.getElementById("confirm-password").value;

  if (password.length < 6) return showMessage("পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।", "error");
  if (password !== confirm) return showMessage("দুটি পাসওয়ার্ড মিলছে না।", "error");

  setLoading(true, "অপেক্ষা করুন...");
  const { error } = await sb.auth.updateUser({ password: password });
  setLoading(false, "পাসওয়ার্ড পরিবর্তন করুন");

  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("different")) return showMessage("নতুন পাসওয়ার্ড আগের পাসওয়ার্ডের চেয়ে আলাদা হতে হবে।", "error");
    return showMessage(friendlyError(error), "error");
  }

  showMessage("পাসওয়ার্ড পরিবর্তন হয়েছে। ড্যাশবোর্ডে নিয়ে যাওয়া হচ্ছে...", "success");
  setTimeout(function () { window.location.href = "dashboard.html"; }, 1500);
}

document.addEventListener("DOMContentLoaded", async function () {
  const forgotForm = document.getElementById("forgot-form");
  const resetForm = document.getElementById("reset-form");
  if (!forgotForm && !resetForm) return;

  if (!isConfigured()) {
    showMessage("js/config.js ফাইলে Supabase URL ও anon key বসানো হয়নি।", "error");
    return;
  }

  if (forgotForm) {
    forgotForm.addEventListener("submit", handleForgotPassword);
    return;
  }

  // reset-password.html: ইমেইলের লিংক থেকে এলে রিকভারি সেশন তৈরি হয়
  resetForm.addEventListener("submit", handleResetPassword);
  let shown = false;
  function showForm() {
    if (shown) return;
    shown = true;
    resetForm.style.display = "block";
  }

  sb.auth.onAuthStateChange(function (event) {
    if (event === "PASSWORD_RECOVERY") showForm();
  });

  setTimeout(async function () {
    if (shown) return;
    const { data } = await sb.auth.getSession();
    if (data.session) {
      showForm();
    } else {
      showMessage("লিংকটি ভুল বা মেয়াদোত্তীর্ণ। আবার রিসেট লিংক চেয়ে নিন।", "error");
    }
  }, 2000);
});
