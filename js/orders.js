// কাস্টমারের অর্ডার সংক্রান্ত কোড (auth.js ও supabase-client.js আগে লোড হতে হবে)

function isValidDriveLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "drive.google.com" || url.hostname === "docs.google.com");
  } catch (e) {
    return false;
  }
}

async function handleNewOrder(event, session) {
  event.preventDefault();
  const title = document.getElementById("title").value.trim();
  const instructions = document.getElementById("instructions").value.trim();
  const driveLink = document.getElementById("drive-link").value.trim();

  if (title.length < 3) return showMessage("অর্ডারের শিরোনাম লিখুন (কমপক্ষে ৩ অক্ষর)।", "error");
  if (instructions.length < 10) return showMessage("টাইপিংয়ের নির্দেশনা একটু বিস্তারিত লিখুন।", "error");
  if (!driveLink) {
    return showMessage("ছবি বা ফাইলের Google Drive লিংক দিন।", "error");
  }
  if (!isValidDriveLink(driveLink)) {
    return showMessage("Google Drive লিংকটি সঠিক নয়। drive.google.com বা docs.google.com থেকে লিংক দিন।", "error");
  }

  const order = {
    customer_id: session.user.id,
    title: title,
    instructions: instructions,
    status: "pending"
  };
  if (driveLink) {
    order.source_type = "drive_link";
    order.source_drive_link = driveLink;
  }

  setLoading(true, "জমা হচ্ছে...");
  const { data, error } = await sb.from("orders").insert(order).select("id").single();
  setLoading(false, "অর্ডার জমা দিন");

  if (error) {
    console.error(error);
    return showMessage("অর্ডার জমা হয়নি। আবার চেষ্টা করুন। (" + error.message + ")", "error");
  }

  document.getElementById("order-form").reset();
  showMessage("অর্ডার জমা হয়েছে। অর্ডার নম্বর: " + data.id.slice(0, 8).toUpperCase(), "success");
}

// ---------- সাবস্ক্রিপশন সাহায্যকারী ----------
// একাধিক ইউজারের সক্রিয় সাবস্ক্রিপশন একসাথে আনে।
// রিটার্ন: { user_id: { plan_name, amount, pages_per_day, started_at, expires_at } }
async function fetchActiveSubscriptions(userIds) {
  const result = {};
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!ids.length) return result;

  const nowIso = new Date().toISOString();
  const [subsRes, plansRes] = await Promise.all([
    sb.from("subscriptions")
      .select("user_id,plan_key,amount,started_at,expires_at")
      .in("user_id", ids)
      .eq("status", "active")
      .gt("expires_at", nowIso)
      .order("expires_at", { ascending: false }),
    sb.from("subscription_plans").select("plan_key,name,pages_per_day")
  ]);

  if (subsRes.error) { console.error(subsRes.error); return result; }

  const plans = {};
  (plansRes.data || []).forEach(function (p) { plans[p.plan_key] = p; });

  (subsRes.data || []).forEach(function (sub) {
    if (result[sub.user_id]) return; // সবচেয়ে দেরিতে শেষ হওয়াটা নেওয়া হবে
    const plan = plans[sub.plan_key] || {};
    result[sub.user_id] = {
      plan_name: plan.name || sub.plan_key,
      amount: sub.amount,
      pages_per_day: plan.pages_per_day,
      started_at: sub.started_at,
      expires_at: sub.expires_at
    };
  });
  return result;
}

function daysLeft(expiresAt) {
  return Math.max(0, Math.ceil((new Date(expiresAt) - new Date()) / 86400000));
}

