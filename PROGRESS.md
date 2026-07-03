# Journal de développement — SoloIA

## v1.0 — Base de connaissances + UI
- Application locale Python, sans dépendance (stdlib + Tkinter).
- Moteur de recherche par mots-clés + persona « développeur senior ».
- Interface graphique (fenêtre) + mode console.
- **415 solutions** sur **15 langages** (Python, JS, TS, HTML/CSS, SQL, C, C++,
  C#, Java, Go, Rust, Bash, PHP, Lua) + transverse (Git / algos / regex).

## v2.0 — SoloIA « réfléchit » et apprend
Couche de raisonnement complète (7 modules) :

| Module | Rôle |
|--------|------|
| `normalize.py` | texte FR : normalisation, stemming, distance de Damerau (fautes de frappe) |
| `retrieval.py` | recherche fine TF-IDF / BM25 + bonus mots-clés + priorité langage |
| `nlu.py` | intention (code / explication / comparaison / composée / apprentissage…) |
| `context.py` | mémoire de conversation : résout les suivis (« et en Java ? ») |
| `learning.py` | apprentissage : feedback 👍/👎 + mode « apprends-moi » (persisté) |
| `reasoning.py` | le cerveau : orchestre tout, produit une trace de « Réflexion » |
| `llm_bridge.py` | pont optionnel vers un LLM local (Ollama) en RAG sur la base |

Tests : `python main.py --selftest` → **30/30**.

## v2.1 — Enrichissement nocturne (hors-ligne)
- `scripts/selfcheck.py` — garde-fou (JSON valides, IDs uniques, imports,
  auto-tests 30/30). Code retour 0 = sain.
- `scripts/train.py` — promeut un lot valide de `data/pending/` vers
  `data/knowledge/`, lance le garde-fou, **annule** (quarantaine) si ça casse.
- Trous comblés (fichiers/IO en JS, TS, HTML/CSS).

## v2.2 — Auto-entraînement (SoloIA s'entraîne tout seul)
- `soloia/selftrain.py` : recettes combinées, mémos par langage, renforcement 👍.
- `scripts/selftrain.py` (CLI) + bouton « 🤖 S'entraîner » dans l'interface.
- Re-fourniture auto quand la réserve passe sous 3 lots.
- Garde-fou étendu (selfcheck vérifie aussi l'auto-entraînement).

## v2.3 — Disposition « HTML à la racine » + package fonctionnel (2026-07-03)
Réorganisation demandée : `index.html`, `assets/` et `server.py` déplacés **à la
racine du projet** (plus de sous-dossier `web/`). Le moteur et l'app bureau
restent dans `python/`.

- **`soloia/webapp.py`** : `_project_root()` remplacé par **`_web_root()`**, qui
  localise `index.html` de façon robuste selon la disposition (bundle exe
  `sys._MEIPASS[/web]`, ancien `web/`, ou racine du projet). Rétro-compatible.
- **`lancer_soloia_web.bat`** : lance `server.py` depuis la racine.
- **`SoloIA.spec`** : réembarque `index.html` + `assets/` + `server.py` (depuis
  la racine) sous `web/` dans le bundle ; icône `..\assets\icon.ico`.
- **README.md** : mis à jour (démarrage, commandes, arbre de structure).
- **Vérifié** : selfcheck **4/4** (31 fichiers JSON, 733 entrées, import OK,
  auto-entraînement OK), selftest **30/30**, serveur bureau embarqué sert bien
  `index.html` + `assets/` + routes SPA depuis la racine (test HTTP réel).
- **Livrable** : `SoloIA.zip` — projet complet fonctionnel (app bureau Python +
  exe autonome + plateforme web), HTML à la racine.

### Note technique — « corruption » des cycles nocturnes précédents
Les alertes des cycles 00:21 → 01:47 du 2026-07-02 (fichiers lus avec octets
NUL / tronqués) étaient un **bug de LECTURE du montage bac-à-sable**, pas une
corruption disque : les fichiers réels étaient sains (confirmé par accès natif).
Ce cycle, le montage lisait correctement le **code** (py/json vérifiés :
selfcheck 4/4) mais **tronquait `README.md` et `PROGRESS.md`** à la lecture.
Ces deux docs ont donc été **réécrits proprement** (contenu de référence) pour
que le zip livré soit intègre. Aucune modification du code fonctionnel n'a été
faite sur la base d'une lecture douteuse.
