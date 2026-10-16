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

  const subs = await fetchActiveSubscriptions([userId]);
  const sub = subs[userId];
  const card = makeEl("div", "detail-card");

  if (sub) {
    card.appendChild(makeEl("h2", "", "আপনার সাবস্ক্রিপশন: সক্রিয় ✅"));
    card.appendChild(makeEl("p", "", sub.plan_name + " — " + formatPrice(sub.amount) + " / ৩০ দিন"));
    if (sub.pages_per_day) {
      card.appendChild(makeEl("p", "hint",
        "প্রতিদিন সর্বোচ্চ " + Number(sub.pages_per_day).toLocaleString("bn-BD") + " পেইজ টাইপিং"));
    }
    card.appendChild(makeEl("p", "hint",
      "মেয়াদ শেষ: " + formatDate(sub.expires_at) +
      " (আর " + daysLeft(sub.expires_at).toLocaleString("bn-BD") + " দিন বাকি)"));
  } else {
    const { data: pending } = await sb.from("subscriptions")
      .select("id").eq("user_id", userId).eq("status", "payment_submitted").limit(1);

    if (pending && pending.length) {
      card.appendChild(makeEl("h2", "", "সাবস্ক্রিপশন: পেমেন্ট যাচাই চলছে ⏳"));
      card.appendChild(makeEl("p", "hint", "অ্যাডমিন কনফার্ম করলে ৩০ দিনের সাবস্ক্রিপশন চালু হবে।"));
    } else {
      card.appendChild(makeEl("h2", "", "আপনার কোনো সক্রিয় সাবস্ক্রিপশন নেই"));
      const a = makeEl("a", "btn-link", "সাবস্ক্রিপশন নিন");
      a.href = "subscription.html";
      card.appendChild(a);
    }
  }
  box.appendChild(card);
}

// ---------- অর্ডার তালিকা ও বিস্তারিত ----------
const STATUS_LABELS = {
  pending: "অপেক্ষমাণ",
  accepted: "গৃহীত",
  in_progress: "চলমান",
  review: "পর্যালোচনা",
  completed: "সম্পন্ন",
  cancelled: "বাতিল"
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
    .select("id,title,instructions,source_drive_link,price,status,admin_notes,result_docx_link,result_pdf_link,created_at")
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
    ["চলমান", count(["accepted", "in_progress", "review"])],
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
