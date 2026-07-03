/* Pont vers un LLM local (Ollama) pour la version web de SoloIA.
   Aucune dépendance : simple fetch() vers l'API Ollama, qui tourne sur la
   MÊME machine que le navigateur (http://localhost:11434). Ollama autorise
   les requêtes cross-origin venant de localhost, donc pas besoin de backend.
   Optionnel par nature : si Ollama n'est pas lancé, tout échoue silencieusement
   et SoloIA continue avec son moteur local (engine.js). */
(function (global) {
  "use strict";

  const BASE = "http://localhost:11434";

  // Modèle demandé par l'utilisateur : llama2-uncensored (prioritaire). On
  // retombe sur Qwen2.5-Coder (spécialisé code) s'il n'est pas installé. On
  // choisit toujours la variante réellement installée la plus capable.
  const PREFERRED = [
    "llama2-uncensored:latest", "llama2-uncensored",
    "qwen2.5-coder:32b", "qwen2.5-coder:14b", "qwen2.5-coder:7b",
    "qwen2.5-coder:3b", "qwen2.5-coder:latest", "qwen2.5-coder",
  ];
  const MODEL_PREFIXES = ["llama2-uncensored", "qwen2.5-coder"];

  async function withTimeout(promise, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { return await promise(ctrl.signal); }
    finally { clearTimeout(t); }
  }

  async function isAvailable(timeout) {
    try {
      const r = await withTimeout((sig) => fetch(BASE + "/api/tags", { signal: sig }), timeout || 800);
      return r.ok;
    } catch (e) { return false; }
  }

  async function listModels(timeout) {
    try {
      const r = await withTimeout((sig) => fetch(BASE + "/api/tags", { signal: sig }), timeout || 1500);
      if (!r.ok) return [];
      const data = await r.json();
      return (data.models || []).map((m) => m.name || m.model).filter(Boolean);
    } catch (e) { return []; }
  }

  async function selectModel(timeout) {
    const installed = await listModels(timeout);
    if (!installed.length) return null;
    const set = new Set(installed);
    for (const cand of PREFERRED) if (set.has(cand)) return cand;
    for (const prefix of MODEL_PREFIXES) {
      const partial = installed.find((n) => n.startsWith(prefix));
      if (partial) return partial;
    }
    return installed[0]; // repli : autre modèle installé par l'utilisateur
  }

  function buildPrompt(question, context, instructions) {
    const parts = [
      "Tu es un développeur logiciel senior, pédagogue et précis.",
      "Réponds toujours en français, de façon claire et concrète.",
    ];
    if (instructions && instructions.trim()) {
      parts.push(
        "", "=== INSTRUCTIONS PERSONNALISÉES DE L'UTILISATEUR (à respecter) ===",
        instructions.trim(), "=== FIN DES INSTRUCTIONS ==="
      );
    }
    if (context && context.trim()) {
      parts.push(
        "Appuie-toi EN PRIORITÉ sur le CONTEXTE ci-dessous (extraits d'une " +
        "base de connaissances de programmation). Complète avec ton expertise " +
        "si besoin, sans jamais inventer d'API inexistante.",
        "", "=== CONTEXTE ===", context.trim(), "=== FIN DU CONTEXTE ==="
      );
    }
    parts.push("", "=== QUESTION ===", question, "", "Réponse (en français) :");
    return parts.join("\n");
  }

  async function warmup(model, timeout) {
    // Precharge le modele en memoire (appel minimal). Sur un CPU modeste sans
    // GPU, le tout premier appel peut prendre 1-2 minutes (chargement depuis
    // le disque) ; les appels suivants sont rapides. On "paie" ce cout des la
    // detection plutot qu'a la premiere vraie question de l'utilisateur.
    if (!model) return false;
    try {
      const r = await withTimeout((sig) => fetch(BASE + "/api/generate", {
        method: "POST", signal: sig,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: "Réponds juste : OK.", stream: false }),
      }), timeout || 240000);
      if (!r.ok) return false;
      const data = await r.json();
      return !!(data && data.response);
    } catch (e) { return false; }
  }

  async function generate(question, context, opts) {
    opts = opts || {};
    const model = opts.model || await selectModel();
    if (!model) return null;
    try {
      const r = await withTimeout((sig) => fetch(BASE + "/api/chat", {
        method: "POST",
        signal: sig,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: buildPrompt(question, context || "", opts.instructions || "") }],
          stream: false,
        }),
      }), opts.timeout || 60000);
      if (!r.ok) return null;
      const data = await r.json();
      const text = data && data.message && data.message.content;
      return (typeof text === "string" && text.trim()) ? text : null;
    } catch (e) { return null; }
  }

  global.SoloIAOllama = { isAvailable, listModels, selectModel, generate, warmup, BASE };
})(window);
