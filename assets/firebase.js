/* Intégration Firebase Auth pour SoloIA.
   Fournisseurs : e-mail/mot de passe, Google, Apple, Téléphone (SMS), Anonyme.
   Repli « invité local » (localStorage) si Firebase est indisponible (hors-ligne).
   La config est publique par nature (SDK web Firebase). */
(function (global) {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyBSR0-r2za33pJdwIhZ7ScC3l1_whIkVRM",
    authDomain: "soloia-d1690.firebaseapp.com",
    projectId: "soloia-d1690",
    storageBucket: "soloia-d1690.firebasestorage.app",
    messagingSenderId: "467181337759",
    appId: "1:467181337759:web:a05681dddf869dd2df36aa",
    measurementId: "G-GZMFVV09XH",
  };

  let auth = null, ready = false;
  try {
    if (global.firebase && firebase.initializeApp) {
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      try { firebase.analytics(); } catch (e) {}
      ready = true;
    }
  } catch (e) { console.warn("Firebase indisponible, mode invité local.", e); }

  function fromFb(u) {
    if (!u) return null;
    const name = u.displayName || (u.email ? u.email.split("@")[0] : null) ||
      (u.phoneNumber ? u.phoneNumber : null) || (u.isAnonymous ? "Anonyme" : "Utilisateur");
    return { email: u.email, phone: u.phoneNumber, name: name, uid: u.uid,
             anonymous: !!u.isAnonymous, source: "firebase" };
  }

  function localUser() { try { return JSON.parse(localStorage.getItem("soloia_user") || "null"); } catch (e) { return null; } }
  function setLocalUser(u) { if (u) localStorage.setItem("soloia_user", JSON.stringify(u)); else localStorage.removeItem("soloia_user"); }

  // Detecte si on tourne DANS la fenetre bureau (pywebview injecte toujours
  // window.pywebview, verifie empiriquement). Les popups OAuth
  // (signInWithPopup) sont notoirement peu fiables dans les navigateurs web
  // embarques (WebView2 ici) : on bascule alors sur signInWithRedirect, qui
  // navigue la fenetre elle-meme au lieu d'ouvrir une popup separee.
  function inEmbeddedWebview() { return !!global.pywebview; }

  const Auth = {
    ready: () => ready,
    firebaseReady: () => ready,

    current: function () { return (ready && auth.currentUser) ? fromFb(auth.currentUser) : localUser(); },
    onChange: function (cb) {
      if (ready) auth.onAuthStateChanged((u) => cb(u ? fromFb(u) : localUser()));
      else cb(localUser());
    },

    // --- E-mail / mot de passe ---
    signIn: async function (email, password) {
      if (ready) return fromFb((await auth.signInWithEmailAndPassword(email, password)).user);
      const u = { email, name: (email || "invite").split("@")[0], uid: "local-" + btoa(email).slice(0, 8), source: "local" };
      setLocalUser(u); return u;
    },
    signUp: async function (email, password) {
      if (ready) return fromFb((await auth.createUserWithEmailAndPassword(email, password)).user);
      const u = { email, name: (email || "invite").split("@")[0], uid: "local-" + btoa(email).slice(0, 8), source: "local" };
      setLocalUser(u); return u;
    },

    // --- Google ---
    google: async function () {
      if (!ready) throw new Error("Firebase requis pour Google.");
      const p = new firebase.auth.GoogleAuthProvider();
      if (inEmbeddedWebview()) { await auth.signInWithRedirect(p); return null; }
      return fromFb((await auth.signInWithPopup(p)).user);
    },
    // --- Apple ---
    apple: async function () {
      if (!ready) throw new Error("Firebase requis pour Apple.");
      const p = new firebase.auth.OAuthProvider("apple.com");
      p.addScope("email"); p.addScope("name");
      if (inEmbeddedWebview()) { await auth.signInWithRedirect(p); return null; }
      return fromFb((await auth.signInWithPopup(p)).user);
    },
    // --- Resultat d'une connexion par redirection (fenetre bureau) ---
    // A appeler au demarrage de l'appli : si un signInWithRedirect vient de
    // se terminer (la page a ete rechargee au retour du fournisseur), renvoie
    // l'utilisateur connecte. Renvoie null si aucune redirection en attente.
    checkRedirectResult: async function () {
      if (!ready) return null;
      try {
        const result = await auth.getRedirectResult();
        return result && result.user ? fromFb(result.user) : null;
      } catch (e) {
        console.warn("Connexion par redirection en echec :", e);
        return null;
      }
    },
    // --- Anonyme ---
    anon: async function () {
      if (ready) { try { return fromFb((await auth.signInAnonymously()).user); } catch (e) {} }
      return Auth.guest();
    },
    guest: function () { const u = { email: null, name: "Invité", uid: "guest", source: "guest" }; setLocalUser(u); return u; },

    // --- Téléphone (SMS) ---
    // 1) startPhone : envoie le code par SMS (reCAPTCHA invisible sur le bouton).
    startPhone: async function (phoneNumber, buttonId) {
      if (!ready) throw new Error("Firebase requis pour la connexion par téléphone.");
      if (!global._recaptcha) {
        global._recaptcha = new firebase.auth.RecaptchaVerifier(buttonId || "phoneSend",
          { size: "invisible" });
      }
      global._confirmation = await auth.signInWithPhoneNumber(phoneNumber, global._recaptcha);
      return true;
    },
    // 2) confirmPhone : valide le code reçu.
    confirmPhone: async function (code) {
      if (!global._confirmation) throw new Error("Aucun code en attente.");
      return fromFb((await global._confirmation.confirm(code)).user);
    },
    resetPhone: function () {
      try { if (global._recaptcha) { global._recaptcha.clear(); global._recaptcha = null; } } catch (e) {}
      global._confirmation = null;
    },

    signOut: async function () { if (ready) { try { await auth.signOut(); } catch (e) {} } setLocalUser(null); },
  };

  global.SoloIAAuth = Auth;
})(window);
