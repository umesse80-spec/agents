// ==========================================================
// AGENTS_IA — CATALOGUE DES CONNECTEURS D'AUTOMATISATION
// Chaque application contient des modules (déclencheurs,
// actions, recherches). Chaque module possède une fonction
// run() qui renvoie un tableau de "bundles" (paquets de données).
// ==========================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DATASTORE_FILE = path.join(DATA_DIR, "automation-datastore.json");

const GEMINI_MODEL = "gemini-3.5-flash-lite";

// ----------------------------------------------------------
// OUTILS COMMUNS
// ----------------------------------------------------------

function toText(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function required(value, label) {
    if (value === undefined || value === null || String(value).trim() === "") {
        throw new Error(`Le champ « ${label} » est obligatoire.`);
    }
    return value;
}

// Transforme une liste [{key, value}] en objet
function pairsToObject(pairs) {
    const result = {};

    if (Array.isArray(pairs)) {
        for (const pair of pairs) {
            if (pair && String(pair.key || "").trim()) {
                result[String(pair.key).trim()] = pair.value;
            }
        }
    } else if (pairs && typeof pairs === "object") {
        Object.assign(result, pairs);
    }

    return result;
}

async function fetchJSON(url, options = {}, label = "API") {
    const response = await fetch(url, options);
    const text = await response.text();

    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = text;
    }

    if (!response.ok) {
        const detail =
            (data && (data.message || data.error?.message || data.error || data.description)) ||
            text ||
            `HTTP ${response.status}`;

        throw new Error(`${label} : ${typeof detail === "string" ? detail : JSON.stringify(detail)} (HTTP ${response.status})`);
    }

    return data;
}

function connectionValue(ctx, connectionId, key, appName) {
    if (!connectionId) {
        throw new Error(`Choisis une connexion ${appName} dans le module.`);
    }

    const connection = ctx.getConnection(connectionId);

    if (!connection) {
        throw new Error(`La connexion ${appName} sélectionnée est introuvable. Recrée-la dans « Connexions ».`);
    }

    const value = connection.data?.[key];

    if (!value) {
        throw new Error(`La connexion ${appName} « ${connection.name} » est incomplète.`);
    }

    return value;
}

// ----------------------------------------------------------
// STOCKAGE DE DONNÉES (Data stores)
// ----------------------------------------------------------

function readDatastore() {
    try {
        return JSON.parse(fs.readFileSync(DATASTORE_FILE, "utf8"));
    } catch {
        return { stores: {} };
    }
}

function writeDatastore(data) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATASTORE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function storeName(name) {
    const clean = String(name || "").trim();
    if (!clean) throw new Error("Indique le nom du stockage de données.");
    if (clean.length > 60) throw new Error("Nom de stockage trop long (60 caractères maximum).");
    return clean;
}

