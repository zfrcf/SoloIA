/*
 * Backend PayPal de SoloIA (optionnel, pour la version payante).
 * Sert aussi le site statique (index.html) sur le meme port.
 *
 * Lancement :
 *   1. npm install
 *   2. copier .env.example en .env et remplir tes cles PayPal (sandbox)
 *   3. node server.js   ->  http://localhost:3000
 *
 * Le site fonctionne SANS ce backend (chat + comptes Firebase) ; ce serveur
 * n'est necessaire que pour encaisser les paiements PayPal.
 */
require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { MongoClient } = require("mongodb");

const app = express();
app.use(express.json());
// Sert le site statique (index.html + assets) depuis ce dossier.
app.use(express.static(__dirname));

const {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID,
  PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com",
  MONGODB_URI,
  PORT = 3000,
} = process.env;

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.warn(
    "[SoloIA] Cles PayPal absentes : les routes /api/paypal renverront une erreur. " +
    "Le site statique reste servi normalement."
  );
}

// ---------------------------------------------------------------------------
// MongoDB (optionnel) : mirroise credits/plan/conversations depuis le front.
// Le site fonctionne SANS MongoDB (localStorage cote navigateur reste la
// source de verite) ; cette base sert de sauvegarde/synchronisation quand
// elle est configuree et joignable. Toute erreur reste silencieuse cote
// serveur (log seulement) pour ne jamais casser le reste de l'API.
// ---------------------------------------------------------------------------
let mongoCollection = null;
let mongoAttempted = false;

async function getStoreCollection() {
  if (mongoCollection) return mongoCollection;
  if (mongoAttempted) return null; // deja tente et echoue : ne pas boucler
  mongoAttempted = true;
  if (!MONGODB_URI) {
    console.warn("[SoloIA] MONGODB_URI absent : /api/store fonctionnera en erreur 503 (pas bloquant pour le reste).");
    return null;
  }
  try {
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
    const db = client.db();
    mongoCollection = db.collection("kv_store");
    await mongoCollection.createIndex({ uid: 1, key: 1 }, { unique: true });
    console.log("[SoloIA] MongoDB connecté :", db.databaseName);
    return mongoCollection;
  } catch (error) {
    console.warn("[SoloIA] MongoDB indisponible (" + error.message + ") : /api/store restera en erreur, le reste du site fonctionne normalement.");
    return null;
  }
}

// Cle/valeur generique, namespacee par utilisateur : miroir de ce que
// app.js garde en localStorage (credits, plan, conversations, projets...).
app.get("/api/store/:uid/:key", async (req, res) => {
  const col = await getStoreCollection();
  if (!col) return res.status(503).json({ error: "MongoDB non configuré ou indisponible." });
  try {
    const doc = await col.findOne({ uid: req.params.uid, key: req.params.key });
    return res.json({ value: doc ? doc.value : null, updatedAt: doc ? doc.updatedAt : null });
  } catch (error) {
    console.error("Erreur lecture MongoDB :", error);
    return res.status(500).json({ error: "Erreur de lecture." });
  }
});

app.put("/api/store/:uid/:key", async (req, res) => {
  const col = await getStoreCollection();
  if (!col) return res.status(503).json({ error: "MongoDB non configuré ou indisponible." });
  try {
    await col.updateOne(
      { uid: req.params.uid, key: req.params.key },
      { $set: { value: req.body, updatedAt: new Date() } },
      { upsert: true }
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error("Erreur écriture MongoDB :", error);
    return res.status(500).json({ error: "Erreur d'écriture." });
  }
});

// Les prix viennent du serveur (jamais du navigateur).
const PRODUCTS = {
  formule_basic: { name: "Formule Basic", value: "19.99", currency_code: "EUR" },
  formule_premium: { name: "Formule Premium", value: "39.99", currency_code: "EUR" },
};

async function generateAccessToken() {
  const credentials = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString("base64");
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("Erreur OAuth PayPal :", data);
    throw new Error("Impossible d'obtenir le jeton PayPal.");
  }
  return data.access_token;
}