// কাস্টমার ড্যাশবোর্ডের সাবস্ক্রিপশন কার্ড
async function loadSubscriptionBox(userId) {
  const box = document.getElementById("sub-box");
  if (!box) return;
  box.textContent = "";

  const card = makeEl("div", "detail-card");
  box.appendChild(card);

  // ১) ইউজারের সব সাবস্ক্রিপশন আনা
  const { data, error } = await sb
    .from("subscriptions")
    .select("plan_key,amount,status,started_at,expires_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Subscription load error:", error);
    card.appendChild(makeEl("p", "", "সাবস্ক্রিপশনের তথ্য লোড করা যায়নি: " + error.message));
    return;
  }

  const rows = data || [];
  console.log("SUB ROWS:", rows);

  // ২) সক্রিয় সাবস্ক্রিপশন বের করা: status = active এবং মেয়াদ শেষ হয়নি
  const now = new Date();
  const activeRows = rows
    .filter(function (r) {
      return r.status === "active" && r.expires_at && new Date(r.expires_at) > now;
    })
    .sort(function (a, b) { return new Date(b.expires_at) - new Date(a.expires_at); });
  const sub = activeRows[0];

  // ৩) সক্রিয় থাকলে প্রিমিয়াম কার্ড
  if (sub) {
    let planName = sub.plan_key;
    let pagesPerDay = null;
    const planRes = await sb
      .from("subscription_plans")
      .select("name,pages_per_day")
      .eq("plan_key", sub.plan_key)
      .maybeSingle();
    if (planRes.data) {
      planName = planRes.data.name;
      pagesPerDay = planRes.data.pages_per_day;
    }

    const left = daysLeft(sub.expires_at);
    const used = Math.min(30, Math.max(0, 30 - left));

    card.style.border = "2px solid #176b4d";
    card.style.background = "#f2fbf5";

    const badge = makeEl("span", "", "⭐ প্রিমিয়াম সাবস্ক্রাইবার");
    badge.style.cssText =
      "display:inline-block;padding:4px 14px;border-radius:99px;background:#176b4d;color:#fff;font-size:14px;font-weight:bold;margin-bottom:8px";
    card.appendChild(badge);

    card.appendChild(makeEl("h2", "", "প্রিমিয়াম সাবস্ক্রিপশন সক্রিয় ✅"));
    card.appendChild(makeEl("p", "", planName + " — " + formatPrice(sub.amount) + " / ৩০ দিন"));

    if (pagesPerDay) {
      card.appendChild(makeEl("p", "hint",
        "প্রতিদিন সর্বোচ্চ " + Number(pagesPerDay).toLocaleString("bn-BD") + " পেইজ টাইপিং"));
    }

    const leftText = makeEl("p", "", "⏳ আর " + left.toLocaleString("bn-BD") + " দিন বাকি");
    leftText.style.cssText = "font-weight:bold;color:#176b4d;margin:10px 0 6px";
    card.appendChild(leftText);

    // মেয়াদের প্রগ্রেস বার
    const bar = makeEl("div", "");
    bar.style.cssText = "height:10px;background:#d9eadf;border-radius:99px;overflow:hidden";
    const fill = makeEl("div", "");
    fill.style.cssText = "height:100%;background:#176b4d;width:" + Math.round((used / 30) * 100) + "%";
    bar.appendChild(fill);
    card.appendChild(bar);

    card.appendChild(makeEl("p", "hint",
      "শুরু: " + formatDate(sub.started_at) + " • মেয়াদ শেষ: " + formatDate(sub.expires_at)));

    // নামের পাশেও ছোট ব্যাজ
    const welcome = document.getElementById("welcome");
    if (welcome && !welcome.querySelector(".prem-tag")) {
      const tag = makeEl("span", "prem-tag", " ⭐ প্রিমিয়াম");
      tag.style.cssText = "font-size:14px;color:#176b4d;margin-left:8px";
      welcome.appendChild(tag);
    }
    return;
  }

  // ৪) সক্রিয় নেই: অন্য অবস্থাগুলো দেখানো
  const hasPending = rows.some(function (r) { return r.status === "payment_submitted"; });
  const hadBefore = rows.some(function (r) { return r.status === "active" || r.status === "expired"; });

  if (hasPending) {
    card.appendChild(makeEl("h2", "", "সাবস্ক্রিপশন: পেমেন্ট যাচাই চলছে ⏳"));
    card.appendChild(makeEl("p", "hint", "অ্যাডমিন কনফার্ম করলে ৩০ দিনের প্রিমিয়াম সাবস্ক্রিপশন চালু হবে।"));
  } else {
    card.appendChild(makeEl("h2", "",
      hadBefore ? "আপনার সাবস্ক্রিপশনের মেয়াদ শেষ হয়েছে" : "আপনার কোনো সক্রিয় সাবস্ক্রিপশন নেই"));
    const a = makeEl("a", "btn-link", hadBefore ? "আবার সাবস্ক্রিপশন নিন" : "সাবস্ক্রিপশন নিন");
    a.href = "subscription.html";
    card.appendChild(a);
  }
}
// ---------- অর্ডার তালিকা ও বিস্তারিত ----------
const STATUS_LABELS = {
  pending: "অপেক্ষমাণ",
  accepted: "গৃহীত",
  in_progress: "চলমান",
  review: "পর্যালোচনা",
  completed: "সম্পন্ন",
  cancelled: "বাতিল",
  revision: "সংশোধন চলছে"
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("bn-BD", { year: "numeric", month: "long", day: "numeric" });
}

