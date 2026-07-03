/* Configuration front de SoloIA — PayPal (abonnements réels via Button Factory).
   Le client-id est PUBLIC par nature (SDK web PayPal) : aucun risque à le
   laisser ici. Le client-secret, lui, ne doit JAMAIS apparaître côté front —
   il reste uniquement dans le .env du serveur (server.js), pour l'API et la
   vérification des webhooks. */
window.PAYPAL_CLIENT_ID = "BAA1F-Pux0sjs2MreQuHG2YOO107Wx5RYWAbhfAvEzwf60OW6PA_lnXiZivAfeNeC16zcFLRGtS2zDA1Zs";

// Identifiants des plans d'abonnement PayPal (créés via Button Factory).
window.PAYPAL_PLANS = {
  pro: { id: "P-0U198209AE187844LNJC3H4A", name: "SoloIA Pro", price: "19,99 €" },
  max: { id: "P-72N32036G3788780TNJC3FTQ", name: "SoloIA Max", price: "79,99 €" },
};

// Crédits alloués chaque mois par forfait. Une fois épuisés, l'envoi de
// messages est bloqué jusqu'au mois suivant (ou jusqu'à une mise à niveau).
window.PLAN_CREDITS = {
  "Forfait Free": 1000,
  "SoloIA Pro": 20000,
  "SoloIA Max": 100000,
};

// Comptes propriétaires : credits illimites et forfait Max force, des qu'un
// de ces emails se connecte via une methode REELLE (email/mot de passe,
// Google, Apple...) - il n'y a plus de raccourci de connexion instantanee :
// c'est la vraie authentification Firebase qui protege l'acces.
window.OWNER_EMAILS = ["antoine.fleau@gmail.com", "chaarlieflow@gmail.com"];

// Rang de chaque forfait (plus haut = plus de modeles debloques).
window.PLAN_RANK = { "Forfait Free": 0, "SoloIA Pro": 1, "SoloIA Max": 2 };

// Modeles proposes dans le menu deroulant. Tous les trois sont EN REALITE le
// meme LLM local (Ollama, Qwen2.5-Coder) sous le capot : seuls le nom affiche,
// le forfait minimum requis et le mode de calcul des credits changent.
// - rapide : ouvert a tous les forfaits, 1 lettre = 0,3 credit.
// - moyen  : reserve Pro et Max, 1 mot = 1 credit.
// - max    : reserve Max, 1 phrase = 10 credits.
window.MODEL_TIERS = {
  rapide: { label: "Solo - Rapide", minRank: 0, unit: "lettre", rate: 0.3 },
  moyen:  { label: "Solo - Moyen",  minRank: 1, unit: "mot",    rate: 1 },
  max:    { label: "Solo - Max",    minRank: 2, unit: "phrase", rate: 10 },
};

// Base de donnees (optionnelle) : si tu lances le backend Node (server.js)
// avec une variable d'environnement MONGODB_URI valide, SoloIA synchronise en
// plus les credits/plan/conversations vers MongoDB (en toile de fond, sans
// jamais bloquer l'appli — localStorage reste la source de verite locale).
window.REMOTE_API = "/api/store";