async function paypalRequest(endpoint, options = {}) {
  const accessToken = await generateAccessToken();
  const response = await fetch(`${PAYPAL_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });
  const text = await response.text();
  let data = {};
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
  return { ok: response.ok, status: response.status, data };
}

app.post("/api/paypal/orders", async (req, res) => {
  try {
    const product = PRODUCTS[req.body.productId];
    if (!product) return res.status(400).json({ error: "Produit inconnu." });
    const result = await paypalRequest("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": crypto.randomUUID() },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: req.body.productId,
          description: product.name,
          amount: { currency_code: product.currency_code, value: product.value },
        }],
        application_context: {
          brand_name: "SoloIA",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
        },
      }),
    });
    if (!result.ok) return res.status(result.status).json({ error: "Commande PayPal refusee.", paypal: result.data });
    return res.status(201).json(result.data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur (creation)." });
  }
});

app.post("/api/paypal/orders/:orderId/capture", async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!/^[A-Z0-9]+$/i.test(orderId)) return res.status(400).json({ error: "Identifiant incorrect." });
    const result = await paypalRequest(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      { method: "POST", headers: { "PayPal-Request-Id": crypto.randomUUID() }, body: JSON.stringify({}) }
    );
    if (!result.ok) return res.status(result.status).json({ error: "Capture impossible.", paypal: result.data });
    return res.status(200).json(result.data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur (capture)." });
  }
});

const processedWebhookEvents = new Set();

async function verifyPayPalWebhook(req) {
  const verification = await paypalRequest("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: req.get("paypal-auth-algo"),
      cert_url: req.get("paypal-cert-url"),
      transmission_id: req.get("paypal-transmission-id"),
      transmission_sig: req.get("paypal-transmission-sig"),
      transmission_time: req.get("paypal-transmission-time"),
      webhook_id: PAYPAL_WEBHOOK_ID,
      webhook_event: req.body,
    }),
  });
  return verification.ok && verification.data.verification_status === "SUCCESS";
}

app.post("/api/paypal/webhook", async (req, res) => {
  try {
    if (!(await verifyPayPalWebhook(req))) return res.sendStatus(400);
    const event = req.body;
    if (!event?.id || !event?.event_type) return res.sendStatus(400);
    if (processedWebhookEvents.has(event.id)) return res.sendStatus(200);
    switch (event.event_type) {
      // --- Abonnements SoloIA Pro / Max (Button Factory, plan_id fixe) ---
      case "BILLING.SUBSCRIPTION.ACTIVATED": {
        const sub = event.resource || {};
        console.log("Abonnement activé :", sub.id, "plan", sub.plan_id);
        // Ici : marquer l'utilisateur comme abonné (Pro/Max selon plan_id) en
        // base de données, a partir de sub.subscriber?.email_address ou d'un
        // identifiant transmis lors de la creation cote client.
        break;
      }
      case "BILLING.SUBSCRIPTION.CANCELLED":
      case "BILLING.SUBSCRIPTION.SUSPENDED":
      case "BILLING.SUBSCRIPTION.EXPIRED":
        console.log("Abonnement terminé :", event.resource?.id, event.event_type);
        // Ici : repasser l'utilisateur en Forfait Free en base de données.
        break;
      case "PAYMENT.SALE.COMPLETED":
        console.log("Paiement d'abonnement reçu :", event.resource?.id);
        break;
      // --- Ancien flux "commande unique" (produits ponctuels, optionnel) ---
      case "PAYMENT.CAPTURE.COMPLETED":
        console.log("Paiement terminé :", event.resource?.id);
        break;
      default:
        console.log("Événement PayPal :", event.event_type);
    }
    processedWebhookEvents.add(event.id);
    return res.sendStatus(200);
  } catch (error) {
    console.error("Erreur webhook :", error);
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`SoloIA (site + paiement) sur http://localhost:${PORT}`);
  getStoreCollection(); // tentative de connexion MongoDB au démarrage (log informatif)
});
