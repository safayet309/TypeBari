
/* TypeBari: subscription selection and manual bKash/Nagad payment submission.
 * Requires the existing Supabase client in js/supabase-client.js.
 * Works with subscription.html from Step 4.
 */
(function () {
  "use strict";

  let currentSession = null;
  let plans = [];
  let paymentSettings = {
    bkash_number: "",
    nagad_number: ""
  };
  let submitInProgress = false;

  const byId = (id) => document.getElementById(id);

  function makeNode(tag, className, text) {
    const node = document.createElement(tag);

    if (className) node.className = className;

    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }

    return node;
  }

  function money(value) {
    const amount = Number(value);

    return "৳" +
      (Number.isFinite(amount) ? amount : 0).toLocaleString("bn-BD", {
        maximumFractionDigits: 0
      });
  }

  function showPageMessage(message, type) {
    const box = byId("message");

    if (!box) return;

    box.textContent = message;
    box.className = "message " + (type || "");
    box.setAttribute("role", "alert");
    box.setAttribute("aria-live", "polite");
  }

  function setSubmitState(disabled, label) {
    const button = byId("submit-btn");

    if (!button) return;

    button.disabled = Boolean(disabled);

    if (label) {
      button.textContent = label;
    }
  }

  function statusLabel(status, expiresAt) {
    if (
      status === "active" &&
      expiresAt &&
      new Date(expiresAt) <= new Date()
    ) {
      return "মেয়াদ শেষ";
    }

    const labels = {
      payment_submitted: "পেমেন্ট যাচাই চলছে",
      active: "সক্রিয়",
      rejected: "পেমেন্ট তথ্য যাচাই হয়নি",
      expired: "মেয়াদ শেষ"
    };

    return labels[status] || "অবস্থা: " + (status || "অজানা");
  }

  function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleDateString("bn-BD", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  // Supabase থেকে সক্রিয় সাবস্ক্রিপশন প্যাকেজ লোড
  async function loadPlans() {
    const { data, error } = await sb
      .from("subscription_plans")
      .select(
        "plan_key,name,pages_per_day,monthly_price,regular_monthly_value,sort_order"
      )
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  }

  // নির্বাচিত প্যাকেজের মূল্য, ছাড় ও সুবিধা দেখানো
  function renderSelectedPlan() {
    const select = byId("plan-select");
    const target = byId("selected-plan");

    if (!select || !target) return null;

    const plan = plans.find(
      (item) => item.plan_key === select.value
    );

    target.textContent = "";

    if (!plan) {
      target.appendChild(
        makeNode(
          "p",
          "message error",
          "একটি বৈধ প্যাকেজ নির্বাচন করুন।"
        )
      );

      return null;
    }

    const dailyPages = Number(plan.pages_per_day);
    const monthlyPages = dailyPages * 30;
    const monthlyPrice = Number(plan.monthly_price);
    const regularValue = Number(plan.regular_monthly_value);

    const savings = Math.max(
      0,
      regularValue - monthlyPrice
    );

    const discount = regularValue > 0
      ? (savings / regularValue) * 100
      : 0;

    target.appendChild(
      makeNode("h2", "", plan.name)
    );

    target.appendChild(
      makeNode(
        "p",
        "",
        "প্রতিদিন " +
          dailyPages.toLocaleString("bn-BD") +
          " পেইজ (" +
          (dailyPages * 2).toLocaleString("bn-BD") +
          " পৃষ্ঠা) · ৩০ দিনে সর্বোচ্চ " +
          monthlyPages.toLocaleString("bn-BD") +
          " পেইজ"
      )
    );

    const price = makeNode(
      "p",
      "plan-price",
      money(monthlyPrice)
    );

    price.appendChild(
      makeNode("span", "", "/ ৩০ দিন")
    );

    target.appendChild(price);

    target.appendChild(
      makeNode(
        "p",
        "plan-regular",
        "নিয়মিত মূল্য " + money(regularValue)
      )
    );

    target.appendChild(
      makeNode(
        "p",
        "plan-savings",
        money(savings) +
          " সাশ্রয় · " +
          discount.toLocaleString("bn-BD", {
            maximumFractionDigits: 1
          }) +
          "% ছাড়"
      )
    );

    const list = makeNode("ul", "plan-features");

    [
      "প্রতিদিন সর্বোচ্চ " +
        dailyPages.toLocaleString("bn-BD") +
        " পেইজ (" +
        (dailyPages * 2).toLocaleString("bn-BD") +
        " পৃষ্ঠা) টাইপিং",

      "৩০ দিনে সর্বোচ্চ " +
        monthlyPages.toLocaleString("bn-BD") +
        " পেইজ",

      "সাবস্ক্রিপশন কোটা ব্যবহার করে জমা দেওয়া অর্ডারে আলাদা টাইপিং চার্জ নেই",

      "অ্যাডমিন পেমেন্ট কনফার্ম করার পর ৩০ দিনের মেয়াদ শুরু হবে"
    ].forEach((benefit) => {
      list.appendChild(makeNode("li", "", benefit));
    });

    target.appendChild(list);

    return plan;
  }

  // Admin settings থেকে বিকাশ ও নগদের নম্বর লোড
  async function loadPaymentSettings() {
    const { data, error } = await sb
      .from("payment_settings")
      .select("bkash_number,nagad_number")
      .eq("id", 1)
      .maybeSingle();

    if (error) throw error;

    return data || {
      bkash_number: "",
      nagad_number: ""
    };
  }

  // গ্রাহকের সামনে পেমেন্ট নম্বর দেখানো
  function renderPaymentMethods() {
    const target = byId("subscription-payment-numbers");
    const methodSelect = byId("subscription-method");

    const numbers = [
      {
        value: paymentSettings.bkash_number,
        method: "bkash",
        label: "বিকাশ (Personal)"
      },
      {
        value: paymentSettings.nagad_number,
        method: "nagad",
        label: "নগদ (Personal)"
      }
    ];

    if (!target || !methodSelect) return;

    target.textContent = "";
    methodSelect.textContent = "";

    const available = numbers.filter(
      (item) =>
        typeof item.value === "string" &&
        item.value.trim()
    );

    available.forEach((item) => {
      const card = makeNode("div", "payment-method-card");

      card.appendChild(
        makeNode("strong", "", item.label)
      );

      card.appendChild(
        makeNode("span", "", item.value.trim())
      );

      target.appendChild(card);

      const option = makeNode(
        "option",
        "",
        item.method === "bkash" ? "বিকাশ" : "নগদ"
      );

      option.value = item.method;

      methodSelect.appendChild(option);
    });

    if (!available.length) {
      target.appendChild(
        makeNode(
          "p",
          "payment-status pending",
          "অ্যাডমিন এখনো বিকাশ/নগদের নম্বর সেট করেননি। পরে আবার চেষ্টা করুন।"
        )
      );

      const option = makeNode(
        "option",
        "",
        "পেমেন্ট নম্বর সেট করা হয়নি"
      );

      option.value = "";
      methodSelect.appendChild(option);

      setSubmitState(true, "পেমেন্ট নম্বর পাওয়া যায়নি");

      return;
    }

    methodSelect.value = available[0].method;

    setSubmitState(false, "পেমেন্ট তথ্য জমা দিন");
  }

  // গ্রাহকের সাবস্ক্রিপশন হিস্ট্রি
  async function loadSubscriptionHistory() {
    const state = byId("subscription-history-state");
    const list = byId("subscription-history-list");

    if (!state || !list) return;

    state.style.display = "block";
    state.textContent = "সাবস্ক্রিপশন হিস্ট্রি লোড হচ্ছে...";
    list.textContent = "";

    const { data, error } = await sb
      .from("subscriptions")
      .select(
        "id,plan_key,amount,status,created_at,started_at,expires_at,admin_note"
      )
      .eq("user_id", currentSession.user.id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("Subscription history error:", error);

      state.textContent =
        "সাবস্ক্রিপশন হিস্ট্রি লোড হয়নি। SQL migration ও RLS নীতিমালা পরীক্ষা করুন।";

      return;
    }

    if (!data || data.length === 0) {
      state.textContent =
        "আপনি এখনো কোনো সাবস্ক্রিপশন আবেদন করেননি।";

      return;
    }

    state.style.display = "none";

    data.forEach((subscription) => {
      const plan = plans.find(
        (item) => item.plan_key === subscription.plan_key
      );

      const card = makeNode("article", "subscription-item");

      card.appendChild(
        makeNode(
          "h3",
          "",
          plan ? plan.name : subscription.plan_key
        )
      );

      card.appendChild(
        makeNode(
          "p",
          "",
          "অবস্থা: " +
            statusLabel(
              subscription.status,
              subscription.expires_at
            ) +
            " · মূল্য: " +
            money(subscription.amount)
        )
      );

      card.appendChild(
        makeNode(
          "p",
          "hint",
          "আবেদনের তারিখ: " +
            formatDate(subscription.created_at)
        )
      );

      if (subscription.started_at) {
        card.appendChild(
          makeNode(
            "p",
            "hint",
            "শুরু: " +
              formatDate(subscription.started_at) +
              " · মেয়াদ শেষ: " +
              formatDate(subscription.expires_at)
          )
        );
      }

      if (subscription.admin_note) {
        card.appendChild(
          makeNode(
            "p",
            "hint",
            "অ্যাডমিনের বার্তা: " +
              subscription.admin_note
          )
        );
      }

      list.appendChild(card);
    });
  }

  function isValidPhone(value) {
    return /^[0-9+\-\s]{8,20}$/.test(value);
  }

  // পেমেন্ট তথ্য জমা দেওয়া
  async function submitSubscription(event) {
    event.preventDefault();

    if (submitInProgress) return;

    if (!currentSession || !currentSession.user) {
      showPageMessage(
        "সাবস্ক্রিপশন আবেদন করতে আগে লগইন করুন।",
        "error"
      );

      return;
    }

    const plan = renderSelectedPlan();

    if (!plan) {
      showPageMessage(
        "একটি প্যাকেজ নির্বাচন করুন।",
        "error"
      );

      return;
    }

    const method = byId("subscription-method").value;

    const senderNumber =
      byId("subscription-sender").value.trim();

    const transactionId =
      byId("subscription-trx").value.trim();

    const recipientNumber =
      method === "bkash"
        ? paymentSettings.bkash_number
        : method === "nagad"
          ? paymentSettings.nagad_number
          : "";

    if (!recipientNumber) {
      showPageMessage(
        "এই পেমেন্ট মাধ্যমের নম্বর পাওয়া যাচ্ছে না। অন্য মাধ্যম বেছে নিন।",
        "error"
      );

      return;
    }

    if (!isValidPhone(senderNumber)) {
      showPageMessage(
        "যে নম্বর থেকে টাকা পাঠিয়েছেন সেটি সঠিকভাবে লিখুন।",
        "error"
      );

      byId("subscription-sender").focus();

      return;
    }

    if (
      transactionId.length < 3 ||
      transactionId.length > 100
    ) {
      showPageMessage(
        "সঠিক Transaction ID লিখুন (৩–১০০ অক্ষর)।",
        "error"
      );

      byId("subscription-trx").focus();

      return;
    }

    submitInProgress = true;

    setSubmitState(true, "তথ্য জমা হচ্ছে...");
    showPageMessage("", "");

    try {
      const { error } = await sb
        .from("subscriptions")
        .insert({
          user_id: currentSession.user.id,
          plan_key: plan.plan_key,
          amount: Number(plan.monthly_price),
          status: "payment_submitted",
          payment_method: method,
          sender_number: senderNumber,
          transaction_id: transactionId
        });

      if (error) throw error;

      byId("subscription-sender").value = "";
      byId("subscription-trx").value = "";

      showPageMessage(
        "পেমেন্ট তথ্য জমা হয়েছে। অ্যাডমিন টাকা পাওয়ার বিষয়টি যাচাই করে কনফার্ম করলে ৩০ দিনের সাবস্ক্রিপশন চালু হবে।",
        "success"
      );

      await loadSubscriptionHistory();

    } catch (error) {
      console.error("Subscription submission error:", error);

      showPageMessage(
        "আবেদন জমা হয়নি। প্যাকেজ, পেমেন্টের তথ্য, Supabase migration ও RLS পরীক্ষা করে আবার চেষ্টা করুন।",
        "error"
      );

    } finally {
      submitInProgress = false;

      const hasPaymentNumber = Boolean(
        paymentSettings.bkash_number ||
        paymentSettings.nagad_number
      );

      setSubmitState(
        !hasPaymentNumber,
        hasPaymentNumber
          ? "পেমেন্ট তথ্য জমা দিন"
          : "পেমেন্ট নম্বর পাওয়া যায়নি"
      );
    }
  }

  // Subscription page চালু করা
  window.initSubscriptionPage = async function (session) {
    currentSession = session;

    const planSelect = byId("plan-select");
    const form = byId("subscription-form");

    if (!planSelect || !form) {
      console.error(
        "Subscription page is missing required elements."
      );

      return;
    }

    setSubmitState(true, "পেজ লোড হচ্ছে...");
    showPageMessage("", "");

    try {
      plans = await loadPlans();

      planSelect.textContent = "";

      if (!plans.length) {
        throw new Error(
          "No active subscription plans were returned from Supabase."
        );
      }

      plans.forEach((plan) => {
        const option = makeNode(
          "option",
          "",
          plan.name +
            " — " +
            money(plan.monthly_price) +
            "/মাস"
        );

        option.value = plan.plan_key;

        planSelect.appendChild(option);
      });

      const requestedPlan =
        new URLSearchParams(window.location.search)
          .get("plan");

      if (
        requestedPlan &&
        plans.some(
          (plan) => plan.plan_key === requestedPlan
        )
      ) {
        planSelect.value = requestedPlan;
      }

      planSelect.addEventListener(
        "change",
        renderSelectedPlan
      );

      renderSelectedPlan();

      try {
        paymentSettings = await loadPaymentSettings();

      } catch (settingsError) {
        console.error(
          "Payment settings load error:",
          settingsError
        );

        paymentSettings = {
          bkash_number: "",
          nagad_number: ""
        };
      }

      renderPaymentMethods();

      form.addEventListener(
        "submit",
        submitSubscription
      );

      await loadSubscriptionHistory();

    } catch (error) {
      console.error(
        "Subscription page initialization error:",
        error
      );

      showPageMessage(
        "সাবস্ক্রিপশন পেজ প্রস্তুত হয়নি। Supabase configuration এবং SQL migration পরীক্ষা করুন।",
        "error"
      );

      const state =
        byId("subscription-history-state");

      if (state) {
        state.textContent =
          "সাবস্ক্রিপশন তথ্য লোড করা যায়নি।";
      }

      setSubmitState(true, "পেজ প্রস্তুত নয়");
    }
  };
})();