function formatPrice(price) {
  if (price === null || price === undefined) return "নির্ধারণ হয়নি";
  return "৳ " + Number(price).toLocaleString("bn-BD");
}

function shortId(id) {
  return id.slice(0, 8).toUpperCase();
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function statusBadge(status) {
  return makeEl("span", "badge badge-" + status, statusLabel(status));
}

async function loadMyOrders() {
  const list = document.getElementById("orders-list");
  const state = document.getElementById("orders-state");

  const { data, error } = await sb
    .from("orders")
    .select("id,title,status,price,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    state.textContent = "অর্ডারের তালিকা লোড করা যায়নি। পেজ রিফ্রেশ করুন।";
    return;
  }

  if (!data.length) {
    state.textContent = "আপনি এখনো কোনো অর্ডার দেননি।";
    const link = makeEl("a", "btn-link", "প্রথম অর্ডার দিন");
    link.href = "new-order.html";
    state.appendChild(document.createElement("br"));
    state.appendChild(link);
    return;
  }

  state.style.display = "none";
  data.forEach(function (o) {
    const card = makeEl("article", "order-card");

    const top = makeEl("div", "order-top");
    top.appendChild(makeEl("h3", "order-title", o.title));
    top.appendChild(statusBadge(o.status));
    card.appendChild(top);

    const meta = makeEl("p", "order-meta",
      "অর্ডার নম্বর: " + shortId(o.id) + " • তারিখ: " + formatDate(o.created_at) + " • দাম: " + formatPrice(o.price));
    card.appendChild(meta);

    const btn = makeEl("a", "btn-link", "বিস্তারিত দেখুন");
    btn.href = "order-details.html?id=" + encodeURIComponent(o.id);
    card.appendChild(btn);

    list.appendChild(card);
  });
}

async function loadOrderDetails() {
  const box = document.getElementById("details");
  const state = document.getElementById("details-state");
  const id = new URLSearchParams(window.location.search).get("id");

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !uuidPattern.test(id)) {
    state.textContent = "অর্ডারটি পাওয়া যায়নি।";
    return;
  }

  // RLS এর কারণে শুধু নিজের অর্ডারই পাওয়া যাবে
  const { data: o, error } = await sb
    .from("orders")
    .select("id,title,instructions,source_drive_link,price,status,admin_notes,result_docx_link,result_pdf_link,created_at,completed_at,revision_count,revision_note")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(error);
    state.textContent = "অর্ডার লোড করা যায়নি। পেজ রিফ্রেশ করুন।";
    return;
  }
  if (!o) {
    state.textContent = "অর্ডারটি পাওয়া যায়নি।";
    return;
  }

  state.style.display = "none";

  const top = makeEl("div", "order-top");
  top.appendChild(makeEl("h1", "order-title", o.title));
  top.appendChild(statusBadge(o.status));
  box.appendChild(top);

  box.appendChild(makeEl("p", "order-meta",
    "অর্ডার নম্বর: " + shortId(o.id) + " • তারিখ: " + formatDate(o.created_at)));

  function section(heading, node) {
    box.appendChild(makeEl("h3", "detail-heading", heading));
    box.appendChild(node);
  }

  section("দাম", makeEl("p", "", formatPrice(o.price)));
  section("আপনার নির্দেশনা", makeEl("p", "pre", o.instructions || "—"));

  if (o.source_drive_link && isValidDriveLink(o.source_drive_link)) {
    const a = makeEl("a", "btn-link", "Google Drive ফাইল খুলুন");
    a.href = o.source_drive_link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    section("সোর্স ফাইল", a);
  }

  if (o.admin_notes) {
    section("আমাদের বার্তা", makeEl("p", "pre", o.admin_notes));
  }

  if (o.status === "completed") {
    const files = makeEl("div", "");
    let any = false;
    [["DOCX ডাউনলোড", o.result_docx_link], ["PDF ডাউনলোড", o.result_pdf_link]].forEach(function (item) {
      if (item[1] && isValidDriveLink(item[1])) {
        const a = makeEl("a", "btn-link", item[0]);
        a.href = item[1];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.style.marginRight = "10px";
        files.appendChild(a);
        any = true;
      }
    });
    if (!any) files.appendChild(makeEl("p", "", "ফাইল শীঘ্রই যুক্ত করা হবে।"));
    section("সম্পন্ন ফাইল", files);
  }

  if (o.status === "revision" && o.revision_note) {
    section("আপনার সংশোধনের অনুরোধ", makeEl("p", "pre", o.revision_note));
  }
  renderOrderActions(box, o);
}

