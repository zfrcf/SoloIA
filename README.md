# ⚡ SoloIA — Assistant codeur senior qui réfléchit (100 % hors-ligne)

SoloIA est un assistant local qui répond à tes questions de **code** dans
**tous les langages**, comme un développeur senior : explication claire,
code prêt à l'emploi, bonnes pratiques et pièges à éviter.

- ✅ **Aucune connexion internet obligatoire**, aucune clé API : rien ne sort de ton PC.
- ✅ **Aucune dépendance obligatoire** : `--tk` (fenêtre Tkinter) et `--cli`
  (console) tournent en Python standard, sans rien installer.
- ✅ **Fenêtre bureau = même interface que le web** (via pywebview) + mode
  console + fenêtre Tkinter classique en repli automatique.
- ✅ Base de connaissances : **733 fiches** couvrant Python, JavaScript,
  TypeScript, HTML/CSS, SQL, C, C++, C#, Java, Go, Rust, Bash, PHP, Lua,
  Kotlin, Swift, React, Docker… + algos / Git / regex / sécurité / tests.

> ℹ️ **Nouvelle disposition « HTML à la racine »** : `index.html`, `assets/` et
> `server.py` sont désormais **à la racine du projet** (plus de sous-dossier
> `web/`). Le moteur et l'app bureau vivent dans `python/`. Les deux formes
> restent 100 % fonctionnelles.

## 🧠 SoloIA réfléchit et apprend

- **Comprend l'intention** (module *NLU*) : question de code, explication,
  comparaison, demande en plusieurs étapes, apprentissage, retour…
- **Décompose** : « lire un fichier **puis** le trier » → réponse en 2 étapes.
- **Se souvient du contexte** : après une question Python, tape « **et en Java ?** ».
- **Recherche fine** (TF-IDF / BM25 + tolérance aux fautes : `pyhton` → `python`).
- **Demande une précision** quand c'est ambigu.
- **Affiche sa « Réflexion »** : tu vois comment il a compris et choisi.
- **Apprend de toi** 🎓 : 👍/👎 ajuste ses priorités ; « apprends : question =>
  réponse » retient TA réponse.
- **Installe tes dépendances** 📦 : « installe le paquet requests » (pip, sûr).
- **Agit vraiment** : zip d'un dossier, compilation `.py` → `.exe`, appel d'API HTTP.
- **Cherche sur internet** 🌐 : DuckDuckGo / Wikipedia, sans clé API.
- **Pilote ton PC** 🖥️ (avec garde-fou : `format`, `diskpart`, `rm -rf /`,
  `shutdown`… sont refusés automatiquement).
