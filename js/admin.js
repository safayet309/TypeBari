// অ্যাডমিন প্যানেলের কোড (auth.js, orders.js আগে লোড হতে হবে)
// গুরুত্বপূর্ণ: এখানকার Admin যাচাই শুধু পেজ দেখানোর জন্য।
// আসল নিরাপত্তা Supabase-এর RLS ও টেবিল-অনুমতি থেকে আসে।

async function requireAdmin() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.href = "../login.html";
    return null;
  }
  const { data: profile } = await sb
    .from("profiles")
    .select("role")
    .eq("id", data.session.user.id)
    .maybeSingle();

  if (!profile || profile.role !== "admin") {
    window.location.href = "../dashboard.html";
    return null;
  }
  return data.session;
}

async function handleAdminLogout() {
  await sb.auth.signOut();
  window.location.href = "../login.html";
}

async function fetchCustomerNames(orders) {
  const ids = Array.from(new Set(orders.map(function (o) { return o.customer_id; })));
  const names = {};
  if (!ids.length) return names;
  const { data } = await sb.from("profiles").select("id,full_name").in("id", ids);
  (data || []).forEach(function (p) { names[p.id] = p.full_name || "নাম নেই"; });
  return names;
}

function renderAdminOrderCard(o, names) {
  const card = makeEl("article", "order-card");

  const top = makeEl("div", "order-top");
  top.appendChild(makeEl("h3", "order-title", o.title));
  top.appendChild(statusBadge(o.status));
  card.appendChild(top);

  card.appendChild(makeEl("p", "order-meta",
    "কাস্টমার: " + (names[o.customer_id] || "—") +
    " • নম্বর: " + shortId(o.id) +
    " • তারিখ: " + formatDate(o.created_at) +
    " • দাম: " + formatPrice(o.price)));

  const link = makeEl("a", "btn-link", "পরিচালনা করুন");
  link.href = "orders.html?id=" + encodeURIComponent(o.id);
  card.appendChild(link);
  return card;
}

async function countOrders(statuses) {
  let q = sb.from("orders").select("id", { count: "exact", head: true });
  if (statuses) q = q.in("status", statuses);
  const { count, error } = await q;
  return error ? "—" : count;
}

// ---------- Admin Dashboard ----------
async function loadAdminDashboard() {
  const results = await Promise.all([
    countOrders(null),
    countOrders(["pending"]),
    countOrders(["accepted", "in_progress", "review"]),
    countOrders(["completed"]),
    sb.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer")
  ]);

  const customerCount = results[4].error ? "—" : results[4].count;
  const stats = [
    ["মোট অর্ডার", results[0]],
    ["নতুন অর্ডার", results[1]],
    ["চলমান অর্ডার", results[2]],
    ["সম্পন্ন অর্ডার", results[3]],
    ["মোট কাস্টমার", customerCount]
  ];

  const grid = document.getElementById("stats");
  stats.forEach(function (s) {
    const box = makeEl("div", "stat");
    box.appendChild(makeEl("div", "stat-num", String(s[1])));
    box.appendChild(makeEl("div", "stat-label", s[0]));
    grid.appendChild(box);
  });

  const state = document.getElementById("recent-state");
  const list = document.getElementById("recent-list");
  const { data, error } = await sb
    .from("orders")
    .select("id,customer_id,title,status,price,created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error(error);
    state.textContent = "অর্ডার লোড করা যায়নি।";
    return;
  }
  if (!data.length) {
    state.textContent = "এখনো কোনো অর্ডার আসেনি।";
    return;
  }
  state.style.display = "none";
  const names = await fetchCustomerNames(data);
  data.forEach(function (o) { list.appendChild(renderAdminOrderCard(o, names)); });
}

// ---------- সব অর্ডারের তালিকা ----------
async function loadAdminOrderList() {
  const state = document.getElementById("list-state");
  const list = document.getElementById("order-list");
  const filter = document.getElementById("status-filter").value;

  list.textContent = "";
  state.style.display = "block";
  state.textContent = "লোড হচ্ছে...";

  let q = sb
    .from("orders")
    .select("id,customer_id,title,status,price,created_at")
    .order("created_at", { ascending: false });
  if (filter) q = q.eq("status", filter);

  const { data, error } = await q;
  if (error) {
    console.error(error);
    state.textContent = "অর্ডার লোড করা যায়নি।";
    return;
  }
  if (!data.length) {
    state.textContent = "কোনো অর্ডার পাওয়া যায়নি।";
    return;
  }
  state.style.display = "none";
  const names = await fetchCustomerNames(data);
  data.forEach(function (o) { list.appendChild(renderAdminOrderCard(o, names)); });
}

