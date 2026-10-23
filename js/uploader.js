// TypeBari — ফাইল আপলোডার
// কাজ: ছবি/PDF বাছাই → ছবি অটো রিসাইজ ও কমপ্রেস → Supabase Storage-এ প্রগ্রেস সহ আপলোড
// নির্ভরতা: supabase-client.js ও config.js আগে লোড হতে হবে। অন্য কোনো লাইব্রেরি লাগে না।
(function (global) {
  "use strict";

  // ---------- সেটিংস (এখান থেকেই বদলানো যাবে) ----------
  const CFG = Object.freeze({
    bucket: "order-files",
    maxFiles: 20,
    maxImageInputBytes: 30 * 1024 * 1024, // রিসাইজের আগে ছবির সর্বোচ্চ সাইজ
    maxPdfBytes: 20 * 1024 * 1024,        // PDF সরাসরি আপলোড হয়, সর্বোচ্চ সাইজ
    maxEdge: 2400,                        // ছবির বড় দিক সর্বোচ্চ এত পিক্সেল
    minEdge: 1600,                        // সাইজ কমাতে গিয়ে এর নিচে নামবে না (লেখা পড়া যাওয়ার জন্য)
    targetBytes: 1.2 * 1024 * 1024,       // রিসাইজের পর লক্ষ্য সাইজ
    startQuality: 0.85,
    minQuality: 0.6,
    processConcurrency: 2,
    uploadConcurrency: 3,
    retries: 2
  });

  const MB = 1024 * 1024;
  const bn = new Intl.NumberFormat("bn-BD", { maximumFractionDigits: 1 });
  const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

  const bytesLabel = (n) =>
    n >= MB ? bn.format(n / MB) + " MB" : bn.format(Math.max(1, Math.round(n / 1024))) + " KB";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cleanName = (s) => String(s || "file").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 150);

  class UploadError extends Error {
    constructor(code, message, retryable = false) {
      super(message);
      this.name = "UploadError";
      this.code = code;
      this.retryable = retryable;
    }
  }

  // ---------- ফাইলের আসল ধরন চেনা (নামের এক্সটেনশন নয়, ভেতরের বাইট দেখে) ----------
  function sniffBytes(h) {
    const at = (...b) => b.every((v, i) => h[i] === v);
    if (at(0xff, 0xd8, 0xff)) return "image/jpeg";
    if (at(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
    if (at(0x52, 0x49, 0x46, 0x46) && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50) return "image/webp";
    if (at(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
    return null;
  }
  async function sniffType(file) {
    return sniffBytes(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  }

  // ---------- সমান্তরাল কাজের সীমা ----------
  function createLimiter(max) {
    let active = 0;
    const queue = [];
    const next = () => {
      if (active >= max || !queue.length) return;
      active++;
      const { fn, res, rej } = queue.shift();
      fn().then(res, rej).finally(() => { active--; next(); });
    };
    return (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
  }

  async function withRetry(fn, retries) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn(attempt);
      } catch (e) {
        if (!e.retryable || attempt >= retries) throw e;
        await sleep(600 * 2 ** attempt + Math.random() * 300);
      }
    }
  }

  // ---------- ছবি রিসাইজ ----------
  // বড় দিক maxEdge-এ আনা হয়; তারপরও বড় থাকলে ধাপে ধাপে ছোট করা হয় (minEdge পর্যন্ত)
  function planSizes(w0, h0) {
    const long = Math.max(w0, h0);
    const base = Math.min(1, CFG.maxEdge / long);
    const out = [];
    [1, 0.85, 0.7].forEach((s, i) => {
      const scale = base * s;
      if (i > 0 && long * scale < CFG.minEdge) return;
      out.push({ w: Math.max(1, Math.round(w0 * scale)), h: Math.max(1, Math.round(h0 * scale)), scaled: scale < 1 });
    });
    return out;
  }

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  function canvasToBlob(canvas, type, quality) {
    if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
    return new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), type, quality));
  }

  async function decodeImage(file) {
    if ("createImageBitmap" in global) {
      try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) { /* পরের পদ্ধতি */ }
      try {
        // খুব বড় ছবি (মেমরি কম ফোনে) ডিকোডের সময়ই ছোট করে নেওয়া
        return await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: CFG.maxEdge, resizeQuality: "high" });
      } catch (_) { /* পরের পদ্ধতি */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function optimizeImage(file, mime) {
    let src;
    try {
      src = await decodeImage(file);
    } catch (e) {
      throw new UploadError("DECODE", "ছবিটি খোলা যায়নি। অন্য ছবি দিন বা JPG করে আবার চেষ্টা করুন।");
    }
    const w0 = src.naturalWidth || src.width;
    const h0 = src.naturalHeight || src.height;
    let best = null;
    let bestDims = { w: w0, h: h0, scaled: false };

    try {
      for (const dims of planSizes(w0, h0)) {
        const canvas = makeCanvas(dims.w, dims.h);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; // PNG-এর স্বচ্ছ অংশ JPEG-এ কালো হওয়া আটকাতে
        ctx.fillRect(0, 0, dims.w, dims.h);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(src, 0, 0, dims.w, dims.h);

        let q = CFG.startQuality;
        let blob = await canvasToBlob(canvas, "image/jpeg", q);
        while (blob.size > CFG.targetBytes && q > CFG.minQuality + 1e-6) {
          q = Math.max(CFG.minQuality, q - 0.07);
          blob = await canvasToBlob(canvas, "image/jpeg", q);
        }
        best = blob;
        bestDims = dims;
        if (blob.size <= CFG.targetBytes) break;
      }
    } finally {
      if (typeof src.close === "function") src.close();
    }

    // রিসাইজ না করেও যদি আসল ফাইলটাই ছোট হয়, আসলটাই রাখা
    if (!bestDims.scaled && best.size >= file.size) {
      return { blob: file, type: mime, ext: EXT[mime], width: w0, height: h0, optimized: false };
    }
    return { blob: best, type: "image/jpeg", ext: "jpg", width: bestDims.w, height: bestDims.h, optimized: true };
  }

  // ---------- Supabase Storage-এ প্রগ্রেস সহ আপলোড (XHR) ----------
  function friendlyError(status, body) {
    if (status === 0) return "ইন্টারনেট সংযোগে সমস্যা হয়েছে।";
    if (status === 401 || status === 403) return "অনুমতি নেই। পেজ রিফ্রেশ করে আবার লগইন করুন।";
    if (status === 413) return "ফাইলটি অনেক বড়।";
    if (status === 415 || /mime/i.test(body)) return "এই ধরনের ফাইল গ্রহণ করা হয় না।";
    return "আপলোড হয়নি (" + status + ")।";
  }

  function xhrUpload({ url, token, apikey, blob, contentType, onProgress }) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Authorization", "Bearer " + token);
      xhr.setRequestHeader("apikey", apikey);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        const body = xhr.responseText || "";
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        // আগের চেষ্টায় আসলে আপলোড হয়ে গিয়ে থাকলে সেটাকে সফল ধরা
        if (/duplicate|already exists/i.test(body)) return resolve();
        const retryable = xhr.status >= 500 || xhr.status === 408 || xhr.status === 429;
        reject(new UploadError("HTTP_" + xhr.status, friendlyError(xhr.status, body), retryable));
      };
      xhr.onerror = () => reject(new UploadError("NETWORK", friendlyError(0, ""), true));
      xhr.ontimeout = () => reject(new UploadError("TIMEOUT", "সময় শেষ হয়ে গেছে।", true));
      xhr.timeout = 120000;
      xhr.send(blob);
    });
  }

  // ---------- ইউআই ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function mount(root, opts = {}) {
    const items = [];
    const processLimit = createLimiter(CFG.processConcurrency);
    const uploadLimit = createLimiter(CFG.uploadConcurrency);
    let busy = false;

    root.classList.add("tb-uploader");

    const input = el("input", "tb-input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/jpeg,image/png,image/webp,application/pdf";
    input.hidden = true;

    const drop = el("div", "tb-drop");
    drop.tabIndex = 0;
    drop.setAttribute("role", "button");
    drop.setAttribute("aria-label", "ছবি বা PDF ফাইল বেছে নিন");
    drop.append(
      el("span", "tb-drop-icon", "⬆"),
      el("strong", "tb-drop-title", "ছবি বা PDF এখানে ছাড়ুন, অথবা চেপে বেছে নিন"),
      el("span", "tb-drop-sub",
        "JPG, PNG, WebP বা PDF • সর্বোচ্চ " + bn.format(CFG.maxFiles) + "টি ফাইল • ছবি অটো ছোট করে নেওয়া হবে")
    );

    const note = el("p", "tb-note");
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");
    const list = el("ul", "tb-list");

    root.append(input, drop, note, list);

    const setNote = (t) => { note.textContent = t || ""; };
    const changed = () => { if (opts.onChange) opts.onChange(api); };

    // ---- রেন্ডার ----
    function metaText(it) {
      switch (it.status) {
        case "processing": return "প্রস্তুত করা হচ্ছে...";
        case "ready":
        case "done": {
          const p = it.processed;
          const base = it.kind === "pdf" || !p.optimized
            ? bytesLabel(it.file.size)
            : bytesLabel(it.file.size) + " → " + bytesLabel(p.blob.size);
          return it.status === "done" ? base + " • আপলোড হয়েছে ✓" : base;
        }
        case "uploading": return "আপলোড হচ্ছে " + bn.format(Math.round(it.progress * 100)) + "%";
        case "error": return it.error || "সমস্যা হয়েছে";
        default: return "";
      }
    }

    function render(it) {
      if (!it.li) {
        it.li = el("li", "tb-file");
        it.thumb = el("div", "tb-thumb");
        it.name = el("div", "tb-name");
        it.meta = el("div", "tb-meta");
        it.bar = el("span", "tb-bar-fill");
        const track = el("div", "tb-bar");
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", "100");
        track.appendChild(it.bar);
        it.track = track;
        it.rm = el("button", "tb-remove", "✕");
        it.rm.type = "button";
        it.rm.setAttribute("aria-label", "মুছে ফেলুন");
        it.rm.addEventListener("click", () => removeItem(it));
        const info = el("div", "tb-info");
        info.append(it.name, it.meta, track);
        it.li.append(it.thumb, info, it.rm);
        list.appendChild(it.li);
        it.name.textContent = cleanName(it.file.name);
      }
      it.li.dataset.status = it.status;
      it.meta.textContent = metaText(it);
      const pct = it.status === "done" ? 100 : Math.round((it.progress || 0) * 100);
      it.bar.style.width = pct + "%";
      it.track.setAttribute("aria-valuenow", String(pct));
      it.rm.disabled = busy;

      if (it.processed && !it.previewUrl) {
        if (it.kind === "image") {
          it.previewUrl = URL.createObjectURL(it.processed.blob);
          const img = el("img");
          img.alt = "";
          img.src = it.previewUrl;
          it.thumb.replaceChildren(img);
        } else {
          it.thumb.replaceChildren(el("span", "tb-pdf", "PDF"));
        }
      } else if (!it.processed && it.kind === "pdf") {
        it.thumb.replaceChildren(el("span", "tb-pdf", "PDF"));
      }
    }

    function removeItem(it) {
      if (busy) return;
      const i = items.indexOf(it);
      if (i >= 0) items.splice(i, 1);
      if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      it.li.remove();
      changed();
    }

    // ---- ফাইল যোগ ----
    async function processItem(it) {
      try {
        it.processed = it.kind === "pdf"
          ? { blob: it.file, type: "application/pdf", ext: "pdf", width: null, height: null, optimized: false }
          : await optimizeImage(it.file, it.mime);
        it.status = "ready";
      } catch (e) {
        it.status = "error";
        it.error = e instanceof UploadError ? e.message : "ফাইলটি প্রস্তুত করা যায়নি।";
      }
      render(it);
      changed();
    }

    async function addFiles(fileList) {
      const msgs = [];
      for (const file of Array.from(fileList)) {
        if (items.length >= CFG.maxFiles) {
          msgs.push("সর্বোচ্চ " + bn.format(CFG.maxFiles) + "টি ফাইল দেওয়া যায়।");
          break;
        }
        const label = '"' + cleanName(file.name).slice(0, 30) + '"';
        const mime = await sniffType(file);
        if (!mime) { msgs.push(label + " — শুধু JPG, PNG, WebP বা PDF চলবে।"); continue; }
        const isPdf = mime === "application/pdf";
        if (isPdf && file.size > CFG.maxPdfBytes) {
          msgs.push(label + " — PDF " + bytesLabel(CFG.maxPdfBytes) + "-এর বেশি হতে পারবে না।");
          continue;
        }
        if (!isPdf && file.size > CFG.maxImageInputBytes) {
          msgs.push(label + " — ছবি " + bytesLabel(CFG.maxImageInputBytes) + "-এর বেশি হতে পারবে না।");
          continue;
        }
        const key = [file.name, file.size, file.lastModified].join("|");
        if (items.some((x) => x.key === key)) continue;

        const it = { key, file, mime, kind: isPdf ? "pdf" : "image", status: "processing", progress: 0 };
        items.push(it);
        render(it);
        it.processing = processLimit(() => processItem(it));
      }
      setNote(msgs.join(" "));
      changed();
    }

    // ---- আপলোড ----
    async function uploadOne(it, ctx) {
      it.status = "uploading";
      it.progress = 0;
      it.error = "";
      render(it);
      const p = it.processed;
      if (!it.path) it.path = ctx.userId + "/" + ctx.orderId + "/" + crypto.randomUUID() + "." + p.ext;
      const url = ctx.baseUrl + "/storage/v1/object/" + CFG.bucket + "/" + it.path;
      try {
        await withRetry(() => xhrUpload({
          url, token: ctx.token, apikey: ctx.apikey, blob: p.blob, contentType: p.type,
          onProgress: (f) => { it.progress = f; render(it); }
        }), CFG.retries);
        it.status = "done";
        it.progress = 1;
      } catch (e) {
        it.status = "error";
        it.error = e instanceof UploadError ? e.message : "আপলোড হয়নি।";
      }
      render(it);
    }

    // রিটার্ন: { records: [...ডাটাবেসে রাখার তথ্য], failed: [...ব্যর্থ ফাইল] }
    async function uploadAll({ userId, orderId }) {
      if (busy) throw new UploadError("BUSY", "আপলোড চলছে।");
      busy = true;
      items.forEach(render);
      const guard = (e) => { e.preventDefault(); e.returnValue = ""; };
      window.addEventListener("beforeunload", guard);
      try {
        await Promise.allSettled(items.map((i) => i.processing));

        const { data } = await sb.auth.getSession();
        const session = data && data.session;
        if (!session) throw new UploadError("AUTH", "লগইন মেয়াদ শেষ। আবার লগইন করুন।");
        const ctx = {
          userId, orderId,
          token: session.access_token,
          baseUrl: global.TYPEBARI_CONFIG.SUPABASE_URL,
          apikey: global.TYPEBARI_CONFIG.SUPABASE_ANON_KEY
        };

        const todo = items.filter((i) => i.processed && i.status !== "done");
        await Promise.all(todo.map((i) => uploadLimit(() => uploadOne(i, ctx))));

        const records = items.filter((i) => i.status === "done").map((i) => ({
          storage_path: i.path,
          original_name: cleanName(i.file.name),
          mime_type: i.processed.type,
          size_bytes: i.processed.blob.size,
          original_size_bytes: i.file.size,
          width: i.processed.width,
          height: i.processed.height
        }));
        return { records, failed: items.filter((i) => i.status === "error") };
      } finally {
        busy = false;
        window.removeEventListener("beforeunload", guard);
        items.forEach(render);
        changed();
      }
    }

    function reset() {
      items.splice(0).forEach((it) => { if (it.previewUrl) URL.revokeObjectURL(it.previewUrl); });
      list.replaceChildren();
      setNote("");
      changed();
    }

    // ---- ইভেন্ট ----
    drop.addEventListener("click", () => { if (!busy) input.click(); });
    drop.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); input.click(); }
    });
    input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("is-over");
    }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("is-over");
    }));
    drop.addEventListener("drop", (e) => { if (!busy && e.dataTransfer) addFiles(e.dataTransfer.files); });

    const api = {
      addFiles, uploadAll, reset,
      get count() { return items.length; },
      get busy() { return busy; }
    };
    return api;
  }

  global.TypeBariUploader = {
    mount, CFG,
    _internals: { sniffBytes, planSizes, createLimiter, withRetry, bytesLabel }
  };
})(window);
