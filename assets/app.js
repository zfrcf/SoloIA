/* SoloIA — application (SPA statique, aucune dépendance de build). */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const ic = (n) => '<svg class="ic"><use href="#ic-' + n + '"/></svg>';
  const LOGO = '<img class="logo" src="assets/icon.png" alt="">';

  // État (le stockage est namespacé PAR COMPTE via state.uid).
  const state = {
    user: null, uid: "guest", mode: "home", conv: null, view: "home",
    plan: "Forfait Free", ownerUnlimited: false, authMode: "signin", authView: "email",
  };
  function nskey(k) { return "soloia_" + (state.uid || "guest") + "_" + k; }
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(nskey(k))); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { localStorage.setItem(nskey(k), JSON.stringify(v)); },
  };
  let pendingFiles = [];

  // ---------- Synchronisation MongoDB (optionnelle, best-effort) ----------
  // localStorage reste TOUJOURS la source de vérité locale (synchrone, marche
  // hors-ligne). Si le backend Node (server.js) tourne avec un MONGODB_URI
  // valide, on mirroise en plus chaque écriture vers MongoDB en tâche de fond
  // — ça ne bloque jamais l'appli et échoue silencieusement si indisponible
  // (site servi en statique via server.py, pas de backend, etc.).
  function remoteSyncKey(key) {
    if (!window.REMOTE_API) return;
    try {
      fetch(window.REMOTE_API + "/" + encodeURIComponent(state.uid) + "/" + encodeURIComponent(key), {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(store.get(key, null)),
      }).catch(() => {});
    } catch (e) { /* silencieux : la persistance locale suffit */ }
  }

  // ---------- Crédits (par forfait, remis à zéro chaque mois) ----------
  const DEFAULT_CREDITS = { "Forfait Free": 1000, "SoloIA Pro": 20000, "SoloIA Max": 100000 };
  function isOwner(user) {
    const owners = (window.OWNER_EMAILS || []).map((e) => e.toLowerCase());
    return !!(user && user.email && owners.includes(String(user.email).toLowerCase()));
  }
  function creditsLimit() {
    if (state.ownerUnlimited) return Infinity;
    const table = window.PLAN_CREDITS || DEFAULT_CREDITS;
    return table[state.plan] ?? DEFAULT_CREDITS["Forfait Free"];
  }
  function ensureCreditMonth() {
    const now = new Date();
    const key = now.getFullYear() + "-" + (now.getMonth() + 1);
    if (store.get("creditsMonth", null) !== key) {
      store.set("creditsMonth", key);
      store.set("creditsUsed", 0);
    }
  }
  function creditsUsedCount() { return store.get("creditsUsed", 0); }

  // ---------- Modèles (Solo - Rapide/Moyen/Max, tous branchés sur Ollama) ----------
  function planRank(plan) {
    if (state.ownerUnlimited) return Infinity;
    const table = window.PLAN_RANK || { "Forfait Free": 0, "SoloIA Pro": 1, "SoloIA Max": 2 };
    return table[plan] ?? 0;
  }
  function tierFor(key) {
    const tiers = window.MODEL_TIERS || {};
    return tiers[key] || { label: "Solo - Rapide", minRank: 0, unit: "lettre", rate: 0.3 };
  }
  function selectedTierKey() { const el = $("#modelDropdown"); return (el && el.value) || "rapide"; }
  function countWords(t) { const m = String(t || "").trim().match(/\S+/g); return m ? m.length : 0; }
  function countSentences(t) {
    const s = String(t || "").trim();
    if (!s) return 0;
    const m = s.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
    return m ? m.filter((x) => x.trim()).length : 1;
  }
  // Coût en crédits d'un message, selon le modèle choisi :
  // Solo - Rapide (tous) : 1 lettre = 0,3 crédit · Moyen (Pro+) : 1 mot = 1 crédit
  // Max (Max) : 1 phrase = 10 crédits.
  function tokenCost(tierKey, text) {
    const t = String(text || "");
    const tier = tierFor(tierKey);
    let units;
    if (tier.unit === "mot") units = countWords(t);
    else if (tier.unit === "phrase") units = countSentences(t);
    else units = t.length;
    return Math.max(1, Math.ceil(units * tier.rate));
  }
  function refreshModelDropdown() {
    const sel = $("#modelDropdown");
    if (!sel) return;
    const rank = planRank(state.plan);
    const planNameForRank = { 0: "Free", 1: "Pro", 2: "Max" };
    Array.from(sel.options).forEach((opt) => {
      const tier = tierFor(opt.value);
      const locked = rank < tier.minRank;
      opt.disabled = locked;
      opt.textContent = locked
        ? tier.label + " (forfait " + (planNameForRank[tier.minRank] || "Max") + " requis)"
        : tier.label;
    });
    if (sel.selectedOptions[0] && sel.selectedOptions[0].disabled) sel.value = "rapide";
  }
  // Masque les incitations "Mettre à niveau" (sidebar Code + topbar) dès que
  // le forfait n'est plus Free — plus rien à vendre à quelqu'un qui a payé.
  function refreshUpsellUI() {
    const paid = planRank(state.plan) >= 1;
    $$(".upsell").forEach((el) => el.classList.toggle("hidden", paid));
    $$(".upgrade-link").forEach((el) => el.classList.toggle("hidden", paid));
  }

  function refreshCreditsUI() {
    const limit = creditsLimit();
    const used = creditsUsedCount();
    const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);
    const text = limit === Infinity
      ? "Illimité"
      : remaining + " / " + limit + " crédits";
    const cls = limit === Infinity ? "unlimited" : (remaining <= 0 ? "empty" : (remaining <= limit * 0.1 ? "low" : ""));
    const b1 = $("#creditsBadge"), b2 = $("#creditsBadge2");
    if (b1) { b1.textContent = text; b1.className = "credits-badge " + cls; }
    if (b2) { b2.innerHTML = '<svg class="ic sm"><use href="#ic-coin"/></svg> ' + esc(text); b2.className = "tokens " + cls; }
  }

  // ---------- Fichiers téléchargeables (zip / extensions personnalisées) ----------
  // 100% client (aucune dépendance, aucun backend requis) : Blob pour un
  // fichier isolé, mini-écrivain ZIP (méthode STORE, non compressé mais 100%
  // valide et lisible par n'importe quel outil) pour les archives.
  const LANG_EXT = {
    python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts",
    html: "html", css: "css", json: "json", sql: "sql", c: "c", cpp: "cpp", "c++": "cpp",
    csharp: "cs", "c#": "cs", java: "java", go: "go", golang: "go", rust: "rs", rs: "rs",
    bash: "sh", sh: "sh", shell: "sh", php: "php", ruby: "rb", rb: "rb", lua: "lua",
    kotlin: "kt", swift: "swift", yaml: "yml", yml: "yml", xml: "xml",
    markdown: "md", md: "md", text: "txt", txt: "txt", "": "txt",
  };
  // Langages rendus DIRECTEMENT par le navigateur (aperçu iframe, marche
  // partout, même hors app bureau) vs langages « programme » exécutés via le
  // pont Python (app bureau uniquement).
  const WEB_PREVIEW_LANGS = new Set(["html", "css", "svg", "javascript", "js"]);
  const RUNNABLE_LANGS = new Set(["python", "py", "javascript", "js", "typescript", "ts",
    "bash", "sh", "shell", "powershell", "ps1", "php", "ruby", "rb", "perl", "lua",
    "c", "cpp", "c++", "go", "golang", "rust", "rs", "java"]);
  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  function downloadBlobWeb(filename, content, isBinary) {
    const bytes = isBinary ? content : new TextEncoder().encode(String(content));
    const blob = new Blob([bytes], { type: isBinary ? "application/zip" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function downloadBlob(filename, content, isBinary) {
    // Dans la fenêtre bureau (pywebview), on passe par une vraie boîte
    // "Enregistrer sous" côté Python — plus fiable qu'un blob+<a download>
    // dans une webview embarquée. Dans un navigateur normal, inchangé.
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file) {
      const payload = isBinary ? bytesToBase64(content) : String(content);
      window.pywebview.api.save_file(filename, payload, !!isBinary)
        .then((res) => {
          if (res && res.ok === false && res.message !== "Enregistrement annulé.") {
            downloadBlobWeb(filename, content, isBinary);
          }
        })
        .catch(() => downloadBlobWeb(filename, content, isBinary));
      return;
    }
    downloadBlobWeb(filename, content, isBinary);
  }
  function slugify(s) {
    return (String(s || "soloia").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)) || "soloia";
  }
  const CRC_TABLE = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let crc = 0 ^ -1;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
  }
  function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
  function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }
  function safeZipName(name) { return String(name || "fichier.txt").replace(/[^A-Za-z0-9._\-/]/g, "_"); }
  // Construit un .zip valide (fichiers non compressés) à partir de
  // [{name, content(string)}, ...]. Renvoie un Uint8Array pret pour un Blob.
  function buildZip(files) {
    const enc = new TextEncoder();
    const localChunks = [], centralChunks = [];
    let offset = 0;
    files.forEach((f) => {
      const nameBytes = enc.encode(safeZipName(f.name));
      const data = enc.encode(String(f.content || ""));
      const crc = crc32(data), size = data.length, dosTime = 0, dosDate = 0x21;
      const localHeader = new Uint8Array([].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate),
        u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0)));
      localChunks.push(localHeader, nameBytes, data);
      const centralHeader = new Uint8Array([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate),
        u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset)));
      centralChunks.push(centralHeader, nameBytes);
      offset += localHeader.length + nameBytes.length + data.length;
    });
    const centralStart = offset;
    let centralSize = 0;
    centralChunks.forEach((c) => { centralSize += c.length; });
    const eocd = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralSize), u32(centralStart), u16(0)));
    const all = localChunks.concat(centralChunks, [eocd]);
    let total = 0; all.forEach((c) => { total += c.length; });
    const out = new Uint8Array(total);
    let pos = 0;
    all.forEach((c) => { out.set(c, pos); pos += c.length; });
    return out;
  }

  // ---------- Markdown minimal ----------
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const _codeBlocks = new Map(); // mid -> [{id, name, content}]
  // Si l'utilisateur a explicitement demandé un nom de fichier (ex. « crée un
  // fichier config.yaml », « fais moi setup.sh ») on utilise CE nom exact pour
  // le 1er bloc de code — extension personnalisée choisie par l'utilisateur.
  function detectCustomFilename(query) {
    const m = String(query || "").match(/\b([\w\-]+\.[A-Za-z0-9]{1,6})\b/);
    return m ? m[1] : null;
  }
  function md(text, mid, firstName) {
    const parts = String(text || "").split("```");
    let html = "";
    let blockN = 0;
    parts.forEach((c, i) => {
      if (i % 2) {
        const nl = c.indexOf("\n");
        const fenceLang = (nl >= 0 ? c.slice(0, nl) : "").trim().toLowerCase();
        const body = (nl >= 0 ? c.slice(nl + 1) : c).replace(/\n$/, "");
        html += "<pre><code>" + esc(body) + "</code></pre>";
        if (mid) {
          blockN++;
          const ext = LANG_EXT[fenceLang] || "txt";
          const fname = (blockN === 1 && firstName) ? firstName : ("extrait_" + blockN + "." + ext);
          const cid = mid + "_c" + blockN;
          if (!_codeBlocks.has(mid)) _codeBlocks.set(mid, []);
          _codeBlocks.get(mid).push({ id: cid, name: fname, content: body, lang: fenceLang });
          let actions = '<button class="dl-btn" data-download="' + cid + '">' +
            ic("download") + " " + esc(fname) + "</button>";
          // Aperçu pour les langages rendus par le navigateur (marche partout).
          if (WEB_PREVIEW_LANGS.has(fenceLang)) {
            actions += ' <button class="dl-btn" data-preview="' + cid + '">' + ic("grid") + " Aperçu</button>";
          }
          // Exécution pour les langages « programme » (Python, JS, bash...).
          if (RUNNABLE_LANGS.has(fenceLang)) {
            actions += ' <button class="dl-btn" data-run="' + cid + '">' + ic("play") + " Exécuter</button>";
          }
          html += '<div class="code-actions">' + actions + "</div>";
        }
      }
      else html += c.split("\n").map(line).join("");
    });
    return html;
  }
  function line(l) {
    if (/^###?\s+/.test(l)) return "<h3>" + inl(esc(l.replace(/^###?\s+/, ""))) + "</h3>";
    if (l.trim() === "") return "<div style='height:6px'></div>";
    if (/^-\s+/.test(l)) return "<div>• " + inl(esc(l.replace(/^-\s+/, ""))) + "</div>";
    return "<div>" + inl(esc(l)) + "</div>";
  }
  function inl(s) {
    return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }

  // ---------- Vues ----------
  const views = { landing: $("#viewLanding"), chat: $("#viewChat"), panel: $("#viewPanel") };
  function showView(name) { Object.values(views).forEach((v) => v.classList.add("hidden")); views[name].classList.remove("hidden"); }
  function setActiveNav(view) { $$(".side-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view)); }

  // ---------------- Routage (URLs propres, sans dépendance/framework) ----------------
  // /discussion /projet /skill /code /settings /login (+ "/" = home). Le
  // serveur (server.py) sert index.html pour ces chemins (SPA fallback) ;
  // ici on résout la vue à partir de location.pathname et on synchronise
  // l'URL à chaque navigation interne (History API).
  const ROUTES = {
    "/": "home", "/discussion": "discussions", "/projet": "projets",
    "/artefacts": "artefacts", "/skill": "skill", "/code": "code",
    "/settings": "settings", "/login": "login",
  };
  const PATH_FOR = {
    home: "/", discussions: "/discussion", projets: "/projet", artefacts: "/artefacts",
    skill: "/skill", code: "/code", settings: "/settings", login: "/login",
  };
  const MAIN_VIEWS = ["home", "code", "discussions", "projets", "artefacts", "skill"];
  function setPath(path, replace) {
    if (!path || location.pathname === path) return;
    history[replace ? "replaceState" : "pushState"]({ view: path }, "", path);
  }
  // Point d'entrée UNIQUE pour changer de page : câblé par la nav latérale,
  // le menu compte, les suggestions de redirection dans le chat, et le
  // routeur (popstate). Gère aussi le verrou "Code" (forfait payant requis).
  function navigateTo(view, opts) {
    opts = opts || {};
    if (view === "code" && planRank(state.plan) < 1) {
      openUpgrade();
      setPath("/code", opts.replace);
      return;
    }
    $$(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
    if (MAIN_VIEWS.includes(view)) { state.view = view; setActiveNav(view); }
    else setActiveNav(null);
    if (view === "home") { newConversation("home"); showView("landing"); }
    else if (view === "code") { newConversation("code"); showView("chat"); }
    else if (view === "discussions") renderDiscussions();
    else if (view === "projets") renderProjets();
    else if (view === "artefacts") renderArtefacts();
    else if (view === "skill") renderSkill();
    else if (view === "settings") openSettings("general");
    else if (view === "login") {
      if (isGuestUser()) openAuth();
      else { navigateTo("home", { replace: true }); return; }
    }
    if (!opts.skipPush) setPath(PATH_FOR[view] || "/", opts.replace);
  }
  function routeFromLocation() {
    navigateTo(ROUTES[location.pathname] || "home", { skipPush: true });
  }
  window.addEventListener("popstate", routeFromLocation);

  function greeting() {
    const h = new Date().getHours();
    const g = h < 5 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir";
    const name = state.user && state.user.name && state.user.name !== "Invité" ? ", " + state.user.name : "";
    $("#greetText").textContent = g + name;
  }

  function applyUser(u) {
    state.user = u || { name: "Invité", source: "guest", uid: "guest" };
    state.uid = state.user.uid || "guest";
    // Recharge les données PROPRES à ce compte (projets, discussions, plan...).
    state.plan = store.get("plan", "Forfait Free");
    // Compte propriétaire (voir window.OWNER_EMAILS) : forfait Max forcé,
    // crédits illimités, quelle que soit la méthode de connexion utilisée.
    state.ownerUnlimited = isOwner(state.user);
    if (state.ownerUnlimited) { state.plan = "SoloIA Max"; store.set("plan", state.plan); }
    const profile = store.get("profile", {});
    const initials = esc((state.user.name || "IN").slice(0, 2).toUpperCase());
    $("#accAvatar").innerHTML = profile.avatar ? '<img src="' + profile.avatar + '" alt="">' : initials;
    $("#btnAccount2").innerHTML = profile.avatar
      ? '<img src="' + profile.avatar + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">'
      : ic("user");
    $("#accName").textContent = profile.nickname || state.user.name || "Invité";
    $("#accPlan").textContent = state.plan + (state.ownerUnlimited ? " · Développeur" : "");
    $("#planLabel").textContent = state.plan;
    applyTheme(profile.theme || "system");
    applyCodePrefs();
    applyUiPrefs();
    applyCapabilities();
    ensureCreditMonth();
    refreshCreditsUI();
    refreshModelDropdown();
    refreshUpsellUI();
    renderRecents();
    rehydrateLearned();
    greeting();
  }

  // ---------------- Thème (clair / sombre / système) ----------------
  function applyTheme(theme) {
    let effective = theme || "system";
    if (effective === "system") {
      effective = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", effective);
  }

  // ---------- Import de fichiers ----------
  const TEXT_MAX = 200000;
  function openFilePicker() { $("#fileInput").click(); }
  function importFiles(files) {
    Array.from(files || []).forEach((file) => {
      if (file.type && file.type.startsWith("image/")) {
        const r = new FileReader();
        r.onload = () => { pendingFiles.push({ name: file.name, kind: "image", url: r.result }); renderAttachments(); };
        r.readAsDataURL(file);
      } else {
        if (file.size > TEXT_MAX) { pendingFiles.push({ name: file.name, kind: "text", content: "(fichier trop volumineux pour l'aperçu)", lines: 0 }); renderAttachments(); return; }
        const r = new FileReader();
        r.onload = () => { const t = String(r.result || ""); pendingFiles.push({ name: file.name, kind: "text", content: t, lines: t.split("\n").length }); renderAttachments(); };
        r.readAsText(file);
      }
    });
  }
  function renderAttachments() {
    const html = pendingFiles.map((f, i) => {
      const thumb = f.kind === "image" ? '<img class="thumb" src="' + f.url + '">' : ic("paperclip");
      return '<span class="attach">' + thumb + '<span class="name">' + esc(f.name) + '</span>' +
        '<span class="rm" data-rm="' + i + '">' + ic("x") + '</span></span>';
    }).join("");
    ["#attachments", "#attachments2"].forEach((sel) => { const b = $(sel); if (b) b.innerHTML = html; });
    $$("[data-rm]").forEach((b) => b.onclick = () => { pendingFiles.splice(+b.dataset.rm, 1); renderAttachments(); });
  }

  // ---------- Chat ----------
  function newConversation(mode) {
    state.mode = mode || "home";
    state.conv = { id: "c" + Date.now(), title: state.mode === "code" ? "Nouveau code" : "Nouvelle conversation", mode: state.mode, messages: [] };
    $("#chatTitle").innerHTML = state.mode === "code" ? ic("code") + " Code — code uniquement" : ic("home") + " Home";
    $("#messages").innerHTML = "";
  }
  function saveConversation() {
    if (!state.conv || !state.conv.messages.length) return;
    const list = store.get("convs", []);
    const idx = list.findIndex((c) => c.id === state.conv.id);
    if (idx >= 0) list[idx] = state.conv; else list.unshift(state.conv);
    store.set("convs", list.slice(0, 40)); renderRecents();
    remoteSyncKey("convs");
  }
  function renderRecents() {
    const box = $("#recentList"); box.innerHTML = "";
    store.get("convs", []).slice(0, 12).forEach((c) => {
      const b = document.createElement("button"); b.className = "recent-item"; b.textContent = c.title;
      b.onclick = () => openConversation(c); box.appendChild(b);
    });
  }
  function openConversation(c) {
    state.conv = c; state.mode = c.mode || "home";
    $("#chatTitle").innerHTML = c.mode === "code" ? ic("code") + " Code" : ic("home") + " Home";
    $("#messages").innerHTML = "";
    // Rejoue l'historique sans défilement par message (sinon N animations
    // s'empilent) : chaque bulle garde son fondu d'apparition (CSS), un seul
    // défilement fluide amène à la fin une fois tout affiché.
    let lastRow = null;
    c.messages.forEach((m) => {
      if (m.role === "user") { lastRow = addMsg("user", m.html || inl(esc(m.text)), m.reasoning, null, null, true); return; }
      const mid = nextMid();
      lastRow = addMsg("bot", md(m.text, mid), m.reasoning, m.text, mid, true);
    });
    showView("chat");
    if (lastRow) lastRow.scrollIntoView({ block: "end", behavior: "smooth" });
  }
  // ---------- Lecture audio des réponses (icône sous chaque message) ----------
  // Ouvert à TOUS les utilisateurs, quel que soit leur forfait : utilise la
  // synthèse vocale du navigateur (Web Speech API), aucune dépendance/modèle.
  let _msgCounter = 0;
  function nextMid() { return "m" + (++_msgCounter); }
  const _msgTexts = new Map();
  function speakText(rawText, btn) {
    if (!("speechSynthesis" in window)) {
      alert("La lecture vocale n'est pas prise en charge par ce navigateur.");
      return;
    }
    const synth = window.speechSynthesis;
    if (btn && btn.classList.contains("speaking")) { synth.cancel(); return; }
    synth.cancel();
    const clean = String(rawText || "")
      .replace(/```[\s\S]*?```/g, " (extrait de code, voir ci-dessus) ")
      .replace(/[#*_`]/g, "");
    const u = new SpeechSynthesisUtterance(clean);
    const vp = uiPrefs();
    u.lang = vp.voiceLang || "fr-FR";
    u.rate = vp.voiceRate || 1;
    $$(".tts-btn.speaking").forEach((b) => { b.classList.remove("speaking"); b.innerHTML = ic("speaker") + " Écouter"; });
    if (btn) { btn.classList.add("speaking"); btn.innerHTML = ic("stop") + " Arrêter"; }
    u.onend = u.onerror = () => { if (btn) { btn.classList.remove("speaking"); btn.innerHTML = ic("speaker") + " Écouter"; } };
    synth.speak(u);
  }
  $("#messages").addEventListener("click", (e) => {
    const speakBtn = e.target.closest("[data-speak]");
    if (speakBtn) { speakText(_msgTexts.get(speakBtn.dataset.speak) || "", speakBtn); return; }
    const dlBtn = e.target.closest("[data-download]");
    if (dlBtn) {
      const cid = dlBtn.dataset.download;
      for (const arr of _codeBlocks.values()) {
        const found = arr.find((b) => b.id === cid);
        if (found) { downloadBlob(found.name, found.content); break; }
      }
      return;
    }
    const zipBtn = e.target.closest("[data-zip]");
    if (zipBtn) {
      const blocks = _codeBlocks.get(zipBtn.dataset.zip) || [];
      if (!blocks.length) return;
      const zipName = slugify(state.conv && state.conv.title) + ".zip";
      downloadBlob(zipName, buildZip(blocks.map((b) => ({ name: b.name, content: b.content }))), true);
      return;
    }
    const previewBtn = e.target.closest("[data-preview]");
    if (previewBtn) { const b = findBlock(previewBtn.dataset.preview); if (b) openPreview(b); return; }
    const runBtn = e.target.closest("[data-run]");
    if (runBtn) { const b = findBlock(runBtn.dataset.run); if (b) runCodeBlock(b, runBtn); return; }
  });
  function findBlock(cid) {
    for (const arr of _codeBlocks.values()) {
      const found = arr.find((b) => b.id === cid);
      if (found) return found;
    }
    return null;
  }
  // Aperçu : HTML/CSS/SVG rendus tels quels dans une iframe sandboxée ; JS
  // seul est enveloppé dans une page minimale avec une petite console visible.
  // 100% navigateur (aucun serveur) — marche partout, même sans app bureau.
  function buildPreviewDoc(block) {
    const lang = block.lang;
    if (lang === "html") return block.content;
    if (lang === "svg") return "<!doctype html><html><body style='margin:0;display:grid;place-items:center;min-height:100vh;background:#fff'>" + block.content + "</body></html>";
    if (lang === "css") return "<!doctype html><html><head><style>" + block.content +
      "</style></head><body><h1>Titre d'exemple</h1><p>Paragraphe de démonstration avec un <a href='#'>lien</a> et un <button>bouton</button>.</p><div class='box'>Bloc .box</div></body></html>";
    // JavaScript : page vierge + capture console.log dans un encadré.
    return "<!doctype html><html><head><meta charset='utf-8'><style>body{font-family:system-ui;margin:0;padding:14px}" +
      "#__out{white-space:pre-wrap;font-family:Consolas,monospace;font-size:13px}</style></head><body><div id='__out'></div>" +
      "<script>(function(){var o=document.getElementById('__out');function w(k,a){o.textContent+=k+Array.prototype.map.call(a,function(x){try{return typeof x==='object'?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(' ')+'\\n';}" +
      "['log','info','warn','error'].forEach(function(m){var f=console[m];console[m]=function(){w(m==='log'?'':'['+m+'] ',arguments);f.apply(console,arguments)}});" +
      "window.onerror=function(msg,src,l,c){w('[erreur] ',[msg+' (ligne '+l+')']);return true};" +
      "try{\n" + block.content + "\n}catch(e){w('[erreur] ',[e.message])}})();<\/script></body></html>";
  }
  function openPreview(block) {
    $("#previewTitle").textContent = "Aperçu — " + block.name;
    const frame = $("#previewFrame");
    frame.srcdoc = buildPreviewDoc(block);
    $("#previewModal").classList.remove("hidden");
  }
  // Exécution réelle d'un programme : passe par le pont Python (app bureau).
  async function runCodeBlock(block, btn) {
    const orig = btn.innerHTML;
    if (!(window.pywebview && window.pywebview.api && window.pywebview.api.run_code)) {
      // JS peut quand même tourner dans le navigateur via l'aperçu console.
      if (block.lang === "js" || block.lang === "javascript") { openPreview(block); return; }
      showRunResult(block, false, "L'exécution de ce langage nécessite l'application bureau SoloIA (SoloIA.exe ou python main.py). En navigateur, seuls l'aperçu HTML/CSS/SVG et l'exécution JavaScript sont possibles.");
      return;
    }
    btn.disabled = true; btn.innerHTML = ic("play") + " …";
    let res;
    try { res = await window.pywebview.api.run_code(block.lang, block.content); }
    catch (e) { res = { ok: false, message: String((e && e.message) || e) }; }
    btn.disabled = false; btn.innerHTML = orig;
    showRunResult(block, !!(res && res.ok), (res && res.message) || "Aucune sortie.");
  }
  function showRunResult(block, ok, output) {
    $("#previewTitle").textContent = (ok ? "Sortie — " : "Erreur — ") + block.name;
    const frame = $("#previewFrame");
    frame.srcdoc = "<!doctype html><html><body style='margin:0;padding:14px;font-family:Consolas,monospace;font-size:13px;white-space:pre-wrap;color:" +
      (ok ? "#1a1a1a" : "#c0392b") + "'>" + esc(output) + "</body></html>";
    $("#previewModal").classList.remove("hidden");
  }

  function addMsg(role, html, reasoning, rawText, mid, skipScroll) {
    const row = document.createElement("div");
    row.className = "row " + (role === "user" ? "user" : "bot");
    const av = role === "user" ? ic("user") : LOGO;
    let inner = '<div class="msg-av">' + av + '</div><div class="bubble">';
    if (reasoning && reasoning.length) inner += '<div class="reasoning"><b>' + ic("sparkle") + ' Réflexion</b><br>' + reasoning.map(esc).join("<br>") + "</div>";
    inner += html;
    if (role !== "user") {
      const actions = [];
      if (rawText && mid) {
        _msgTexts.set(mid, rawText);
        actions.push('<button class="tts-btn" data-speak="' + mid + '">' + ic("speaker") + " Écouter</button>");
      }
      const blocks = mid ? _codeBlocks.get(mid) : null;
      if (blocks && blocks.length > 1) {
        actions.push('<button class="tts-btn" data-zip="' + mid + '">' + ic("archive") + " Tout en .zip</button>");
      }
      if (actions.length) inner += '<div class="msg-actions">' + actions.join("") + "</div>";
    }
    inner += "</div>";
    row.innerHTML = inner;
    $("#messages").appendChild(row);
    if (!skipScroll) row.scrollIntoView({ block: "end", behavior: "smooth" });
    return row;
  }
  const TYPING_HTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

  // ---------------- Plugins (capacités activables) ----------------
  // "search" est exécutable depuis un simple navigateur (accès réseau
  // simple, sans backend). Les autres (pip/zip/exe/api/pilotage système)
  // exigent un vrai accès OS : ils passent par le pont window.pywebview.api
  // (voir python/soloia/webapp.py, classe Api) et ne sont donc réels que
  // dans l'app bureau — dans un navigateur classique, on répond honnêtement
  // que la capacité nécessite l'app bureau (voir handleSystemIntent).
  const PLUGINS = [
    { id: "search", title: "Recherche internet", scope: "web",
      desc: "Cherche sur Wikipédia pour répondre à une question générale (« cherche sur internet... »)." },
    { id: "install", title: "Installation de paquets (pip)", scope: "desktop",
      desc: "Installe une dépendance Python à ta demande." },
    { id: "zip", title: "Archives ZIP", scope: "desktop",
      desc: "Compresse un dossier/fichier de ton PC." },
    { id: "exe", title: "Compilation .exe", scope: "desktop",
      desc: "Transforme un script Python en exécutable (PyInstaller)." },
    { id: "api", title: "Appels API", scope: "desktop",
      desc: "Appelle une API HTTP externe et t'en montre la réponse." },
    { id: "system", title: "Pilotage système", scope: "desktop",
      desc: "Ouvre des applis/fichiers, exécute des commandes (liste noire de sécurité)." },
  ];
  const DEFAULT_PLUGINS = { search: true, install: true, zip: true, exe: true, api: true, system: true };
  function pluginsState() { return Object.assign({}, DEFAULT_PLUGINS, store.get("plugins", {})); }
  function isPluginEnabled(id) { return pluginsState()[id] !== false; }

  // ---------------- Plugin "Recherche internet" (Wikipédia, sans backend) --
  const _SEARCH_VERBS = ["cherche", "recherche", "trouve", "googlise", "google"];
  const _WEB_TOKENS = ["internet", "web", "wikipedia", "wikipédia", "duckduckgo"];
  const _SEARCH_STOPWORDS = _SEARCH_VERBS.concat(_WEB_TOKENS).concat([
    "sur", "stp", "svp", "plait", "moi", "dis", "et", "que", "qu", "ce",
    "en", "ligne", "s'il", "te", "a", "propos", "de", "d"]);
  // Détecte une demande de recherche web explicite (verbe + mention internet/
  // web/wikipedia) et renvoie la requête nettoyée, ou null si non pertinent.
  function detectSearchQuery(text) {
    const low = stripAccentsLower(text);
    const hasVerb = _SEARCH_VERBS.some((v) => low.includes(v));
    const hasWeb = _WEB_TOKENS.some((w) => low.includes(w));
    if (!hasVerb || !hasWeb) return null;
    let q = low;
    _SEARCH_STOPWORDS.forEach((w) => {
      q = q.replace(new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g"), " ");
    });
    q = q.replace(/[?!.]/g, " ").replace(/\s+/g, " ").trim();
    return q || text.trim();
  }
  function stripAccentsLower(s) {
    return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  }
  async function handleWebSearch(text, query) {
    const reasoning = ["Compris : « " + text + " ».", "Intention : recherche internet.",
      "Recherche : « " + query + " »…"];
    if (!window.SoloIAWebSearch) {
      return { reasoning: reasoning.concat(["Plugin de recherche indisponible."]),
        answer: "La recherche internet n'est pas disponible pour l'instant.", redirect: null };
    }
    const results = await SoloIAWebSearch.search(query);
    if (!results.length) {
      reasoning.push("Aucun résultat.");
      return { reasoning, answer: "### 🌐 Recherche : « " + query + " »\n\nAucun résultat trouvé — reformule ou précise ta recherche.", redirect: null };
    }
    reasoning.push(results.length + " résultat(s) trouvé(s).");
    let answer = "### 🌐 Résultats pour « " + query + " »\n\n";
    results.forEach((r, i) => {
      answer += "**" + (i + 1) + ". " + r.title + "**\n" + (r.snippet ? r.snippet + "\n" : "") + r.url + "\n\n";
    });
    return { reasoning, answer: answer.trim(), redirect: null };
  }

  // ---------------- Plugins "système" (pip/commande/appli/zip/exe) --------
  // Détecte une demande d'action machine réelle en français courant et
  // l'associe au plugin qui la gouverne + à la méthode du pont pywebview
  // correspondante (voir python/soloia/webapp.py, classe Api). Renvoie
  // null si aucun motif ne correspond (la question part alors vers le
  // moteur SoloIA/Ollama comme d'habitude).
  function detectSystemIntent(text) {
    const t = String(text || "").trim();
    let m;
    m = t.match(/\b(?:installe|installer|install)\b(?:\s+(?:la\s+d[ée]pendance|le\s+paquet|la\s+librairie|le\s+package|le\s+module))?\s+(?:pip\s+)?["'`]?([A-Za-z0-9_.\-]+)["'`]?\s*$/i);
    if (m) return { kind: "install", label: "Installation de « " + m[1] + " » (pip)", arg: m[1], plugin: "install" };

    m = t.match(/\b(?:ex[ée]cute|ex[ée]cuter|lance|lancer|run)\b\s+(?:la\s+)?commande\s*[:\-]?\s*(.+)$/i);
    if (m) return { kind: "run_command", label: "Exécution de la commande « " + m[1].trim() + " »", arg: m[1].trim(), plugin: "system" };

    // Requête API : « envoie une requête GET à https://... » / « appelle l'API ... »
    m = t.match(/\b(?:envoie|fais|lance)\s+(?:une\s+)?requ[êe]te\s+(GET|POST|PUT|PATCH|DELETE)?\s*(?:à|a|vers|sur)?\s*(https?:\/\/\S+)/i) ||
        t.match(/\bappelle\s+l['’]?api\s+(GET|POST|PUT|PATCH|DELETE)?\s*(https?:\/\/\S+)/i) ||
        t.match(/\b(GET|POST|PUT|PATCH|DELETE)\s+(https?:\/\/\S+)/);
    if (m) return { kind: "http", label: "Requête " + ((m[1] || "GET").toUpperCase()) + " → " + m[2],
      arg: { method: (m[1] || "GET").toUpperCase(), url: m[2] }, plugin: "api" };

    m = t.match(/\bouvre\b\s+(?:le\s+site|l['’]url|le\s+lien)\s+["'«]?(\S+)["'»]?\s*$/i) || t.match(/\bouvre\b\s+(https?:\/\/\S+|www\.\S+)/i);
    if (m) return { kind: "open_url", label: "Ouverture de l'URL « " + m[1] + " »", arg: m[1], plugin: "system" };

    m = t.match(/\bouvre\b\s+(?:l['’]application|le\s+programme|l['’]appli(?:cation)?)\s+["'«]?([^"'»]+?)["'»]?\s*$/i);
    if (m) return { kind: "open_app", label: "Ouverture de l'application « " + m[1].trim() + " »", arg: m[1].trim(), plugin: "system" };

    m = t.match(/\bouvre\b\s+(?:le\s+dossier|le\s+fichier|le\s+chemin)\s+["'«]?([^"'»]+?)["'»]?\s*$/i);
    if (m) return { kind: "open_path", label: "Ouverture de « " + m[1].trim() + " »", arg: m[1].trim(), plugin: "system" };

    m = t.match(/\b(?:zippe|compresse|archive)\b\s+(?:le\s+dossier|le\s+fichier)?\s*["'«]?([^"'»]+?)["'»]?\s*$/i);
    if (m) return { kind: "zip", label: "Compression de « " + m[1].trim() + " » (.zip)", arg: m[1].trim(), plugin: "zip" };

    m = t.match(/\b(?:compile|transforme)\b\s+["'«]?([^"'»]+?)["'»]?\s+en\s+(?:ex[ée]cutable|\.?exe)\b/i);
    if (m) return { kind: "exe", label: "Compilation de « " + m[1].trim() + " » en .exe", arg: m[1].trim(), plugin: "exe" };

    if (/\b(?:informations?\s+syst[eè]me|sysinfo|infos?\s+sur\s+(?:le\s+|ce\s+)?(?:pc|ordinateur|système))\b/i.test(t)) {
      return { kind: "sysinfo", label: "Informations système", arg: "", plugin: "system" };
    }

    // Connecteurs OAuth (Paramètres → Connecteurs) : mails, agenda, drive, repos.
    if (/\b(?:mes|les)\s+(?:e-?mails?|courriels?|mails?)\b.*\bnon\s+lus?\b|\bmails?\s+non\s+lus?\b|\bregarde\s+mes\s+(?:e-?mails?|courriels?|mails?)\b/i.test(t)) {
      return { kind: "gmail", label: "Courriels non lus (Gmail)", arg: "", plugin: "api" };
    }
    if (/\bmon\s+agenda\b|\bmes\s+(?:rendez-vous|rdv|[ée]v[èé]nements)\b|\bagenda\s+(?:du\s+jour|d'aujourd)/i.test(t)) {
      return { kind: "calendar", label: "Agenda du jour (Google Agenda)", arg: "", plugin: "api" };
    }
    if (/\bmes\s+(?:derniers\s+)?fichiers\s+(?:drive|google)\b|\b(?:google\s+)?drive\b.*\br[ée]cents?\b/i.test(t)) {
      return { kind: "drive", label: "Fichiers récents (Google Drive)", arg: "", plugin: "api" };
    }
    if (/\bmes\s+(?:d[ée]p[oô]ts|repos?)\b(?:\s+github)?|\bmes\s+projets\s+github\b/i.test(t)) {
      return { kind: "github_repos", label: "Dépôts récents (GitHub)", arg: "", plugin: "api" };
    }
    return null;
  }
  async function handleSystemIntent(text, intent) {
    const reasoning = ["Compris : « " + text + " ».", "Intention détectée : " + intent.kind + "."];
    if (!(window.pywebview && window.pywebview.api)) {
      reasoning.push("Capacité machine réelle : nécessite l'application bureau SoloIA (indisponible dans un simple navigateur).");
      return {
        answer: "### 💻 Application bureau requise\n\nCette action (**" + esc(intent.label) + "**) agit vraiment sur une machine — elle n'est possible que depuis l'**application bureau SoloIA** (`python main.py` ou `SoloIA.exe`), pas dans un navigateur classique.",
        reasoning, redirect: null,
      };
    }
    const api = window.pywebview.api;
    let result;
    try {
      if (intent.kind === "install") result = await api.pip_install(intent.arg);
      else if (intent.kind === "run_command") result = await api.run_command(intent.arg);
      else if (intent.kind === "open_url") result = await api.open_url(intent.arg);
      else if (intent.kind === "open_app") result = await api.open_app(intent.arg);
      else if (intent.kind === "open_path") result = await api.open_path(intent.arg);
      else if (intent.kind === "zip") result = await api.zip_path(intent.arg);
      else if (intent.kind === "exe") result = await api.build_exe(intent.arg);
      else if (intent.kind === "sysinfo") result = await api.sysinfo();
      else if (intent.kind === "gmail") result = await api.gmail_unread();
      else if (intent.kind === "calendar") result = await api.calendar_today();
      else if (intent.kind === "drive") result = await api.drive_recent();
      else if (intent.kind === "github_repos") result = await api.github_repos();
      else if (intent.kind === "http") result = await api.http_request(intent.arg.url, intent.arg.method, "", null);
    } catch (e) {
      result = { ok: false, message: String((e && e.message) || e) };
    }
    const ok = !!(result && result.ok);
    reasoning.push(ok ? "Terminé avec succès." : "Échec.");
    let bodyText = "";
    if (ok && intent.kind === "gmail") {
      const msgs = result.messages || [];
      bodyText = msgs.length ? msgs.map((m, i) => "**" + (i + 1) + ". " + esc(m.subject) + "**\nDe : " + esc(m.from) + (m.snippet ? "\n_" + esc(m.snippet) + "_" : "")).join("\n\n")
        : "Aucun courriel non lu. 📭";
    } else if (ok && intent.kind === "calendar") {
      const evts = result.events || [];
      bodyText = evts.length ? evts.map((e2) => "- **" + esc(e2.summary) + "** — " + esc((e2.start || "").replace("T", " ").slice(0, 16))).join("\n")
        : "Rien à l'agenda aujourd'hui.";
    } else if (ok && intent.kind === "drive") {
      const files = result.files || [];
      bodyText = files.length ? files.map((f) => "- [" + esc(f.name) + "](" + esc(f.url) + ") — modifié le " + esc((f.modified || "").slice(0, 10))).join("\n")
        : "Aucun fichier récent.";
    } else if (ok && intent.kind === "github_repos") {
      const repos = result.repos || [];
      bodyText = repos.length ? repos.map((r) => "- [" + esc(r.name) + "](" + esc(r.url) + ")" + (r.private ? " 🔒" : "") + (r.description ? " — " + esc(r.description) : "")).join("\n")
        : "Aucun dépôt trouvé.";
    } else if (intent.kind === "http") {
      // Réponse d'API : on la montre dans un bloc de code (souvent du JSON).
      bodyText = (ok ? "" : "⛔ ") + "```\n" + (result && result.message ? result.message : "Aucune réponse.") + "\n```";
    } else {
      bodyText = (ok ? "✅ " : "⛔ ") + esc((result && result.message) || "Erreur inconnue.");
    }
    const answer = "### 💻 " + esc(intent.label) + "\n\n" + bodyText;
    return { answer, reasoning, redirect: null };
  }

  async function send(text) {
    text = (text || "").trim();
    const atts = pendingFiles.slice();
    pendingFiles = []; renderAttachments();
    if (!text && !atts.length) return;
    if (!state.conv) newConversation(state.mode);
    if (views.chat.classList.contains("hidden")) showView("chat");

    // Message utilisateur (texte + pièces jointes).
    let userHtml = text ? inl(esc(text)) : "";
    atts.forEach((f) => {
      if (f.kind === "image") userHtml += '<div class="attach-msg"><img class="preview" src="' + f.url + '"></div>';
      else userHtml += '<div style="margin-top:8px">' + ic("paperclip") + " <b>" + esc(f.name) + "</b> <span class='muted'>(" + f.lines + " lignes)</span></div><pre><code>" + esc(f.content.slice(0, 4000)) + (f.content.length > 4000 ? "\n… (tronqué)" : "") + "</code></pre>";
    });
    addMsg("user", userHtml);
    state.conv.messages.push({ role: "user", text: text + (atts.length ? " [+" + atts.length + " fichier(s)]" : ""), html: userHtml });
    if (state.conv.messages.length === 1) state.conv.title = (text || atts[0].name).slice(0, 40);

    // Crédits : le coût dépend du modèle choisi (Solo - Rapide/Moyen/Max).
    ensureCreditMonth();
    const tierKey = selectedTierKey();
    const cost = tokenCost(tierKey, text);
    const limit = creditsLimit();
    if (limit !== Infinity && creditsUsedCount() + cost > limit) {
      const remain = Math.max(0, limit - creditsUsedCount());
      addMsg("bot", md(
        "### ⛔ Crédits insuffisants\n\nCe message coûterait **" + cost + " crédits** (" +
        tierFor(tierKey).label + "), mais il ne t'en reste que **" + remain + "** ce " +
        "mois-ci (" + state.plan + "). Ils se renouvellent le mois prochain, ou passe à " +
        "un forfait supérieur pour continuer dès maintenant."));
      const b = document.createElement("button"); b.className = "chip"; b.style.marginTop = "6px";
      b.textContent = "Voir les forfaits"; b.onclick = openUpgrade;
      $("#messages").lastChild.querySelector(".bubble").appendChild(b);
      saveConversation();
      return;
    }

    const thinking = addMsg("bot", TYPING_HTML);

    // Réponse.
    const textFile = atts.find((a) => a.kind === "text");
    const imgFile = atts.find((a) => a.kind === "image");
    const sysIntent = (!atts.length && text) ? detectSystemIntent(text) : null;
    const searchQuery = (!atts.length && text && !sysIntent) ? detectSearchQuery(text) : null;
    let res;
    if (!text && imgFile) {
      res = { answer: "J'ai bien reçu l'image **" + esc(imgFile.name) + "**. L'analyse d'image nécessite un modèle local (Ollama/vision) — disponible en version Pro.", reasoning: [], redirect: null };
    } else if (!text && textFile) {
      res = { answer: "J'ai importé **" + esc(textFile.name) + "** (" + textFile.lines + " lignes) — je le garde en contexte. Pose ta question dessus. L'analyse complète du code arrive avec un modèle local (Ollama).", reasoning: [], redirect: null };
    } else if (sysIntent && !isPluginEnabled(sysIntent.plugin)) {
      res = {
        answer: "Cette action nécessite le plugin **" + esc(PLUGINS.find((p) => p.id === sysIntent.plugin).title) + "**, désactivé. Active-le dans **Paramètres → Plugins** pour continuer.",
        reasoning: ["Compris : « " + text + " ».", "Intention détectée : " + sysIntent.kind + ".", "Plugin désactivé par l'utilisateur."],
        redirect: null,
      };
    } else if (sysIntent) {
      res = await handleSystemIntent(text, sysIntent);
    } else if (searchQuery && !isPluginEnabled("search")) {
      res = {
        answer: "Le plugin **Recherche internet** est désactivé. Active-le dans **Paramètres → Plugins** pour que je puisse chercher sur le web.",
        reasoning: ["Compris : « " + text + " ».", "Intention : recherche internet.", "Plugin désactivé par l'utilisateur."],
        redirect: null,
      };
    } else if (searchQuery) {
      res = await handleWebSearch(text, searchQuery);
    } else {
      try { res = SoloIA.respond(text, state.mode); }
      catch (e) { res = { answer: "Erreur du moteur SoloIA.", reasoning: [], redirect: null }; }
      // Si la meilleure fiche trouvée a déjà été apprise depuis une réponse
      // Ollama précédente (tag "ollama", voir learnFromOllama), on la sert
      // directement : c'est tout l'intérêt de l'apprentissage, ne pas
      // rappeler Ollama pour une question déjà répondue.
      const alreadyLearned = !!(res.matchedEntry && (res.matchedEntry.tags || []).includes("ollama"));
      if (alreadyLearned) {
        res.reasoning = (res.reasoning || []).concat(
          ["Déjà apprise depuis une réponse Ollama précédente : servie directement depuis la base SoloIA, sans relancer Ollama."]);
      }
      // Les 3 modèles (Rapide/Moyen/Max) sont TOUS branchés sur le LLM local
      // (Ollama) par défaut. Seuls leur nom, leur accès par forfait et leur
      // coût en crédits diffèrent. Si la question n'est pas redirigée (Home
      // reste sans code, Code reste sans bavardage) et pas déjà apprise, on
      // tente une vraie génération, en contexte (RAG) sur la base SoloIA.
      if (!alreadyLearned && !res.redirect && window.SoloIAOllama) {
        const model = await ensureOllamaModel();
        if (model) {
          const ctx = SoloIA.search(text, null, 3)
            .map((r) => r[0].title + "\n" + r[0].explanation + "\n" + r[0].code).join("\n\n");
          const instructions = store.get("profile", {}).instructions || "";
          const llmText = await SoloIAOllama.generate(text, ctx, { model, instructions });
          if (llmText) {
            // Capacité "Mémoire" (Paramètres → Capacités) : désactivée, on ne
            // mémorise plus les réponses générées (elles restent affichées).
            const learned = capEnabled("learning") ? learnFromOllama(text, llmText) : false;
            res = {
              answer: llmText,
              reasoning: (res.reasoning || []).concat(
                ["Réponse enrichie par le LLM local (contexte = base SoloIA)."]
                  .concat(learned ? ["Mémorisée dans la base SoloIA : la prochaine question similaire n'aura plus besoin d'Ollama."] : [])),
              redirect: null, usedLLM: true,
            };
          } else {
            res.reasoning = (res.reasoning || []).concat(
              ["LLM local sans réponse exploitable : repli sur la base SoloIA."]);
          }
        } else {
          res.reasoning = (res.reasoning || []).concat(
            ["Aucun LLM local disponible : repli sur la base SoloIA."]);
        }
      }
    }
    thinking.remove();
    const mid = nextMid();
    const customName = detectCustomFilename(text);
    addMsg("bot", md(res.answer, mid, customName), res.reasoning, res.answer, mid);
    state.conv.messages.push({ role: "bot", text: res.answer, reasoning: res.reasoning });
    if (!state.ownerUnlimited) store.set("creditsUsed", creditsUsedCount() + cost);
    refreshCreditsUI();
    saveConversation();
    remoteSyncKey("creditsUsed");

    if (res.redirect && res.redirect !== state.mode) {
      const target = res.redirect;
      const b = document.createElement("button"); b.className = "chip"; b.style.marginTop = "10px";
      b.innerHTML = ic(target === "code" ? "code" : "home") + " Aller dans l'onglet " + (target === "code" ? "Code" : "Home");
      b.onclick = () => navigateTo(target);
      $("#messages").lastChild.querySelector(".bubble").appendChild(b);
    }
  }

  // ---------- Panneaux ----------
  function panel(title, bodyHtml) { $("#panelInner").innerHTML = "<h1>" + title + "</h1>" + bodyHtml; showView("panel"); }
  function renderDiscussions() {
    const list = store.get("convs", []);
    let h = list.length ? "" : "<div class='card muted'>Aucune discussion pour l'instant.</div>";
    list.forEach((c) => { h += "<div class='card'><b>" + esc(c.title) + "</b> <span class='muted'>· " + (c.mode === "code" ? "Code" : "Home") + " · " + c.messages.length + " messages</span><div style='margin-top:8px'><button class='linky' data-open='" + c.id + "'>Ouvrir</button></div></div>"; });
    panel(ic("chat") + " Discussions", h);
    $$("[data-open]").forEach((b) => b.onclick = () => { const c = store.get("convs", []).find((x) => x.id === b.dataset.open); if (c) openConversation(c); });
  }
  function renderProjets() {
    const projs = store.get("projects", []);
    let h = "<div class='card'><b>Nouveau projet</b><div class='field'><input id='newProj' placeholder='Nom du projet'></div><button class='primary' id='addProj'>Créer</button></div>";
    h += projs.length ? "" : "<div class='card muted'>Aucun projet.</div>";
    projs.forEach((p) => h += "<div class='card'>" + ic("folder") + " <b>" + esc(p.name) + "</b> <span class='muted'>· " + (p.files || 0) + " fichier(s)</span></div>");
    panel(ic("folder") + " Projets", h);
    if ($("#addProj")) $("#addProj").onclick = () => { const n = ($("#newProj").value || "").trim(); if (!n) return; const l = store.get("projects", []); l.unshift({ name: n, files: 0 }); store.set("projects", l); remoteSyncKey("projects"); renderProjets(); };
  }
  function renderArtefacts() {
    const arts = store.get("artefacts", []);
    let h = "<div class='card muted'>Les <b>artéfacts</b> sont les blocs de code que tu sauvegardes depuis l'onglet Code.</div>";
    arts.forEach((a) => h += "<div class='card'>" + ic("grid") + " <b>" + esc(a.title) + "</b><pre style='max-height:160px'><code>" + esc(a.code) + "</code></pre></div>");
    if (!arts.length) h += "<div class='card muted'>Aucun artéfact pour l'instant.</div>";
    panel(ic("grid") + " Artéfacts", h);
  }
  // Skills = raccourcis vers de bonnes questions prêtes à l'emploi. Elles
  // préparent le composer (rien n'est envoyé tant que l'utilisateur n'a pas
  // complété/validé) et vont vers l'onglet Code, qui seul a la puissance de
  // l'IA locale nécessaire pour ce genre d'analyse (l'onglet Home resterait
  // en mode dégradé sur ces demandes, voir engine.js).
  //
  // Format .skill (frontmatter + gabarit — même format que le mode bureau,
  // voir python/soloia/skill_tools.py) :
  //   ---
  //   title: Réviser mon code
  //   icon: sparkle
  //   description: Relecture et suggestions concrètes.
  //   ---
  //   Relis ce code et propose des améliorations concrètes :
  //
  // Dans l'app bureau (pywebview), la liste vient de vrais fichiers .skill
  // sur disque (fournis + importés, voir Api.list_skills/import_skill_file
  // dans webapp.py). Dans un navigateur classique, on garde une liste
  // intégrée équivalente + les .skill importés via le bouton (lus avec
  // FileReader, stockés dans localStorage).
  const BUILTIN_SKILLS = [
    { id: "review", icon: "sparkle", title: "Réviser mon code", desc: "Relecture et suggestions concrètes.",
      template: "Relis ce code et propose des améliorations concrètes :\n\n```\n\n```" },
    { id: "tests", icon: "code", title: "Générer des tests", desc: "Tests unitaires prêts à l'emploi.",
      template: "Écris des tests unitaires pour ce code :\n\n```\n\n```" },
    { id: "explain", icon: "book", title: "Expliquer un extrait", desc: "Explication ligne par ligne.",
      template: "Explique ce que fait ce code, ligne par ligne :\n\n```\n\n```" },
    { id: "bug", icon: "sliders", title: "Trouver un bug", desc: "Diagnostic et correction.",
      template: "Trouve le bug dans ce code et corrige-le :\n\n```\n\n```" },
    { id: "translate", icon: "swap", title: "Traduire vers un autre langage", desc: "Ex. Python → JavaScript.",
      template: "Traduis ce code de Python vers JavaScript, en gardant le même comportement :\n\n```\n\n```" },
    { id: "optimize", icon: "sparkle", title: "Optimiser les performances", desc: "Complexité, mémoire, lisibilité.",
      template: "Optimise ce code pour de meilleures performances, sans changer son comportement :\n\n```\n\n```" },
    { id: "document", icon: "edit", title: "Documenter", desc: "Commentaires et docstring.",
      template: "Ajoute des commentaires utiles et une docstring à ce code :\n\n```\n\n```" },
  ];
  const SKILL_ICONS = new Set(["sparkle", "code", "book", "sliders", "swap", "edit", "puzzle",
    "chat", "folder", "grid", "gear", "plus", "search", "paperclip", "mic", "x", "speaker", "stop", "home"]);
  // Parse le texte d'un fichier .skill — miroir de skill_tools.parse_skill_text (Python).
  function parseSkillFile(text, fallbackId) {
    const raw = String(text || "").replace(/\r\n/g, "\n");
    const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    const meta = {};
    let body = raw;
    if (m) {
      body = m[2];
      m[1].split("\n").forEach((line) => {
        line = line.trim();
        const idx = line.indexOf(":");
        if (!line || line.startsWith("#") || idx === -1) return;
        meta[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
      });
    }
    const title = meta.title || meta.name;
    if (!title) return null;
    return {
      id: (meta.id || fallbackId || "skill").trim() || fallbackId || "skill",
      title, desc: meta.description || meta.desc || "",
      icon: SKILL_ICONS.has(meta.icon) ? meta.icon : "puzzle",
      template: body.replace(/^\n+|\n+$/g, ""),
    };
  }
  function getCustomSkills() { return store.get("customSkills", []); }
  function saveCustomSkill(skill) {
    const list = getCustomSkills().filter((s) => s.id !== skill.id);
    list.push(skill);
    store.set("customSkills", list);
    remoteSyncKey("customSkills");
  }
  let _skillsCache = null;
  async function loadAllSkills() {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.list_skills) {
      const res = await window.pywebview.api.list_skills();
      if (res && res.ok && res.skills && res.skills.length) return res.skills;
    }
    return BUILTIN_SKILLS.concat(getCustomSkills());
  }
  function importSkillFromBrowser(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const fallbackId = slugify(file.name.replace(/\.skill$/i, ""));
      const skill = parseSkillFile(reader.result, fallbackId);
      if (!skill) { alert("Fichier .skill invalide : il manque un « title: » dans l'en-tête."); return; }
      saveCustomSkill(skill);
      renderSkill();
    };
    reader.readAsText(file);
  }
  $("#skillFileInput").onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) importSkillFromBrowser(file);
  };
  function wireSkillCards(skills) {
    $$("[data-skill]").forEach((b) => b.onclick = () => {
      const skill = skills.find((s) => s.id === b.dataset.skill);
      if (!skill) return;
      navigateTo("code");
      setTimeout(() => {
        const el = $("#input2");
        if (!el) return;
        el.value = skill.template;
        el.focus();
        const pos = el.value.indexOf("```");
        el.setSelectionRange(pos < 0 ? el.value.length : pos + 4, pos < 0 ? el.value.length : pos + 4);
        el.dispatchEvent(new Event("input"));
      }, 30);
    });
    const importBtn = $("#skillImportBtn");
    if (importBtn) importBtn.onclick = async () => {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.import_skill_file) {
        const res = await window.pywebview.api.import_skill_file();
        if (res && res.message) alert(res.message);
        renderSkill();
        return;
      }
      $("#skillFileInput").click();
    };
    const runBtn = $("#jsonToolRun");
    if (runBtn) runBtn.onclick = () => {
      const raw = $("#jsonToolInput").value;
      const status = $("#jsonToolStatus"), out = $("#jsonToolOutput");
      try {
        const parsed = JSON.parse(raw);
        out.querySelector("code").textContent = JSON.stringify(parsed, null, 2);
        out.style.display = "block";
        status.textContent = "✓ JSON valide.";
        status.style.color = "var(--accent-2)";
      } catch (e) {
        out.style.display = "none";
        status.textContent = "✗ JSON invalide : " + e.message;
        status.style.color = "#c0392b";
      }
    };
  }
  function renderSkillsPanel(skills) {
    let h = "<div class='card muted'>Les skills préparent une bonne question pour SoloIA — rien n'est envoyé tant que tu n'as pas complété et validé.</div>";
    h += "<div class='skills-grid'>";
    skills.forEach((s) => {
      h += "<button class='skill-card' data-skill='" + esc(s.id) + "'>" + ic(s.icon || "puzzle") +
        "<span><b>" + esc(s.title) + "</b><span class='hint' style='display:block;margin-top:3px'>" + esc(s.desc || "") + "</span></span></button>";
    });
    h += "</div>";
    h += "<div style='margin-top:14px'><button class='chip' id='skillImportBtn'>" + ic("plus") + " Importer un fichier .skill…</button></div>";
    h += "<h3 style='margin-top:26px;font-size:13px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted-txt)'>Outil instantané</h3>";
    h += "<div class='card'>" + ic("puzzle") + " <b>Formatter / valider du JSON</b>" +
      "<div class='hint' style='margin:4px 0 8px'>100% local, aucune IA nécessaire — colle ton JSON, il est formaté ou tu vois l'erreur exacte.</div>" +
      "<textarea id='jsonToolInput' rows='6' placeholder='Colle ton JSON ici…' style='width:100%;font-family:Consolas,monospace;font-size:12.5px;padding:10px;border:1px solid var(--border-strong);border-radius:10px;background:var(--panel);color:var(--fg)'></textarea>" +
      "<div style='margin-top:8px'><button class='primary' id='jsonToolRun'>Formatter</button> <span id='jsonToolStatus' class='hint' style='margin-left:8px'></span></div>" +
      "<pre id='jsonToolOutput' style='display:none;margin-top:10px;max-height:240px;overflow:auto'><code></code></pre></div>";
    panel(ic("puzzle") + " Skills", h);
    wireSkillCards(skills);
  }
  function renderSkill() {
    if (_skillsCache) renderSkillsPanel(_skillsCache);
    else renderSkillsPanel(BUILTIN_SKILLS.concat(getCustomSkills()));
    loadAllSkills().then((skills) => {
      _skillsCache = skills;
      if (!views.panel.classList.contains("hidden") && state.view === "skill") renderSkillsPanel(skills);
    });
  }
  // ---------- Paramètres (avatar, profil, instructions, apparence...) ----------
  function readAvatarFile(file, cb) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const c2d = canvas.getContext("2d");
        const s = Math.min(img.width, img.height);
        c2d.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        cb(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  $("#avatarInput").onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    readAvatarFile(file, (dataUrl) => {
      const p = store.get("profile", {});
      p.avatar = dataUrl;
      store.set("profile", p);
      remoteSyncKey("profile");
      applyUser(state.user);
      if (!$("#settingsModal").classList.contains("hidden")) renderSettingsGeneral();
    });
  };

  function openSettings(section) {
    $("#settingsModal").classList.remove("hidden");
    const search = $("#settingsSearch");
    if (search) { search.value = ""; filterSettingsNav(""); }
    showSettingsSection(section || "general");
  }
  function showSettingsSection(key) {
    $$(".settings-nav-item").forEach((b) => b.classList.toggle("active", b.dataset.settings === key));
    const renderers = {
      general: renderSettingsGeneral, account: renderSettingsAccount,
      plugins: renderSettingsPlugins, connectors: renderSettingsConnectors,
      privacy: renderSettingsPrivacy, billing: renderSettingsBilling,
      usage: renderSettingsUsage, capabilities: renderSettingsCapabilities,
      code: renderSettingsCode, desktop: renderSettingsDesktop,
      skills: renderSettingsSkills,
    };
    (renderers[key] || renderSettingsGeneral)();
  }
  $$(".settings-nav-item").forEach((b) => b.onclick = () => showSettingsSection(b.dataset.settings));
  // Recherche dans les paramètres : filtre les entrées de navigation, et les
  // titres de groupe disparaissent quand toutes leurs entrées sont masquées.
  function filterSettingsNav(query) {
    const q = query.trim().toLowerCase();
    let firstVisible = null;
    $$(".settings-nav-item").forEach((b) => {
      const match = !q || b.textContent.toLowerCase().includes(q);
      b.classList.toggle("hidden", !match);
      if (match && !firstVisible) firstVisible = b;
    });
    $$(".settings-nav-group").forEach((g) => {
      let el = g.nextElementSibling, any = false;
      while (el && !el.classList.contains("settings-nav-group")) {
        if (el.classList.contains("settings-nav-item") && !el.classList.contains("hidden")) any = true;
        el = el.nextElementSibling;
      }
      g.classList.toggle("hidden", !any);
    });
    if (q && firstVisible) showSettingsSection(firstVisible.dataset.settings);
  }
  if ($("#settingsSearch")) $("#settingsSearch").addEventListener("input", (e) => filterSettingsNav(e.target.value));

  // Capacités activables (réelles) : mémoire/apprentissage et artéfacts.
  function capsState() { return Object.assign({ learning: true, artifacts: true }, store.get("capabilities", {})); }
  function capEnabled(id) { return capsState()[id] !== false; }

  // Préférences d'interface (façon captures Claude) — stockées par compte,
  // avec effet RÉEL : "motion" coupe les animations, "chatFont" change la
  // police des messages, la voix pilote la synthèse vocale (speakText).
  const UI_PREF_DEFAULTS = {
    chatFont: "serif", motion: "system", voiceLang: "fr-FR", voiceRate: 1,
    notifDone: true, notifCode: true, notifAuth: true, notifEmail: false,
    memorySearch: false, connectorSearch: true, modelSwitch: true,
    aiArtifacts: false, integratedViz: true, highContrast: false,
    interfaceFont: "sans", sessionStates: true,
  };
  function uiPrefs() { return Object.assign({}, UI_PREF_DEFAULTS, store.get("uiprefs", {})); }
  function setUiPref(key, value) { const p = uiPrefs(); p[key] = value; store.set("uiprefs", p); remoteSyncKey("uiprefs"); }
  function applyUiPrefs() {
    const p = uiPrefs();
    const root = document.documentElement;
    // Mouvement réduit : coupe toutes les animations/transitions.
    let reduce = p.motion === "reduce";
    if (p.motion === "system") reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    root.classList.toggle("reduce-motion", reduce);
    // Police de discussion.
    root.style.setProperty("--chat-font", p.chatFont === "sans" ? "var(--sans)" : p.chatFont === "mono" ? "Consolas, monospace" : "var(--serif)");
    root.style.setProperty("--ui-font", p.interfaceFont === "system" ? "system-ui, sans-serif" : "var(--sans)");
    root.classList.toggle("high-contrast", !!p.highContrast);
  }
  // Rangée à bascule réutilisable (titre + description + interrupteur), pour
  // reproduire fidèlement les sections de Paramètres des captures.
  function toggleRow(id, title, desc, checked) {
    return "<div class='settings-card plugin-row'><div><b>" + esc(title) + "</b>" +
      (desc ? "<div class='hint' style='margin-top:3px'>" + desc + "</div>" : "") + "</div>" +
      "<label class='plugin-switch'><input type='checkbox' data-uitoggle='" + id + "'" + (checked ? " checked" : "") + "><span></span></label></div>";
  }
  function wireToggleRows(onChange) {
    $$("[data-uitoggle]").forEach((cb) => cb.onchange = () => onChange(cb.dataset.uitoggle, cb.checked));
  }

  const JOBS = ["Développeur / Ingénieur", "Étudiant", "Data / IA", "Chef de projet", "Autre"];
  function renderSettingsGeneral() {
    const p = store.get("profile", {});
    const theme = p.theme || "system";
    const body = $("#settingsBody");
    body.innerHTML =
      "<h3>Profil</h3>" +
      "<div class='settings-row'>" +
      "<div class='settings-avatar' id='avatarPreview'>" +
      (p.avatar ? '<img src="' + p.avatar + '" alt="">' : esc((state.user && state.user.name || "IN").slice(0, 2).toUpperCase())) +
      "<div class='cam-overlay'>" + ic("camera") + "</div></div>" +
      "<div class='field'><label>Photo de profil</label><div class='hint'>Clique sur l'avatar pour en choisir une — stockée uniquement sur cet appareil.</div></div>" +
      "</div>" +
      "<div class='field'><label>Nom complet</label><input id='setFullName' value=\"" + esc(p.fullName || (state.user && state.user.name) || "") + "\"></div>" +
      "<div class='field'><label>Comment souhaitez-vous que SoloIA vous appelle ?</label><input id='setNickname' placeholder='Surnom (optionnel)' value=\"" + esc(p.nickname || "") + "\"></div>" +
      "<div class='field'><label>Quelle est la meilleure description de votre travail ?</label><select id='setJob'>" +
      "<option value=''>— Choisir —</option>" +
      JOBS.map((j) => "<option " + (p.job === j ? "selected" : "") + ">" + j + "</option>").join("") +
      "</select></div>" +
      "<div class='field'><label>Instructions personnalisées pour SoloIA</label>" +
      "<textarea id='setInstructions' placeholder=\"Ex. : réponds toujours avec des exemples concrets, je préfère Python, sois direct...\">" + esc(p.instructions || "") + "</textarea>" +
      "<div class='hint'>Transmises au modèle local (Ollama) à chaque réponse générée.</div></div>" +
      "<button class='primary' id='saveGeneral' style='margin-top:6px'>Enregistrer</button>";
    // ----- Apparence / Police / Mouvement / Voix / Notifications -----
    const u = uiPrefs();
    const seg = (id, opts, cur) => "<div class='seg-toggle' data-uiseg='" + id + "'>" +
      opts.map((o) => "<button class='seg-opt" + (o.v === cur ? " active" : "") + "' data-v='" + o.v + "'>" + esc(o.label) + "</button>").join("") + "</div>";
    const rowFlex = (title, desc, control) => "<div class='settings-card plugin-row'><div><b>" + esc(title) + "</b>" +
      (desc ? "<div class='hint' style='margin-top:3px'>" + esc(desc) + "</div>" : "") + "</div>" + control + "</div>";
    body.innerHTML +=
      "<h3>Apparence</h3>" +
      rowFlex("Thème", "", "<div class='theme-toggle'>" +
        "<button class='theme-opt" + (theme === "light" ? " active" : "") + "' data-theme='light'>" + ic("sun") + "</button>" +
        "<button class='theme-opt" + (theme === "dark" ? " active" : "") + "' data-theme='dark'>" + ic("moon") + "</button>" +
        "<button class='theme-opt" + (theme === "system" ? " active" : "") + "' data-theme='system'>" + ic("monitor") + "</button></div>") +
      rowFlex("Police de discussion", "", "<select id='uiChatFont' class='mini-select'>" +
        [["serif", "SoloIA Serif"], ["sans", "SoloIA Sans"], ["mono", "Monospace"]].map((o) => "<option value='" + o[0] + "'" + (u.chatFont === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select>") +
      rowFlex("Mouvement", "Réduire les animations dans les réponses en streaming et les autres éléments d'interface.", seg("motion", [{ v: "system", label: "Système" }, { v: "reduce", label: "Réduit" }], u.motion)) +
      "<h3>Voix</h3>" +
      rowFlex("Langue", "Voix utilisée pour lire les réponses à voix haute.", "<select id='uiVoiceLang' class='mini-select'>" +
        [["fr-FR", "Français"], ["en-US", "Anglais"], ["es-ES", "Espagnol"], ["de-DE", "Allemand"]].map((o) => "<option value='" + o[0] + "'" + (u.voiceLang === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select>") +
      rowFlex("Vitesse", "", seg("voiceRate", [{ v: "0.8", label: "Lent" }, { v: "1", label: "Normal" }, { v: "1.4", label: "Rapide" }], String(u.voiceRate))) +
      "<h3>Notifications</h3>" +
      toggleRow("notifDone", "Complétions de réponse", "Être averti lorsque SoloIA a terminé une réponse. Utile pour les tâches longues.", u.notifDone) +
      toggleRow("notifCode", "Notifications de code", "SoloIA peut vous notifier des mises à jour importantes d'une session de code.", u.notifCode) +
      toggleRow("notifAuth", "Demandes d'autorisation", "Recevoir une notification lorsque SoloIA a besoin d'une autorisation pour exécuter une commande.", u.notifAuth) +
      toggleRow("notifEmail", "E-mails", "Recevoir un e-mail lorsqu'une tâche longue est terminée (nécessite un compte connecté).", u.notifEmail);
    $("#avatarPreview").onclick = () => $("#avatarInput").click();
    $$(".theme-opt").forEach((b) => b.onclick = () => {
      const pp = store.get("profile", {});
      pp.theme = b.dataset.theme; store.set("profile", pp); remoteSyncKey("profile");
      applyTheme(pp.theme); renderSettingsGeneral();
    });
    $("#uiChatFont").onchange = (e) => { setUiPref("chatFont", e.target.value); applyUiPrefs(); };
    $("#uiVoiceLang").onchange = (e) => setUiPref("voiceLang", e.target.value);
    $$("[data-uiseg]").forEach((seg2) => $$(".seg-opt", seg2).forEach((b) => b.onclick = () => {
      const key = seg2.dataset.uiseg;
      setUiPref(key, key === "voiceRate" ? parseFloat(b.dataset.v) : b.dataset.v);
      applyUiPrefs(); renderSettingsGeneral();
    }));
    wireToggleRows((id, val) => setUiPref(id, val));
    $("#saveGeneral").onclick = () => {
      const pp = store.get("profile", {});
      pp.fullName = $("#setFullName").value.trim();
      pp.nickname = $("#setNickname").value.trim();
      pp.job = $("#setJob").value;
      pp.instructions = $("#setInstructions").value;
      store.set("profile", pp); remoteSyncKey("profile");
      if (state.user && pp.fullName) state.user.name = pp.fullName;
      applyUser(state.user);
      $("#saveGeneral").textContent = "Enregistré";
      setTimeout(() => { if ($("#saveGeneral")) $("#saveGeneral").textContent = "Enregistrer"; }, 1500);
    };
  }
  function renderSettingsAccount() {
    const body = $("#settingsBody");
    const email = (state.user && state.user.email) || "Invité (hors-ligne)";
    const source = (state.user && state.user.source) || "invité";
    // Session courante réelle (pas de fausse liste d'appareils fabriquée).
    const nav = navigator;
    const device = /Windows/.test(nav.userAgent) ? "Windows" : /Mac/.test(nav.userAgent) ? "macOS" : /Android/.test(nav.userAgent) ? "Android" : /iPhone|iPad/.test(nav.userAgent) ? "iOS" : "Cet appareil";
    const browser = /Edg/.test(nav.userAgent) ? "Edge" : /Chrome/.test(nav.userAgent) ? "Chrome" : /Firefox/.test(nav.userAgent) ? "Firefox" : /Safari/.test(nav.userAgent) ? "Safari" : "Navigateur";
    body.innerHTML =
      "<h3>Compte</h3>" +
      "<div class='settings-card'><div><b>" + esc(email) + "</b></div>" +
      "<div class='hint' style='margin-top:4px'>Connexion : " + esc(source) + "</div></div>" +
      "<div class='settings-card plugin-row'><div><b>Se déconnecter de cet appareil</b>" +
      "<div class='hint' style='margin-top:3px'>Ferme la session locale sur ce navigateur.</div></div>" +
      "<button class='chip' id='setLogout'>Se déconnecter</button></div>" +
      "<div class='settings-card plugin-row'><div><b>Effacer le compte local</b>" +
      "<div class='hint' style='margin-top:3px'>Supprime toutes les données de ce compte sur cet appareil (irréversible).</div></div>" +
      "<button class='chip' id='setDeleteLocal' style='color:#c0392b'>Supprimer</button></div>" +
      "<div class='settings-card plugin-row'><div><b>Identifiant du compte</b></div>" +
      "<code class='hint'>" + esc(state.uid || "guest") + "</code></div>" +
      "<h3>Sessions actives</h3>" +
      "<div class='settings-card' style='padding:0'>" +
      "<div class='directory-row'><div class='grow'><b>" + esc(browser + " (" + device + ")") + "</b>" +
      "<span class='hint' style='display:block'>Session courante · " + (source === "invité" ? "local" : esc(source)) + "</span></div>" +
      "<span class='badge-actuel'>Actuel</span></div></div>" +
      "<div class='hint' style='margin-top:8px'>SoloIA est local : il n'y a pas de sessions distantes à gérer. Une seule session par navigateur.</div>";
    $("#setLogout").onclick = async () => { await SoloIAAuth.signOut(); applyUser(SoloIAAuth.guest()); navigateTo("home"); };
    $("#setDeleteLocal").onclick = () => {
      if (!confirm("Supprimer TOUTES les données locales de ce compte (discussions, projets, réglages, mémoire) ?")) return;
      Object.keys(localStorage).filter((k) => k.startsWith("soloia_" + (state.uid || "guest") + "_")).forEach((k) => localStorage.removeItem(k));
      location.reload();
    };
  }
  function renderSettingsPlugins() {
    const state2 = pluginsState();
    const body = $("#settingsBody");
    let h = "<h3>Plugins</h3>" +
      "<div class='card muted'>Active ou désactive les capacités que SoloIA peut utiliser. Certains plugins demandent un accès système réel et ne sont donc disponibles que dans l'app bureau.</div>";
    PLUGINS.forEach((p) => {
      const enabled = state2[p.id] !== false;
      h += "<div class='settings-card plugin-row'>" +
        "<div><b>" + esc(p.title) + "</b>" +
        (p.scope === "desktop" ? " <span class='hint'>(app bureau)</span>" : " <span class='hint'>(disponible ici)</span>") +
        "<div class='hint' style='margin-top:3px'>" + esc(p.desc) + "</div></div>" +
        "<label class='plugin-switch'><input type='checkbox' data-plugin='" + p.id + "'" + (enabled ? " checked" : "") + "><span></span></label>" +
        "</div>";
    });
    body.innerHTML = h;
    $$("[data-plugin]").forEach((cb) => cb.onchange = () => {
      const s = pluginsState();
      s[cb.dataset.plugin] = cb.checked;
      store.set("plugins", s);
      remoteSyncKey("plugins");
    });
  }
  async function renderSettingsConnectors() {
    const body = $("#settingsBody");
    body.innerHTML =
      "<h3>Connecteurs</h3><div class='card muted'>Connecte tes applications : SoloIA pourra les utiliser à ta demande, sans écrire une ligne de code.</div>" +
      "<div id='oauthList'><div class='hint'>Vérification…</div></div>" +
      "<h3 style='margin-top:22px'>Services internes</h3>" +
      "<div id='connectorsList'><div class='hint'>Vérification…</div></div>";
    renderOauthConnectors();
    let ollamaOk = false;
    try { ollamaOk = !!(window.SoloIAOllama && await SoloIAOllama.isAvailable(1200)); } catch (e) { ollamaOk = false; }
    const authReady = !!(window.SoloIAAuth && SoloIAAuth.ready && SoloIAAuth.ready());
    // MongoDB : ne pas se fier a la simple presence de window.REMOTE_API (un
    // simple string de config, toujours "vrai" que le backend Node tourne ou
    // non) — sonde reellement l'endpoint. server.py (statique) renvoie 404
    // generique sur un chemin inconnu ; server.js (Node/Express) repond avec
    // un vrai statut (200 ou 503 "Mongo non configure") sur cette meme route :
    // un 404 signifie donc "pas de backend Node du tout".
    let mongoOk = false;
    if (window.REMOTE_API) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 1200);
        const r = await fetch(window.REMOTE_API + "/_ping/_ping", { signal: ctrl.signal });
        clearTimeout(t);
        mongoOk = r.status !== 404;
      } catch (e) { mongoOk = false; }
    }
    const rows = [
      { name: "IA locale (Ollama)", ok: ollamaOk, detail: ollamaOk ? "Connecté — les réponses peuvent être enrichies par l'IA locale." : "Non détecté — SoloIA répond depuis sa base de connaissances." },
      { name: "Comptes (Firebase)", ok: authReady, detail: authReady ? "Connecté — email/mot de passe, Google, Apple, téléphone disponibles." : "Mode invité local uniquement (hors-ligne)." },
      { name: "Synchronisation (MongoDB)", ok: mongoOk, detail: mongoOk ? "Backend joignable — sauvegarde en tâche de fond." : "Aucun backend Node détecté (optionnel, localStorage suffit)." },
      { name: "Paiement (PayPal)", ok: !!window.PAYPAL_CLIENT_ID, detail: window.PAYPAL_CLIENT_ID ? "Clé configurée — abonnements réels actifs." : "Non configuré (mode démo pour Pro/Max)." },
    ];
    const list = $("#connectorsList");
    if (list) {
      list.innerHTML = rows.map((r) =>
        "<div class='settings-card connector-row'>" +
        "<div><b>" + esc(r.name) + "</b><div class='hint' style='margin-top:3px'>" + esc(r.detail) + "</div></div>" +
        "<span class='connector-dot " + (r.ok ? "ok" : "off") + "' title='" + (r.ok ? "Connecté" : "Non connecté") + "'></span>" +
        "</div>"
      ).join("");
    }
  }
  // Connecteurs OAuth (GitHub / Google) — réels uniquement via le pont bureau
  // (les API OAuth exigent un vrai flux navigateur système + stockage local,
  // voir python/soloia/oauth_tools.py). En navigateur pur : message honnête.
  async function renderOauthConnectors() {
    const box = $("#oauthList");
    if (!box) return;
    const bridge = window.pywebview && window.pywebview.api && window.pywebview.api.connectors_status;
    if (!bridge) {
      box.innerHTML = "<div class='settings-card'><b>GitHub, Gmail, Google Agenda, Google Drive</b>" +
        "<div class='hint' style='margin-top:3px'>Disponibles dans l'application bureau (SoloIA.exe ou python main.py) — un navigateur seul ne peut pas stocker ces connexions de façon sûre.</div></div>";
      return;
    }
    const st = await window.pywebview.api.connectors_status();
    if (!st || !st.ok) {
      box.innerHTML = "<div class='settings-card'><b>Connecteurs indisponibles</b><div class='hint'>" + esc((st && st.message) || "Erreur du pont bureau.") + "</div></div>";
      return;
    }
    const gh = st.github || {}, gg = st.google || {};
    const logo = (bg, label) => "<span class='connector-logo' style='background:" + bg + "'>" + label + "</span>";
    // Un service connectable : logo + nom + description + bouton Connecter/
    // Déconnecter (btnId), ou juste un statut (statusOnly) pour un sous-service
    // (Gmail/Agenda/Drive) piloté par la connexion Google.
    const row = (logoHtml, name, desc, connected, account, btnId, extra, statusOnly) =>
      "<div class='directory-row'>" + logoHtml +
      "<div class='grow'><b>" + esc(name) + "</b>" +
      "<div class='hint' style='margin-top:2px'>" + desc + "</div>" + (extra || "") + "</div>" +
      "<div style='display:flex;align-items:center;gap:10px'>" +
      (statusOnly
        ? "<span class='connector-dot " + (connected ? "ok" : "off") + "'></span>"
        : (connected
          ? "<span class='hint'>" + esc(account || "Connecté") + "</span><span class='connector-dot ok'></span><button class='chip' data-disconnect='" + btnId + "'>Déconnecter</button>"
          : "<button class='chip primary-chip' data-connect='" + btnId + "'>Connecter</button>")) +
      "</div></div>";
    box.innerHTML = "<div class='settings-card' style='padding:0'>" +
      row(logo("#24292f", "GH"), "GitHub", "Dépôts, issues et fichiers — Device Flow officiel GitHub.", gh.connected, gh.account, "github",
        "<div class='hint hidden' id='ghDeviceHint' style='margin-top:6px'></div>") +
      row(logo("#4285f4", "G"), "Google", st.google_configured
        ? "Compte Google — débloque Gmail, Agenda et Drive (lecture seule)."
        : "google_client.json introuvable dans le dossier de données SoloIA.", gg.connected, gg.account, "google") +
      row(logo("#ea4335", "M"), "Gmail", "Courriels non lus (« regarde mes emails »).", gg.connected, "", "", "", true) +
      row(logo("#34a853", "31"), "Google Agenda", "Événements du jour (« mon agenda »).", gg.connected, "", "", "", true) +
      row(logo("#fbbc04", "D"), "Google Drive", "Fichiers récents (« mes fichiers drive »).", gg.connected, "", "", "", true) +
      row(logo("#000", "N"), "Notion", "Nécessite une configuration développeur (à venir).", false, "", "notion", "", true) +
      "</div>";
    $$("[data-disconnect]", box).forEach((b) => b.onclick = async () => {
      await window.pywebview.api.connector_disconnect(b.dataset.disconnect);
      renderOauthConnectors();
    });
    const ghBtn = $("[data-connect='github']", box);
    if (ghBtn) ghBtn.onclick = async () => {
      ghBtn.disabled = true; ghBtn.textContent = "Démarrage…";
      const start = await window.pywebview.api.github_connect_start();
      if (!start || !start.ok) { alert((start && start.message) || "GitHub injoignable."); renderOauthConnectors(); return; }
      const hint = $("#ghDeviceHint");
      hint.classList.remove("hidden");
      hint.innerHTML = "Saisis le code <b style='font-size:15px;letter-spacing:2px'>" + esc(start.user_code) + "</b> sur " +
        "<a href='" + esc(start.verification_uri) + "' target='_blank' rel='noopener'>" + esc(start.verification_uri) + "</a> — j'attends ta validation…";
      if (window.pywebview.api.open_url) window.pywebview.api.open_url(start.verification_uri);
      ghBtn.textContent = "En attente…";
      const deadline = Date.now() + (start.expires_in || 900) * 1000;
      const interval = Math.max(5, start.interval || 5) * 1000;
      const poll = async () => {
        if (Date.now() > deadline) { hint.textContent = "Temps écoulé — réessaie."; renderOauthConnectors(); return; }
        const r = await window.pywebview.api.github_connect_poll(start.device_code);
        if (r && r.status === "connected") { renderOauthConnectors(); return; }
        if (r && r.status === "pending") { setTimeout(poll, interval); return; }
        hint.textContent = (r && r.message) || "Échec de la connexion GitHub.";
        setTimeout(renderOauthConnectors, 2500);
      };
      setTimeout(poll, interval);
    };
    const ggBtn = $("[data-connect='google']", box);
    if (ggBtn) ggBtn.onclick = async () => {
      if (!st.google_configured) { alert("google_client.json introuvable — replace le fichier d'identifiants dans le dossier de données SoloIA."); return; }
      ggBtn.disabled = true; ggBtn.textContent = "Consentement dans le navigateur…";
      const r = await window.pywebview.api.google_connect();
      if (!r || !r.ok) alert((r && r.message) || "Connexion Google refusée.");
      renderOauthConnectors();
    };
  }
  function renderSettingsPrivacy() {
    const u = uiPrefs();
    const priv = Object.assign({ location: false, improve: false }, store.get("privacy", {}));
    const body = $("#settingsBody");
    body.innerHTML =
      "<h3>Confidentialité</h3>" +
      "<div class='card muted'>SoloIA garde tes données <b>localement dans ce navigateur</b> (par compte). " +
      (window.REMOTE_API ? "Une synchronisation MongoDB best-effort tourne en arrière-plan si un backend est configuré." : "Aucun serveur n'est configuré : tout reste sur cet appareil.") + "</div>" +
      "<h3>Préférences</h3>" +
      toggleRow("privLocation", "Métadonnées de localisation", "Autoriser SoloIA à utiliser une localisation approximative (ville/région) pour améliorer les réponses.", priv.location) +
      toggleRow("privImprove", "Contribuer à améliorer le modèle", "Autoriser l'utilisation de tes conversations pour entraîner l'IA locale (reste sur cette machine).", priv.improve) +
      "<h3>Tes données</h3>" +
      "<div class='settings-card plugin-row'><div><b>Exporter les données</b>" +
      "<div class='hint' style='margin-top:3px'>Télécharge toutes tes discussions et réglages de ce compte en JSON.</div></div>" +
      "<button class='chip' id='privExport'>Exporter</button></div>" +
      "<div class='settings-card plugin-row'><div><b>Préférences de mémoire</b>" +
      "<div class='hint' style='margin-top:3px'>Gérer les réponses apprises (Capacités → Mémoire).</div></div>" +
      "<button class='chip' id='privMemory'>Gérer</button></div>" +
      "<h3>Réinitialisation</h3>" +
      "<button class='chip' id='setClearData' style='color:#c0392b'>Effacer mes données locales</button>" +
      "<div class='hint'>Supprime discussions, projets, artéfacts, réponses apprises et réglages de ce compte.</div>";
    wireToggleRows((id, val) => {
      const pv = Object.assign({ location: false, improve: false }, store.get("privacy", {}));
      if (id === "privLocation") pv.location = val;
      if (id === "privImprove") pv.improve = val;
      store.set("privacy", pv); remoteSyncKey("privacy");
    });
    $("#privExport").onclick = () => {
      const dump = {};
      Object.keys(localStorage).filter((k) => k.startsWith("soloia_" + (state.uid || "guest") + "_"))
        .forEach((k) => { try { dump[k] = JSON.parse(localStorage.getItem(k)); } catch (e) { dump[k] = localStorage.getItem(k); } });
      downloadBlob("soloia_donnees_" + (state.uid || "guest") + ".json", JSON.stringify(dump, null, 2));
    };
    $("#privMemory").onclick = () => showSettingsSection("capabilities");
    $("#setClearData").onclick = () => {
      if (!confirm("Effacer discussions, projets, réglages et réponses apprises de ce compte ?")) return;
      ["convs", "projects", "artefacts", "settings", "profile", "learned", "creditsUsed", "creditsMonth"]
        .forEach((k) => localStorage.removeItem(nskey(k)));
      location.reload();
    };
  }
  function renderSettingsBilling() {
    const body = $("#settingsBody");
    const limit = creditsLimit(), used = creditsUsedCount();
    const subId = store.get("subscriptionId", null);
    const planName = state.plan;
    const price = planName === "SoloIA Max" ? "79,99 €" : planName === "SoloIA Pro" ? "19,99 €" : "Gratuit";
    // Historique de paiement RÉEL uniquement : les abonnements enregistrés
    // par PayPal côté client (pas de fausses factures fabriquées).
    const invoices = store.get("invoices", []);
    body.innerHTML =
      "<h3>Abonnement</h3>" +
      "<div class='settings-card'><div class='usage-row'><div><b>" + esc(planName) + "</b>" +
      (state.ownerUnlimited ? " <span class='hint'>· Développeur (illimité)</span>" : "") +
      "<div class='hint' style='margin-top:4px'>" + (limit === Infinity ? "Tout est illimité." : (used + " / " + limit + " crédits utilisés ce mois-ci · " + price + "/mois")) + "</div></div>" +
      (state.ownerUnlimited ? "" : "<button class='chip primary-chip' id='setUpgrade'>Modifier l'abonnement</button>") + "</div></div>" +
      "<h3>Factures</h3>" +
      (invoices.length
        ? "<div class='settings-card' style='padding:0'><table class='invoice-table'><thead><tr><th>Date</th><th>Total</th><th>Statut</th></tr></thead><tbody>" +
          invoices.map((iv) => "<tr><td>" + esc(iv.date || "—") + "</td><td>" + esc(iv.total || "—") + "</td><td>" + esc(iv.status || "Payé") + "</td></tr>").join("") +
          "</tbody></table></div>"
        : "<div class='settings-card muted'>Aucune facture — tu es en forfait " + esc(planName) + (planName === "Forfait Free" ? " (gratuit)" : "") + ".</div>") +
      (subId ? "<div class='hint' style='margin-top:10px'>ID abonnement PayPal : <code>" + esc(subId) + "</code></div>" : "");
    if ($("#setUpgrade")) $("#setUpgrade").onclick = () => { closeModals(); openUpgrade(); };
  }
  // ---------- Paramètres : Utilisation (crédits réels du compte) ----------
  function renderSettingsUsage() {
    const body = $("#settingsBody");
    const limit = creditsLimit(), used = creditsUsedCount();
    const pct = limit === Infinity ? 0 : Math.min(100, Math.round(used / limit * 100));
    const now = new Date();
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    body.innerHTML =
      "<h3>Limites d'utilisation du forfait <span class='hint'>" + esc(state.plan) + (state.ownerUnlimited ? " (développeur)" : "") + "</span></h3>" +
      (limit === Infinity
        ? "<div class='settings-card'><b>Crédits illimités</b><div class='hint' style='margin-top:4px'>Aucune limite sur ce compte.</div></div>"
        : "<div class='settings-card'><div class='usage-row'><div><b>Ce mois-ci</b>" +
          "<div class='hint' style='margin-top:3px'>Réinitialisation le " + nextReset.toLocaleDateString("fr-FR") + "</div></div>" +
          "<span class='hint'>" + pct + " % utilisés</span></div>" +
          "<div class='usage-bar'><div class='usage-fill" + (pct >= 90 ? " high" : "") + "' style='width:" + pct + "%'></div></div>" +
          "<div class='hint' style='margin-top:6px'>" + used + " / " + limit + " crédits — le coût dépend du modèle choisi (Rapide : par lettre, Moyen : par mot, Max : par phrase).</div></div>") +
      "<h3>Crédits d'utilisation</h3>" +
      "<div class='settings-card'>Besoin de plus de crédits avant la fin du mois ? Passe à un forfait supérieur." +
      (state.ownerUnlimited ? "" : "<div style='margin-top:8px'><button class='chip' id='usageUpgrade'>Voir les forfaits</button></div>") + "</div>" +
      "<button class='chip' id='usageRefresh'>Actualiser</button>";
    if ($("#usageUpgrade")) $("#usageUpgrade").onclick = () => { closeModals(); openUpgrade(); };
    $("#usageRefresh").onclick = renderSettingsUsage;
  }
  // ---------- Paramètres : Capacités (interrupteurs à effet réel) ----------
  function renderSettingsCapabilities() {
    const caps = capsState();
    const plug = pluginsState();
    const learnedCount = (store.get("learned", []) || []).length;
    const execOn = ["install", "zip", "exe", "system"].every((id) => plug[id] !== false);
    const body = $("#settingsBody");
    const u = uiPrefs();
    const domainMode = (store.get("capabilities", {}).netDomains) || "all";
    body.innerHTML =
      "<h3>Mémoire</h3>" +
      toggleRow("memorySearch", "Rechercher et référencer les conversations", "Autoriser SoloIA à chercher des détails pertinents dans les conversations passées.", u.memorySearch) +
      "<div class='settings-card plugin-row'><div><b>Générer la mémoire à partir des conversations</b>" +
      "<div class='hint' style='margin-top:3px'>SoloIA mémorise les réponses de l'IA locale dans sa base : la prochaine question similaire est servie instantanément, sans rappeler le modèle.</div></div>" +
      "<label class='plugin-switch'><input type='checkbox' id='capLearning'" + (caps.learning !== false ? " checked" : "") + "><span></span></label></div>" +
      "<div class='settings-card plugin-row'><div><b>Afficher et gérer la mémoire</b>" +
      "<div class='hint' style='margin-top:3px'>" + learnedCount + " réponse(s) apprise(s) sur ce compte.</div></div>" +
      "<button class='chip' id='capClearLearned'" + (learnedCount ? "" : " disabled") + ">Effacer</button></div>" +
      "<h3>Général</h3>" +
      "<div class='settings-card plugin-row'><div><b>Mode d'accès aux outils</b>" +
      "<div class='hint' style='margin-top:3px'>Contrôle comment les outils de connecteur sont chargés dans les nouvelles conversations.</div></div>" +
      "<select id='capToolMode' class='mini-select'>" +
      [["lazy", "Charger si nécessaire"], ["all", "Tout charger"], ["off", "Désactivé"]].map((o) => "<option value='" + o[0] + "'" + ((caps.toolMode || "lazy") === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></div>" +
      toggleRow("connectorSearch", "Recherche de connecteurs", "Laisser SoloIA parcourir les connecteurs disponibles et remonter ceux qui sont pertinents.", u.connectorSearch) +
      toggleRow("modelSwitch", "Changer de modèle lorsqu'un message est signalé", "Bascule automatiquement le modèle pour continuer la conversation si la sécurité signale un message.", u.modelSwitch) +
      "<h3>Visuels</h3>" +
      "<div class='settings-card plugin-row'><div><b>Artéfacts</b>" +
      "<div class='hint' style='margin-top:3px'>Génère du code et des documents dans une fenêtre dédiée, et affiche l'onglet Artéfacts dans la barre latérale.</div></div>" +
      "<label class='plugin-switch'><input type='checkbox' id='capArtifacts'" + (caps.artifacts !== false ? " checked" : "") + "><span></span></label></div>" +
      toggleRow("aiArtifacts", "Artéfacts propulsés par l'IA", "Créer des applications et documents interactifs qui utilisent l'IA locale dans l'artéfact.", u.aiArtifacts) +
      toggleRow("integratedViz", "Visualisations intégrées", "Permettre à SoloIA de générer des visualisations, graphiques et diagrammes directement dans la conversation.", u.integratedViz) +
      "<h3>Exécution de code et création de fichiers</h3>" +
      "<div class='settings-card plugin-row'><div><b>Exécution de code et création de fichiers</b>" +
      "<div class='hint' style='margin-top:3px'>SoloIA peut exécuter du code (n'importe quel langage installé), lancer des commandes et créer/compresser des fichiers. Interrupteur maître des plugins machine — réglage fin dans <a href='#' id='capGoPlugins'>Plugins</a>. Requis pour l'app bureau.</div></div>" +
      "<label class='plugin-switch'><input type='checkbox' id='capExec'" + (execOn ? " checked" : "") + "><span></span></label></div>" +
      "<div class='settings-card'><div class='plugin-row'><div><b>Autoriser la sortie réseau</b>" +
      "<div class='hint' style='margin-top:3px'>Donner à SoloIA un accès réseau pour appeler des API et installer des paquets. À surveiller — comporte des risques de sécurité.</div></div>" +
      "<label class='plugin-switch'><input type='checkbox' id='capNet'" + (store.get("plugins", {}).api !== false ? " checked" : "") + "><span></span></label></div>" +
      "<div class='field' style='margin:12px 0 0'><label>Liste d'autorisation de domaines</label><select id='capDomains' class='mini-select' style='max-width:100%'>" +
      [["all", "Tous les domaines"], ["none", "Aucun domaine"]].map((o) => "<option value='" + o[0] + "'" + (domainMode === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") +
      "</select><div class='hint' style='margin-top:6px'>" + (domainMode === "all" ? "SoloIA peut accéder à tous les domaines sur Internet." : "Aucun accès réseau sortant autorisé.") + "</div></div></div>" +
      "<h3>Compétences</h3>" +
      "<div class='settings-card'>Les compétences ont été déplacées vers <a href='#' id='capGoSkills'>Personnaliser → Compétences</a>.</div>";
    $("#capLearning").onchange = (e) => { const c = capsState(); c.learning = e.target.checked; store.set("capabilities", c); remoteSyncKey("capabilities"); };
    $("#capArtifacts").onchange = (e) => { const c = capsState(); c.artifacts = e.target.checked; store.set("capabilities", c); remoteSyncKey("capabilities"); applyCapabilities(); };
    $("#capToolMode").onchange = (e) => { const c = capsState(); c.toolMode = e.target.value; store.set("capabilities", c); remoteSyncKey("capabilities"); };
    $("#capDomains").onchange = (e) => { const c = capsState(); c.netDomains = e.target.value; store.set("capabilities", c); remoteSyncKey("capabilities"); renderSettingsCapabilities(); };
    $("#capExec").onchange = (e) => {
      const s = pluginsState();
      ["install", "zip", "exe", "system"].forEach((id) => s[id] = e.target.checked);
      store.set("plugins", s); remoteSyncKey("plugins");
    };
    $("#capNet").onchange = (e) => { const s = pluginsState(); s.api = e.target.checked; store.set("plugins", s); remoteSyncKey("plugins"); };
    $("#capClearLearned").onclick = () => {
      if (!confirm("Effacer les " + learnedCount + " réponses apprises de ce compte ?")) return;
      store.set("learned", []); remoteSyncKey("learned");
      renderSettingsCapabilities();
    };
    $("#capGoPlugins").onclick = (e) => { e.preventDefault(); showSettingsSection("plugins"); };
    $("#capGoSkills").onclick = (e) => { e.preventDefault(); showSettingsSection("skills"); };
    wireToggleRows((id, val) => setUiPref(id, val));
  }
  function applyCapabilities() {
    const artBtn = $('.side-item[data-view="artefacts"]');
    if (artBtn) artBtn.classList.toggle("hidden", !capEnabled("artifacts"));
  }
  // ---------- Paramètres : SoloIA Code (apparence réelle du chat/code) ------
  const CODE_PREF_DEFAULTS = { textSize: "medium", width: "medium", codeFont: "" };
  function codePrefs() { return Object.assign({}, CODE_PREF_DEFAULTS, store.get("codePrefs", {})); }
  function applyCodePrefs() {
    const p = codePrefs();
    const root = document.documentElement;
    root.style.setProperty("--chat-font-size", { small: "13px", medium: "14.5px", large: "16.5px" }[p.textSize] || "14.5px");
    root.style.setProperty("--chat-max-width", { narrow: "620px", medium: "760px", wide: "980px" }[p.width] || "760px");
    root.style.setProperty("--code-font", p.codeFont ? p.codeFont + ", Consolas, monospace" : "Consolas, 'Courier New', monospace");
  }
  function renderSettingsCode() {
    const p = codePrefs();
    const seg = (id, options, current) => "<div class='seg-toggle' id='" + id + "'>" +
      options.map((o) => "<button class='seg-opt" + (o.v === current ? " active" : "") + "' data-v='" + o.v + "'>" + o.label + "</button>").join("") + "</div>";
    const u = uiPrefs();
    const body = $("#settingsBody");
    body.innerHTML =
      "<h3>Général</h3>" +
      toggleRow("sessionStates", "Classifier les états de session", "Autoriser SoloIA à classer automatiquement les sessions (bloquée, prête pour révision, terminée).", u.sessionStates) +
      toggleRow("modelSwitch", "Changer de modèle lorsqu'un message est signalé", "Basculer automatiquement le modèle pour continuer si la sécurité signale un message.", u.modelSwitch) +
      "<h3>Apparence</h3>" +
      toggleRow("highContrast", "Thème sombre à contraste élevé", "Utilise un arrière-plan presque noir quand le mode sombre est activé.", u.highContrast) +
      "<div class='settings-card plugin-row'><div><b>Police d'interface</b>" +
      "<div class='hint' style='margin-top:3px'>Police des menus, de la barre latérale et du chat.</div></div>" +
      seg("uiInterfaceFont", [{ v: "sans", label: "SoloIA Sans" }, { v: "system", label: "Système" }], u.interfaceFont) + "</div>" +
      "<div class='settings-card plugin-row'><div><b>Taille du texte de la transcription</b>" +
      "<div class='hint' style='margin-top:3px'>Taille du texte des conversations.</div></div>" +
      seg("codeTextSize", [{ v: "small", label: "Petit" }, { v: "medium", label: "Moyen" }, { v: "large", label: "Grand" }], p.textSize) + "</div>" +
      "<div class='settings-card plugin-row'><div><b>Largeur de la transcription</b>" +
      "<div class='hint' style='margin-top:3px'>Largeur maximale des colonnes de conversation et de saisie.</div></div>" +
      seg("codeWidth", [{ v: "narrow", label: "Étroit" }, { v: "medium", label: "Moyen" }, { v: "wide", label: "Large" }], p.width) + "</div>" +
      "<h3>Police de code</h3>" +
      "<div class='settings-card'><div class='hint' style='margin-bottom:6px'>Police monospace personnalisée pour le code et le terminal (doit être installée sur ta machine).</div>" +
      "<input id='codeFontInput' placeholder='p. ex. JetBrains Mono' value=\"" + esc(p.codeFont) + "\" style='max-width:280px'>" +
      " <button class='chip' id='codeFontSave'>Appliquer</button>" +
      "<pre style='margin-top:10px'><code>function greet(name) {\n  return `Bonjour, ${name} !`;\n}</code></pre></div>";
    const wireSeg = (id, key) => $$("#" + id + " .seg-opt").forEach((b) => b.onclick = () => {
      const prefs = codePrefs(); prefs[key] = b.dataset.v;
      store.set("codePrefs", prefs); remoteSyncKey("codePrefs");
      applyCodePrefs(); renderSettingsCode();
    });
    wireSeg("codeTextSize", "textSize");
    wireSeg("codeWidth", "width");
    $$("#uiInterfaceFont .seg-opt").forEach((b) => b.onclick = () => { setUiPref("interfaceFont", b.dataset.v); applyUiPrefs(); renderSettingsCode(); });
    $("#codeFontSave").onclick = () => {
      const prefs = codePrefs(); prefs.codeFont = $("#codeFontInput").value.trim();
      store.set("codePrefs", prefs); remoteSyncKey("codePrefs");
      applyCodePrefs(); renderSettingsCode();
    };
    wireToggleRows((id, val) => { setUiPref(id, val); if (id === "highContrast") applyUiPrefs(); });
  }
  // ---------- Paramètres : Application bureau ----------
  function renderSettingsDesktop() {
    const bridge = !!(window.pywebview && window.pywebview.api);
    const body = $("#settingsBody");
    body.innerHTML =
      "<h3>Application bureau</h3>" +
      "<div class='settings-card'><div class='usage-row'><b>Fenêtre bureau SoloIA</b>" +
      "<span class='connector-dot " + (bridge ? "ok" : "off") + "'></span></div>" +
      "<div class='hint' style='margin-top:4px'>" + (bridge
        ? "Détectée — le pont Python est actif : téléchargements natifs, installation pip, exécution de commandes (liste noire de sécurité), ZIP, compilation .exe, fichiers .skill sur disque et connecteurs OAuth."
        : "Tu utilises SoloIA dans un navigateur. Lance <b>SoloIA.exe</b> (ou <code>python main.py</code>) pour débloquer les capacités machine : téléchargements natifs, pip, commandes, ZIP, .exe, connecteurs.") + "</div></div>" +
      (bridge ? "<button class='chip' id='desktopSysinfo'>Voir les informations système</button><pre id='desktopSysinfoOut' class='hidden' style='margin-top:10px'><code></code></pre>" : "");
    if (bridge && $("#desktopSysinfo")) $("#desktopSysinfo").onclick = async () => {
      const r = await window.pywebview.api.sysinfo();
      const out = $("#desktopSysinfoOut");
      out.classList.remove("hidden");
      out.querySelector("code").textContent = (r && r.message) || "Indisponible.";
    };
  }
  // ---------- Paramètres : Compétences (mêmes données que l'onglet Skills) --
  function renderSettingsSkills() {
    const body = $("#settingsBody");
    body.innerHTML = "<h3>Compétences <span style='float:right'><button class='chip' id='skillsBrowse'>Parcourir</button> <button class='chip' id='skillsAdd'>Ajouter</button></span></h3>" +
      "<div id='skillsTable'><div class='hint'>Chargement…</div></div>";
    $("#skillsBrowse").onclick = () => { closeModals(); navigateTo("skill"); };
    $("#skillsAdd").onclick = async () => {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.import_skill_file) {
        const res = await window.pywebview.api.import_skill_file();
        if (res && res.message) alert(res.message);
        _skillsCache = null; renderSettingsSkills();
        return;
      }
      $("#skillFileInput").click();
    };
    loadAllSkills().then((skills) => {
      const table = $("#skillsTable");
      if (!table) return;
      const customIds = new Set(getCustomSkills().map((s) => s.id));
      table.innerHTML = "<div class='settings-card' style='padding:0'>" +
        "<div class='skills-table-head'><span>Compétence</span><span>Auteur</span></div>" +
        skills.map((s) => {
          // "Vous" = importé par l'utilisateur : via le navigateur (customSkills)
          // ou via l'app bureau (fichier copié dans le dossier de données).
          const yours = customIds.has(s.id) || /SoloIA_data|data[\\/]skills[\\/]user/i.test(s.source || "") ||
            ((s.source || "").length > 0 && !/data[\\/]skills[\\/]/i.test(s.source || ""));
          return "<div class='skills-table-row'><span><b>" + esc(s.title) + "</b>" +
            "<span class='hint' style='display:block'>" + esc(s.desc || "") + "</span></span>" +
            "<span class='hint'>" + (yours ? "Vous" : "SoloIA") + "</span></div>";
        }).join("") + "</div>";
    });
  }

  // ---------- Auth ----------
  function openAuth() { setAuthMode("signin"); showAuthView("email"); $("#authModal").classList.remove("hidden"); $("#authEmail").focus(); }
  function setAuthMode(m) {
    state.authMode = m;
    $("#authTitle").textContent = m === "signin" ? "Se connecter" : "Créer un compte";
    $("#authSubmit").textContent = m === "signin" ? "Se connecter" : "Créer mon compte";
    $("#authSwitch").textContent = m === "signin" ? "Pas de compte ? Créer un compte" : "Déjà un compte ? Se connecter";
    $("#authErr").textContent = "";
  }
  function showAuthView(v) {
    state.authView = v;
    $("#emailForm").classList.toggle("hidden", v !== "email");
    $("#phoneForm").classList.toggle("hidden", v !== "phone");
    if (v === "phone") { $("#codeStep").classList.add("hidden"); $("#phoneErr").textContent = ""; $("#authPhone").focus(); }
  }
  function cleanErr(e) { const m = (e && e.message) || ""; if (/popup-closed|cancelled-popup|popup-blocked/i.test(m)) return "Fenêtre fermée."; if (/operation-not-allowed|not.*enabled/i.test(m)) return "Fournisseur non activé côté Firebase."; if (/unauthorized-domain|localhost/i.test(m)) return "Domaine non autorisé — déploie sur un domaine Firebase autorisé."; return m.replace("Firebase:", "").trim() || "Échec."; }

  $("#authSwitch").onclick = (e) => { e.preventDefault(); setAuthMode(state.authMode === "signin" ? "signup" : "signin"); };
  $("#authSubmit").onclick = async () => {
    const email = $("#authEmail").value.trim(), pass = $("#authPass").value;
    $("#authErr").textContent = "";
    if (!email || !pass) { $("#authErr").textContent = "Email et mot de passe requis."; return; }
    try { const u = state.authMode === "signin" ? await SoloIAAuth.signIn(email, pass) : await SoloIAAuth.signUp(email, pass); applyUser(u); closeModals(); }
    catch (e) { $("#authErr").textContent = cleanErr(e); }
  };
  async function providerLogin(fn) {
    try {
      const u = await fn();
      // u === null : signInWithRedirect vient de demarrer (fenetre bureau,
      // voir firebase.js) — la page va naviguer, rien d'autre a faire ici.
      if (u) { applyUser(u); closeModals(); }
    } catch (e) { $("#authErr").textContent = cleanErr(e); }
  }
  $("#provGoogle").onclick = () => providerLogin(() => SoloIAAuth.google());
  $("#provApple").onclick = () => providerLogin(() => SoloIAAuth.apple());
  $("#provGuest").onclick = async () => { try { const u = await SoloIAAuth.anon(); applyUser(u); } catch (e) { applyUser(SoloIAAuth.guest()); } closeModals(); };
  $("#provPhone").onclick = () => showAuthView("phone");
  $("#phoneBack").onclick = (e) => { e.preventDefault(); showAuthView("email"); };
  $("#phoneSend").onclick = async () => {
    const num = ($("#authPhone").value || "").trim();
    $("#phoneErr").textContent = "";
    if (!/^\+?[0-9 ]{6,}$/.test(num)) { $("#phoneErr").textContent = "Numéro au format international, ex : +33 6 12 34 56 78."; return; }
    try { await SoloIAAuth.startPhone(num.replace(/\s+/g, ""), "phoneSend"); $("#codeStep").classList.remove("hidden"); $("#phoneErr").textContent = "Code envoyé par SMS."; $("#authCode").focus(); }
    catch (e) { if (SoloIAAuth.resetPhone) SoloIAAuth.resetPhone(); $("#phoneErr").textContent = cleanErr(e); }
  };
  $("#phoneConfirm").onclick = async () => {
    const code = ($("#authCode").value || "").trim();
    if (!code) { $("#phoneErr").textContent = "Entre le code reçu."; return; }
    try { const u = await SoloIAAuth.confirmPhone(code); applyUser(u); closeModals(); }
    catch (e) { $("#phoneErr").textContent = "Code invalide, réessaie."; }
  };

  // ---------- Upgrade / PayPal (abonnements réels, Button Factory) ----------
  // N'affiche que ce qui a du sens pour le forfait courant : Free voit Pro+Max,
  // Pro ne voit plus que Max (déjà Pro, inutile de se le revendre), Max et le
  // compte développeur (rang illimité) ne voient plus aucune offre du tout.
  function openUpgrade() {
    $("#upgradeModal").classList.remove("hidden");
    $("#payNote").textContent = "";
    $("#paypalArea").innerHTML = "";
    const rank = planRank(state.plan);
    const plansWrap = $(".plans");
    const proCard = $('.plan-card[data-plan="pro"]');
    const maxCard = $('.plan-card[data-plan="max"]');
    if (rank >= 2) {
      if (plansWrap) plansWrap.classList.add("hidden");
      $("#payNote").textContent = "Tu as déjà le forfait le plus complet (SoloIA Max) — tout est illimité.";
    } else {
      if (plansWrap) plansWrap.classList.remove("hidden");
      if (proCard) proCard.classList.toggle("hidden", rank >= 1);
      if (maxCard) maxCard.classList.remove("hidden");
    }
  }
  function buy(planKey) {
    const note = $("#payNote"), area = $("#paypalArea");
    const CLIENT = window.PAYPAL_CLIENT_ID;
    const plan = window.PAYPAL_PLANS && window.PAYPAL_PLANS[planKey];
    if (!CLIENT || !plan) {
      note.innerHTML = "Abonnement PayPal non configuré. Renseigne <b>window.PAYPAL_CLIENT_ID</b> et <b>window.PAYPAL_PLANS</b> dans assets/config.js. En attendant, tu peux simuler :";
      area.innerHTML = "<button class='primary' id='simBuy'>Simuler l'abonnement (démo)</button>";
      $("#simBuy").onclick = () => activatePlan(planKey); return;
    }
    loadPayPal(CLIENT, () => renderPayPalButtons(planKey, plan));
  }
  function activatePlan(planKey, subscriptionId) {
    const plan = window.PAYPAL_PLANS && window.PAYPAL_PLANS[planKey];
    state.plan = plan ? plan.name : (planKey === "max" ? "SoloIA Max" : "SoloIA Pro");
    store.set("plan", state.plan);
    if (subscriptionId) store.set("subscriptionId", subscriptionId);
    applyUser(state.user);
    $("#payNote").textContent = state.plan + " activé. Merci pour ton abonnement !";
    setTimeout(closeModals, 1400);
  }
  function loadPayPal(client, cb) {
    if (window.paypal) return cb();
    const s = document.createElement("script");
    // vault=true&intent=subscription : requis par l'API Subscriptions PayPal
    // (Button Factory). Pas de "currency" : le prix vient du plan PayPal.
    s.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(client) + "&vault=true&intent=subscription";
    s.setAttribute("data-sdk-integration-source", "button-factory");
    s.onload = cb; s.onerror = () => { $("#payNote").textContent = "Impossible de charger PayPal."; };
    document.head.appendChild(s);
  }
  function renderPayPalButtons(planKey, plan) {
    $("#paypalArea").innerHTML = "<div id='ppbtns'></div>";
    window.paypal.Buttons({
      style: { shape: "pill", color: "blue", layout: "vertical", label: "subscribe" },
      createSubscription: (data, actions) => actions.subscription.create({
        plan_id: plan.id,
        quantity: 1,
      }),
      onApprove: (data) => {
        // data.subscriptionID confirme l'abonnement cote PayPal. Pour une
        // activation fiable en production, verifie aussi le webhook serveur
        // (BILLING.SUBSCRIPTION.ACTIVATED) avant de debloquer definitivement.
        activatePlan(planKey, data.subscriptionID);
      },
      onError: () => { $("#payNote").textContent = "Erreur PayPal."; },
    }).render("#ppbtns");
  }

  function closeModals() {
    $$(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
    setPath(PATH_FOR[state.view] || "/", true);
  }
  $$("[data-close]").forEach((b) => b.onclick = closeModals);
  $$(".modal-backdrop").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModals(); }));

  // ---------- Câblage entrées ----------
  function wireInput(txtId, sendId) {
    const t = $(txtId); if (!t) return;
    const grow = () => { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 220) + "px"; };
    t.addEventListener("input", grow);
    t.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const v = t.value; t.value = ""; grow(); send(v); } });
    if (sendId) $(sendId).onclick = () => { const v = t.value; t.value = ""; grow(); send(v); };
  }
  wireInput("#input", "#btnSend");
  wireInput("#input2", "#btnSend2");

  $("#fileInput").onchange = (e) => { importFiles(e.target.files); e.target.value = ""; };
  $("#btnPlus").onclick = openFilePicker;
  $("#btnPlus2").onclick = openFilePicker;

  $$("[data-view]").forEach((b) => b.addEventListener("click", () => navigateTo(b.dataset.view)));
  $$("[data-upgrade]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openUpgrade(); }));
  $$(".buy").forEach((b) => b.addEventListener("click", () => buy(b.dataset.plan)));

  // ---------- Compte : menu déroulant (invité -> connexion directe) ----------
  function isGuestUser() { return !state.user || state.user.source === "guest"; }
  function renderAccountMenu() {
    const profile = store.get("profile", {});
    $("#ddEmail").textContent = (state.user && state.user.email) || "Invité (hors-ligne)";
    $("#ddName").textContent = profile.nickname || (state.user && state.user.name) || "Invité";
    $("#ddPlan").textContent = state.plan + (state.ownerUnlimited ? " · Développeur" : "");
  }
  function toggleAccountMenu(show) {
    const dd = $("#accDropdown");
    const willShow = show !== undefined ? show : dd.classList.contains("hidden");
    if (willShow) renderAccountMenu();
    dd.classList.toggle("hidden", !willShow);
  }
  $("#accountChip").addEventListener("click", (e) => {
    if (e.target.closest("#accDropdown")) return;
    if (isGuestUser()) { navigateTo("login"); return; }
    toggleAccountMenu();
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#accountChip")) toggleAccountMenu(false); });
  $("#ddSettings").onclick = () => { toggleAccountMenu(false); navigateTo("settings"); };
  $("#ddLanguage").onclick = () => { toggleAccountMenu(false); navigateTo("settings"); };
  $("#ddHelp").onclick = () => { toggleAccountMenu(false); alert("Besoin d'aide ? Consulte le README du projet ou écris à l'adresse support indiquée dans l'app."); };
  $("#ddUpgrade").onclick = () => { toggleAccountMenu(false); openUpgrade(); };
  $("#ddChangelog").onclick = () => { toggleAccountMenu(false); alert("SoloIA — assistant de code local (Ollama) + base de connaissances.\n\nRécemment ajouté :\n- Apprentissage automatique des réponses d'Ollama dans la base SoloIA\n- Paramètres de profil (avatar, surnom, instructions personnalisées)\n- Thème clair / sombre / système"); };
  $("#ddLogout").onclick = async () => { toggleAccountMenu(false); await SoloIAAuth.signOut(); applyUser(SoloIAAuth.guest()); navigateTo("home"); };
  $("#btnAccount2").onclick = () => navigateTo(isGuestUser() ? "login" : "settings");
  $("#btnMic").onclick = () => alert("La dictée vocale (speech-to-text) s'activera avec un modèle local (Ollama/Whisper).");

  // ---------- Réduire la sidebar (bouton à côté de la loupe) ----------
  // Préférence d'affichage globale (pas namespacée par compte : ça reste
  // pareil quel que soit le compte connecté sur ce navigateur).
  function applySidebarCollapsed(collapsed) {
    $("#sidebar").classList.toggle("collapsed", collapsed);
    $("#btnCollapse").title = collapsed ? "Agrandir" : "Réduire";
  }
  applySidebarCollapsed(localStorage.getItem("soloia_sidebar_collapsed") === "1");
  $("#btnCollapse").onclick = () => {
    const collapsed = !$("#sidebar").classList.contains("collapsed");
    applySidebarCollapsed(collapsed);
    localStorage.setItem("soloia_sidebar_collapsed", collapsed ? "1" : "0");
  };

  // ---------- Recherche (loupe) : discussions + base de connaissances ----------
  function openSearch() {
    $("#searchModal").classList.remove("hidden");
    $("#searchInput").value = "";
    $("#searchResults").innerHTML = "<div class='hint' style='padding:16px'>Tape au moins 2 caractères…</div>";
    setTimeout(() => $("#searchInput").focus(), 30);
  }
  function runSearch(query) {
    const box = $("#searchResults");
    const q = query.trim();
    if (q.length < 2) {
      box.innerHTML = "<div class='hint' style='padding:16px'>Tape au moins 2 caractères…</div>";
      return;
    }
    const qLow = q.toLowerCase();
    const convs = store.get("convs", []).filter((c) => (c.title || "").toLowerCase().includes(qLow)).slice(0, 6);
    const kbResults = (window.SoloIA ? SoloIA.search(q, null, 5) : []) || [];
    let html = "";
    if (convs.length) {
      html += "<div class='search-group-title'>Discussions</div>";
      convs.forEach((c) => {
        html += "<button class='search-result' data-search-conv='" + esc(c.id) + "'>" + ic("chat") + " " + esc(c.title) +
          "<span class='muted-sub'>" + (c.mode === "code" ? "Code" : "Home") + " · " + c.messages.length + " messages</span></button>";
      });
    }
    if (kbResults.length) {
      html += "<div class='search-group-title'>Base de connaissances</div>";
      kbResults.forEach((r) => {
        html += "<button class='search-result' data-search-kb='" + esc(r[0].title) + "'>" + ic("book") + " " + esc(r[0].title) +
          "<span class='muted-sub'>" + esc(SoloIA.langLabel(r[0].language)) + "</span></button>";
      });
    }
    box.innerHTML = html || "<div class='hint' style='padding:16px'>Aucun résultat pour « " + esc(q) + " ».</div>";
    $$("[data-search-conv]", box).forEach((b) => b.onclick = () => {
      const c = store.get("convs", []).find((x) => x.id === b.dataset.searchConv);
      closeModals();
      if (c) openConversation(c);
    });
    $$("[data-search-kb]", box).forEach((b) => b.onclick = () => {
      closeModals();
      navigateTo("home");
      setTimeout(() => { $("#input").value = b.dataset.searchKb; $("#input").focus(); }, 30);
    });
  }
  $("#btnSearch").onclick = openSearch;
  $("#searchInput").addEventListener("input", (e) => runSearch(e.target.value));

  const chipText = { ecrire: "Aide-moi à écrire un texte", apprendre: "Explique-moi la récursivité", vie: "Donne-moi une idée de recette rapide", choix: "Surprends-moi avec une astuce de dev utile" };
  $$("[data-chip]").forEach((c) => c.onclick = () => { $("#input").value = chipText[c.dataset.chip] || ""; $("#input").focus(); });

  // ---------- Apprentissage : intègre les réponses d'Ollama dans le VRAI
  // moteur SoloIA (base de connaissances), pour ne plus avoir besoin d'Ollama
  // sur une question similaire par la suite. Persisté PAR COMPTE (store.*),
  // rechargé dans l'index de recherche à chaque connexion (rehydrateLearned).
  function hashId(s) {
    let h = 5381;
    const str = String(s || "");
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return "learned_" + h.toString(36);
  }
  function extractCode(answer) {
    const m = String(answer || "").match(/```[a-zA-Z0-9_+#.]*\n?([\s\S]*?)```/);
    return m ? m[1].replace(/\s+$/, "") : "";
  }
  function stripCodeFences(answer) {
    return String(answer || "").replace(/```[\s\S]*?```/g, "").trim();
  }
  // Renvoie true si une nouvelle fiche a été apprise (ou déjà connue et
  // ré-indexée), false en cas d'échec silencieux (jamais bloquant pour send()).
  function learnFromOllama(question, answer) {
    try {
      if (!window.SoloIA || !SoloIA.learn) return false;
      const id = hashId(String(question || "").trim().toLowerCase());
      const learned = store.get("learned", []);
      const existing = learned.find((e) => e.id === id);
      if (existing) { SoloIA.learn(existing); return true; }
      const language = SoloIA.detectLanguage(question) || "general";
      const entry = {
        id,
        title: String(question || "").trim().slice(0, 90) || "Question apprise",
        language,
        explanation: stripCodeFences(answer).slice(0, 4000),
        code: extractCode(answer),
        keywords: String(question || "").trim().split(/\s+/).slice(0, 20),
        tags: ["appris", "ollama"],
        difficulty: "auto",
      };
      learned.push(entry);
      store.set("learned", learned);
      remoteSyncKey("learned");
      SoloIA.learn(entry);
      return true;
    } catch (e) { return false; }
  }
  function rehydrateLearned() {
    if (!window.SoloIA || !SoloIA.learn) return;
    store.get("learned", []).forEach((e) => SoloIA.learn(e));
  }

  // ---------- LLM local (Ollama / Qwen2.5-Coder) ----------
  let _ollamaModel = null, _ollamaChecked = false;
  async function ensureOllamaModel() {
    if (_ollamaChecked) return _ollamaModel;
    _ollamaChecked = true;
    try {
      const avail = window.SoloIAOllama && await SoloIAOllama.isAvailable(800);
      _ollamaModel = avail ? await SoloIAOllama.selectModel(1500) : null;
    } catch (e) { _ollamaModel = null; }
    return _ollamaModel;
  }
  // Détection + préchauffage silencieux : aucune trace visible du modèle ou
  // de son statut n'est affichée à l'utilisateur (juste utilisée en interne
  // par send() si "LLM local" est sélectionné dans le menu déroulant).
  function silentOllamaWarmup() {
    ensureOllamaModel().then((model) => {
      if (model && window.SoloIAOllama) SoloIAOllama.warmup(model);
    });
  }

  // ---------- Init ----------
  SoloIAAuth.onChange((u) => applyUser(u));
  applyUser(SoloIAAuth.current());
  routeFromLocation();
  silentOllamaWarmup();
  // Reprend une connexion Google/Apple par redirection (fenêtre bureau,
  // voir firebase.js inEmbeddedWebview) si la page vient d'y revenir.
  if (SoloIAAuth.checkRedirectResult) {
    SoloIAAuth.checkRedirectResult().then((u) => { if (u) { applyUser(u); closeModals(); } });
  }
  const st = SoloIA.stats();
  console.log("SoloIA prêt :", st.total, "fiches,", Object.keys(st.languages).length, "langages.");

  // Écran de chargement : masqué une fois l'appli prête (base indexée,
  // session résolue, route initiale affichée). Durée minimale de 350ms pour
  // que ça se voie sur un chargement très rapide, sans jamais ralentir un
  // chargement déjà plus long que ça.
  (function hideAppLoadingWhenReady() {
    const el = $("#appLoading");
    if (!el) return;
    const elapsed = Date.now() - (window.__soloiaLoadStart || Date.now());
    setTimeout(() => {
      el.classList.add("hide");
      setTimeout(() => el.remove(), 450);
    }, Math.max(0, 350 - elapsed));
  })();
})();
