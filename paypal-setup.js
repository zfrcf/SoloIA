/*
 * Crée les produits PayPal de SoloIA via l'API Catalogs.
 * Utilise l'auth OAuth propre (client-id/secret du .env), JAMAIS un jeton collé
 * en dur (les jetons d'accès expirent et ne doivent pas être partagés).
 *
 * Usage :
 *   1. remplir .env (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET)
 *   2. node paypal-setup.js
 */
require("dotenv").config();

const crypto = require("crypto");

const {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com",
} = process.env;

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error("Renseigne PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET dans .env.");
  process.exit(1);
}

const PRODUCTS = [
  { name: "SoloIA Basic", description: "Abonnement SoloIA Basic", type: "SERVICE", category: "SOFTWARE" },
  { name: "SoloIA Premium", description: "Abonnement SoloIA Premium (Pro Max)", type: "SERVICE", category: "SOFTWARE" },
];

async function accessToken() {
  const creds = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const d = await r.json();
  if (!r.ok) throw new Error("OAuth PayPal échoué : " + JSON.stringify(d));
  return d.access_token;
}

async function createProduct(token, p) {
  const r = await fetch(`${PAYPAL_BASE_URL}/v1/catalogs/products`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "PayPal-Request-Id": crypto.randomUUID(),
      Prefer: "return=representation",
    },
    body: JSON.stringify(p),
  });
  const d = await r.json();
  if (!r.ok) throw new Error("Création produit échouée : " + JSON.stringify(d));
  return d;
}

(async () => {
  try {
    const token = await accessToken();
    for (const p of PRODUCTS) {
      const created = await createProduct(token, p);
      console.log(`✔ ${created.name}  ->  id = ${created.id}`);
    }
    console.log("\nProduits créés. (Pour des ABONNEMENTS récurrents, crée ensuite des 'plans' liés à ces produits.)");
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