// ---------- বাতিল ও সংশোধন ----------
function showActionMessage(text, isError) {
  const m = document.getElementById("order-action-msg");
  if (!m) return;
  m.textContent = text;
  m.className = "message " + (isError ? "error" : "success");
}

function friendlyActionError(error) {
  const m = ((error && error.message) || "").toLowerCase();
  if (m.includes("7 days")) return "সংশোধন চাওয়ার ৭ দিনের সময় শেষ হয়ে গেছে।";
  if (m.includes("maximum 2")) return "সংশোধনের সীমা (২ বার) শেষ হয়েছে।";
  if (m.includes("note must be")) return "সংশোধনের বিবরণ ৫ থেকে ১০০০ অক্ষরের মধ্যে লিখুন।";
  if (m.includes("cannot be cancelled")) return "এই অর্ডার আর বাতিল করা যাবে না। পেজ রিফ্রেশ করে দেখুন।";
  if (m.includes("only completed")) return "শুধু সম্পন্ন অর্ডারে সংশোধন চাওয়া যায়।";
  return "কাজটি করা যায়নি। পেজ রিফ্রেশ করে আবার চেষ্টা করুন।";
}

async function cancelMyOrder(orderId, btn) {
  if (!confirm("অর্ডারটি বাতিল করবেন? এটি আর ফেরত আনা যাবে না।")) return;
  btn.disabled = true;
  const { error } = await sb.rpc("customer_cancel_order", { p_order_id: orderId });
  if (error) {
    console.error(error);
    btn.disabled = false;
    showActionMessage(friendlyActionError(error), true);
    return;
  }
  window.location.reload();
}

async function requestRevision(orderId, btn) {
  const note = document.getElementById("rev-note").value.trim();
  if (note.length < 5) {
    showActionMessage("কী সংশোধন করতে হবে তা অন্তত ৫ অক্ষরে লিখুন।", true);
    return;
  }
  btn.disabled = true;
  const { error } = await sb.rpc("customer_request_revision", { p_order_id: orderId, p_note: note });
  if (error) {
    console.error(error);
    btn.disabled = false;
    showActionMessage(friendlyActionError(error), true);
    return;
  }
  window.location.reload();
}

