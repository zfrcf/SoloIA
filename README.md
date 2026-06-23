# SoloIA

SoloIA est une application Windows Python modulaire destinée à créer un espace personnel IA : conversation, organisation, recherche web, navigateur intégré, automatisations, gestion de projets et espace de codage.

## Fonctionnalités incluses

- Interface moderne PySide6 avec thème sombre / clair
- Navigation latérale et tableau de bord
- Agent IA conversationnel avec mémoire locale SQLite
- Gestion de plusieurs conversations
- Architecture prête pour API OpenAI ou autre fournisseur IA
- Navigateur intégré via Qt WebEngine quand disponible
- Recherche web légère avec résumé IA
- Automatisations : rappels et exécution de scripts Python
- Historique des actions
- Éditeur de code avec ouverture, sauvegarde et exécution de scripts Python
- Gestion de projets/dossiers
- Préparation Firebase Admin SDK pour synchronisation cloud
- Préparation PyInstaller pour générer un `.exe`

## Installation Windows

```bash
cd SoloIA
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python main.py
```

## Configuration IA

Dans `.env`, ajoutez :

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Sans clé API, SoloIA fonctionne en mode placeholder local : l'interface, la mémoire et les modules restent utilisables.

## Configuration Firebase

1. Créer un projet Firebase.
2. Générer une clé de compte de service depuis Firebase / Google Cloud.
3. Placer le fichier JSON dans :

```text
secrets/firebase-service-account.json
```

4. Compléter `.env` :

```env
FIREBASE_PROJECT_ID=votre-projet
FIREBASE_CREDENTIALS_PATH=secrets/firebase-service-account.json
FIREBASE_DATABASE_URL=
```

Structure Firestore prévue :

```text
users/{userId}
  settings: {...}
  conversations/{conversationId}
  projects/{projectId}
```

## Générer le fichier `.exe`

Méthode recommandée :

```bash
venv\Scripts\activate
pyinstaller SoloIA.spec --clean --noconfirm
```

Ou double-cliquer sur :

```text
pyinstaller_build.bat
```

Le fichier sera généré dans :

```text
dist/SoloIA.exe
```

## Arborescence

```text
SoloIA/
  main.py
  requirements.txt
  .env.example
  .gitignore
  README.md
  SoloIA.spec
  pyinstaller_build.bat
  assets/
    icons/
      soloia.ico
  data/
    automations/
    conversations/
    projects/
  secrets/
  soloia/
    __init__.py
    app.py
    config.py
    core/
      __init__.py
    modules/
      __init__.py
    services/
      __init__.py
      ai_service.py
      automation_service.py
      firebase_service.py
      search_service.py
    storage/
      __init__.py
      database.py
    ui/
      __init__.py
      automation_page.py
      browser_page.py
      chat_page.py
      code_page.py
      dashboard_page.py
      main_window.py
      projects_page.py
      search_page.py
      styles.py
      widgets.py
    utils/
      __init__.py
```

## Notes de production

- Pour un moteur de recherche robuste, remplacez `SearchService` par SerpAPI, Bing Search API, Tavily ou Brave Search API.
- Pour l'authentification Firebase côté client, ajoutez un flux email/mot de passe ou OAuth via une API backend sécurisée. Le module fourni prépare la sauvegarde Firestore via Firebase Admin.
- Pour un navigateur intégré complet, PySide6 WebEngine doit être correctement packagé avec PyInstaller.
- Les automatisations locales utilisent APScheduler et peuvent être étendues vers des tâches récurrentes avec cron.


# SoloIA Pro — extension Termux et IA locale

Cette version ajoute un serveur Android/Termux, un connecteur Windows, un moteur de compréhension de prompt, un service RAG local et des scripts pour installer llama.cpp et télécharger des modèles GGUF. Voir `docs/TERMUX_MODELS.md` et `docs/ARCHITECTURE_PRO.md`.
