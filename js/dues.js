// হোম পেজে বকেয়া পেমেন্টের ব্যানার (payments.js আগে লোড হতে হবে)
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

  function fdate(v) {
    try {
      return new Date(v).toLocaleDateString("bn-BD", { year: "numeric", month: "long", day: "numeric" });
    } catch (e) {
      return "";
    }
  }

  window.loadHomeDues = async function () {
    const band = document.getElementById("dues-band");
    const list = document.getElementById("dues-list");
    const title = document.getElementById("dues-title");
    if (!band || !list || !title) return;

    const { data: sess } = await sb.auth.getSession();
    const uid = sess.session && sess.session.user.id;
    if (!uid) return;

    const { data: orders, error } = await sb
      .from("orders")
      .select("id,title,price,status,billing_type,completed_at,created_at")
      .eq("customer_id", uid)
      .eq("status", "completed")
      .gt("price", 0)
      .order("completed_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error(error);
      return;
    }

    const regular = (orders || []).filter(function (o) { return o.billing_type !== "subscription"; });
    if (!regular.length) {
      band.hidden = true;
      return;
    }

    const { data: pays, error: payErr } = await sb
      .from("order_payments")
      .select("order_id,status,admin_note")
      .in("order_id", regular.map(function (o) { return o.id; }));

    if (payErr) {
      console.error(payErr);
      return;
    }

    const byOrder = {};
    (pays || []).forEach(function (p) {
      (byOrder[p.order_id] = byOrder[p.order_id] || []).push(p);
    });

    const due = [];
    const verifying = [];
    regular.forEach(function (o) {
      const ps = byOrder[o.id] || [];
      if (ps.some(function (p) { return p.status === "confirmed"; })) return;
      if (ps.some(function (p) { return p.status === "submitted"; })) {
        verifying.push(o);
        return;
      }
      const rej = ps.find(function (p) { return p.status === "rejected"; });
      o._rejected = !!rej;
      o._note = (rej && rej.admin_note) || "";
      due.push(o);
    });

    list.textContent = "";
    if (!due.length && !verifying.length) {
      band.hidden = true;
      return;
    }

    const total = due.reduce(function (s, o) { return s + Number(o.price); }, 0);
    title.textContent = due.length ? "আপনার বকেয়া পেমেন্ট: " + money(total) : "পেমেন্ট যাচাই চলছে";

    const panels = [];
    due.forEach(function (o) {
      const row = el("div", "due-item");

      const info = el("div", "due-info");
      info.appendChild(el("strong", "", o.title));
      info.appendChild(el("div", "due-meta",
        "অর্ডার নম্বর: " + o.id.slice(0, 8).toUpperCase() +
        " • সম্পন্ন: " + fdate(o.completed_at || o.created_at) +
        " • " + money(o.price)));
      if (o._rejected) {
        info.appendChild(el("div", "due-warn",
          "আগের পেমেন্ট তথ্য গ্রহণ করা যায়নি।" + (o._note ? " কারণ: " + o._note : "")));
      }

      const actions = el("div", "due-actions");
      const payBtn = el("button", "button", "পরিশোধ করুন");
      payBtn.type = "button";
      payBtn.setAttribute("aria-expanded", "false");
      const view = el("a", "button secondary", "অর্ডার দেখুন");
      view.href = "order-details.html?id=" + encodeURIComponent(o.id);
      actions.appendChild(payBtn);
      actions.appendChild(view);

      const panel = el("div", "due-panel");
      panel.hidden = true;
      panels.push({ panel: panel, btn: payBtn });

      payBtn.addEventListener("click", function () {
        const opening = panel.hidden;
        // একসাথে একটা ফর্মই খোলা থাকবে
        panels.forEach(function (p) {
          p.panel.hidden = true;
          p.panel.textContent = "";
          p.btn.setAttribute("aria-expanded", "false");
          p.btn.textContent = "পরিশোধ করুন";
        });
        if (opening) {
          panel.hidden = false;
          payBtn.setAttribute("aria-expanded", "true");
          payBtn.textContent = "বন্ধ করুন";
          renderOrderPayment(panel, o, function () { window.loadHomeDues(); });
        }
      });

      row.appendChild(info);
      row.appendChild(actions);
      row.appendChild(panel);
      list.appendChild(row);
    });

    verifying.forEach(function (o) {
      list.appendChild(el("p", "due-verify",
        "যাচাই চলছে: " + o.title + " (" + money(o.price) + ") — অ্যাডমিন কনফার্ম করবেন।"));
    });

    band.hidden = false;
  };
})();
