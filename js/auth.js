// ---------- সাহায্যকারী ফাংশন ----------
function showMessage(text, type) {
  const box = document.getElementById("message");
  if (!box) return;
  box.textContent = text;
  box.className = "message " + type;
}

function setLoading(isLoading, label) {
  const btn = document.getElementById("submit-btn");
  if (!btn) return;
  btn.disabled = isLoading;
  if (label) btn.textContent = label;
}

function friendlyError(error) {
  const msg = (error && error.message ? error.message : "").toLowerCase();
  if (msg.includes("invalid login credentials")) return "ইমেইল বা পাসওয়ার্ড ভুল হয়েছে।";
  if (msg.includes("already registered") || msg.includes("already been registered")) return "এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে। লগইন করুন।";
  if (msg.includes("password") && msg.includes("6")) return "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।";
  if (msg.includes("valid email") || msg.includes("invalid email")) return "সঠিক ইমেইল ঠিকানা দিন।";
  if (msg.includes("rate limit") || msg.includes("too many")) return "অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।";
  if (msg.includes("failed to fetch") || msg.includes("network")) return "ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।";
  return "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।";
}

function isConfigured() {
  const c = window.TYPEBARI_CONFIG;
  return c && c.SUPABASE_URL && !c.SUPABASE_URL.startsWith("YOUR_") &&
         c.SUPABASE_ANON_KEY && !c.SUPABASE_ANON_KEY.startsWith("YOUR_");
}

// ---------- রেজিস্ট্রেশন ----------
async function handleRegister(event) {
  event.preventDefault();
  const fullName = document.getElementById("full-name").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const confirm = document.getElementById("confirm-password").value;

  if (!fullName) return showMessage("পূর্ণ নাম লিখুন।", "error");
  if (!email) return showMessage("ইমেইল লিখুন।", "error");
  if (password.length < 6) return showMessage("পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।", "error");
  if (password !== confirm) return showMessage("দুটি পাসওয়ার্ড মিলছে না।", "error");

  setLoading(true, "অপেক্ষা করুন...");
  const { data, error } = await sb.auth.signUp({
    email: email,
    password: password,
    options: { data: { full_name: fullName } }
  });
  setLoading(false, "রেজিস্ট্রেশন করুন");

  if (error) return showMessage(friendlyError(error), "error");

  if (data.session) {
    window.location.href = "dashboard.html";
  } else {
    showMessage("অ্যাকাউন্ট তৈরি হয়েছে। এখন লগইন করুন।", "success");
  }
}

// ---------- লগইন ----------
async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email || !password) return showMessage("ইমেইল ও পাসওয়ার্ড দিন।", "error");

  setLoading(true, "অপেক্ষা করুন...");
  const { error } = await sb.auth.signInWithPassword({ email: email, password: password });
  setLoading(false, "লগইন করুন");

  if (error) return showMessage(friendlyError(error), "error");
  window.location.href = "dashboard.html";
}

// ---------- লগআউট ----------
async function handleLogout() {
  await sb.auth.signOut();
  window.location.href = "login.html";
}

// ---------- সুরক্ষিত পেজের জন্য ----------
async function requireAuth() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.href = "login.html";
    return null;
  }
  return data.session;
}

// ---------- পেজ চালু হলে ----------
document.addEventListener("DOMContentLoaded", async function () {
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  if (!loginForm && !registerForm) return;

  if (!isConfigured()) {
    showMessage("js/config.js ফাইলে Supabase URL ও anon key বসানো হয়নি।", "error");
    return;
  }

  // আগে থেকে লগইন থাকলে সরাসরি ড্যাশবোর্ডে
  const { data } = await sb.auth.getSession();
  if (data.session) {
    window.location.href = "dashboard.html";
    return;
  }

  if (loginForm) loginForm.addEventListener("submit", handleLogin);
  if (registerForm) registerForm.addEventListener("submit", handleRegister);
});