function parseMaybeJSON(value) {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^[\[{"]/.test(trimmed) || /^(true|false|null|-?\d+(\.\d+)?)$/.test(trimmed)) {
        try {
            return JSON.parse(trimmed);
        } catch {
            return value;
        }
    }
    return value;
}

// ----------------------------------------------------------
// GMAIL (utilise ton agent Gmail et ton token.json existants)
// ----------------------------------------------------------

function ensureGmailPlugin() {
    const plugins = require("./plugins");
    const gmail = plugins.getAll().find(plugin => plugin.id === "gmail");

    if (!gmail?.installed || !gmail?.enabled) {
        throw new Error("Le plugin Gmail doit être installé et activé (onglet Plugins).");
    }
}

function gmailClient() {
    const { google } = require("googleapis");

    const credentialsPath = path.join(__dirname, "gmail-credentials.json");
    const tokenPath = path.join(__dirname, "token.json");

    if (!fs.existsSync(credentialsPath) || !fs.existsSync(tokenPath)) {
        throw new Error("Connexion Gmail non configurée (gmail-credentials.json ou token.json manquant).");
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    const config = credentials.installed || credentials.web;
    const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));

    const auth = new google.auth.OAuth2(
        config.client_id,
        config.client_secret,
        config.redirect_uris?.[0]
    );

    auth.setCredentials(token);

    // Sauvegarde automatique du jeton rafraîchi
    auth.on("tokens", tokens => {
        try {
            const current = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
            fs.writeFileSync(tokenPath, JSON.stringify({ ...current, ...tokens }, null, 2));
        } catch (error) {
            console.warn("[AUTOMATIONS] Impossible d'enregistrer le jeton Gmail :", error.message);
        }
    });

    return google.gmail({ version: "v1", auth });
}

function encodeHeader(value) {
    const text = String(value || "");
    return /^[\x00-\x7F]*$/.test(text)
        ? text
        : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function normalizeEmail(email) {
    return {
        id: email.id,
        threadId: email.threadId,
        sender: email.sender || email.from,
        subject: email.subject,
        date: email.date,
        snippet: email.snippet,
        body: email.body || email.snippet || "",
        ...email
    };
}

// ----------------------------------------------------------
// GEMINI
// ----------------------------------------------------------

let geminiClient = null;

function gemini() {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("Clé API Gemini manquante dans le fichier .env");
    }

    if (!geminiClient) {
        const { GoogleGenAI } = require("@google/genai");
        geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }

    return geminiClient;
}

// ----------------------------------------------------------
// CATALOGUE
// ----------------------------------------------------------

const apps = [

    // ======================= WEBHOOKS =======================
    {
        id: "webhooks",
        name: "Webhooks",
        color: "#c3226b",
        icon: "⚓",
        category: "Intégré",
        description: "Recevoir des données depuis n'importe quel service via une URL.",
        modules: [
            {
                id: "customWebhook",
                name: "Webhook personnalisé",
                kind: "trigger",
                instant: true,
                description: "Déclenche le scénario dès qu'une requête arrive sur l'URL du webhook.",
                fields: [
                    { key: "hookId", label: "Webhook", type: "hook", required: true }
                ],
                outputs: [],
                async run(params, ctx) {
                    if (ctx.webhookPayload === undefined) {
                        throw new Error("Aucune donnée reçue sur ce webhook. Envoie d'abord une requête à son URL, puis relance.");
                    }
                    return [ctx.webhookPayload];
                }
            },
            {
                id: "webhookResponse",
                name: "Réponse au webhook",
                kind: "action",
                description: "Renvoie une réponse personnalisée à l'appelant du webhook.",
                fields: [
                    { key: "status", label: "Statut HTTP", type: "number", default: 200 },
                    { key: "body", label: "Corps de la réponse", type: "textarea", placeholder: "{\"ok\": true}" },
                    { key: "headers", label: "En-têtes", type: "keyvalue" }
                ],
                outputs: [{ key: "status", label: "Statut" }],
                async run(params, ctx) {
                    const status = Number(params.status) || 200;
                    const headers = {};
                    for (const [key, value] of Object.entries(pairsToObject(params.headers))) {
                        headers[key] = toText(value);
                    }
                    ctx.setWebhookResponse({
                        status: status >= 100 && status <= 599 ? status : 200,
                        body: params.body ?? "",
                        headers
                    });
                    return [{ status }];
                }
            }
        ]
    },

    // ======================= OUTILS =======================
    {
        id: "tools",
        name: "Outils",
        color: "#6b7280",
        icon: "⚙",
        category: "Intégré",
        description: "Déclencheur de base, variables, pauses et composition de texte.",
        modules: [
            {
                id: "basicTrigger",
                name: "Déclencheur de base",
                kind: "trigger",
                description: "Lance le scénario selon la planification avec les données que tu définis.",
                fields: [
                    { key: "data", label: "Données du paquet", type: "keyvalue", help: "Optionnel : valeurs fixes disponibles pour la suite." }
                ],
                outputs: [{ key: "timestamp", label: "Date de déclenchement" }],
                async run(params) {
                    return [{ ...pairsToObject(params.data), timestamp: new Date().toISOString() }];
                }
            },
            {
                id: "setVariables",
                name: "Définir des variables",
                kind: "action",
                description: "Crée des variables réutilisables dans les modules suivants.",
                fields: [
                    { key: "variables", label: "Variables", type: "keyvalue", required: true }
                ],
                outputs: [],
                async run(params) {
                    return [pairsToObject(params.variables)];
                }
            },
            {
                id: "compose",
                name: "Composer un texte",
                kind: "action",
                description: "Assemble un texte à partir de données mappées.",
                fields: [
                    { key: "text", label: "Texte", type: "textarea", required: true }
                ],
                outputs: [{ key: "text", label: "Texte" }],
                async run(params) {
                    return [{ text: toText(params.text) }];
                }
            },
            {
                id: "sleep",
                name: "Pause",
                kind: "action",
                description: "Attend un nombre de secondes avant de continuer (300 max).",
                fields: [
                    { key: "seconds", label: "Durée (secondes)", type: "number", default: 5, required: true }
                ],
                outputs: [{ key: "waited", label: "Secondes attendues" }],
                async run(params) {
                    const seconds = Math.min(300, Math.max(0, Number(params.seconds) || 0));
                    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
                    return [{ waited: seconds }];
                }
            }
        ]
    },

    // ======================= CONTRÔLE DU FLUX =======================
    {
        id: "flow",
        name: "Contrôle du flux",
        color: "#7c3aed",
        icon: "⑂",
        category: "Intégré",
        description: "Routeur, itérateur et répéteur.",
        modules: [
            {
                id: "router",
                name: "Routeur",
                kind: "router",
                description: "Sépare le scénario en plusieurs routes, chacune avec son propre filtre.",
                fields: [],
                outputs: []
            },
            {
                id: "iterator",
                name: "Itérateur",
                kind: "action",
                description: "Transforme un tableau en plusieurs paquets traités un par un.",
                fields: [
                    { key: "array", label: "Tableau", type: "text", required: true, help: "Mappe un tableau, ex. {{2.items}}. Un texte JSON de tableau est aussi accepté." }
                ],
                outputs: [
                    { key: "value", label: "Valeur" },
                    { key: "index", label: "Position (à partir de 1)" },
                    { key: "total", label: "Nombre total" }
                ],
                async run(params) {
                    let list = parseMaybeJSON(params.array);

                    if (!Array.isArray(list)) {
                        if (list === "" || list === undefined || list === null) return [];
                        list = [list];
                    }

                    return list.map((item, index) => ({
                        ...(item && typeof item === "object" && !Array.isArray(item) ? item : {}),
                        value: item,
                        index: index + 1,
                        total: list.length
                    }));
                }
            },
            {
                id: "repeater",
                name: "Répéteur",
                kind: "action",
                description: "Répète la suite du scénario un certain nombre de fois.",
                fields: [
                    { key: "initial", label: "Valeur initiale", type: "number", default: 1 },
                    { key: "repeats", label: "Répétitions", type: "number", default: 3, required: true },
                    { key: "step", label: "Pas", type: "number", default: 1 }
                ],
                outputs: [{ key: "i", label: "Compteur" }],
                async run(params) {
                    const repeats = Math.min(1000, Math.max(0, Math.floor(Number(params.repeats) || 0)));
                    const initial = Number(params.initial) || 0;
                    const step = Number(params.step) || 1;
                    return Array.from({ length: repeats }, (_, i) => ({ i: initial + i * step }));
                }
            }
        ]
    },

    // ======================= STOCKAGE DE DONNÉES =======================
    {
        id: "datastore",
        name: "Stockage de données",
        color: "#0f9f8f",
        icon: "▤",
        category: "Intégré",
        description: "Mémoriser des données entre deux exécutions (anti-doublons, compteurs…).",
        modules: [
            {
                id: "set",
                name: "Ajouter / remplacer un enregistrement",
                kind: "action",
                fields: [
                    { key: "store", label: "Stockage", type: "text", required: true, placeholder: "ex. : clients" },
                    { key: "key", label: "Clé", type: "text", required: true },
                    { key: "value", label: "Valeur (texte ou JSON)", type: "textarea", required: true }
                ],
                outputs: [{ key: "key", label: "Clé" }, { key: "value", label: "Valeur" }],
                async run(params) {
                    const name = storeName(params.store);
                    const key = String(required(params.key, "Clé"));
                    const value = parseMaybeJSON(params.value);
                    const db = readDatastore();
                    db.stores[name] = db.stores[name] || {};
                    db.stores[name][key] = { value, updatedAt: new Date().toISOString() };
                    writeDatastore(db);
                    return [{ key, value }];
                }
            },
            {
                id: "get",
                name: "Obtenir un enregistrement",
                kind: "search",
                fields: [
                    { key: "store", label: "Stockage", type: "text", required: true },
                    { key: "key", label: "Clé", type: "text", required: true }
                ],
                outputs: [
                    { key: "exists", label: "Existe" },
                    { key: "key", label: "Clé" },
                    { key: "value", label: "Valeur" }
                ],
                async run(params) {
                    const name = storeName(params.store);
                    const key = String(required(params.key, "Clé"));
                    const record = readDatastore().stores[name]?.[key];
                    return [{ exists: Boolean(record), key, value: record ? record.value : null }];
                }
            },
            {
                id: "list",
                name: "Rechercher des enregistrements",
                kind: "search",
                fields: [
                    { key: "store", label: "Stockage", type: "text", required: true },
                    { key: "contains", label: "Clé contenant (optionnel)", type: "text" },
                    { key: "limit", label: "Nombre maximum", type: "number", default: 50 }
                ],
                outputs: [{ key: "key", label: "Clé" }, { key: "value", label: "Valeur" }],
                async run(params) {
                    const name = storeName(params.store);
                    const filter = String(params.contains || "").toLowerCase();
                    const limit = Math.max(1, Number(params.limit) || 50);
                    const store = readDatastore().stores[name] || {};
                    return Object.entries(store)
                        .filter(([key]) => !filter || key.toLowerCase().includes(filter))
                        .slice(0, limit)
                        .map(([key, record]) => ({ key, value: record.value, updatedAt: record.updatedAt }));
                }
            },
            {
                id: "delete",
                name: "Supprimer un enregistrement",
                kind: "action",
                fields: [
                    { key: "store", label: "Stockage", type: "text", required: true },
                    { key: "key", label: "Clé", type: "text", required: true }
                ],
                outputs: [{ key: "deleted", label: "Supprimé" }],
                async run(params) {
                    const name = storeName(params.store);
                    const key = String(required(params.key, "Clé"));
                    const db = readDatastore();
                    const existed = Boolean(db.stores[name]?.[key]);
                    if (existed) {
                        delete db.stores[name][key];
                        writeDatastore(db);
                    }
                    return [{ deleted: existed, key }];
                }
            }
        ]
    },

    // ======================= GMAIL =======================
    {
        id: "gmail",
        name: "Gmail",
        color: "#ea4335",
        icon: "✉",
        category: "Communication",
        description: "Surveiller, lire, envoyer et répondre aux e-mails (utilise ton compte Gmail déjà connecté).",
        modules: [
            {
                id: "watchEmails",
                name: "Surveiller les nouveaux e-mails",
                kind: "trigger",
                polling: true,
                description: "Déclenche le scénario pour chaque nouvel e-mail reçu.",
                fields: [
                    { key: "limit", label: "Nombre d'e-mails vérifiés par exécution", type: "number", default: 10 },
                    {
                        key: "startFrom", label: "Choisir où commencer", type: "select", default: "now",
                        options: [
                            { value: "now", label: "À partir de maintenant (ignorer les e-mails existants)" },
                            { value: "all", label: "Inclure les derniers e-mails déjà reçus" }
                        ]
                    }
                ],
                outputs: [
                    { key: "id", label: "ID de l'e-mail" },
                    { key: "sender", label: "Expéditeur" },
                    { key: "subject", label: "Objet" },
                    { key: "date", label: "Date" },
                    { key: "snippet", label: "Extrait" },
                    { key: "body", label: "Contenu" }
                ],
                async run(params, ctx) {
                    ensureGmailPlugin();
                    const gmailAgent = require("./agents/gmailAgent");
                    const limit = Math.min(50, Math.max(1, Number(params.limit) || 10));
                    const emails = (await gmailAgent.getEmails(limit)).map(normalizeEmail);

                    const firstRun = !Array.isArray(ctx.state.seen);
                    const seen = new Set(ctx.state.seen || []);
                    const fresh = emails.filter(email => email.id && !seen.has(email.id));

                    ctx.state.seen = [...emails.map(e => e.id), ...(ctx.state.seen || [])]
                        .filter((id, i, all) => id && all.indexOf(id) === i)
                        .slice(0, 500);

                    if (firstRun && params.startFrom !== "all") return [];

                    // Les plus anciens d'abord, comme Make
                    return fresh.reverse();
                }
            },
            {
                id: "listEmails",
                name: "Lister les derniers e-mails",
                kind: "search",
                fields: [
                    { key: "limit", label: "Nombre d'e-mails", type: "number", default: 10 }
                ],
                outputs: [
                    { key: "id", label: "ID de l'e-mail" },
                    { key: "sender", label: "Expéditeur" },
                    { key: "subject", label: "Objet" },
                    { key: "date", label: "Date" },
                    { key: "body", label: "Contenu" }
                ],
                async run(params) {
                    ensureGmailPlugin();
                    const gmailAgent = require("./agents/gmailAgent");
                    const limit = Math.min(50, Math.max(1, Number(params.limit) || 10));
                    return (await gmailAgent.getEmails(limit)).map(normalizeEmail);
                }
            },
            {
                id: "sendEmail",
                name: "Envoyer un e-mail",
                kind: "action",
                fields: [
                    { key: "to", label: "Destinataire(s)", type: "text", required: true, placeholder: "client@exemple.fr" },
                    { key: "cc", label: "Copie (CC)", type: "text" },
                    { key: "subject", label: "Objet", type: "text", required: true },
                    { key: "body", label: "Message", type: "textarea", required: true },
                    { key: "html", label: "Le message est en HTML", type: "boolean", default: false }
                ],
                outputs: [{ key: "id", label: "ID du message envoyé" }, { key: "threadId", label: "ID du fil" }],
                async run(params) {
                    ensureGmailPlugin();
                    required(params.to, "Destinataire(s)");
                    required(params.subject, "Objet");

                    const lines = [
                        `To: ${params.to}`,
                        params.cc ? `Cc: ${params.cc}` : null,
                        `Subject: ${encodeHeader(params.subject)}`,
                        "MIME-Version: 1.0",
                        `Content-Type: ${params.html ? "text/html" : "text/plain"}; charset=UTF-8`,
                        "Content-Transfer-Encoding: base64",
                        "",
                        Buffer.from(toText(params.body), "utf8").toString("base64")
                    ].filter(line => line !== null);

                    const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
                    const result = await gmailClient().users.messages.send({
                        userId: "me",
                        requestBody: { raw }
                    });

                    return [{ id: result.data.id, threadId: result.data.threadId, to: params.to }];
                }
            },
            {
                id: "reply",
                name: "Répondre à un e-mail",
                kind: "action",
                fields: [
                    { key: "emailId", label: "ID de l'e-mail", type: "text", required: true, help: "Mappe l'ID depuis « Surveiller les nouveaux e-mails »." },
                    { key: "text", label: "Réponse", type: "textarea", required: true }
                ],
                outputs: [{ key: "sent", label: "Envoyé" }],
                async run(params) {
                    ensureGmailPlugin();
                    const gmailAgent = require("./agents/gmailAgent");
                    const result = await gmailAgent.sendReply(
                        String(required(params.emailId, "ID de l'e-mail")),
                        String(required(params.text, "Réponse"))
                    );
                    return [{ sent: true, result: result ?? null }];
                }
            }
        ]
    },

    // ======================= GOOGLE GEMINI =======================
    {
        id: "gemini",
        name: "Google Gemini",
        color: "#4285f4",
        icon: "✦",
        category: "Intelligence artificielle",
        description: "Générer du texte et analyser des e-mails avec ta clé Gemini du fichier .env.",
        modules: [
            {
                id: "generate",
                name: "Générer une réponse",
                kind: "action",
                fields: [
                    { key: "prompt", label: "Prompt", type: "textarea", required: true },
                    { key: "system", label: "Instructions système", type: "textarea" },
                    { key: "model", label: "Modèle", type: "text", default: GEMINI_MODEL },
                    { key: "json", label: "Répondre en JSON", type: "boolean", default: false, help: "Le résultat JSON est aussi disponible dans « data »." }
                ],
                outputs: [{ key: "text", label: "Réponse" }, { key: "data", label: "Données JSON" }],
                async run(params) {
                    const config = {};
                    if (params.system) config.systemInstruction = toText(params.system);
                    if (params.json) config.responseMimeType = "application/json";

                    const response = await gemini().models.generateContent({
                        model: params.model || GEMINI_MODEL,
                        contents: toText(required(params.prompt, "Prompt")),
                        config
                    });

                    const text = response.text || "";
                    let data = null;
                    if (params.json) {
                        try { data = JSON.parse(text); } catch { data = null; }
                    }
                    return [{ text, data }];
                }
            },
            {
                id: "analyzeEmail",
                name: "Analyser un e-mail (AGENTS_IA)",
                kind: "action",
                description: "Classe l'e-mail, résume la demande et prépare un brouillon de réponse.",
                fields: [
                    { key: "sender", label: "Expéditeur", type: "text" },
                    { key: "subject", label: "Objet", type: "text" },
                    { key: "date", label: "Date", type: "text" },
                    { key: "body", label: "Contenu", type: "textarea", required: true }
                ],
                outputs: [
                    { key: "category", label: "Catégorie" },
                    { key: "urgency", label: "Urgence" },
                    { key: "summary", label: "Résumé" },
                    { key: "request", label: "Demande" },
                    { key: "action", label: "Action" },
                    { key: "requiresHumanReview", label: "Validation humaine requise" },
                    { key: "replyDraft", label: "Brouillon de réponse" }
                ],
                async run(params) {
                    const assistant = require("./assistant");
                    const analysis = await assistant.analyzeEmail({
                        sender: params.sender,
                        subject: params.subject,
                        date: params.date,
                        body: required(params.body, "Contenu")
                    });
                    return [analysis];
                }
            }
        ]
    },

    // ======================= ANTHROPIC CLAUDE =======================
    {
        id: "claude",
        name: "Anthropic Claude",
        color: "#d97757",
        icon: "✳",
        category: "Intelligence artificielle",
        description: "Envoyer un message à Claude via l'API Anthropic.",
        connection: {
            fields: [{ key: "apiKey", label: "Clé API Anthropic", type: "password", required: true }],
            async test(data) {
                await fetchJSON("https://api.anthropic.com/v1/models", {
                    headers: { "x-api-key": data.apiKey, "anthropic-version": "2023-06-01" }
                }, "Anthropic");
                return "Clé API valide.";
            }
        },
        modules: [
            {
                id: "message",
                name: "Créer un message",
                kind: "action",
                fields: [
                    { key: "connection", label: "Connexion", type: "connection", required: true },
                    { key: "model", label: "Modèle", type: "text", default: "claude-sonnet-5-5", required: true },
                    { key: "system", label: "Instructions système", type: "textarea" },
                    { key: "prompt", label: "Message", type: "textarea", required: true },
                    { key: "maxTokens", label: "Jetons maximum", type: "number", default: 1024 }
                ],
                outputs: [{ key: "text", label: "Réponse" }, { key: "stopReason", label: "Raison d'arrêt" }],
                async run(params, ctx) {
                    const apiKey = connectionValue(ctx, params.connection, "apiKey", "Anthropic");
                    const body = {
                        model: required(params.model, "Modèle"),
                        max_tokens: Number(params.maxTokens) || 1024,
                        messages: [{ role: "user", content: toText(required(params.prompt, "Message")) }]
                    };
                    if (params.system) body.system = toText(params.system);

                    const data = await fetchJSON("https://api.anthropic.com/v1/messages", {
                        method: "POST",
                        headers: {
                            "x-api-key": apiKey,
                            "anthropic-version": "2023-06-01",
                            "content-type": "application/json"
                        },
                        body: JSON.stringify(body)
                    }, "Anthropic");

                    const text = (data.content || [])
                        .filter(part => part.type === "text")
                        .map(part => part.text)
                        .join("\n");

                    return [{ text, stopReason: data.stop_reason, usage: data.usage }];
                }
            }
        ]
    },

    // ======================= OPENAI =======================
    {
        id: "openai",
        name: "OpenAI (ChatGPT)",
        color: "#10a37f",
        icon: "◎",
        category: "Intelligence artificielle",
        description: "Générer du texte avec l'API OpenAI.",
        connection: {
            fields: [{ key: "apiKey", label: "Clé API OpenAI", type: "password", required: true }],
            async test(data) {
                await fetchJSON("https://api.openai.com/v1/models", {
                    headers: { Authorization: `Bearer ${data.apiKey}` }
                }, "OpenAI");
                return "Clé API valide.";
            }
        },
        modules: [
            {
                id: "chat",
                name: "Créer une complétion",
                kind: "action",
                fields: [
                    { key: "connection", label: "Connexion", type: "connection", required: true },
                    { key: "model", label: "Modèle", type: "text", required: true, placeholder: "Nom du modèle OpenAI" },
                    { key: "system", label: "Instructions système", type: "textarea" },
                    { key: "prompt", label: "Message", type: "textarea", required: true }
                ],
                outputs: [{ key: "text", label: "Réponse" }],
                async run(params, ctx) {
                    const apiKey = connectionValue(ctx, params.connection, "apiKey", "OpenAI");
                    const messages = [];
                    if (params.system) messages.push({ role: "system", content: toText(params.system) });
                    messages.push({ role: "user", content: toText(required(params.prompt, "Message")) });

                    const data = await fetchJSON("https://api.openai.com/v1/chat/completions", {
                        method: "POST",
                        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ model: required(params.model, "Modèle"), messages })
                    }, "OpenAI");

                    return [{ text: data.choices?.[0]?.message?.content || "", usage: data.usage }];
                }
            }
        ]
    },

    // ======================= HTTP =======================
    {
        id: "http",
        name: "HTTP",
        color: "#0b6fc7",
        icon: "⇄",
        category: "Intégré",
        description: "Appeler n'importe quelle API web (le connecteur universel).",
        modules: [
            {
                id: "request",
                name: "Faire une requête",
                kind: "action",
                fields: [
                    { key: "url", label: "URL", type: "text", required: true, placeholder: "https://api.exemple.com/..." },
                    {
                        key: "method", label: "Méthode", type: "select", default: "GET",
                        options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map(v => ({ value: v, label: v }))
                    },
                    { key: "headers", label: "En-têtes", type: "keyvalue" },
                    { key: "query", label: "Paramètres d'URL", type: "keyvalue" },
                    {
                        key: "bodyType", label: "Type de corps", type: "select", default: "none",
                        options: [
                            { value: "none", label: "Aucun" },
                            { value: "json", label: "JSON" },
                            { value: "form", label: "Formulaire (x-www-form-urlencoded)" },
                            { value: "text", label: "Texte brut" }
                        ]
                    },
                    { key: "body", label: "Corps", type: "textarea" },
                    { key: "parse", label: "Analyser la réponse (JSON)", type: "boolean", default: true }
                ],
                outputs: [
                    { key: "status", label: "Statut" },
                    { key: "headers", label: "En-têtes" },
                    { key: "data", label: "Données" }
                ],
                async run(params) {
                    const url = new URL(String(required(params.url, "URL")).trim());
                    for (const [key, value] of Object.entries(pairsToObject(params.query))) {
                        url.searchParams.append(key, toText(value));
                    }

                    const headers = {};
                    for (const [key, value] of Object.entries(pairsToObject(params.headers))) {
                        headers[key] = toText(value);
                    }

                    const options = { method: params.method || "GET", headers };

                    if (params.bodyType && params.bodyType !== "none" && !["GET"].includes(options.method)) {
                        if (params.bodyType === "json") {
                            const body = typeof params.body === "string" ? params.body : JSON.stringify(params.body ?? {});
                            try { JSON.parse(body || "{}"); } catch {
                                throw new Error("Le corps JSON est invalide. Vérifie les guillemets et les virgules.");
                            }
                            options.body = body || "{}";
                            headers["Content-Type"] = headers["Content-Type"] || "application/json";
                        } else if (params.bodyType === "form") {
                            const obj = parseMaybeJSON(params.body);
                            options.body = new URLSearchParams(typeof obj === "object" && obj ? obj : String(params.body || "")).toString();
                            headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded";
                        } else {
                            options.body = toText(params.body);
                            headers["Content-Type"] = headers["Content-Type"] || "text/plain; charset=utf-8";
                        }
                    }

                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 40000);

                    let response;
                    try {
                        response = await fetch(url, { ...options, signal: controller.signal });
                    } catch (error) {
                        throw new Error(error.name === "AbortError"
                            ? "La requête a dépassé 40 secondes."
                            : `Requête impossible : ${error.message}`);
                    } finally {
                        clearTimeout(timer);
                    }

                    const text = await response.text();
                    let data = text;
                    if (params.parse !== false) {
                        try { data = JSON.parse(text); } catch { data = text; }
                    }

                    if (!response.ok) {
                        throw new Error(`Le serveur a répondu HTTP ${response.status} : ${text.slice(0, 300)}`);
                    }

                    return [{
                        status: response.status,
                        headers: Object.fromEntries(response.headers.entries()),
                        data
                    }];
                }
            }
        ]
    },

    // ======================= JSON =======================
    {
        id: "json",
        name: "JSON",
        color: "#d99a00",
        icon: "{}",
        category: "Intégré",
        description: "Convertir du texte en données et inversement.",
        modules: [
            {
                id: "parse",
                name: "Analyser un JSON",
                kind: "action",
                description: "Si le JSON est un tableau, chaque élément devient un paquet.",
                fields: [
                    { key: "json", label: "Texte JSON", type: "textarea", required: true }
                ],
                outputs: [],
                async run(params) {
                    let data = params.json;
                    if (typeof data === "string") {
                        try { data = JSON.parse(data); } catch {
                            throw new Error("Le texte fourni n'est pas un JSON valide.");
                        }
                    }
                    if (Array.isArray(data)) {
                        return data.map(item => (item && typeof item === "object" ? item : { value: item }));
                    }
                    return [data && typeof data === "object" ? data : { value: data }];
                }
            },
            {
                id: "create",
                name: "Créer un JSON",
                kind: "action",
                fields: [
                    { key: "fields", label: "Champs", type: "keyvalue", required: true }
                ],
                outputs: [{ key: "json", label: "Texte JSON" }],
                async run(params) {
                    const obj = {};
                    for (const [key, value] of Object.entries(pairsToObject(params.fields))) {
                        obj[key] = parseMaybeJSON(value);
                    }
                    return [{ json: JSON.stringify(obj) }];
                }
            }
        ]
    },

    // ======================= TEXTE =======================
    {
        id: "text",
        name: "Analyseur de texte",
        color: "#0891b2",
        icon: "Aa",
        category: "Intégré",
        description: "Remplacer, extraire avec une expression régulière, nettoyer le HTML.",
        modules: [
            {
                id: "replace",
                name: "Remplacer",
                kind: "action",
                fields: [
                    { key: "text", label: "Texte", type: "textarea", required: true },
                    { key: "pattern", label: "Rechercher", type: "text", required: true },
                    { key: "replacement", label: "Remplacer par", type: "text" },
                    { key: "regex", label: "Expression régulière", type: "boolean", default: false },
                    { key: "caseInsensitive", label: "Ignorer la casse", type: "boolean", default: true }
                ],
                outputs: [{ key: "text", label: "Texte" }],
                async run(params) {
                    const text = toText(params.text);
                    const flags = `g${params.caseInsensitive ? "i" : ""}`;
                    const source = params.regex
                        ? String(params.pattern)
                        : String(params.pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    return [{ text: text.replace(new RegExp(source, flags), toText(params.replacement)) }];
                }
            },
            {
                id: "match",
                name: "Correspondance de motif",
                kind: "search",
                description: "Chaque correspondance devient un paquet.",
                fields: [
                    { key: "text", label: "Texte", type: "textarea", required: true },
                    { key: "pattern", label: "Expression régulière", type: "text", required: true, placeholder: "ex. : [\\w.]+@[\\w.]+" },
                    { key: "global", label: "Toutes les correspondances", type: "boolean", default: true },
                    { key: "caseInsensitive", label: "Ignorer la casse", type: "boolean", default: true }
                ],
                outputs: [{ key: "match", label: "Correspondance" }, { key: "groups", label: "Groupes" }],
                async run(params) {
                    let regex;
                    try {
                        regex = new RegExp(String(params.pattern), `g${params.caseInsensitive ? "i" : ""}`);
                    } catch {
                        throw new Error("Expression régulière invalide.");
                    }
                    const results = [];
                    for (const m of toText(params.text).matchAll(regex)) {
                        results.push({ match: m[0], groups: m.slice(1), index: m.index });
                        if (!params.global) break;
                    }
                    return results;
                }
            },
            {
                id: "htmlToText",
                name: "HTML vers texte",
                kind: "action",
                fields: [
                    { key: "html", label: "HTML", type: "textarea", required: true }
                ],
                outputs: [{ key: "text", label: "Texte" }],
                async run(params) {
                    const text = toText(params.html)
                        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
                        .replace(/<br\s*\/?>/gi, "\n")
                        .replace(/<\/(p|div|li|h\d)>/gi, "\n")
                        .replace(/<[^>]+>/g, "")
                        .replace(/&nbsp;/g, " ")
                        .replace(/&amp;/g, "&")
                        .replace(/&lt;/g, "<")
                        .replace(/&gt;/g, ">")
                        .replace(/&quot;/g, "\"")
                        .replace(/&#39;/g, "'")
                        .replace(/\n{3,}/g, "\n\n")
                        .trim();
                    return [{ text }];
                }
            }
        ]
    },

    // ======================= SLACK =======================
    {
        id: "slack",
        name: "Slack",
        color: "#4a154b",
        icon: "#",
        category: "Communication",
        description: "Publier des messages dans un canal Slack (webhook entrant).",
        connection: {
            fields: [{ key: "webhookUrl", label: "URL du webhook entrant Slack", type: "password", required: true, placeholder: "https://hooks.slack.com/services/..." }]
        },
        modules: [
            {
                id: "sendMessage",
                name: "Envoyer un message",
                kind: "action",
                fields: [
                    { key: "connection", label: "Connexion", type: "connection", required: true },
                    { key: "text", label: "Message", type: "textarea", required: true }
                ],
                outputs: [{ key: "ok", label: "Envoyé" }],
                async run(params, ctx) {
                    const url = connectionValue(ctx, params.connection, "webhookUrl", "Slack");
                    const response = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ text: toText(required(params.text, "Message")) })
                    });
                    if (!response.ok) throw new Error(`Slack : HTTP ${response.status} ${await response.text()}`);
                    return [{ ok: true }];
                }
            }
        ]
    },

    // ======================= DISCORD =======================
    {
        id: "discord",
        name: "Discord",
        color: "#5865f2",
        icon: "◆",
        category: "Communication",
        description: "Publier des messages dans un salon Discord (webhook de salon).",
        connection: {
            fields: [{ key: "webhookUrl", label: "URL du webhook Discord", type: "password", required: true, placeholder: "https://discord.com/api/webhooks/..." }]
        },
        modules: [
            {
                id: "sendMessage",
                name: "Envoyer un message",
                kind: "action",
                fields: [
                    { key: "connection", label: "Connexion", type: "connection", required: true },
                    { key: "content", label: "Message", type: "textarea", required: true },
                    { key: "username", label: "Nom affiché (optionnel)", type: "text" }
                ],
                outputs: [{ key: "ok", label: "Envoyé" }],
                async run(params, ctx) {
                    const url = connectionValue(ctx, params.connection, "webhookUrl", "Discord");
                    const body = { content: toText(required(params.content, "Message")).slice(0, 2000) };
                    if (params.username) body.username = toText(params.username);
                    const response = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body)
                    });
                    if (!response.ok) throw new Error(`Discord : HTTP ${response.status} ${await response.text()}`);
                    return [{ ok: true }];
                }
            }
        ]
    },

    // ======================= TELEGRAM =======================
    {
        id: "telegram",
        name: "Telegram Bot",
        color: "#229ed9",
        icon: "➤",
        category: "Communication",
        description: "Recevoir et envoyer des messages avec ton bot Telegram.",
        connection: {
            fields: [{ key: "token", label: "Jeton du bot (BotFather)", type: "password", required: true }],
            async test(data) {
                const result = await fetchJSON(`https://api.telegram.org/bot${data.token}/getMe`, {}, "Telegram");
                return `Bot connecté : @${result.result?.username}`;
            }
        },
        modules: [
            {
                id: "watchUpdates",
                name: "Surveiller les messages",
                kind: "trigger",
                polling: true,
                fields: [
                    { key: "connection", label: "Connexion", type: "connection", required: true },
                    {
                        key: "startFrom", label: "Choisir où commencer", type: "select", default: "now",
                        options: [
                            { value: "now", label: "À partir de maintenant" },
                            { value: "all", label: "Inclure les messages en attente" }
                        ]
                    }
                ],
                outputs: [
                    { key: "chatId", label: "ID de la discussion" },
                    { key: "text", label: "Texte" },
                    { key: "fromName", label: "Prénom de l'expéditeur" },
                    { key: "fromUsername", label: "Pseudo de l'expéditeur" },
                    { key: "date", label: "Date" }
                ],
                async run(params, ctx) {
                    const token = connectionValue(ctx, params.connection, "token", "Telegram");
                    const firstRun = ctx.state.offset === undefined;
                    const offset = firstRun ? "" : `&offset=${ctx.state.offset}`;
                    const data = await fetchJSON(`https://api.telegram.org/bot${token}/getUpdates?timeout=0${offset}`, {}, "Telegram");
                    const updates = data.result || [];

                    if (updates.length) {
                        ctx.state.offset = updates[updates.length - 1].update_id + 1;
                    } else if (firstRun) {
                        ctx.state.offset = 0;
                    }

                    if (firstRun && params.startFrom !== "all") return [];

                    return updates
                        .filter(update => update.message || update.channel_post)
                        .map(update => {
                            const message = update.message || update.channel_post;
                            return {
                                updateId: update.update_id,
                                chatId: message.chat?.id,
                                text: message.text || message.caption || "",
                                fromName: message.from?.first_name || "",
                                fromUsername: message.from?.username || "",
                                date: new Date((message.date || 0) * 1000).toISOString(),
                                message
                            };
                        });
                }
            },
            {
                id: "sendMessage",
                name: "Envoyer un message",
                kind: "action",
                fields: [
                    { key: "connection", label: "Connexion", type: "connection", required: true },
                    { key: "chatId", label: "ID de la discussion", type: "text", required: true },
                    { key: "text", label: "Message", type: "textarea", required: true },
                    {
                        key: "parseMode", label: "Mise en forme", type: "select", default: "",
                        options: [
                            { value: "", label: "Texte simple" },
                            { value: "HTML", label: "HTML" },
                            { value: "MarkdownV2", label: "MarkdownV2" }
                        ]
                    }
                ],
                outputs: [{ key: "messageId", label: "ID du message" }],
                async run(params, ctx) {
                    const token = connectionValue(ctx, params.connection, "token", "Telegram");
                    const body = {
                        chat_id: required(params.chatId, "ID de la discussion"),
                        text: toText(required(params.text, "Message")).slice(0, 4096)
                    };
                    if (params.parseMode) body.parse_mode = params.parseMode;
                    const data = await fetchJSON(`https://api.telegram.org/bot${token}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body)
                    }, "Telegram");
                    return [{ messageId: data.result?.message_id, chatId: data.result?.chat?.id }];
                }
            }
        ]
    },

    // ======================= NOTION =======================
    {
        id: "notion",
        name: "Notion",
        color: "#111111",
        icon: "N",
        category: "Productivité",
        description: "Créer des pages et interroger des bases de données Notion.",
        connection: {
            fields: [{ key: "token", label: "Jeton d'intégration interne", type: "password", required: true, placeholder: "ntn_..." }],
            async test(data) {
                const me = await fetchJSON("https://api.notion.com/v1/users/me", {
                    headers: { Authorization: `Bearer ${data.token}`, "Notion-Version": "2022-06-28" }
                }, "Notion");
                return `Intégration connectée : ${me.name || me.id}`;
            }
        },
        modules: [
            {
                id: "createPage",
                name: "Créer une page dans une base",
                kind: "action",
                fields: [
                    { key: "connection", label: "Connexion", type: "connection", required: true },
                    { key: "databaseId", label: "ID de la base de données", type: "text", required: true },
                    { key: "titleProperty", label: "Nom de la colonne titre", type: "text", default: "Name" },
                    { key: "title", label: "Titre", type: "text", required: true },
                    { key: "content", label: "Contenu de la page", type: "textarea" }
                ],
                outputs: [{ key: "id", label: "ID de la page" }, { key: "url", label: "URL" }],
                async run(params, ctx) {
                    const token = connectionValue(ctx, params.connection, "token", "Notion");
                    const body = {
                        parent: { database_id: String(required(params.databaseId, "ID de la base")).replace(/-/g, "") },
                        properties: {
                            [params.titleProperty || "Name"]: {
                                title: [{ text: { content: toText(required(params.title, "Titre")).slice(0, 2000) } }]
                            }
                        }
                    };
                    if (params.content) {
                        body.children = toText(params.content)
                            .split(/\n{2,}/)
                            .slice(0, 100)
                            .map(chunk => ({
                                object: "block",
                                type: "paragraph",
                                paragraph: { rich_text: [{ type: "text", text: { content: chunk.slice(0, 2000) } }] }
                            }));
                    }
                    const page = await fetchJSON("https://api.notion.com/v1/pages", {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${token}`,
                            "Notion-Version": "2022-06-28",
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(body)
                    }, "Notion");
                    return [{ id: page.id, url: page.url }];
                }
            },
            {
                id: "queryDatabase",
                name: "Rechercher dans une base",
                kind: "search",
                fields: [
                    { key: "connection", label: "Connexion", type: "connection", required: true },
                    { key: "databaseId", label: "ID de la base de données", type: "text", required: true },
                    { key: "limit", label: "Nombre maximum", type: "number", default: 20 }
                ],
                outputs: [{ key: "id", label: "ID de la page" }, { key: "url", label: "URL" }, { key: "properties", label: "Propriétés" }],
                async run(params, ctx) {
                    const token = connectionValue(ctx, params.connection, "token", "Notion");
                    const data = await fetchJSON(`https://api.notion.com/v1/databases/${String(required(params.databaseId, "ID de la base")).replace(/-/g, "")}/query`, {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${token}`,
                            "Notion-Version": "2022-06-28",
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ page_size: Math.min(100, Math.max(1, Number(params.limit) || 20)) })
                    }, "Notion");
                    return (data.results || []).map(page => ({
                        id: page.id,
                        url: page.url,
                        createdTime: page.created_time,
                        properties: page.properties
                    }));
                }
            }
        ]
    },

    // ======================= AIRTABLE =======================
    {
        id: "airtable",
        name: "Airtable",
        color: "#e0a100",
        icon: "▦",
        category: "Productivité",
        description: "Créer et rechercher des enregistrements Airtable.",
        connection: {
            fields: [{ key: "token", label: "Jeton d'accès personnel", type: "password", required: true, placeholder: "pat..." }],
            async test(data) {
                const me = await fetchJSON("https://api.airtable.com/v0/meta/whoami", {
                    headers: { Authorization: `Bearer ${data.token}` }
                }, "Airtable");
                return `Jeton valide (${me.email || me.id}).`;
            }
        },
        modules: [
            {
                id: "createRecord",
                name: "Créer un enregistrement",
                kind: "action",
                fields: [
                    { key: "connection", label: "Connexion", type: "connection", required: true },
                    { key: "baseId", label: "ID de la base (app...)", type: "text", required: true },
                    { key: "table", label: "Nom de la table", type: "text", required: true },
                    { key: "fields", label: "Champs", type: "keyvalue", required: true }
                ],
                outputs: [{ key: "id", label: "ID de l'enregistrement" }, { key: "fields", label: "Champs" }],
                async run(params, ctx) {
                    const token = connectionValue(ctx, params.connection, "token", "Airtable");
                    const fields = {};
                    for (const [key, value] of Object.entries(pairsToObject(params.fields))) {
                        fields[key] = parseMaybeJSON(value);
                    }
                    const record = await fetchJSON(`https://api.airtable.com/v0/${encodeURIComponent(required(params.baseId, "ID de la base"))}/${encodeURIComponent(required(params.table, "Table"))}`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ fields, typecast: true })
                    }, "Airtable");
                    return [{ id: record.id, fields: record.fields, createdTime: record.createdTime }];
                }
            },
            {
                id: "searchRecords",
                name: "Rechercher des enregistrements",
                kind: "search",
                fields: [
                    { key: "connection", label: "Connexion", type: "connection", required: true },
                    { key: "baseId", label: "ID de la base (app...)", type: "text", required: true },
                    { key: "table", label: "Nom de la table", type: "text", required: true },
                    { key: "formula", label: "Formule de filtre (optionnel)", type: "text", placeholder: "{Statut}='Nouveau'" },
                    { key: "maxRecords", label: "Nombre maximum", type: "number", default: 20 }
                ],
                outputs: [{ key: "id", label: "ID" }, { key: "fields", label: "Champs" }],
                async run(params, ctx) {
                    const token = connectionValue(ctx, params.connection, "token", "Airtable");
                    const url = new URL(`https://api.airtable.com/v0/${encodeURIComponent(required(params.baseId, "ID de la base"))}/${encodeURIComponent(required(params.table, "Table"))}`);
                    url.searchParams.set("maxRecords", String(Math.min(100, Math.max(1, Number(params.maxRecords) || 20))));
                    if (params.formula) url.searchParams.set("filterByFormula", toText(params.formula));
                    const data = await fetchJSON(url, { headers: { Authorization: `Bearer ${token}` } }, "Airtable");
                    return (data.records || []).map(record => ({ id: record.id, fields: record.fields, createdTime: record.createdTime }));
                }
            }
        ]
    },

    // ======================= AGENTS_IA =======================
    {
        id: "agents",
        name: "AGENTS_IA",
        color: "#18181b",
        icon: "AI",
        category: "Intégré",
        description: "Confier une mission à l'un de tes agents IA.",
        modules: [
            {
                id: "runMission",
                name: "Créer et exécuter une mission",
                kind: "action",
                fields: [
                    {
                        key: "agentId", label: "Agent", type: "select", default: "3", required: true,
                        options: [
                            { value: "1", label: "Documentation Specialist API" },
                            { value: "2", label: "Code Analyst" },
                            { value: "3", label: "Developer Agent" },
                            { value: "4", label: "Test Agent" }
                        ]
                    },
                    { key: "description", label: "Description de la mission", type: "textarea", required: true }
                ],
                outputs: [
                    { key: "taskId", label: "ID de la mission" },
                    { key: "status", label: "Statut" },
                    { key: "result", label: "Résultat" }
                ],
                async run(params) {
                    const runtime = require("./runtime");
                    const executor = require("./executor");
                    const task = runtime.createTask(Number(params.agentId), toText(required(params.description, "Description")));
                    await executor.executeTask(task.id);
                    const done = runtime.getTask(task.id);
                    return [{
                        taskId: done.id,
                        status: done.status,
                        result: done.result,
                        zipUrl: done.project?.zipUrl || null
                    }];
                }
            }
        ]
    }
];

// ----------------------------------------------------------
// ACCÈS AU CATALOGUE
// ----------------------------------------------------------

function getApp(appId) {
    return apps.find(app => app.id === appId);
}

function getModule(appId, moduleId) {
    return getApp(appId)?.modules.find(module => module.id === moduleId);
}

// Version envoyée au navigateur (sans les fonctions)
function publicCatalog() {
    return apps.map(app => ({
        id: app.id,
        name: app.name,
        color: app.color,
        icon: app.icon,
        category: app.category,
        description: app.description,
        connection: app.connection
            ? { fields: app.connection.fields, testable: typeof app.connection.test === "function" }
            : null,
        modules: app.modules.map(module => ({
            id: module.id,
            name: module.name,
            kind: module.kind,
            instant: Boolean(module.instant),
            polling: Boolean(module.polling),
            description: module.description || "",
            fields: module.fields,
            outputs: module.outputs
        }))
    }));
}

module.exports = {
    apps,
    getApp,
    getModule,
    publicCatalog,
    readDatastore,
    writeDatastore
};
