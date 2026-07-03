/* Plugin "Recherche internet" pour la version web de SoloIA.
   Utilise directement l'API MediaWiki de Wikipédia (origin=*, sans clé, sans
   backend : Wikipédia autorise explicitement les requêtes cross-origin
   anonymes en lecture). Aucune dépendance. Miroir du plugin equivalent côté
   Python (soloia/search_tools.py), pour une capacité comparable sur les deux
   plateformes — la seule que le navigateur puisse exécuter lui-même
   (contrairement à pip/zip/exe/pilotage système, qui exigent un accès OS réel
   et restent donc réservés à l'app bureau). */
(function (global) {
  "use strict";

  // Décode les entités HTML (&#039;, &amp;, &quot;...) d'un texte, sans jamais
  // l'interpréter comme du HTML actif : une <textarea> parse les entités mais
  // n'exécute rien (contrairement à un <div>.innerHTML), .value renvoie le
  // texte brut décodé.
  function decodeEntities(text) {
    const ta = document.createElement("textarea");
    ta.innerHTML = text;
    return ta.value;
  }

  async function search(query, lang) {
    lang = lang || "fr";
    const q = String(query || "").trim();
    if (!q) return [];
    const url = "https://" + lang + ".wikipedia.org/w/api.php?action=query&list=search" +
      "&srsearch=" + encodeURIComponent(q) + "&format=json&origin=*&srlimit=4";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) return [];
      const data = await r.json();
      const hits = (data.query && data.query.search) || [];
      return hits.map((h) => ({
        title: decodeEntities(h.title || ""),
        snippet: decodeEntities(String(h.snippet || "").replace(/<[^>]+>/g, "")),
        url: "https://" + lang + ".wikipedia.org/wiki/" + encodeURIComponent(h.title.replace(/ /g, "_")),
      }));
    } catch (e) {
      return [];
    }
  }

  global.SoloIAWebSearch = { search };
})(window);
