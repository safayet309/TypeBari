// সাধারণ অর্ডারের পেমেন্ট — অর্ডার পেজে (এবং পরে হোম পেজে) ব্যবহার হবে
(function () {
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function money(n) {
    return "৳" + Number(n).toLocaleString("bn-BD");
  }

  function methodName(m) {
    if (m === "bkash") return "বিকাশ";
    if (m === "nagad") return "নগদ";
    return m || "—";
  }

  function isValidPhone(v) {
    return /^[0-9+\-\s]{8,20}$/.test(v);
  }

  function injectStyle() {
    if (document.getElementById("pay-style")) return;
    const s = document.createElement("style");
    s.id = "pay-style";
    s.textContent =
      ".pay-amount{font-size:20px;font-weight:700;margin:0 0 8px}" +
      ".pay-ok,.pay-wait,.pay-bad{margin:0 0 12px;padding:12px 14px;border-radius:10px}" +
      ".pay-ok{background:var(--green-100,#e2f1e9);color:var(--green-700,#176b4d)}" +
      ".pay-wait{background:var(--warn-bg,#fff0e0);color:var(--warn,#8a4b00)}" +
      ".pay-bad{background:var(--danger-bg,#fbe9e9);color:var(--danger,#a32020)}" +
      ".pay-form select,.pay-form input{margin-bottom:4px}";
    document.head.appendChild(s);
  }

  let settingsCache = null;
  async function getSettings() {
    if (!settingsCache) {
      const { data } = await sb
        .from("payment_settings")
        .select("bkash_number,nagad_number")
        .eq("id", 1)
        .maybeSingle();
      settingsCache = data || { bkash_number: "", nagad_number: "" };
    }
    return settingsCache;
  }

  function friendlyError(error) {
    if (error && error.code === "23505") {
      return "এই Transaction ID আগেই জমা দেওয়া হয়েছে। সঠিক TrxID দিন।";
    }
    if (error && error.code === "42501") {
      return "এই অর্ডারে এখন পেমেন্ট জমা দেওয়া যাচ্ছে না। পেজ রিফ্রেশ করে দেখুন।";
    }
    return "পেমেন্ট তথ্য জমা হয়নি। আবার চেষ্টা করুন। (" + ((error && error.message) || "অজানা সমস্যা") + ")";
  }

  // mount: যে div-এ বসবে | order: { id, price, status, billing_type } | onDone: জমা হলে যা করবে
  window.renderOrderPayment = async function (mount, order, onDone) {
    if (!mount) return;
    injectStyle();
    mount.textContent = "";

    if (order.billing_type === "subscription") return;
    if (order.price === null || order.price === undefined || Number(order.price) <= 0) return;

    const { data: pays, error } = await sb
      .from("order_payments")
      .select("id,gateway,status,admin_note,submitted_at,confirmed_at")
      .eq("order_id", order.id)
      .order("submitted_at", { ascending: false });

    if (error) {
      console.error(error);
      mount.appendChild(el("p", "hint", "পেমেন্টের তথ্য লোড করা যায়নি।"));
      return;
    }

    const list = pays || [];
    const confirmed = list.find(function (p) { return p.status === "confirmed"; });
    const submitted = list.find(function (p) { return p.status === "submitted"; });
    const rejected = list.find(function (p) { return p.status === "rejected"; });

    if (confirmed) {
      mount.appendChild(el("p", "pay-ok",
        "পেমেন্ট সম্পন্ন হয়েছে: " + money(order.price) + " (" + methodName(confirmed.gateway) + ")। ধন্যবাদ।"));
      return;
    }
    if (submitted) {
      mount.appendChild(el("p", "pay-wait",
        "পেমেন্ট তথ্য জমা হয়েছে (" + methodName(submitted.gateway) +
        ")। অ্যাডমিন টাকা পাওয়ার বিষয়টি যাচাই করে কনফার্ম করবেন।"));
      return;
    }
    if (order.status !== "completed") {
      mount.appendChild(el("p", "hint", "কাজ সম্পন্ন হলে এখান থেকে পেমেন্ট করতে পারবেন।"));
      return;
    }

    if (rejected) {
      mount.appendChild(el("p", "pay-bad",
        "আগের পেমেন্ট তথ্য গ্রহণ করা যায়নি।" + (rejected.admin_note ? " কারণ: " + rejected.admin_note : "") +
        " সঠিক তথ্য দিয়ে আবার জমা দিন।"));
    }

    const settings = await getSettings();
    const form = el("div", "pay-form");
    form.appendChild(el("p", "pay-amount", "পরিশোধযোগ্য: " + money(order.price)));

    const methodLabel = el("label", "", "পেমেন্ট মাধ্যম");
    methodLabel.setAttribute("for", "pay-method");
    const sel = document.createElement("select");
    sel.id = "pay-method";
    [["bkash", "বিকাশ"], ["nagad", "নগদ"]].forEach(function (m) {
      const o = document.createElement("option");
      o.value = m[0];
      o.textContent = m[1];
      sel.appendChild(o);
    });
        const to = el("p", "hint pay-to");
    function updateTo() {
      const num = sel.value === "bkash" ? settings.bkash_number : settings.nagad_number;
      to.textContent = "";
      if (!num) {
        to.textContent = "এই মাধ্যমের নম্বর এখনো যোগ করা হয়নি। অন্য মাধ্যম বেছে নিন।";
        return;
      }
      to.appendChild(el("span", "pay-to-label", methodName(sel.value) + " নম্বর"));
      to.appendChild(el("strong", "pay-to-number", num));
      if (sel.value === "bkash") {
        to.appendChild(el("span", "pay-to-type", "এটি পার্সোনাল নম্বর। বিকাশ অ্যাপে \"Send Money\" করে টাকা পাঠান।"));
      }
      to.appendChild(el("span", "pay-to-note", "এই নম্বরে " + money(order.price) + " পাঠান, তারপর নিচের তথ্য দিন।"));
    }
    updateTo();
    sel.addEventListener("change", updateTo);

    const senderLabel = el("label", "", "যে নম্বর থেকে টাকা পাঠিয়েছেন");
    senderLabel.setAttribute("for", "pay-sender");
    const senderIn = document.createElement("input");
    senderIn.id = "pay-sender";
    senderIn.type = "tel";
    senderIn.inputMode = "tel";
    senderIn.maxLength = 20;
    senderIn.placeholder = "01XXXXXXXXX";

    const trxLabel = el("label", "", "Transaction ID (TrxID)");
    trxLabel.setAttribute("for", "pay-trx");
    const trxIn = document.createElement("input");
    trxIn.id = "pay-trx";
    trxIn.type = "text";
    trxIn.maxLength = 100;
    trxIn.autocomplete = "off";
    trxIn.placeholder = "পেমেন্টের TrxID লিখুন";

    const msg = el("div", "message");
    msg.setAttribute("role", "alert");
    function say(text, isError) {
      msg.textContent = text;
      msg.className = "message " + (isError ? "error" : "success");
    }

    const btn = el("button", "button", "পেমেন্ট তথ্য জমা দিন");
    btn.type = "button";
    btn.style.marginTop = "12px";

    btn.addEventListener("click", async function () {
      const method = sel.value;
      const recipient = method === "bkash" ? settings.bkash_number : settings.nagad_number;
      const sender = senderIn.value.trim();
      const trx = trxIn.value.trim();

      if (!recipient) { say("এই মাধ্যমের নম্বর পাওয়া যাচ্ছে না। অন্য মাধ্যম বেছে নিন।", true); return; }
      if (!isValidPhone(sender)) { say("যে নম্বর থেকে টাকা পাঠিয়েছেন সেটি সঠিকভাবে লিখুন।", true); return; }
      if (trx.length < 3 || trx.length > 100) { say("সঠিক Transaction ID লিখুন (৩–১০০ অক্ষর)।", true); return; }

      btn.disabled = true;
      const { data: sess } = await sb.auth.getSession();
      const uid = sess.session && sess.session.user.id;
      if (!uid) { btn.disabled = false; say("লগইন করা নেই। আবার লগইন করুন।", true); return; }

      let res;
      if (rejected) {
        res = await sb.from("order_payments").update({
          gateway: method,
          sender_number: sender,
          transaction_id: trx,
          status: "submitted",
          admin_note: null,
          submitted_at: new Date().toISOString()
        }).eq("id", rejected.id);
      } else {
        res = await sb.from("order_payments").insert({
          order_id: order.id,
          customer_id: uid,
          gateway: method,
          sender_number: sender,
          transaction_id: trx,
          status: "submitted"
        });
      }
      btn.disabled = false;

      if (res.error) {
        console.error(res.error);
        say(friendlyError(res.error), true);
        return;
      }
      if (typeof onDone === "function") onDone();
      else window.location.reload();
    });

    form.appendChild(methodLabel);
    form.appendChild(sel);
    form.appendChild(to);
    form.appendChild(senderLabel);
    form.appendChild(senderIn);
    form.appendChild(trxLabel);
    form.appendChild(trxIn);
    form.appendChild(msg);
    form.appendChild(btn);
    mount.appendChild(form);
  };
})();
