
/*
 * TypeBari — Admin Payment Management
 *
 * Required:
 *   admin/payments.html
 *   js/config.js
 *   js/supabase-client.js
 *   js/auth.js
 *   js/orders.js
 *   js/admin.js
 *
 * Database:
 *   payment_settings
 *   subscriptions
 *   subscription_plans
 *   order_payments
 *   orders
 *   profiles
 *
 * Run the supplied TypeBari Supabase migration first.
 */

(function () {
  "use strict";

  let adminSession = null;
  let busy = false;

  const $ = (id) => document.getElementById(id);

  function node(tag, className, value) {
    const el = document.createElement(tag);

    if (className) el.className = className;

    if (value !== undefined && value !== null) {
      el.textContent = String(value);
    }

    return el;
  }

  function message(id, text, type) {
    const el = $(id);

    if (!el) return;

    el.textContent = text || "";
    el.className = "message";

    if (text) {
      el.classList.add(type === "success" ? "success" : "error");
    }
  }

  function money(value) {
    const amount = Number(value);

    return "৳" + (
      Number.isFinite(amount) ? amount : 0
    ).toLocaleString("bn-BD", {
      maximumFractionDigits: 2
    });
  }

  function dateText(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString("bn-BD", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function methodText(value) {
    if (value === "bkash") return "বিকাশ";
    if (value === "nagad") return "নগদ";

    return value || "—";
  }

  function statusText(value) {
    const labels = {
      payment_submitted: "পেমেন্ট যাচাই বাকি",
      submitted: "পেমেন্ট যাচাই বাকি",
      active: "সাবস্ক্রিপশন সক্রিয়",
      confirmed: "পেমেন্ট কনফার্ম",
      rejected: "যাচাই হয়নি",
      expired: "মেয়াদ শেষ"
    };

    return labels[value] || value || "অজানা";
  }

  function statusClass(value) {
    if (value === "active" || value === "confirmed") {
      return "confirmed";
    }

    if (value === "rejected" || value === "expired") {
      return "rejected";
    }

    return "pending";
  }

  function setButton(button, disabled, text) {
    if (!button) return;

    button.disabled = Boolean(disabled);

    if (text) button.textContent = text;
  }

  function phoneIsValid(value) {
    return !value || /^[0-9+\-\s]{8,20}$/.test(value);
  }

  async function currentAdminSession() {
    const { data, error } = await sb.auth.getSession();

    if (error || !data.session) {
      throw new Error("লগইন সেশন পাওয়া যায়নি। আবার লগইন করুন।");
    }

    const { data: profile, error: profileError } = await sb
      .from("profiles")
      .select("role")
      .eq("id", data.session.user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile || profile.role !== "admin") {
      throw new Error("এই কাজটি শুধু Admin করতে পারবেন।");
    }

    return data.session;
  }

  // --------------------------------------------------
  // 1. PAYMENT SETTINGS
  // --------------------------------------------------

  async function loadPaymentSettings() {
    const saveButton = $("save-settings-btn");

    setButton(saveButton, true, "নম্বর লোড হচ্ছে...");

    try {
      const { data, error } = await sb
        .from("payment_settings")
        .select("id,bkash_number,nagad_number")
        .eq("id", 1)
        .maybeSingle();

      if (error) throw error;

      $("bkash-number").value =
        data ? data.bkash_number || "" : "";

      $("nagad-number").value =
        data ? data.nagad_number || "" : "";

      message("settings-message", "", "");

    } catch (error) {
      console.error("Payment settings loading error:", error);

      message(
        "settings-message",
        "পেমেন্ট নম্বর লোড হয়নি। Supabase migration ও Admin RLS পরীক্ষা করুন।",
        "error"
      );

    } finally {
      setButton(saveButton, false, "নম্বর সংরক্ষণ করুন");
    }
  }

  async function savePaymentSettings(event) {
    event.preventDefault();

    if (busy) return;

    const bkash = $("bkash-number").value.trim();
    const nagad = $("nagad-number").value.trim();

    if (!bkash && !nagad) {
      message(
        "settings-message",
        "কমপক্ষে একটি বিকাশ অথবা নগদ নম্বর দিন।",
        "error"
      );
      return;
    }

    if (!phoneIsValid(bkash) || !phoneIsValid(nagad)) {
      message(
        "settings-message",
        "বিকাশ/নগদ নম্বর সঠিকভাবে লিখুন।",
        "error"
      );
      return;
    }

    if (!window.confirm(
      "এই নম্বরগুলো গ্রাহকদের কাছে পেমেন্টের জন্য দেখানো হবে। নম্বর ঠিক আছে তো?"
    )) {
      return;
    }

    busy = true;

    const button = $("save-settings-btn");

    setButton(button, true, "সংরক্ষণ হচ্ছে...");
    message("settings-message", "", "");

    try {
      adminSession = await currentAdminSession();

      const { error } = await sb
        .from("payment_settings")
        .upsert({
          id: 1,
          bkash_number: bkash,
          nagad_number: nagad,
          updated_at: new Date().toISOString(),
          updated_by: adminSession.user.id
        }, {
          onConflict: "id"
        });

      if (error) throw error;

      message(
        "settings-message",
        "বিকাশ ও নগদের নম্বর সফলভাবে সংরক্ষণ হয়েছে।",
        "success"
      );

    } catch (error) {
      console.error("Saving payment settings failed:", error);

      message(
        "settings-message",
        error.message ||
          "নম্বর সংরক্ষণ হয়নি। Supabase RLS পরীক্ষা করুন।",
        "error"
      );

    } finally {
      busy = false;

      setButton(button, false, "নম্বর সংরক্ষণ করুন");
    }
  }

  // --------------------------------------------------
  // 2. CUSTOMER NAMES
  // --------------------------------------------------

  async function getCustomerNames(ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    const names = {};

    if (!uniqueIds.length) return names;

    const { data, error } = await sb
      .from("profiles")
      .select("id,full_name")
      .in("id", uniqueIds);

    if (error) {
      console.error("Could not load customer names:", error);
      return names;
    }

    (data || []).forEach((profile) => {
      names[profile.id] = profile.full_name || "নাম দেওয়া নেই";
    });

    return names;
  }

  // --------------------------------------------------
  // 3. SUBSCRIPTION PAYMENTS
  // --------------------------------------------------

  async function loadSubscriptions() {
    const state = $("subscription-state");
    const list = $("subscription-list");

    state.style.display = "block";
    state.textContent = "সাবস্ক্রিপশন আবেদন লোড হচ্ছে...";
    list.replaceChildren();

    try {
      const [subsResult, plansResult] = await Promise.all([
        sb
          .from("subscriptions")
          .select(
            "id,user_id,plan_key,amount,status,payment_method," +
            "sender_number,transaction_id,created_at,started_at," +
            "expires_at,admin_note"
          )
          .order("created_at", { ascending: false })
          .limit(200),

        sb
          .from("subscription_plans")
          .select("plan_key,name,pages_per_day,monthly_price")
      ]);

      if (subsResult.error) throw subsResult.error;
      if (plansResult.error) throw plansResult.error;

      const rows = subsResult.data || [];
      const plans = {};

      (plansResult.data || []).forEach((plan) => {
        plans[plan.plan_key] = plan;
      });

      const names = await getCustomerNames(
        rows.map((row) => row.user_id)
      );

      if (!rows.length) {
        state.textContent = "এখনো কোনো সাবস্ক্রিপশন আবেদন আসেনি।";
        return;
      }

      state.style.display = "none";

      rows.forEach((row) => {
        list.appendChild(
          renderSubscriptionCard(row, plans, names)
        );
      });

    } catch (error) {
      console.error("Loading subscriptions failed:", error);

      state.textContent =
        "সাবস্ক্রিপশন লোড হয়নি। SQL migration, Admin role ও RLS পরীক্ষা করুন।";
    }
  }

  function renderSubscriptionCard(row, plans, names) {
    const plan = plans[row.plan_key] || {
      name: row.plan_key,
      pages_per_day: 0
    };

    const card = node("article", "record-card");

    card.appendChild(
      node("h3", "", plan.name)
    );

    card.appendChild(
      node(
        "span",
        "status " + statusClass(row.status),
        statusText(row.status)
      )
    );

    card.appendChild(
      node(
        "p",
        "",
        "গ্রাহক: " +
          (names[row.user_id] || row.user_id)
      )
    );

    card.appendChild(
      node(
        "p",
        "",
        "মূল্য: " + money(row.amount) +
          " · প্রতিদিন " +
          Number(plan.pages_per_day).toLocaleString("bn-BD") +
          " পেইজ"
      )
    );

    card.appendChild(
      node(
        "p",
        "",
        "মাধ্যম: " + methodText(row.payment_method) +
          " · প্রেরকের নম্বর: " + row.sender_number
      )
    );

    card.appendChild(
      node("p", "", "Transaction ID: " + row.transaction_id)
    );

    card.appendChild(
      node("p", "", "আবেদন: " + dateText(row.created_at))
    );

    if (row.started_at) {
      card.appendChild(
        node(
          "p",
          "",
          "শুরু: " + dateText(row.started_at) +
            " · মেয়াদ শেষ: " + dateText(row.expires_at)
        )
      );
    }

    if (row.admin_note) {
      card.appendChild(
        node("p", "", "Admin নোট: " + row.admin_note)
      );
    }

    if (row.status === "payment_submitted") {
      const actions = node("div", "record-actions");

      const confirmButton = node(
        "button",
        "",
        "টাকা পেয়েছি — কনফার্ম"
      );

      confirmButton.type = "button";

      confirmButton.addEventListener("click", async () => {
        if (busy) return;

        const approved = window.confirm(
          "বিকাশ/নগদ অ্যাপে এই Transaction ID ও টাকা পাওয়ার বিষয়টি যাচাই করেছেন তো?\n\n" +
          "কনফার্ম করলে সাবস্ক্রিপশন ৩০ দিনের জন্য চালু হবে।"
        );

        if (!approved) return;

        busy = true;

        setButton(
          confirmButton,
          true,
          "কনফার্ম হচ্ছে..."
        );

        try {
          adminSession = await currentAdminSession();

          const { error } = await sb.rpc(
            "admin_activate_subscription",
            {
              p_subscription_id: row.id
            }
          );

          if (error) throw error;

          message(
            "page-message",
            "সাবস্ক্রিপশন সক্রিয় করা হয়েছে।",
            "success"
          );

          await loadSubscriptions();

        } catch (error) {
          console.error("Subscription confirmation failed:", error);

          window.alert(
            "সাবস্ক্রিপশন কনফার্ম হয়নি। Supabase migration, Admin role ও RPC function পরীক্ষা করুন।"
          );

          setButton(
            confirmButton,
            false,
            "টাকা পেয়েছি — কনফার্ম"
          );

        } finally {
          busy = false;
        }
      });

      const rejectButton = node(
        "button",
        "secondary",
        "পেমেন্ট যাচাই হয়নি"
      );

      rejectButton.type = "button";

      rejectButton.addEventListener("click", async () => {
        if (busy) return;

        const note = window.prompt(
          "পেমেন্ট প্রত্যাখ্যানের কারণ লিখুন:",
          "পেমেন্ট তথ্য যাচাই করা যায়নি। নম্বর ও Transaction ID মিলিয়ে আবার জমা দিন।"
        );

        if (note === null) return;

        busy = true;

        setButton(rejectButton, true, "আপডেট হচ্ছে...");

        try {
          adminSession = await currentAdminSession();

          const { data, error } = await sb
            .from("subscriptions")
            .update({
              status: "rejected",
              admin_note: note.trim() || "পেমেন্ট যাচাই করা যায়নি।",
              reviewed_by: adminSession.user.id
            })
            .eq("id", row.id)
            .eq("status", "payment_submitted")
            .select("id")
            .maybeSingle();

          if (error) throw error;
          if (!data) {
            throw new Error("আবেদনটি ইতিমধ্যে অন্য কেউ যাচাই করেছেন।");
          }

          message(
            "page-message",
            "সাবস্ক্রিপশনের আবেদন যাচাই হয়নি হিসেবে চিহ্নিত হয়েছে।",
            "success"
          );

          await loadSubscriptions();

        } catch (error) {
          console.error("Subscription rejection failed:", error);

          window.alert(
            error.message || "সাবস্ক্রিপশন স্ট্যাটাস আপডেট হয়নি।"
          );

          setButton(
            rejectButton,
            false,
            "পেমেন্ট যাচাই হয়নি"
          );

        } finally {
          busy = false;
        }
      });

      actions.appendChild(confirmButton);
      actions.appendChild(rejectButton);
      card.appendChild(actions);
    }

    return card;
  }

  // --------------------------------------------------
  // 4. NORMAL ORDER PAYMENTS
  // --------------------------------------------------

  async function loadOrderPayments() {
    const state = $("order-payment-state");
    const list = $("order-payment-list");

    state.style.display = "block";
    state.textContent = "অর্ডারের পেমেন্ট লোড হচ্ছে...";
    list.replaceChildren();

    try {
      const { data: payments, error } = await sb
        .from("order_payments")
        .select(
          "id,order_id,customer_id,gateway,sender_number," +
          "transaction_id,status,admin_note,submitted_at," +
          "confirmed_at,confirmed_by"
        )
        .order("submitted_at", { ascending: false })
        .limit(200);

      if (error) throw error;

      const rows = payments || [];

      if (!rows.length) {
        state.textContent = "এখনো কোনো সাধারণ অর্ডারের পেমেন্ট জমা হয়নি।";
        return;
      }

      const orderIds = [...new Set(rows.map((row) => row.order_id))];

      const { data: orders, error: ordersError } = await sb
        .from("orders")
        .select("id,title,status,price,customer_id")
        .in("id", orderIds);

      if (ordersError) throw ordersError;

      const orderMap = {};

      (orders || []).forEach((order) => {
        orderMap[order.id] = order;
      });

      const names = await getCustomerNames(
        rows.map((row) => row.customer_id)
      );

      state.style.display = "none";

      rows.forEach((payment) => {
        list.appendChild(
          renderOrderPaymentCard(payment, orderMap, names)
        );
      });

    } catch (error) {
      console.error("Loading order payments failed:", error);

      state.textContent =
        "অর্ডারের পেমেন্ট লোড হয়নি। Database migration, Admin role ও RLS পরীক্ষা করুন।";
    }
  }

  function renderOrderPaymentCard(payment, orderMap, names) {
    const order = orderMap[payment.order_id] || {};
    const card = node("article", "record-card");

    card.appendChild(
      node(
        "h3",
        "",
        order.title || "অর্ডার " + payment.order_id.slice(0, 8)
      )
    );

    card.appendChild(
      node(
        "span",
        "status " + statusClass(payment.status),
        statusText(payment.status)
      )
    );

    card.appendChild(
      node(
        "p",
        "",
        "গ্রাহক: " +
          (names[payment.customer_id] || payment.customer_id)
      )
    );

    card.appendChild(
      node(
        "p",
        "",
        "অর্ডারের মূল্য: " +
          (order.price === null || order.price === undefined
            ? "নির্ধারিত নয়"
            : money(order.price))
      )
    );

    card.appendChild(
      node(
        "p",
        "",
        "অর্ডারের অবস্থা: " + (order.status || "—")
      )
    );

    card.appendChild(
      node(
        "p",
        "",
        "পেমেন্ট মাধ্যম: " + methodText(payment.gateway)
      )
    );

    card.appendChild(
      node(
        "p",
        "",
        "টাকা পাঠানো নম্বর: " + payment.sender_number
      )
    );

    card.appendChild(
      node("p", "", "Transaction ID: " + payment.transaction_id)
    );

    card.appendChild(
      node("p", "", "জমা দেওয়ার সময়: " + dateText(payment.submitted_at))
    );

    if (payment.confirmed_at) {
      card.appendChild(
        node(
          "p",
          "",
          "কনফার্মের সময়: " + dateText(payment.confirmed_at)
        )
      );
    }

    if (payment.admin_note) {
      card.appendChild(
        node("p", "", "Admin নোট: " + payment.admin_note)
      );
    }

    if (payment.status === "submitted") {
      const actions = node("div", "record-actions");

      const confirmButton = node(
        "button",
        "",
        "টাকা পেয়েছি — কনফার্ম"
      );

      confirmButton.type = "button";

      confirmButton.addEventListener("click", async () => {
        if (busy) return;

        if (!window.confirm(
          "বিকাশ/নগদ অ্যাপে টাকা পাওয়ার বিষয়টি যাচাই করেছেন তো?"
        )) {
          return;
        }

        busy = true;

        setButton(confirmButton, true, "কনফার্ম হচ্ছে...");

        try {
          adminSession = await currentAdminSession();

          const { data, error } = await sb
            .from("order_payments")
            .update({
              status: "confirmed",
              confirmed_at: new Date().toISOString(),
              confirmed_by: adminSession.user.id,
              admin_note: null
            })
            .eq("id", payment.id)
            .eq("status", "submitted")
            .select("id")
            .maybeSingle();

          if (error) throw error;

          if (!data) {
            throw new Error(
              "এই পেমেন্টটি ইতিমধ্যে যাচাই করা হয়েছে।"
            );
          }

          message(
            "page-message",
            "অর্ডারের পেমেন্ট কনফার্ম করা হয়েছে।",
            "success"
          );

          await loadOrderPayments();

        } catch (error) {
          console.error("Order payment confirmation failed:", error);

          window.alert(
            error.message ||
            "পেমেন্ট কনফার্ম হয়নি। Admin permissions পরীক্ষা করুন।"
          );

          setButton(
            confirmButton,
            false,
            "টাকা পেয়েছি — কনফার্ম"
          );

        } finally {
          busy = false;
        }
      });

      const rejectButton = node(
        "button",
        "secondary",
        "পেমেন্ট যাচাই হয়নি"
      );

      rejectButton.type = "button";

      rejectButton.addEventListener("click", async () => {
        if (busy) return;

        const note = window.prompt(
          "পেমেন্ট প্রত্যাখ্যানের কারণ লিখুন:",
          "পেমেন্ট তথ্য যাচাই করা যায়নি। নম্বর ও Transaction ID মিলিয়ে আবার জমা দিন।"
        );

        if (note === null) return;

        busy = true;

        setButton(rejectButton, true, "আপডেট হচ্ছে...");

        try {
          adminSession = await currentAdminSession();

          const { data, error } = await sb
            .from("order_payments")
            .update({
              status: "rejected",
              admin_note: note.trim() ||
                "পেমেন্ট তথ্য যাচাই করা যায়নি।",
              confirmed_at: null,
              confirmed_by: null
            })
            .eq("id", payment.id)
            .eq("status", "submitted")
            .select("id")
            .maybeSingle();

          if (error) throw error;

          if (!data) {
            throw new Error(
              "এই পেমেন্টটি ইতিমধ্যে যাচাই করা হয়েছে।"
            );
          }

          message(
            "page-message",
            "পেমেন্ট যাচাই হয়নি হিসেবে চিহ্নিত করা হয়েছে।",
            "success"
          );

          await loadOrderPayments();

        } catch (error) {
          console.error("Order payment rejection failed:", error);

          window.alert(
            error.message ||
            "পেমেন্ট স্ট্যাটাস আপডেট হয়নি।"
          );

          setButton(
            rejectButton,
            false,
            "পেমেন্ট যাচাই হয়নি"
          );

        } finally {
          busy = false;
        }
      });

      actions.appendChild(confirmButton);
      actions.appendChild(rejectButton);
      card.appendChild(actions);
    }

    return card;
  }

  // --------------------------------------------------
  // 5. PAGE INITIALIZATION
  // --------------------------------------------------

  window.initAdminPayments = async function () {
    try {
      adminSession = await currentAdminSession();

      $("payment-settings-form").addEventListener(
        "submit",
        savePaymentSettings
      );

      $("refresh-subscriptions-btn").addEventListener(
        "click",
        loadSubscriptions
      );

      $("refresh-order-payments-btn").addEventListener(
        "click",
        loadOrderPayments
      );

      await Promise.all([
        loadPaymentSettings(),
        loadSubscriptions(),
        loadOrderPayments()
      ]);

    } catch (error) {
      console.error("Admin payment initialization failed:", error);

      message(
        "page-message",
        error.message ||
          "পেমেন্ট পেজ চালু হয়নি। Admin login ও Supabase connection পরীক্ষা করুন।",
        "error"
      );
    }
  };
})();
