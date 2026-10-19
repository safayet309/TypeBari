// অর্ডারভিত্তিক মেসেজ — কাস্টমার ও অ্যাডমিন দুই পেজেই ব্যবহার হয়
(function () {
  const POLL_MS = 20000; // প্রতি ২০ সেকেন্ডে নতুন মেসেজ দেখবে (পেজ খোলা থাকলে)

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function injectStyle() {
    if (document.getElementById("chat-style")) return;
    const s = document.createElement("style");
    s.id = "chat-style";
    s.textContent =
      ".chat-list{display:flex;flex-direction:column;gap:10px;max-height:380px;overflow-y:auto;padding:12px;border:1px solid var(--line,#dde6e0);border-radius:10px;background:var(--paper,#f5f8f6)}" +
      ".chat-msg{max-width:85%;padding:9px 13px;border-radius:12px;background:#fff;border:1px solid var(--line,#dde6e0);align-self:flex-start}" +
      ".chat-msg.mine{align-self:flex-end;background:var(--green-100,#e2f1e9);border-color:#c5e0d2}" +
      ".chat-body{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}" +
      ".chat-meta{margin-top:4px;font-size:12px;color:var(--muted,#566860)}" +
      ".chat-empty{margin:0;padding:18px 0;text-align:center;color:var(--muted,#566860)}" +
      ".chat-form{margin-top:12px}" +
      ".chat-form textarea{min-height:80px}" +
      ".chat-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}" +
      ".chat-count{margin-left:auto;font-size:13px;color:var(--muted,#566860)}";
    document.head.appendChild(s);
  }

  // mount: যে div-এ চ্যাট বসবে | viewerRole: "customer" বা "admin" | canSend: পাঠানো যাবে কি না
  window.initOrderChat = function (mount, orderId, viewerRole, canSend) {
    if (!mount) return;
    injectStyle();
    mount.textContent = "";

    const list = el("div", "chat-list");
    list.setAttribute("role", "log");
    list.setAttribute("aria-live", "polite");
    list.setAttribute("aria-label", "অর্ডারের মেসেজ");
    mount.appendChild(list);

    const msg = el("div", "message");
    msg.setAttribute("role", "alert");

    const otherLabel = viewerRole === "admin" ? "কাস্টমার" : "অ্যাডমিন";
    let lastKey = "";

    function showMsg(text, isError) {
      msg.textContent = text;
      msg.className = "message " + (isError ? "error" : "success");
    }

    function render(rows) {
      list.textContent = "";
      if (!rows.length) {
        list.appendChild(el("p", "chat-empty", "এখনো কোনো মেসেজ নেই।"));
        return;
      }
      rows.forEach(function (r) {
        const mine = r.sender_role === viewerRole;
        const bubble = el("div", "chat-msg" + (mine ? " mine" : ""));
        bubble.appendChild(el("p", "chat-body", r.body));
        let when = "";
        try {
          when = new Date(r.created_at).toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" });
        } catch (e) { /* তারিখ দেখানো না গেলে বাদ */ }
        bubble.appendChild(el("div", "chat-meta", (mine ? "আপনি" : otherLabel) + " · " + when));
        list.appendChild(bubble);
      });
      list.scrollTop = list.scrollHeight;
    }

    async function load(force) {
      const { data, error } = await sb
        .from("order_messages")
        .select("id,sender_role,body,created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) {
        console.error(error);
        if (force) {
          list.textContent = "";
          list.appendChild(el("p", "chat-empty", "মেসেজ লোড করা যায়নি।"));
        }
        return;
      }
      const key = data.map(function (r) { return r.id; }).join(",");
      if (key === lastKey && !force) return;
      lastKey = key;
      render(data);
    }

    if (canSend) {
      const form = el("div", "chat-form");
      const label = el("label", "", "নতুন মেসেজ");
      label.setAttribute("for", "chat-input");

      const ta = document.createElement("textarea");
      ta.id = "chat-input";
      ta.maxLength = 1000;
      ta.placeholder = "মেসেজ লিখুন…";

      const actions = el("div", "chat-actions");
      const btn = el("button", "button", "পাঠান");
      btn.type = "button";
      const count = el("span", "chat-count", "০ / ১০০০");
      actions.appendChild(btn);
      actions.appendChild(count);

      form.appendChild(label);
      form.appendChild(ta);
      form.appendChild(actions);
      form.appendChild(msg);
      mount.appendChild(form);

      async function send() {
        const body = ta.value.trim();
        if (!body) {
          showMsg("মেসেজ লিখুন।", true);
          return;
        }
        btn.disabled = true;
        const { error } = await sb.from("order_messages").insert({ order_id: orderId, body: body });
        btn.disabled = false;

        if (error) {
          console.error(error);
          showMsg(
            error.code === "42501"
              ? "এই অর্ডারে এখন মেসেজ পাঠানো যাচ্ছে না।"
              : "মেসেজ পাঠানো যায়নি। আবার চেষ্টা করুন।",
            true
          );
          return;
        }
        ta.value = "";
        count.textContent = "০ / ১০০০";
        msg.className = "message";
        await load(true);
      }

      ta.addEventListener("input", function () {
        count.textContent = ta.value.length.toLocaleString("bn-BD") + " / ১০০০";
      });
      ta.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          send();
        }
      });
      btn.addEventListener("click", send);
    } else {
      mount.appendChild(el("p", "hint", "এই অর্ডারে নতুন মেসেজ পাঠানো যায় না।"));
    }

    const timer = setInterval(function () {
      if (!document.body.contains(mount)) {
        clearInterval(timer);
        return;
      }
      if (!document.hidden) load(false);
    }, POLL_MS);

    load(true);
  };
})();
