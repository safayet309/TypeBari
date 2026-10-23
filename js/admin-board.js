// TypeBari — অ্যাডমিন অর্ডার বোর্ড (admin/orders.html)
// এক পেজ থেকে সব অর্ডার: স্ট্যাটাস, দাম, বার্তা, কাস্টমারের ফাইল দেখা/মোছা, সম্পন্ন কাজের লিংক।
// আগে লোড হতে হবে: supabase-client.js, auth.js, messages.js, orders.js, admin.js
(function () {
  "use strict";

  const BUCKET = "order-files";
  const EXPIRY_DAYS = 7; // অর্ডার সম্পন্ন হওয়ার কত দিন পর ফাইল মুছবে
  const DAY = 86400000;
  const MB = 1024 * 1024;
  const COLS = "id,customer_id,title,instructions,source_drive_link,price,status,admin_notes," +
    "result_docx_link,result_pdf_link,created_at,completed_at,revision_count,revision_note,contact_phone";

  const STATUSES = [
    ["pending", "অপেক্ষমাণ"], ["accepted", "গৃহীত"], ["in_progress", "চলমান"], ["review", "পর্যালোচনা"],
    ["completed", "সম্পন্ন"], ["revision", "সংশোধন চলছে"], ["cancelled", "বাতিল"]
  ];
  const GROUPS = [
    ["all", "সব", null],
    ["pending", "নতুন", ["pending"]],
    ["active", "চলমান", ["accepted", "in_progress", "review", "revision"]],
    ["completed", "সম্পন্ন", ["completed"]],
    ["cancelled", "বাতিল", ["cancelled"]]
  ];

  const state = {
    orders: [], names: {}, files: new Map(), rows: new Map(),
    group: "all", query: "", openId: null
  };

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("bn-BD", { maximumFractionDigits: 1 });
  const bytesLabel = (n) => n >= MB ? nf.format(n / MB) + " MB" : nf.format(Math.max(1, Math.round(n / 1024))) + " KB";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function flash(box, text, type) {
    box.textContent = text || "";
    box.className = "message" + (text && type ? " " + type : "");
  }
  const filesOf = (id) => state.files.get(id) || [];
  const activeFiles = (id) => filesOf(id).filter((f) => !f.deleted_at);

  // সম্পন্নের তারিখ থেকে ৭ দিন
  function expiryInfo(o) {
    if (o.status !== "completed" || !o.completed_at) return null;
    const end = new Date(new Date(o.completed_at).getTime() + EXPIRY_DAYS * DAY);
    return { end, left: Math.ceil((end.getTime() - Date.now()) / DAY) };
  }

  // ---------- ফাইল মোছা (স্টোরেজ থেকে মুছে, তালিকায় "মুছে ফেলা হয়েছে" চিহ্ন) ----------
  async function purgeFiles(files, reason) {
    for (let i = 0; i < files.length; i += 100) {
      const chunk = files.slice(i, i + 100);
      const paths = chunk.map((f) => f.storage_path);

      const { data, error } = await sb.storage.from(BUCKET).remove(paths);
      if (error) throw error;
      const removed = new Set((data || []).map((x) => x.name));
      // মুছে না যাওয়া ফাইল: আগেই নেই, নাকি অনুমতির কারণে মোছা যায়নি — আলাদা করা
      for (const p of paths.filter((x) => !removed.has(x))) {
        const probe = await sb.storage.from(BUCKET).createSignedUrl(p, 5);
        if (!probe.error) throw new Error("স্টোরেজ থেকে মুছতে অনুমতি নেই। (SQL ধাপ ৪ক-এর ৩ নম্বর অংশ চালানো হয়েছে কি?)");
      }

      const now = new Date().toISOString();
      const upd = await sb.from("order_uploads")
        .update({ deleted_at: now, deleted_reason: reason })
        .in("id", chunk.map((f) => f.id))
        .select("id");
      if (upd.error) throw upd.error;
      if ((upd.data || []).length !== chunk.length) throw new Error("ফাইলের তালিকা হালনাগাদ হয়নি।");
      chunk.forEach((f) => { f.deleted_at = now; f.deleted_reason = reason; });
    }
  }

  // বোর্ড খুললে: সম্পন্নের ৭ দিন পার হওয়া অর্ডারের ফাইল মুছে ফেলা
  async function sweepExpired() {
    const files = [];
    const orderIds = new Set();
    state.orders.forEach((o) => {
      const info = expiryInfo(o);
      if (!info || info.left > 0) return;
      activeFiles(o.id).forEach((f) => { files.push(f); orderIds.add(o.id); });
    });
    if (!files.length) return null;
    try {
      await purgeFiles(files, "expired");
      return { orders: orderIds.size, files: files.length };
    } catch (e) {
      console.error(e);
      return { error: e.message || "অজানা সমস্যা" };
    }
  }

  // ---------- তালিকা: ফিল্টার, খোঁজা, সংখ্যা ----------
  function groupOf(code) { return GROUPS.find((g) => g[0] === code); }

  function matches(o) {
    const g = groupOf(state.group);
    if (g && g[2] && g[2].indexOf(o.status) < 0) return false;
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    const hay = [o.title, state.names[o.customer_id], shortId(o.id), o.contact_phone, o.instructions]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function applyFilter() {
    let shown = 0;
    state.orders.forEach((o) => {
      const row = state.rows.get(o.id);
      const visible = matches(o) || o.id === state.openId; // খোলা অর্ডার কখনো হঠাৎ লুকাবে না
      row.li.hidden = !visible;
      if (visible) shown++;
    });
    const st = $("board-state");
    st.style.display = shown ? "none" : "block";
    if (!shown) st.textContent = state.orders.length ? "এই ফিল্টারে কোনো অর্ডার নেই।" : "এখনো কোনো অর্ডার আসেনি।";
  }

  function paintChips() {
    const box = $("chips");
    box.replaceChildren();
    GROUPS.forEach((g) => {
      const count = state.orders.filter((o) => !g[2] || g[2].indexOf(o.status) >= 0).length;
      const b = el("button", "chip");
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.group === g[0]));
      b.append(g[1] + " ", el("b", "", nf.format(count)));
      b.addEventListener("click", () => { state.group = g[0]; paintChips(); applyFilter(); });
      box.appendChild(b);
    });
  }

  // ---------- সারি ----------
  function buildRow(o) {
    const li = el("li", "bo");
    const head = el("button", "bo-head");
    head.type = "button";
    head.setAttribute("aria-expanded", "false");
    const main = el("div", "bo-main");
    const title = el("div", "bo-title");
    const meta = el("div", "bo-meta");
    main.append(title, meta);
    const side = el("div", "bo-side");
    head.append(main, side);
    const panel = el("div", "bo-panel");
    panel.hidden = true;
    li.append(head, panel);
    head.addEventListener("click", () => toggleRow(o.id, true));

    const row = {
      li, head, panel,
      refreshHead() {
        title.textContent = o.title;
        const active = activeFiles(o.id).length;
        const parts = [
          state.names[o.customer_id] || "—",
          "#" + shortId(o.id),
          formatDate(o.created_at),
          active ? nf.format(active) + "টি ফাইল" : null,
          o.price === null || o.price === undefined ? "দাম নেই" : formatPrice(o.price)
        ].filter(Boolean);
        meta.textContent = parts.join(" • ");

        side.replaceChildren(statusBadge(o.status));
        const info = expiryInfo(o);
        if (info && active) {
          side.appendChild(el("span", "tag warn",
            info.left > 0 ? "ফাইল মুছবে " + nf.format(info.left) + " দিনে" : "ফাইল মোছার সময় হয়েছে"));
        } else if (o.status === "completed" && !active && filesOf(o.id).length) {
          side.appendChild(el("span", "tag", "ফাইল মুছে গেছে"));
        }
      }
    };
    row.refreshHead();
    return row;
  }

  function closeRow(id) {
    const row = state.rows.get(id);
    if (!row) return;
    row.li.classList.remove("open");
    row.head.setAttribute("aria-expanded", "false");
    row.panel.hidden = true;
    row.panel.replaceChildren();
  }

  function toggleRow(id, scroll) {
    const prev = state.openId;
    if (prev) closeRow(prev);
    if (prev === id) {
      state.openId = null;
      history.replaceState(null, "", location.pathname);
      applyFilter();
      return;
    }
    const o = state.orders.find((x) => x.id === id);
    const row = state.rows.get(id);
    if (!o || !row) return;
    state.openId = id;
    row.li.classList.add("open");
    row.head.setAttribute("aria-expanded", "true");
    row.panel.hidden = false;
    buildPanel(o, row);
    history.replaceState(null, "", "?id=" + encodeURIComponent(id));
    applyFilter();
    if (scroll) {
      const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.li.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
    }
  }

  // ---------- ফাইলের অংশ ----------
  async function openDownload(f, btn) {
    btn.disabled = true;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(f.storage_path, 60, { download: f.original_name });
    btn.disabled = false;
    if (error || !data) return alert("ডাউনলোড লিংক তৈরি হয়নি।");
    window.location.href = data.signedUrl;
  }

  async function deleteFiles(files, label, onDone) {
    if (!files.length) return;
    if (!window.confirm(label + "\nএটা আর ফেরানো যাবে না। মুছে ফেলবেন?")) return;
    try {
      await purgeFiles(files, "admin");
    } catch (e) {
      console.error(e);
      return alert("মোছা যায়নি: " + (e.message || e));
    }
    onDone();
  }

  async function renderFiles(box, o, onChange) {
    const all = filesOf(o.id);
    const active = all.filter((f) => !f.deleted_at);
    const gone = all.filter((f) => f.deleted_at);
    box.replaceChildren();

    const drive = o.source_drive_link && isValidDriveLink(o.source_drive_link);
    if (drive) {
      const a = el("a", "btn-link", "Google Drive ফাইল খুলুন");
      a.href = o.source_drive_link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      box.appendChild(a);
    }
    if (!active.length && !gone.length && !drive) {
      box.appendChild(el("p", "hint", "কাস্টমার কোনো ফাইল বা লিংক দেননি।"));
      return;
    }

    if (active.length) {
      const total = active.reduce((s, f) => s + f.size_bytes, 0);
      const bar = el("div", "files-bar");
      bar.appendChild(el("span", "", nf.format(active.length) + "টি ফাইল • মোট " + bytesLabel(total)));
      const all = el("button", "mini danger", "সব ফাইল মুছুন");
      all.type = "button";
      all.addEventListener("click", () => deleteFiles(active,
        "এই অর্ডারের " + nf.format(active.length) + "টি ফাইলই মুছে যাবে।", onChange));
      bar.appendChild(all);
      box.appendChild(bar);

      const grid = el("div", "fgrid");
      box.appendChild(grid);
      grid.appendChild(el("p", "hint", "ছবি লোড হচ্ছে..."));
      const signed = await sb.storage.from(BUCKET).createSignedUrls(active.map((f) => f.storage_path), 3600);
      if (!grid.isConnected) return; // এর মধ্যে সারি বন্ধ হয়ে গেছে
      const urlOf = {};
      ((signed && signed.data) || []).forEach((s) => { if (!s.error) urlOf[s.path] = s.signedUrl; });
      grid.replaceChildren();

      active.forEach((f) => {
        const card = el("div", "fcard");
        const url = urlOf[f.storage_path];
        const thumb = el(url ? "a" : "div", "fthumb");
        if (url) { thumb.href = url; thumb.target = "_blank"; thumb.rel = "noopener noreferrer"; }
        if (f.mime_type.indexOf("image/") === 0 && url) {
          const img = el("img");
          img.src = url;
          img.alt = f.original_name;
          img.loading = "lazy";
          thumb.appendChild(img);
        } else {
          thumb.appendChild(el("span", "fpdf", f.mime_type === "application/pdf" ? "PDF" : "ফাইল"));
        }
        const name = el("div", "fname", f.original_name);
        name.title = f.original_name;
        const size = el("div", "fsize", bytesLabel(f.size_bytes));
        const acts = el("div", "facts");
        const dl = el("button", "", "ডাউনলোড");
        dl.type = "button";
        dl.addEventListener("click", () => openDownload(f, dl));
        const rm = el("button", "danger", "মুছুন");
        rm.type = "button";
        rm.addEventListener("click", () => deleteFiles([f], "\"" + f.original_name + "\" ফাইলটি মুছে যাবে।", onChange));
        acts.append(dl, rm);
        card.append(thumb, name, size, acts);
        grid.appendChild(card);
      });
    }

    if (gone.length) {
      const wrap = el("div", "gone");
      wrap.appendChild(el("p", "hint", "মুছে ফেলা হয়েছে (" + nf.format(gone.length) + "টি):"));
      gone.forEach((f) => {
        const why = f.deleted_reason === "expired" ? "মেয়াদ শেষ" : "অ্যাডমিন মুছেছেন";
        wrap.appendChild(el("p", "gone-line", f.original_name + " — " + why + ", " + formatDate(f.deleted_at)));
      });
      box.appendChild(wrap);
    }
  }

  // ---------- খোলা অর্ডারের প্যানেল ----------
  function buildPanel(o, row) {
    const host = row.panel;
    host.replaceChildren();
    const h = (t) => el("h3", "sec-h", t);
    const field = (labelText, input, id) => {
      const wrap = el("div");
      const lab = el("label", "", labelText);
      input.id = id;
      lab.htmlFor = id;
      wrap.append(lab, input);
      return wrap;
    };

    // ১) নির্দেশনা
    host.appendChild(h("কাস্টমারের নির্দেশনা"));
    host.appendChild(el("p", "pre", o.instructions || "—"));
    if (o.status === "revision" && o.revision_note) {
      host.appendChild(h("সংশোধনের অনুরোধ"));
      host.appendChild(el("p", "pre", o.revision_note + "\n\n(সংশোধনের অনুরোধ: " + (o.revision_count || 0) + "/২ বার)"));
    }
    if (o.contact_phone) host.appendChild(el("p", "hint", "কাস্টমারের নম্বর: " + o.contact_phone));

    // ২) ফাইল
    host.appendChild(h("কাস্টমারের ফাইল"));
    const filesBox = el("div", "files");
    const expiry = el("div", "tag warn block");
    expiry.hidden = true;
    host.append(filesBox, expiry);

    function paintExpiry() {
      expiry.hidden = true;
      if (o.status !== "completed" || !activeFiles(o.id).length) return;
      const info = expiryInfo(o);
      expiry.hidden = false;
      if (!info) expiry.textContent = "সম্পন্নের তারিখ পাওয়া যায়নি, তাই এই ফাইল নিজে মুছতে হবে।";
      else if (info.left > 0) expiry.textContent = "সম্পন্ন হওয়ার " + nf.format(EXPIRY_DAYS) + " দিন পর ফাইল নিজে মুছবে। আর " +
        nf.format(info.left) + " দিন বাকি (" + formatDate(info.end) + ")।";
      else expiry.textContent = "মেয়াদ শেষ। পেজ রিফ্রেশ করলে ফাইল মুছে যাবে।";
    }
    const refresh = () => { renderFiles(filesBox, o, refresh); paintExpiry(); row.refreshHead(); };
    refresh();

    // ৩) স্ট্যাটাস
    host.appendChild(h("স্ট্যাটাস (চাপলেই বদলে সংরক্ষণ হবে)"));
    const chips = el("div", "stchips");
    host.appendChild(chips);
    function paintStatus() {
      chips.replaceChildren();
      STATUSES.forEach((s) => {
        const b = el("button", "stchip" + (o.status === s[0] ? " on" : ""), s[1]);
        b.type = "button";
        b.setAttribute("aria-pressed", String(o.status === s[0]));
        b.addEventListener("click", () => { if (o.status !== s[0]) save(s[0]); });
        chips.appendChild(b);
      });
    }
    paintStatus();

    // ৪) দাম, বার্তা, সম্পন্ন কাজের লিংক
    const price = el("input");
    price.type = "number"; price.min = "0"; price.step = "1"; price.inputMode = "numeric";
    price.placeholder = "যেমন: 500";
    price.value = o.price === null || o.price === undefined ? "" : o.price;

    const notes = el("textarea");
    notes.maxLength = 2000;
    notes.placeholder = "এটি কাস্টমার তার অর্ডার পেজে দেখতে পাবে। গোপন নোট এখানে লিখবেন না।";
    notes.value = o.admin_notes || "";

    const docx = el("input");
    docx.type = "url"; docx.placeholder = "https://drive.google.com/..."; docx.value = o.result_docx_link || "";
    const pdf = el("input");
    pdf.type = "url"; pdf.placeholder = "https://drive.google.com/..."; pdf.value = o.result_pdf_link || "";

    const two = el("div", "two-col");
    two.append(field("দাম (টাকা)", price, "p-" + o.id), el("div"));
    host.appendChild(two);
    host.appendChild(field("কাস্টমারের জন্য বার্তা", notes, "n-" + o.id));
    host.appendChild(h("সম্পন্ন কাজের ফাইল (Google Drive লিংক)"));
    host.appendChild(el("p", "hint",
      "ফাইল প্রস্তুত না হলে ফাঁকা রাখুন। লিংক সংরক্ষণ করলে কাস্টমারের ডাউনলোড বাটন \"সম্পন্ন\" অবস্থায় চালু হবে।"));
    const two2 = el("div", "two-col");
    two2.append(field("DOCX লিংক", docx, "d-" + o.id), field("PDF লিংক", pdf, "f-" + o.id));
    host.appendChild(two2);

    const msg = el("div", "message");
    msg.setAttribute("role", "alert");
    host.appendChild(msg);

    // ৫) বাটন, WhatsApp, মেসেজ
    const actions = el("div", "actions");
    const saveBtn = el("button", "button", "সংরক্ষণ করুন");
    saveBtn.type = "button";
    saveBtn.addEventListener("click", () => save(null));
    const waBtn = el("button", "button secondary", "WhatsApp-এ জানান");
    waBtn.type = "button";
    const chatBtn = el("button", "button secondary", "মেসেজ");
    chatBtn.type = "button";
    actions.append(saveBtn, waBtn, chatBtn);
    host.appendChild(actions);

    const waBox = el("div", "sub");
    waBox.hidden = true;
    const chatBox = el("div", "sub");
    chatBox.hidden = true;
    host.append(waBox, chatBox);

    waBtn.addEventListener("click", () => {
      waBox.hidden = !waBox.hidden;
      if (waBox.hidden) return;
      waBox.replaceChildren();
      if (!o.contact_phone) {
        waBox.appendChild(el("p", "hint", "এই অর্ডারে কাস্টমার ফোন নম্বর দেননি। \"মেসেজ\" বাটনে উত্তর দিন।"));
        return;
      }
      const ta = el("textarea");
      ta.maxLength = 600;
      ta.value = waTemplate(o, o.status, price.value.trim());
      const go = el("button", "button", "WhatsApp খুলুন");
      go.type = "button";
      go.style.marginTop = "10px";
      go.addEventListener("click", () => {
        const text = ta.value.trim();
        if (text) window.open("https://wa.me/88" + o.contact_phone + "?text=" + encodeURIComponent(text), "_blank", "noopener");
      });
      waBox.append(el("label", "", "পাঠানোর মেসেজ (চাইলে বদলে নিন)"), ta, go);
    });

    chatBtn.addEventListener("click", () => {
      chatBox.hidden = !chatBox.hidden;
      if (!chatBox.hidden && !chatBox.dataset.ready) {
        chatBox.dataset.ready = "1";
        initOrderChat(chatBox, o.id, "admin", true);
      }
    });

    // সংরক্ষণ
    async function save(forced) {
      const status = forced || o.status;
      const priceRaw = price.value.trim();
      let p = null;
      if (priceRaw !== "") {
        p = Number(priceRaw);
        if (!isFinite(p) || p < 0) return flash(msg, "দাম সঠিক সংখ্যায় লিখুন।", "error");
      }
      if (status !== "pending" && status !== "cancelled" && p === null) {
        return flash(msg, "এই স্ট্যাটাসে যাওয়ার আগে দাম নির্ধারণ করুন।", "error");
      }
      const dx = docx.value.trim();
      const pf = pdf.value.trim();
      if (dx && !isValidDriveLink(dx)) return flash(msg, "DOCX লিংকটি সঠিক Google Drive লিংক নয়।", "error");
      if (pf && !isValidDriveLink(pf)) return flash(msg, "PDF লিংকটি সঠিক Google Drive লিংক নয়।", "error");
      if (status === "completed" && !dx && !pf) {
        return flash(msg, "সম্পন্ন করার আগে অন্তত একটি DOCX বা PDF লিংক দিন।", "error");
      }

      const busy = (v) => host.querySelectorAll("button").forEach((b) => { b.disabled = v; });
      busy(true);
      flash(msg, "সংরক্ষণ হচ্ছে...", "info");
      const nt = notes.value.trim();
      const { data, error } = await sb.from("orders")
        .update({ status, price: p, admin_notes: nt || null, result_docx_link: dx || null, result_pdf_link: pf || null })
        .eq("id", o.id)
        .select("id,status,completed_at")
        .maybeSingle();
      busy(false);

      if (error) { console.error(error); return flash(msg, "সংরক্ষণ হয়নি। (" + error.message + ")", "error"); }
      if (!data) return flash(msg, "আপডেট হয়নি। Admin অনুমতি আছে কি না দেখুন।", "error");

      Object.assign(o, {
        status: data.status, completed_at: data.completed_at, price: p,
        admin_notes: nt || null, result_docx_link: dx || null, result_pdf_link: pf || null
      });
      paintStatus();
      paintExpiry();
      row.refreshHead();
      paintChips();
      flash(msg, data.status === "completed" && activeFiles(o.id).length
        ? "সংরক্ষণ হয়েছে। কাস্টমারের ফাইল " + nf.format(EXPIRY_DAYS) + " দিন পর নিজে মুছে যাবে।"
        : "সংরক্ষণ হয়েছে।", "success");
    }
  }

  // ---------- লোড ----------
  async function load() {
    const st = $("board-state");
    st.style.display = "block";
    st.textContent = "লোড হচ্ছে...";
    $("board-list").replaceChildren();
    state.rows.clear();
    flash($("board-note"), "");

    const [oRes, fRes] = await Promise.all([
      sb.from("orders").select(COLS).order("created_at", { ascending: false }).limit(1000),
      sb.from("order_uploads")
        .select("id,order_id,storage_path,original_name,mime_type,size_bytes,deleted_at,deleted_reason")
        .order("created_at", { ascending: true })
        .limit(5000)
    ]);
    if (oRes.error) {
      console.error(oRes.error);
      st.textContent = "অর্ডার লোড করা যায়নি। পেজ রিফ্রেশ করুন।";
      return;
    }
    state.orders = oRes.data || [];
    state.files = new Map();
    if (fRes.error) {
      console.error(fRes.error);
      flash($("board-note"), "ফাইলের তালিকা লোড হয়নি। SQL ধাপ ৪ক চালানো হয়েছে কি না দেখুন। (" + fRes.error.message + ")", "error");
    } else {
      (fRes.data || []).forEach((f) => {
        if (!state.files.has(f.order_id)) state.files.set(f.order_id, []);
        state.files.get(f.order_id).push(f);
      });
    }
    state.names = await fetchCustomerNames(state.orders);

    // মেয়াদ শেষ ফাইল মোছা
    const swept = fRes.error ? null : await sweepExpired();
    if (swept && swept.error) {
      flash($("board-note"), "মেয়াদ শেষ ফাইল মোছা যায়নি: " + swept.error, "error");
    } else if (swept) {
      flash($("board-note"), nf.format(swept.orders) + "টি সম্পন্ন অর্ডারের " + nf.format(swept.files) +
        "টি ফাইল ৭ দিন পার হওয়ায় নিজে থেকে মুছে ফেলা হয়েছে।", "success");
    }

    const list = $("board-list");
    state.orders.forEach((o) => {
      const row = buildRow(o);
      state.rows.set(o.id, row);
      list.appendChild(row.li);
    });
    paintChips();
    applyFilter();
    $("board-sync").textContent = "হালনাগাদ: " + new Date().toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" });
  }

  async function init() {
    const session = await requireAdmin();
    if (!session) return;
    $("board-search").addEventListener("input", (e) => { state.query = e.target.value; applyFilter(); });
    $("refresh-btn").addEventListener("click", async () => {
      const keep = state.openId;
      state.openId = null;
      await load();
      if (keep && state.rows.has(keep)) toggleRow(keep, false);
    });
    await load();
    const deep = new URLSearchParams(location.search).get("id");
    if (deep && state.rows.has(deep)) toggleRow(deep, true);
  }

  window.addEventListener("DOMContentLoaded", init);
})();