// ---------- একটি অর্ডার পরিচালনা ----------
async function loadAdminOrder(id) {
  const state = document.getElementById("detail-state");
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(id)) {
    state.textContent = "অর্ডারটি পাওয়া যায়নি।";
    return;
  }

  const { data: o, error } = await sb
    .from("orders")
    .select("id,customer_id,title,instructions,source_drive_link,price,status,admin_notes,result_docx_link,result_pdf_link,created_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !o) {
    if (error) console.error(error);
    state.textContent = "অর্ডারটি পাওয়া যায়নি।";
    return;
  }

  const names = await fetchCustomerNames([o]);
  state.style.display = "none";
  document.getElementById("detail-view").style.display = "block";

  document.getElementById("d-title").textContent = o.title;
  const badgeBox = document.getElementById("d-badge");
  badgeBox.textContent = "";
  badgeBox.appendChild(statusBadge(o.status));
  document.getElementById("d-meta").textContent =
    "কাস্টমার: " + (names[o.customer_id] || "—") + " • নম্বর: " + shortId(o.id) + " • তারিখ: " + formatDate(o.created_at);
  document.getElementById("d-instructions").textContent = o.instructions || "—";

  const src = document.getElementById("d-source");
  src.textContent = "";
  if (o.source_drive_link && isValidDriveLink(o.source_drive_link)) {
    const a = makeEl("a", "btn-link", "Google Drive ফাইল খুলুন");
    a.href = o.source_drive_link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    src.appendChild(a);
  } else {
    src.textContent = "কাস্টমার কোনো লিংক দেননি।";
  }

  document.getElementById("f-status").value = o.status;
  document.getElementById("f-price").value = o.price === null ? "" : o.price;
  document.getElementById("f-notes").value = o.admin_notes || "";
  document.getElementById("f-docx").value = o.result_docx_link || "";
  document.getElementById("f-pdf").value = o.result_pdf_link || "";

  document.getElementById("manage-form").addEventListener("submit", function (e) {
    e.preventDefault();
    saveAdminOrder(id, null);
  });
  document.getElementById("accept-btn").addEventListener("click", function () {
    saveAdminOrder(id, "accepted");
  });
}

async function saveAdminOrder(id, forcedStatus) {
  const status = forcedStatus || document.getElementById("f-status").value;
  const priceRaw = document.getElementById("f-price").value.trim();
  const notes = document.getElementById("f-notes").value.trim();

  let price = null;
  if (priceRaw !== "") {
    price = Number(priceRaw);
    if (!isFinite(price) || price < 0) return showMessage("দাম সঠিক সংখ্যায় লিখুন।", "error");
  }
  if (status !== "pending" && status !== "cancelled" && price === null) {
    return showMessage("এই স্ট্যাটাসে যাওয়ার আগে দাম নির্ধারণ করুন।", "error");
  }

  const docx = document.getElementById("f-docx").value.trim();
  const pdf = document.getElementById("f-pdf").value.trim();
  if (docx && !isValidDriveLink(docx)) return showMessage("DOCX লিংকটি সঠিক Google Drive লিংক নয়।", "error");
  if (pdf && !isValidDriveLink(pdf)) return showMessage("PDF লিংকটি সঠিক Google Drive লিংক নয়।", "error");
  if (status === "completed" && !docx && !pdf) {
    return showMessage("সম্পন্ন করার আগে অন্তত একটি DOCX বা PDF লিংক দিন।", "error");
  }

  setLoading(true, "সংরক্ষণ হচ্ছে...");
  const { data, error } = await sb
    .from("orders")
    .update({
      status: status,
      price: price,
      admin_notes: notes || null,
      result_docx_link: docx || null,
      result_pdf_link: pdf || null
    })
    .eq("id", id)
    .select("id,status")
    .maybeSingle();
  setLoading(false, "সংরক্ষণ করুন");

  if (error) {
    console.error(error);
    return showMessage("সংরক্ষণ হয়নি। (" + error.message + ")", "error");
  }
  if (!data) {
    return showMessage("আপডেট হয়নি। Admin অনুমতি আছে কি না দেখুন।", "error");
  }

  document.getElementById("f-status").value = data.status;
  const badgeBox = document.getElementById("d-badge");
  badgeBox.textContent = "";
  badgeBox.appendChild(statusBadge(data.status));
  showMessage("সংরক্ষণ হয়েছে।", "success");
}