- **LLM local optionnel** 🧬 : avec [Ollama](https://ollama.com) + Qwen2.5-Coder,
  SoloIA génère de vraies réponses (RAG sur sa base). Sans Ollama, tout marche.

---

## 🚀 Démarrage rapide (Windows)

SoloIA se présente sous **deux formes** dans le même projet. Le **site web**
(`index.html`, `assets/`, `server.py`) est **à la racine** ; le **moteur /
l'app bureau** vit dans `python/`.

- 🌐 **Plateforme web** : double-clique sur **`lancer_soloia_web.bat`** → ouvre
  `index.html` dans ton navigateur via un petit serveur local (`http://localhost:5500`).
- 🖥️ **Fenêtre bureau** : double-clique sur **`lancer_soloia.bat`**. Elle affiche
  **exactement la même interface** que le web (via [pywebview](https://pywebview.flowrl.com/),
  vraie fenêtre native), branchée sur le même moteur local. `pip install pywebview`
  active ce mode ; sans lui, SoloIA bascule sur la fenêtre Tkinter classique.
- 📦 **`SoloIA.exe`** (racine) : la version bureau compilée en un seul exécutable
  Windows autonome — **aucun Python ni dépendance à installer**. Les données
  apprises vont dans un dossier `SoloIA_data/` créé à côté de l'exe.

  Pour recompiler l'exe après une modif (recette `SoloIA.spec` fournie) :
  ```bash
  cd python
  pip install pyinstaller
  # SoloIA.spec réembarque index.html + assets/ + server.py depuis la racine :
  python -m PyInstaller --noconfirm --clean SoloIA.spec
  ```
  (le `.exe` produit atterrit dans `python/dist/` — déplace-le à la racine.)

> Il faut **Python 3.8+** installé (coche « Add Python to PATH »).

### En ligne de commande (fenêtre / console) — dossier `python/`

```bash
cd python
python main.py             # fenêtre bureau = même interface que le web (défaut)
python main.py --tk        # fenêtre Tkinter classique (100% Python standard)
python main.py --cli       # mode console (sans fenêtre)
python main.py --llm       # active le LLM local (Ollama) s'il est présent
python main.py --stats     # statistiques de la base
python main.py --selftest  # lance les auto-tests internes (30/30 attendus)
```

### En ligne de commande (plateforme web) — à la racine

Le site (`index.html`, `assets/`, `server.py`) est **à la racine du projet** :

```bash
python server.py                 # http://localhost:5500 (ouvert automatiquement)

# En option, pour activer le paiement PayPal réel (sinon mode démo) :
npm install
copy .env.example .env           # (macOS/Linux : cp) puis remplis tes clés PayPal
node server.js                   # http://localhost:3000 (sert le site ET l'API paiement)
```

---

## 🌐 Plateforme web (`index.html`)

Interface façon Claude (thème clair), **statique et auto-suffisante** : le chat
tourne dans le navigateur (moteur SoloIA en JS, 733 fiches). Comptes via
**Firebase**, version payante via **PayPal**.

- 🏠 **Home** (ne code pas) / 💻 **Code** (que du code) — moteur JS local.
- 🔊 **Lecture audio des réponses** (Web Speech API, FR) — tous forfaits, hors-ligne.
- 📥 **Fichiers téléchargeables** : chaque bloc de code → bouton ⬇ (extension
  déduite du langage) ; plusieurs blocs → 📦 « Tout en .zip » (écrivain ZIP JS pur).
- 💳 **Crédits mensuels par forfait** : Free 1 000 · Pro 20 000 · Max 100 000.
- 🧠 **3 modèles** (Solo Rapide/Moyen/Max), tous branchés sur Ollama, déverrouillés
  selon le forfait.
- 🔐 **Connexion** : Email, Google, Apple, Téléphone/SMS, Invité (Firebase).
- 💳 **Abonnements** Pro (19,99 €) / Max (79,99 €) via PayPal.
- 🗄️ **MongoDB optionnelle** : miroir des crédits/plan/conversations en tâche de
  fond si `MONGODB_URI` est fourni au backend Node ; sinon localStorage seul.

**Compte développeur** : lien discret dans la modale de connexion → accès local
Max + crédits illimités (sans Firebase), pratique pour tester.

### ⚙️ Configuration
- **Firebase** : config dans `assets/firebase.js`. Google/Apple/Téléphone ne
  marchent **pas sur localhost** (déployer sur un domaine autorisé).
- **PayPal** : `client-id` + plans dans `assets/config.js` ; le `client-secret`
  va **uniquement** dans `.env` côté serveur. Sans config → **mode démo**.
- **MongoDB** : `MONGODB_URI` dans `.env` ; sans elle `/api/store` répond 503.

---

## 🧠 Comment ça marche

1. Les solutions sont dans `python/data/knowledge/*.json` (un fichier par langage).
2. Le moteur (`python/soloia/engine.py` + `retrieval.py`) transforme ta question
   en mots-clés et calcule un **score de pertinence**.
3. La meilleure réponse est mise en forme façon senior (`persona.py`).

Le même contenu est exporté en JS (`assets/knowledge.js`) pour la plateforme web.

## ➕ Enrichir la base

Ajoute une entrée dans un JSON de `python/data/knowledge/` :
```json
{
  "id": "identifiant-unique",
  "title": "Titre de la solution",
  "keywords": ["mots", "cles", "synonymes"],
  "tags": ["theme"],
  "difficulty": "débutant | intermédiaire | avancé",
  "explanation": "Explication en français.",
  "code": "le code, avec des \n pour les sauts de ligne"
}
```
Relance SoloIA : la nouvelle entrée est prise en compte automatiquement.

### 🌙 Enrichissement nocturne + 🤖 auto-entraînement (hors-ligne)
```bash
cd python
python scripts/train.py            # ajoute le prochain lot (garde-fou)
python scripts/train.py --status   # réserve restante
python scripts/selfcheck.py        # santé du projet (0 = sain, 4/4)
python scripts/selftrain.py --promote  # génère PUIS intègre de nouvelles fiches
```
Chaque ajout passe le garde-fou (`selfcheck.py` : JSON valides, IDs uniques,
imports OK, auto-tests 30/30) ; en cas d'échec, l'ajout est **annulé**.

---

## 📁 Structure du projet (HTML à la racine)

```
SoloIA/
├── index.html             ← point d'entrée web (À LA RACINE ; servi aussi par la fenêtre bureau)
├── assets/                ← TOUT le CSS/JS de la plateforme web
│   ├── style.css          ← thème clair (variables CSS)
│   ├── app.js             ← application (vues, chat, comptes, paiement, crédits)
│   ├── engine.js          ← moteur SoloIA en JS (recherche + Home/Code)
│   ├── knowledge.js       ← 733 fiches de code (export JS)
│   ├── firebase.js        ← auth Firebase
│   ├── ollama.js          ← pont LLM local (Qwen2.5-Coder via Ollama)
│   ├── websearch.js       ← recherche internet (DuckDuckGo / Wikipedia)
│   ├── config.js          ← client-id/plans PayPal, crédits, emails propriétaires
│   └── icon.png / icon.ico ← logo SoloIA (web + fenêtre)
├── server.py              ← serveur statique local (À LA RACINE), web ET fenêtre bureau
├── server.js              ← backend paiement PayPal + API MongoDB (optionnel, Node)
├── paypal-setup.js · package.json · package-lock.json · .env.example
├── lancer_soloia.bat      ← double-clic : fenêtre bureau (cd python && python main.py)
├── lancer_soloia_web.bat  ← double-clic : plateforme web (python server.py à la racine)
├── SoloIA.exe             ← fenêtre bureau compilée (autonome, sans Python)
├── README.md · PROGRESS.md
│
└── python/                    ← TOUT le code Python (moteur + app bureau)
    ├── main.py                ← point d'entrée (fenêtre bureau / --tk / --cli)
    ├── requirements.txt       ← pywebview (fenêtre bureau par défaut)
    ├── SoloIA.spec            ← recette PyInstaller
    ├── soloia/                ← engine, retrieval, nlu, reasoning, learning, webapp
    │                             (_web_root trouve la racine), outils, gui/cli, selftest…
    ├── scripts/               ← selfcheck.py · train.py · selftrain.py
    └── data/                  ← knowledge/ (base) · skills/ · learning.json (à l'usage)
```

---

## ❓ FAQ

**Ça marche sans internet ?** Oui, totalement. Tout est local.

**Ça marche sur Mac / Linux ?** Oui : `cd python && python3 main.py`.

**Rien ne s'ouvre ?** Depuis `python/`, essaie `python main.py --tk` (Tkinter,
sans dépendance) ou `python main.py --cli`, et vérifie `python --version`.

**Où est passé le dossier `web/` ?** Son contenu est désormais **à la racine**
(disposition « HTML à la racine »). Le moteur bureau (`soloia/webapp.py`) le
retrouve automatiquement via `_web_root()`.

Bon code ! ⚡

---

## 🧬 Note Ollama (LLM local branché)

SoloIA est branché sur **[Qwen2.5-Coder](https://ollama.com/library/qwen2.5-coder)**.
Il détecte automatiquement la meilleure variante installée (32b > 14b > 7b > 3b) :

```bash
ollama pull qwen2.5-coder:3b    # PC modeste, sans GPU (rapide)
ollama pull qwen2.5-coder:7b    # bon compromis (16 Go RAM conseillés)
ollama pull qwen2.5-coder:14b   # avec GPU ou Mac puissant
ollama pull qwen2.5-coder:32b   # le "Max", GPU 24 Go+ / Mac 32 Go+
```

Active « LLM local » (`python main.py --llm`). Sans modèle installé, SoloIA
reste sur sa base de connaissances (aucune erreur).