function renderOrderActions(box, o) {
  const MAX_REVISIONS = 2;
  const REVISION_DAYS = 7;
  const msg = makeEl("div", "message");
  msg.id = "order-action-msg";
  msg.setAttribute("role", "alert");

  if (o.status === "pending") {
    box.appendChild(makeEl("h3", "detail-heading", "অর্ডার বাতিল"));
    box.appendChild(makeEl("p", "hint", "কাজ শুরুর আগে আপনি অর্ডারটি বাতিল করতে পারবেন।"));
    const cancelBtn = makeEl("button", "button danger", "অর্ডার বাতিল করুন");
    cancelBtn.type = "button";
    cancelBtn.style.marginTop = "12px";
    cancelBtn.addEventListener("click", function () { cancelMyOrder(o.id, cancelBtn); });
    box.appendChild(cancelBtn);
    box.appendChild(msg);
    return;
  }

  if (o.status === "completed") {
    const used = o.revision_count || 0;
    const deadline = o.completed_at
      ? new Date(o.completed_at).getTime() + REVISION_DAYS * 24 * 60 * 60 * 1000
      : 0;
    box.appendChild(makeEl("h3", "detail-heading", "সংশোধন"));

    if (used >= MAX_REVISIONS) {
      box.appendChild(makeEl("p", "hint", "সংশোধনের সীমা (সর্বোচ্চ ২ বার) শেষ হয়েছে।"));
      return;
    }
    if (Date.now() > deadline) {
      box.appendChild(makeEl("p", "hint", "সংশোধন চাওয়ার সময় (সম্পন্নের ৭ দিন) শেষ হয়েছে।"));
      return;
    }

    box.appendChild(makeEl("p", "hint",
      "কাজে ভুল থাকলে সম্পন্নের ৭ দিনের মধ্যে সর্বোচ্চ ২ বার সংশোধন চাইতে পারবেন। এ পর্যন্ত চেয়েছেন: " +
      used.toLocaleString("bn-BD") + " বার।"));

    const label = makeEl("label", "", "কী সংশোধন করতে হবে লিখুন");
    label.setAttribute("for", "rev-note");
    const ta = document.createElement("textarea");
    ta.id = "rev-note";
    ta.maxLength = 1000;
    ta.placeholder = "যেমন: ৩ নম্বর পেইজের টেবিলের শেষ সারি বাদ পড়েছে।";
    const btn = makeEl("button", "button", "সংশোধন চাই");
    btn.type = "button";
    btn.style.marginTop = "12px";
    btn.addEventListener("click", function () { requestRevision(o.id, btn); });

    box.appendChild(label);
    box.appendChild(ta);
    box.appendChild(btn);
    box.appendChild(msg);
  }
}

// ---------- কাস্টমার ড্যাশবোর্ড ----------
async function loadCustomerDashboard() {
  const statsBox = document.getElementById("stats");
  const state = document.getElementById("recent-state");
  const list = document.getElementById("recent-list");

  const { data, error } = await sb
    .from("orders")
    .select("id,title,status,price,created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error(error);
    state.textContent = "অর্ডার লোড করা যায়নি। পেজ রিফ্রেশ করুন।";
    return;
  }

  function count(statuses) {
    return data.filter(function (o) { return statuses.indexOf(o.status) !== -1; }).length;
  }
  const stats = [
    ["মোট অর্ডার", data.length],
    ["অপেক্ষমাণ", count(["pending"])],
    ["চলমান", count(["accepted", "in_progress", "review", "revision"])],
    ["সম্পন্ন", count(["completed"])]
  ];
  statsBox.textContent = "";
  stats.forEach(function (s) {
    const box = makeEl("div", "stat");
    box.appendChild(makeEl("div", "stat-num", String(s[1])));
    box.appendChild(makeEl("div", "stat-label", s[0]));
    statsBox.appendChild(box);
  });

  if (!data.length) {
    state.textContent = "আপনি এখনো কোনো অর্ডার দেননি।";
    return;
  }

  state.style.display = "none";
  data.slice(0, 5).forEach(function (o) {
    const card = makeEl("article", "order-card");
    const top = makeEl("div", "order-top");
    top.appendChild(makeEl("h3", "order-title", o.title));
    top.appendChild(statusBadge(o.status));
    card.appendChild(top);
    card.appendChild(makeEl("p", "order-meta",
      "অর্ডার নম্বর: " + shortId(o.id) + " • তারিখ: " + formatDate(o.created_at) + " • দাম: " + formatPrice(o.price)));
    const btn = makeEl("a", "btn-link", "বিস্তারিত দেখুন");
    btn.href = "order-details.html?id=" + encodeURIComponent(o.id);
    card.appendChild(btn);
    list.appendChild(card);
  });
}
