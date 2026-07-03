/* Moteur SoloIA côté navigateur : recherche dans la base + modes Home/Code.
   Aucune dépendance. La base est fournie par knowledge.js (window.SOLOIA_KB). */
(function (global) {
  "use strict";

  const KB = global.SOLOIA_KB || [];

  const LANG_LABELS = {
    python: "Python", javascript: "JavaScript", typescript: "TypeScript",
    html_css: "HTML/CSS", sql: "SQL", c: "C", cpp: "C++", csharp: "C#",
    java: "Java", go: "Go", rust: "Rust", bash: "Bash", php: "PHP",
    lua: "Lua", kotlin: "Kotlin", swift: "Swift", general: "Général",
  };
  const FENCE = {
    python: "python", javascript: "javascript", typescript: "typescript",
    html_css: "html", sql: "sql", c: "c", cpp: "cpp", csharp: "csharp",
    java: "java", go: "go", rust: "rust", bash: "bash", php: "php",
    lua: "lua", kotlin: "kotlin", swift: "swift", general: "",
  };
  const ALIASES = {
    python: "python", py: "python", js: "javascript", javascript: "javascript",
    node: "javascript", nodejs: "javascript", typescript: "typescript",
    ts: "typescript", html: "html_css", css: "html_css", web: "html_css",
    sql: "sql", mysql: "sql", postgres: "sql", sqlite: "sql", bdd: "sql",
    c: "c", cpp: "cpp", "c++": "cpp", csharp: "csharp", "c#": "csharp",
    java: "java", go: "go", golang: "go", rust: "rust", bash: "bash",
    shell: "bash", php: "php", ruby: "ruby", lua: "lua", roblox: "lua",
    kotlin: "kotlin", swift: "swift",
  };
  const STOP = new Set(("le la les un une des de du et ou a au aux en dans sur " +
    "pour par avec sans je tu il elle on nous vous comment faire fait quoi que " +
    "qui quel quelle est ce cette mon ma mes veux peux the a an of to in on for " +
    "and or with how do i you my me can want svp stp merci moi").split(" "));

  function stripAccents(s) {
    return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  }
  // Elisions francaises (c'est, l'onglet, qu'est-ce, j'aime...) : sans ce
  // traitement, "c'est" se coupe en jetons "c" + "est", et "c" est justement
  // l'alias du langage C — ce qui faisait passer "c'est quoi une IA ?" pour
  // une question de code. On retire le fragment elide (pas juste l'apostrophe)
  // avant la tokenisation.
  function stripElisions(s) {
    return s.replace(/\b(c|l|d|j|n|m|s|t|qu)['’]/gi, "");
  }
  function tokenize(text) {
    return stripElisions(stripAccents(String(text || "").toLowerCase()))
      .match(/[a-z0-9_+#.]+/g) || [];
  }
  function contentTokens(text) {
    return tokenize(text).filter((t) => t.length > 1 && !STOP.has(t));
  }
  function detectLanguage(text) {
    for (const t of tokenize(text)) if (ALIASES[t]) return ALIASES[t];
    return null;
  }

  // Index précalculé.
  const INDEX = KB.map((e) => {
    const kw = new Set();
    (e.keywords || []).forEach((k) => contentTokens(k).forEach((t) => kw.add(t)));
    const title = new Set(contentTokens(e.title));
    const tags = new Set((e.tags || []).map((t) => stripAccents(t.toLowerCase())));
    const text = new Set([...contentTokens(e.explanation), ...title, ...kw]);
    return { e, kw, title, tags, text };
  });

  function inter(a, b) { let n = 0; a.forEach((x) => { if (b.has(x)) n++; }); return n; }

  // ---------------------------------------------------------------------
  // Apprentissage : integre une reponse (typiquement generee par le LLM
  // local) dans le VRAI index de recherche SoloIA. Une fois apprise, une
  // question similaire est retrouvee directement, sans repasser par Ollama.
  // ---------------------------------------------------------------------
  const _learnedIds = new Set();
  function learn(entry) {
    if (!entry || !entry.id || _learnedIds.has(entry.id)) return false;
    _learnedIds.add(entry.id);
    const kw = new Set();
    (entry.keywords || []).forEach((k) => contentTokens(k).forEach((t) => kw.add(t)));
    const title = new Set(contentTokens(entry.title));
    const tags = new Set((entry.tags || []).map((t) => stripAccents(t.toLowerCase())));
    const text = new Set([...contentTokens(entry.explanation), ...title, ...kw]);
    INDEX.push({ e: entry, kw, title, tags, text });
    return true;
  }

  function search(query, language, limit) {
    const q = new Set(contentTokens(query));
    if (!q.size) return [];
    const lang = language || detectLanguage(query);
    const scored = [];
    for (const it of INDEX) {
      let s = 0;
      s += 6 * inter(q, it.kw);
      s += 4 * inter(q, it.title);
      s += 3 * inter(q, it.tags);
      s += 1 * inter(q, it.text);
      if (lang && it.e.language === lang) s += 5;
      else if (lang && it.e.language !== "general") s *= 0.25;
      if (s > 0) scored.push([it.e, s]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    return scored.slice(0, limit || 5);
  }

  function langLabel(l) { return LANG_LABELS[l] || l; }

  function formatAnswer(entry) {
    const fence = FENCE[entry.language] || "";
    let md = "### " + entry.title + "  ·  " + langLabel(entry.language) + "\n\n";
    if (entry.explanation) md += entry.explanation.trim() + "\n\n";
    if (entry.code) md += "```" + fence + "\n" + entry.code.replace(/\s+$/, "") + "\n```\n\n";
    const meta = [];
    if (entry.difficulty) meta.push("niveau : " + entry.difficulty);
    if (entry.tags && entry.tags.length) meta.push("thèmes : " + entry.tags.slice(0, 5).join(", "));
    if (meta.length) md += "_" + meta.join("  ·  ") + "_";
    return md.trim();
  }

  const GREET = ["salut", "bonjour", "bonsoir", "hello", "coucou", "hey", "yo", "cc", "hi"];
  const CODE_HINT = ["code", "coder", "fonction", "programme", "script", "classe",
    "boucle", "variable", "algorithme", "compiler", "trie", "trier", "lire",
    "ecrire", "afficher"];

  function intentOf(text) {
    const toks = tokenize(text);
    if (toks.length && toks.length <= 3 && toks.every((t) => GREET.includes(t))) return "greeting";
    if (detectLanguage(text)) return "code";
    // heuristique : mots typiques de code -> code
    if (toks.some((t) => CODE_HINT.includes(t))) return "code";
    return "chat";
  }

  // Réponse principale, selon le mode d'onglet.
  function respond(message, mode) {
    const reasoning = [];
    const kind = intentOf(message);
    reasoning.push("Compris : « " + message + " »");
    reasoning.push("Intention : " + kind);

    if (mode === "code" && kind === "greeting") {
      return {
        reasoning, intent: kind, redirect: "home",
        answer: "Ici c'est **du code uniquement**. Pose-moi une question de code (« lire un fichier en python »).",
      };
    }
    if (kind === "greeting") {
      return {
        reasoning, intent: kind, redirect: null,
        answer: "Bonjour, je suis **SoloIA**. Pose-moi une question — et pour du code, file dans l'onglet Code.",
      };
    }

    // Home peut coder, mais en moins bien : réponse depuis la base uniquement
    // (pas d'IA locale), avec une suggestion (non bloquante) vers l'onglet
    // Code pour une génération complète et sur-mesure.
    const homeCode = mode === "home" && kind === "code";
    const results = search(message, null, 4);
    reasoning.push(results.length + " résultat(s) trouvé(s)");
    if (!results.length) {
      let answer = "Je n'ai pas trouvé dans ma base. Reformule avec des mots-clés techniques, ou précise le langage.";
      if (homeCode) answer += "\n\n_L'onglet **Code** utilise en plus l'IA locale pour une génération complète et sur-mesure._";
      return { reasoning, intent: kind, redirect: homeCode ? "code" : null, answer };
    }
    reasoning.push("Choix : « " + results[0][0].title + " » (" +
      langLabel(results[0][0].language) + "), score " + results[0][1].toFixed(1));
    let answer = formatAnswer(results[0][0]);
    if (results.length > 1) {
      answer += "\n\n**Autres pistes :**\n" + results.slice(1, 4)
        .map((r) => "- " + r[0].title + " (" + langLabel(r[0].language) + ")").join("\n");
    }
    // Si la fiche vient d'un apprentissage Ollama déjà complet (tag "ollama"),
    // ce n'est PAS une réponse dégradée : elle vaut ce qu'elle vaut partout.
    const isLearnedFull = !!(results[0][0].tags && results[0][0].tags.includes("ollama"));
    const degrade = homeCode && !isLearnedFull;
    if (degrade) {
      reasoning.push("Mode Home : réponse simplifiée (base de connaissances, sans IA locale).");
      answer += "\n\n_Réponse simplifiée depuis la base SoloIA. L'onglet **Code** te donne une génération complète et sur-mesure par l'IA locale._";
    }
    return {
      reasoning, intent: kind, redirect: degrade ? "code" : null, answer, code: results[0][0].code,
      matchedEntry: results[0][0],
    };
  }

  global.SoloIA = {
    respond, search, formatAnswer, langLabel, detectLanguage, learn,
    stats: function () {
      const langs = {};
      KB.forEach((e) => { langs[e.language] = (langs[e.language] || 0) + 1; });
      return { total: KB.length, languages: langs };
    },
  };
})(window);
