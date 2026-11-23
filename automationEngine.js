// ==========================================================
// AGENTS_IA — MOTEUR D'AUTOMATISATION (façon Make.com)
// Scénarios, exécution des modules, mapping {{1.champ}},
// filtres, routeur, planification, webhooks et historique.
// ==========================================================

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const catalog = require("./automationApps");

const DATA_DIR = path.join(__dirname, "data");
const SCENARIOS_FILE = path.join(DATA_DIR, "automations.json");
const RUNS_FILE = path.join(DATA_DIR, "automation-runs.json");
const CONNECTIONS_FILE = path.join(DATA_DIR, "automation-connections.json");
const HOOKS_FILE = path.join(DATA_DIR, "automation-hooks.json");

const MAX_RUNS_KEPT = 200;
const MAX_OPERATIONS_PER_RUN = 2000;
const MAX_LOGGED_OPERATIONS = 25;
const MAX_BODY_SIZE = 1024 * 1024;

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

let scenarios = loadJSON(SCENARIOS_FILE, { scenarios: [] }).scenarios || [];
let runs = loadJSON(RUNS_FILE, { runs: [] }).runs || [];
let connections = loadJSON(CONNECTIONS_FILE, { connections: [] }).connections || [];
let hooks = loadJSON(HOOKS_FILE, { hooks: {} }).hooks || {};

const runningScenarios = new Set();

const saveScenarios = () => saveJSON(SCENARIOS_FILE, { scenarios });
const saveRuns = () => saveJSON(RUNS_FILE, { runs });
const saveConnections = () => saveJSON(CONNECTIONS_FILE, { connections });
const saveHooks = () => saveJSON(HOOKS_FILE, { hooks });

const shortId = prefix => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

// ==========================================================
// 1. MAPPING : {{1.subject}}, {{upper(1.subject)}}, etc.
// ==========================================================

function toText(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function isEmpty(value) {
    return value === undefined || value === null || value === "" ||
        (Array.isArray(value) && value.length === 0);
}

function truthy(value) {
    if (isEmpty(value)) return false;
    if (typeof value === "string") {
        return !["false", "0", "non", "no"].includes(value.trim().toLowerCase());
    }
    return Boolean(value);
}

// Lecture d'un chemin : "1.body.items.2.name"
// Un indice numérique sur un tableau commence à 1, comme dans Make.
function getPath(data, pathText) {
    const parts = String(pathText).split(".");
    let current = data[parts.shift()];

    for (const part of parts) {
        if (current === undefined || current === null) return undefined;

        if (Array.isArray(current) && /^\d+$/.test(part)) {
            current = current[Number(part) - 1];
        } else if (typeof current === "string" && part === "length") {
            current = current.length;
        } else {
            current = current[part];
        }
    }

    return current;
}

function splitArgs(text) {
    const args = [];
    let depth = 0;
    let quote = null;
    let current = "";

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (quote) {
            current += char;
            if (char === "\\" && i + 1 < text.length) {
                current += text[++i];
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === "\"" || char === "'") {
            quote = char;
            current += char;
        } else if (char === "(") {
            depth++;
            current += char;
        } else if (char === ")") {
            depth--;
            current += char;
        } else if (char === ";" && depth === 0) {
            args.push(current);
            current = "";
        } else {
            current += char;
        }
    }

    args.push(current);
    return args;
}

function toDate(value) {
    if (value instanceof Date) return value;
    if (typeof value === "number") return new Date(value);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, format = "DD/MM/YYYY HH:mm") {
    const date = toDate(value);
    if (!date) return "";
    const pad = n => String(n).padStart(2, "0");
    const tokens = {
        YYYY: date.getFullYear(),
        MM: pad(date.getMonth() + 1),
        DD: pad(date.getDate()),
        HH: pad(date.getHours()),
        mm: pad(date.getMinutes()),
        ss: pad(date.getSeconds())
    };
    return String(format).replace(/YYYY|MM|DD|HH|mm|ss/g, token => tokens[token]);
}

function toNumber(value) {
    if (typeof value === "number") return value;
    const n = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
    return Number.isNaN(n) ? 0 : n;
}

const FUNCTIONS = {
    upper: v => toText(v).toUpperCase(),
    lower: v => toText(v).toLowerCase(),
    capitalize: v => { const t = toText(v); return t.charAt(0).toUpperCase() + t.slice(1); },
    trim: v => toText(v).trim(),
    length: v => (Array.isArray(v) ? v.length : toText(v).length),
    substring: (v, start, end) => toText(v).substring(toNumber(start), end === undefined || end === "" ? undefined : toNumber(end)),
    replace: (v, search, replacement = "") => {
        const text = toText(v);
        const s = toText(search);
        const regex = s.match(/^\/(.+)\/([gimsuy]*)$/);
        if (regex) return text.replace(new RegExp(regex[1], regex[2]), toText(replacement));
        return text.split(s).join(toText(replacement));
    },
    split: (v, separator = ",") => toText(v).split(toText(separator)),
    join: (list, separator = ", ") => (Array.isArray(list) ? list.map(toText).join(toText(separator)) : toText(list)),
    get: (source, key) => {
        if (Array.isArray(source) && /^\d+$/.test(String(key))) return source[Number(key) - 1];
        return getPath({ x: source }, `x.${key}`);
    },
    first: list => (Array.isArray(list) ? list[0] : list),
    last: list => (Array.isArray(list) ? list[list.length - 1] : list),
    slice: (list, start, end) => (Array.isArray(list) ? list.slice(toNumber(start), end === undefined || end === "" ? undefined : toNumber(end)) : []),
    contains: (v, search) => (Array.isArray(v) ? v.map(toText).includes(toText(search)) : toText(v).toLowerCase().includes(toText(search).toLowerCase())),
    if: (condition, a, b) => (truthy(condition) ? a : b),
    ifempty: (a, b) => (isEmpty(a) ? b : a),
    tostring: v => toText(v),
    parsenumber: v => toNumber(v),
    round: (v, decimals = 0) => { const f = 10 ** toNumber(decimals); return Math.round(toNumber(v) * f) / f; },
    floor: v => Math.floor(toNumber(v)),
    ceil: v => Math.ceil(toNumber(v)),
    sum: (...values) => values.flat().reduce((total, v) => total + toNumber(v), 0),
    max: (...values) => Math.max(...values.flat().map(toNumber)),
    min: (...values) => Math.min(...values.flat().map(toNumber)),
    now: () => new Date().toISOString(),
    timestamp: () => Date.now(),
    formatdate: (v, format) => formatDate(v, format || "DD/MM/YYYY HH:mm"),
    parsedate: v => { const d = toDate(v); return d ? d.toISOString() : ""; },
    adddays: (v, n) => { const d = toDate(v); if (!d) return ""; d.setDate(d.getDate() + toNumber(n)); return d.toISOString(); },
    addhours: (v, n) => { const d = toDate(v); if (!d) return ""; d.setHours(d.getHours() + toNumber(n)); return d.toISOString(); },
    addminutes: (v, n) => { const d = toDate(v); if (!d) return ""; d.setMinutes(d.getMinutes() + toNumber(n)); return d.toISOString(); },
    tojson: v => JSON.stringify(v),
    parsejson: v => { try { return JSON.parse(toText(v)); } catch { return null; } },
    encodeurl: v => encodeURIComponent(toText(v)),
    base64: v => Buffer.from(toText(v), "utf8").toString("base64"),
    striphtml: v => toText(v).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim(),
    keys: v => (v && typeof v === "object" ? Object.keys(v) : []),
    uuid: () => randomUUID()
};

function evalExpression(expression, data) {
    const expr = String(expression).trim();

    if (expr === "") return "";

    const call = expr.match(/^([a-zA-Z_][\w]*)\s*\(([\s\S]*)\)$/);
    if (call) {
        const fn = FUNCTIONS[call[1].toLowerCase()];
        if (!fn) throw new Error(`Fonction inconnue : ${call[1]}()`);
        const rawArgs = call[2].trim() === "" ? [] : splitArgs(call[2]);
        return fn(...rawArgs.map(arg => evalExpression(arg, data)));
    }

    const quoted = expr.match(/^(["'])([\s\S]*)\1$/);
    if (quoted) return quoted[2].replace(/\\(["'\\])/g, "$1");

    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);

    const keywords = { now: () => new Date().toISOString(), true: () => true, false: () => false, null: () => null, emptystring: () => "" };
    if (keywords[expr.toLowerCase()]) return keywords[expr.toLowerCase()]();

    if (/^\d+(\.[^.\s]+)*$/.test(expr)) return getPath(data, expr);

    // Texte libre (ex. : un argument non entouré de guillemets)
    return expr;
}

function resolveString(text, data) {
    const matches = text.match(/\{\{[\s\S]*?\}\}/g);
    if (!matches) return text;

    // Un seul {{...}} sans autre texte : on garde le type d'origine (tableau, objet, nombre…)
    if (matches.length === 1 && text.trim() === matches[0]) {
        return evalExpression(matches[0].slice(2, -2), data);
    }

    return text.replace(/\{\{([\s\S]*?)\}\}/g, (_, expression) => toText(evalExpression(expression, data)));
}

function resolveValue(value, data) {
    if (typeof value === "string") return resolveString(value, data);
    if (Array.isArray(value)) return value.map(item => resolveValue(item, data));
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, item] of Object.entries(value)) result[key] = resolveValue(item, data);
        return result;
    }
    return value;
}

// ==========================================================
// 2. FILTRES (groupes OU de conditions ET, comme Make)
// ==========================================================

const OPERATORS = {
    exists: a => !isEmpty(a),
    notExists: a => isEmpty(a),
    equals: (a, b) => toText(a).trim().toLowerCase() === toText(b).trim().toLowerCase(),
    notEquals: (a, b) => toText(a).trim().toLowerCase() !== toText(b).trim().toLowerCase(),
    contains: (a, b) => toText(a).toLowerCase().includes(toText(b).toLowerCase()),
    notContains: (a, b) => !toText(a).toLowerCase().includes(toText(b).toLowerCase()),
    startsWith: (a, b) => toText(a).toLowerCase().startsWith(toText(b).toLowerCase()),
    endsWith: (a, b) => toText(a).toLowerCase().endsWith(toText(b).toLowerCase()),
    matches: (a, b) => { try { return new RegExp(toText(b), "i").test(toText(a)); } catch { return false; } },
    greater: (a, b) => compare(a, b) > 0,
    greaterEq: (a, b) => compare(a, b) >= 0,
    less: (a, b) => compare(a, b) < 0,
    lessEq: (a, b) => compare(a, b) <= 0,
    isTrue: a => truthy(a),
    isFalse: a => !truthy(a)
};

function compare(a, b) {
    const na = Number(toText(a).replace(",", "."));
    const nb = Number(toText(b).replace(",", "."));
    if (toText(a) !== "" && toText(b) !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    const da = toDate(a);
    const db = toDate(b);
    if (da && db && typeof a === "string" && /\d{4}-\d{2}-\d{2}/.test(a)) return da - db;
    return toText(a).localeCompare(toText(b));
}

function passesFilter(filter, data) {
    if (!filter || !Array.isArray(filter.groups) || filter.groups.length === 0) return true;

    const groups = filter.groups.filter(group => Array.isArray(group) && group.length);
    if (!groups.length) return true;

    return groups.some(group => group.every(condition => {
        const operator = OPERATORS[condition.op] || OPERATORS.exists;
        return operator(resolveValue(condition.a ?? "", data), resolveValue(condition.b ?? "", data));
    }));
}

// ==========================================================
// 3. EXÉCUTION D'UN SCÉNARIO
// ==========================================================

function limitSize(value, max = 20000) {
    try {
        const text = JSON.stringify(value);
        if (text === undefined) return null;
        if (text.length <= max) return JSON.parse(text);
        return { __tronqué: true, aperçu: text.slice(0, max) + "…" };
    } catch {
        return String(value).slice(0, max);
    }
}

function getConnection(id) {
    return connections.find(connection => connection.id === id) || null;
}

async function executeScenario(scenario, options = {}) {
    const run = {
        id: shortId("run"),
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        source: options.source || "manual",
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        durationMs: 0,
        operations: 0,
        error: null,
        logs: {}
    };

    const started = Date.now();
    const state = JSON.parse(JSON.stringify(scenario.state || {}));
    let webhookResponse = null;
    let ignoredErrors = 0;

    const ctx = moduleId => ({
        scenario,
        state: (state[moduleId] = state[moduleId] || {}),
        getConnection,
        webhookPayload: options.webhookPayload,
        setWebhookResponse: response => { webhookResponse = response; }
    });

    function logOperation(module, entry) {
        const log = run.logs[module.id] = run.logs[module.id] || {
            app: module.app,
            module: module.module,
            count: 0,
            errors: 0,
            filtered: 0,
            operations: []
        };

        if (entry.filtered) {
            log.filtered++;
        } else {
            log.count++;
            run.operations++;
        }
        if (entry.error) log.errors++;

        if (log.operations.length < MAX_LOGGED_OPERATIONS) {
            log.operations.push({
                at: new Date().toISOString(),
                filtered: Boolean(entry.filtered),
                input: limitSize(entry.input),
                output: limitSize(entry.output),
                error: entry.error || null
            });
        }
    }

    async function runModule(module, params) {
        const definition = catalog.getModule(module.app, module.module);
        if (!definition || typeof definition.run !== "function") {
            throw new Error(`Module inconnu : ${module.app}.${module.module}`);
        }
        const outputs = await definition.run(params, ctx(module.id));
        if (!Array.isArray(outputs)) return [];
        return outputs.map(output => (output && typeof output === "object" ? output : { value: output }));
    }

    async function runChain(chain, data) {
        for (let i = 0; i < chain.length; i++) {
            const module = chain[i];

            if (run.operations >= MAX_OPERATIONS_PER_RUN) {
                throw new Error(`Limite de ${MAX_OPERATIONS_PER_RUN} opérations atteinte pour une exécution.`);
            }

            if (module.disabled) continue;

            if (!passesFilter(module.filter, data)) {
                logOperation(module, { filtered: true, input: { filtre: module.filter?.label || "Filtre" } });
                return;
            }

            if (module.module === "router" && module.app === "flow") {
                logOperation(module, { input: {}, output: [{ routes: (module.routes || []).length }] });
                for (const route of module.routes || []) {
                    await runChain(route, { ...data });
                }
                return;
            }

            let params;
            let outputs;

            try {
                params = resolveValue(module.params || {}, data);
                outputs = await runModule(module, params);
                logOperation(module, { input: params, output: outputs });
            } catch (error) {
                logOperation(module, { input: params, error: error.message });

                if (module.onError === "ignore") {
                    ignoredErrors++;
                    return;
                }

                const wrapped = new Error(`${module.label || module.module} (module ${module.id}) : ${error.message}`);
                wrapped.handled = true;
                throw wrapped;
            }

            if (outputs.length === 0) return;

            if (outputs.length === 1) {
                data[module.id] = outputs[0];
                continue;
            }

            const rest = chain.slice(i + 1);
            for (const output of outputs) {
                await runChain(rest, { ...data, [module.id]: output });
            }
            return;
        }
    }

    try {
        if (!scenario.trigger) {
            throw new Error("Ajoute un premier module (déclencheur) au scénario.");
        }

        const trigger = scenario.trigger;
        let bundles;

        try {
            const params = resolveValue(trigger.params || {}, {});
            bundles = await runModule(trigger, params);
            logOperation(trigger, { input: params, output: bundles });
        } catch (error) {
            logOperation(trigger, { error: error.message });
            throw error;
        }

        for (const bundle of bundles) {
            await runChain(scenario.modules || [], { [trigger.id]: bundle });
        }

        run.status = ignoredErrors ? "warning" : "success";
    } catch (error) {
        run.status = "error";
        run.error = error.message;
    }

    run.finishedAt = new Date().toISOString();
    run.durationMs = Date.now() - started;

    // Mise à jour du scénario actuel (il a pu être modifié pendant l'exécution)
    const current = scenarios.find(item => item.id === scenario.id);
    if (current) {
        current.state = state;
        current.lastRun = {
            id: run.id,
            status: run.status,
            at: run.finishedAt,
            operations: run.operations,
            error: run.error
        };
        current.stats = current.stats || { runs: 0, operations: 0, errors: 0 };
        current.stats.runs++;
        current.stats.operations += run.operations;
        if (run.status === "error") current.stats.errors++;
        saveScenarios();
    }

    runs.unshift(run);
    runs = runs.slice(0, MAX_RUNS_KEPT);
    saveRuns();

    console.log(`[AUTOMATIONS] « ${scenario.name} » → ${run.status} (${run.operations} opération(s), ${run.durationMs} ms)`);

    return { run, webhookResponse };
}

async function runScenarioById(id, options = {}) {
    const scenario = scenarios.find(item => item.id === id);
    if (!scenario) throw new Error("Scénario introuvable.");

    if (runningScenarios.has(id) && options.source !== "webhook") {
        throw new Error("Ce scénario est déjà en cours d'exécution.");
    }

    runningScenarios.add(id);
    try {
        return await executeScenario(scenario, options);
    } finally {
        runningScenarios.delete(id);
    }
}

// ==========================================================
// 4. PLANIFICATION
// ==========================================================

function computeNextRun(schedule, from = new Date()) {
    if (!schedule) return null;
    const base = new Date(from);

    if (schedule.type === "interval") {
        const minutes = Math.max(1, Number(schedule.minutes) || 15);
        return new Date(base.getTime() + minutes * 60000).toISOString();
    }

    if (schedule.type === "daily" || schedule.type === "weekly") {
        const [hours, minutes] = String(schedule.time || "09:00").split(":").map(Number);
        const days = schedule.type === "weekly"
            ? (Array.isArray(schedule.days) && schedule.days.length ? schedule.days.map(Number) : [1])
            : [0, 1, 2, 3, 4, 5, 6];

        for (let offset = 0; offset <= 7; offset++) {
            const candidate = new Date(base);
            candidate.setDate(base.getDate() + offset);
            candidate.setHours(hours || 0, minutes || 0, 0, 0);
            if (candidate > base && days.includes(candidate.getDay())) {
                return candidate.toISOString();
            }
        }
    }

    return null;
}

function isScheduled(scenario) {
    return ["interval", "daily", "weekly"].includes(scenario.schedule?.type);
}

let schedulerTimer = null;

function startScheduler() {
    if (schedulerTimer) return;

    schedulerTimer = setInterval(() => {
        const now = Date.now();

        for (const scenario of scenarios) {
            if (!scenario.active || !isScheduled(scenario) || runningScenarios.has(scenario.id)) continue;
            if (!scenario.trigger || scenario.trigger.app === "webhooks") continue;

            if (!scenario.nextRunAt) {
                scenario.nextRunAt = computeNextRun(scenario.schedule);
                saveScenarios();
                continue;
            }

            if (now >= new Date(scenario.nextRunAt).getTime()) {
                scenario.nextRunAt = computeNextRun(scenario.schedule, new Date());
                saveScenarios();
                runScenarioById(scenario.id, { source: "schedule" })
                    .catch(error => console.error("[AUTOMATIONS] Erreur planifiée :", error.message));
            }
        }
    }, 15000);

    console.log("Automatisations : planificateur démarré");
}

// ==========================================================
// 5. SCÉNARIOS (création, mise à jour, modèles)
// ==========================================================

function walkModules(scenario, callback) {
    const visit = chain => {
        for (const module of chain || []) {
            callback(module);
            if (Array.isArray(module.routes)) module.routes.forEach(visit);
        }
    };
    if (scenario.trigger) callback(scenario.trigger);
    visit(scenario.modules);
}

function maxModuleId(scenario) {
    let max = 0;
    walkModules(scenario, module => { max = Math.max(max, Number(module.id) || 0); });
    return max;
}

function sanitizeModule(module) {
    if (!module || typeof module !== "object") return null;
    const clean = {
        id: Number(module.id),
        app: String(module.app || ""),
        module: String(module.module || ""),
        label: module.label ? String(module.label).slice(0, 80) : "",
        params: module.params && typeof module.params === "object" ? module.params : {},
        filter: module.filter && Array.isArray(module.filter.groups) ? module.filter : null,
        onError: module.onError === "ignore" ? "ignore" : "stop",
        disabled: Boolean(module.disabled)
    };
    if (!catalog.getModule(clean.app, clean.module)) {
        throw new Error(`Module inconnu : ${clean.app}.${clean.module}`);
    }
    if (clean.app === "flow" && clean.module === "router") {
        clean.routes = (Array.isArray(module.routes) ? module.routes : [[], []])
            .map(route => (Array.isArray(route) ? route.map(sanitizeModule).filter(Boolean) : []));
    }
    return clean;
}

function sanitizeSchedule(schedule, trigger) {
    if (trigger?.app === "webhooks") return { type: "instant" };
    const type = ["manual", "interval", "daily", "weekly"].includes(schedule?.type) ? schedule.type : "interval";
    return {
        type,
        minutes: Math.max(1, Math.min(10080, Number(schedule?.minutes) || 15)),
        time: /^\d{2}:\d{2}$/.test(schedule?.time || "") ? schedule.time : "09:00",
        days: Array.isArray(schedule?.days) ? schedule.days.map(Number).filter(d => d >= 0 && d <= 6) : [1, 2, 3, 4, 5]
    };
}

function applyScenarioInput(target, input) {
    if (input.name !== undefined) {
        const name = String(input.name).trim();
        target.name = (name || "Nouveau scénario").slice(0, 120);
    }
    if (input.description !== undefined) target.description = String(input.description).slice(0, 1000);
    if (input.trigger !== undefined) target.trigger = input.trigger ? sanitizeModule(input.trigger) : null;
    if (input.modules !== undefined) {
        target.modules = (Array.isArray(input.modules) ? input.modules : []).map(sanitizeModule).filter(Boolean);
    }
    if (input.trigger !== undefined && target.trigger && catalog.getModule(target.trigger.app, target.trigger.module)?.kind !== "trigger") {
        throw new Error("Le premier module doit être un déclencheur.");
    }
    if (input.schedule !== undefined || input.trigger !== undefined) {
        target.schedule = sanitizeSchedule(input.schedule || target.schedule, target.trigger);
    }
    target.updatedAt = new Date().toISOString();
    if (target.active && isScheduled(target)) {
        target.nextRunAt = computeNextRun(target.schedule);
    }
}

function createScenario(input = {}) {
    const scenario = {
        id: shortId("sc"),
        name: "Nouveau scénario",
        description: "",
        active: false,
        trigger: null,
        modules: [],
        schedule: { type: "interval", minutes: 15, time: "09:00", days: [1, 2, 3, 4, 5] },
        state: {},
        nextRunAt: null,
        lastRun: null,
        stats: { runs: 0, operations: 0, errors: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    applyScenarioInput(scenario, input);
    scenarios.unshift(scenario);
    saveScenarios();
    return scenario;
}

function setActive(scenario, active) {
    if (active) {
        if (!scenario.trigger) throw new Error("Impossible d'activer un scénario sans déclencheur.");
        if (scenario.schedule?.type === "manual") {
            throw new Error("La planification est « À la demande » : choisis une fréquence avant d'activer le scénario.");
        }
    }
    scenario.active = Boolean(active);
    scenario.nextRunAt = scenario.active && isScheduled(scenario)
        ? (scenario.schedule.type === "interval" ? new Date().toISOString() : computeNextRun(scenario.schedule))
        : null;
    saveScenarios();
}

const TEMPLATES = [
    {
        id: "gmail-gemini-telegram",
        name: "Résumer chaque nouvel e-mail avec l'IA et me l'envoyer sur Telegram",
        description: "Gmail → Gemini (analyse) → Telegram. Idéal pour suivre ta boîte mail depuis ton téléphone.",
        apps: ["gmail", "gemini", "telegram"],
        build: () => ({
            name: "E-mails résumés sur Telegram",
            schedule: { type: "interval", minutes: 15 },
            trigger: { id: 1, app: "gmail", module: "watchEmails", params: { limit: 10, startFrom: "now" } },
            modules: [
                { id: 2, app: "gemini", module: "analyzeEmail", params: { sender: "{{1.sender}}", subject: "{{1.subject}}", date: "{{1.date}}", body: "{{1.body}}" } },
                {
                    id: 3, app: "telegram", module: "sendMessage",
                    filter: { label: "Pas de publicité", groups: [[{ a: "{{2.category}}", op: "notEquals", b: "publicité" }]] },
                    params: { connection: "", chatId: "", text: "📩 {{1.subject}}\nDe : {{1.sender}}\nUrgence : {{2.urgency}}\n\n{{2.summary}}" }
                }
            ]
        })
    },
    {
        id: "webhook-datastore",
        name: "Recevoir un formulaire par webhook et l'enregistrer",
        description: "Webhook → Stockage de données → Réponse au webhook. Parfait pour un formulaire de contact.",
        apps: ["webhooks", "datastore"],
        build: () => ({
            name: "Formulaire de contact",
            trigger: { id: 1, app: "webhooks", module: "customWebhook", params: { hookId: randomUUID() } },
            modules: [
                { id: 2, app: "datastore", module: "set", params: { store: "contacts", key: "{{1.email}}", value: "{{tojson(1)}}" } },
                { id: 3, app: "webhooks", module: "webhookResponse", params: { status: 200, body: "{\"ok\": true, \"message\": \"Merci {{1.name}} !\"}", headers: [{ key: "Content-Type", value: "application/json" }] } }
            ]
        })
    },
    {
        id: "gmail-router",
        name: "Trier les e-mails : urgents sur Discord, le reste archivé",
        description: "Gmail → Gemini → Routeur (urgent → Discord / autres → Stockage de données).",
        apps: ["gmail", "gemini", "flow", "discord", "datastore"],
        build: () => ({
            name: "Tri intelligent des e-mails",
            schedule: { type: "interval", minutes: 15 },
            trigger: { id: 1, app: "gmail", module: "watchEmails", params: { limit: 10, startFrom: "now" } },
            modules: [
                { id: 2, app: "gemini", module: "analyzeEmail", params: { sender: "{{1.sender}}", subject: "{{1.subject}}", date: "{{1.date}}", body: "{{1.body}}" } },
                {
                    id: 3, app: "flow", module: "router", params: {},
                    routes: [
                        [{
                            id: 4, app: "discord", module: "sendMessage",
                            filter: { label: "Urgent", groups: [[{ a: "{{2.urgency}}", op: "equals", b: "élevée" }], [{ a: "{{2.category}}", op: "equals", b: "urgent" }]] },
                            params: { connection: "", content: "🚨 E-mail urgent de {{1.sender}} : **{{1.subject}}**\n{{2.summary}}" }
                        }],
                        [{
                            id: 5, app: "datastore", module: "set",
                            filter: { label: "Non urgent", groups: [[{ a: "{{2.urgency}}", op: "notEquals", b: "élevée" }]] },
                            params: { store: "emails", key: "{{1.id}}", value: "{{tojson(2)}}" }
                        }]
                    ]
                }
            ]
        })
    },
    {
        id: "http-slack",
        name: "Appeler une API chaque jour et publier le résultat sur Slack",
        description: "Déclencheur de base (planifié) → HTTP → Slack.",
        apps: ["tools", "http", "slack"],
        build: () => ({
            name: "Rapport quotidien sur Slack",
            schedule: { type: "daily", time: "09:00" },
            trigger: { id: 1, app: "tools", module: "basicTrigger", params: { data: [] } },
            modules: [
                { id: 2, app: "http", module: "request", params: { url: "https://api.exemple.com/stats", method: "GET", headers: [], query: [], bodyType: "none", body: "", parse: true } },
                { id: 3, app: "slack", module: "sendMessage", params: { connection: "", text: "📊 Rapport du {{formatDate(now; \"DD/MM/YYYY\")}} :\n{{tojson(2.data)}}" } }
            ]
        })
    },
    {
        id: "webhook-ai-reply",
        name: "Répondre à une demande de contact avec un e-mail rédigé par l'IA",
        description: "Webhook → Gemini (rédaction) → Gmail (envoi).",
        apps: ["webhooks", "gemini", "gmail"],
        build: () => ({
            name: "Réponse IA aux demandes de contact",
            trigger: { id: 1, app: "webhooks", module: "customWebhook", params: { hookId: randomUUID() } },
            modules: [
                { id: 2, app: "gemini", module: "generate", params: { prompt: "Rédige une réponse courte, chaleureuse et professionnelle en français à ce message de {{1.name}} : {{1.message}}. N'invente aucune information (prix, dates).", system: "Tu es l'assistant de l'entreprise.", model: "gemini-3.5-flash-lite", json: false } },
                { id: 3, app: "gmail", module: "sendEmail", params: { to: "{{1.email}}", cc: "", subject: "Re : votre demande", body: "{{2.text}}", html: false } }
            ]
        })
    }
];

// ==========================================================
// 6. CONNEXIONS
// ==========================================================

function publicConnection(connection) {
    const app = catalog.getApp(connection.app);
    const fields = {};
    for (const field of app?.connection?.fields || []) {
        const value = String(connection.data?.[field.key] || "");
        fields[field.key] = field.type === "password"
            ? (value ? `••••${value.slice(-4)}` : "")
            : value;
    }
    return {
        id: connection.id,
        app: connection.app,
        name: connection.name,
        createdAt: connection.createdAt,
        fields
    };
}

// ==========================================================
// 7. WEBHOOKS
// ==========================================================

function findHookScenario(hookId) {
    return scenarios.find(scenario =>
        scenario.trigger?.app === "webhooks" &&
        scenario.trigger?.module === "customWebhook" &&
        scenario.trigger?.params?.hookId === hookId
    );
}

function parseIncoming(raw, contentType, query) {
    let body = {};
    const type = String(contentType || "").toLowerCase();

    if (raw) {
        if (type.includes("application/json") || /^[\[{]/.test(raw.trim())) {
            try { body = JSON.parse(raw); } catch { body = { body: raw }; }
        } else if (type.includes("application/x-www-form-urlencoded")) {
            body = Object.fromEntries(new URLSearchParams(raw));
        } else {
            body = { body: raw };
        }
    }

    if (Array.isArray(body)) body = { items: body };
    if (!body || typeof body !== "object") body = { value: body };

    return { ...query, ...body };
}

// ==========================================================
// 8. ROUTES HTTP  (/api/automations/...)
// ==========================================================

function readRaw(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", chunk => {
            size += chunk.length;
            if (size > MAX_BODY_SIZE) {
                reject(new Error("Requête trop volumineuse (1 Mo maximum)."));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

async function readJSONBody(req) {
    const raw = await readRaw(req);
    if (!raw.trim()) return {};
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error("JSON invalide : " + error.message);
    }
}

function scenarioSummary(scenario) {
    const apps = [];
    walkModules(scenario, module => apps.push(module.app));
    return {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        active: scenario.active,
        schedule: scenario.schedule,
        nextRunAt: scenario.nextRunAt,
        lastRun: scenario.lastRun,
        stats: scenario.stats,
        apps,
        running: runningScenarios.has(scenario.id),
        createdAt: scenario.createdAt,
        updatedAt: scenario.updatedAt
    };
}

function publicScenario(scenario) {
    const { state, ...rest } = scenario;
    return { ...rest, running: runningScenarios.has(scenario.id) };
}

async function handleRequest(req, res, url, sendJSON) {
    const route = url.pathname.replace(/^\/api\/automations/, "") || "/";
    const method = req.method;
    let match;

    try {
        // ---------- Webhooks entrants ----------
        if ((match = route.match(/^\/hooks\/([\w-]{8,64})$/))) {
            const hookId = match[1];
            const raw = ["GET", "HEAD"].includes(method) ? "" : await readRaw(req);
            const payload = parseIncoming(raw, req.headers["content-type"], Object.fromEntries(url.searchParams));

            const scenario = findHookScenario(hookId);
            if (!scenario) {
                return sendJSON(res, 404, { error: "Aucun scénario n'utilise ce webhook." });
            }

            hooks[hookId] = { receivedAt: new Date().toISOString(), sample: limitSize(payload, 50000) };
            saveHooks();

            if (!scenario.active) {
                return sendJSON(res, 202, {
                    accepted: true,
                    message: "Données reçues et enregistrées comme exemple. Active le scénario pour qu'il s'exécute automatiquement."
                });
            }

            const { run, webhookResponse } = await runScenarioById(scenario.id, { source: "webhook", webhookPayload: payload });

            if (webhookResponse) {
                const body = webhookResponse.body;
                const headers = {
                    "Access-Control-Allow-Origin": "*",
                    "Content-Type": "text/plain; charset=utf-8",
                    ...webhookResponse.headers
                };
                res.writeHead(webhookResponse.status || 200, headers);
                res.end(typeof body === "string" ? body : JSON.stringify(body));
                return;
            }

            return sendJSON(res, run.status === "error" ? 500 : 200, {
                accepted: true,
                status: run.status,
                error: run.error || undefined
            });
        }

        // ---------- Catalogue ----------
        if (method === "GET" && route === "/apps") {
            return sendJSON(res, 200, catalog.publicCatalog());
        }

        if (method === "GET" && route === "/new-hook-id") {
            return sendJSON(res, 200, { hookId: randomUUID() });
        }

        // ---------- Scénarios ----------
        if (method === "GET" && route === "/scenarios") {
            return sendJSON(res, 200, scenarios.map(scenarioSummary));
        }

        if (method === "POST" && route === "/scenarios") {
            const data = await readJSONBody(req);
            return sendJSON(res, 201, publicScenario(createScenario(data)));
        }

        if ((match = route.match(/^\/scenarios\/(sc_\w+)(\/[a-z]+)?$/))) {
            const scenario = scenarios.find(item => item.id === match[1]);
            const action = match[2] || "";

            if (!scenario) return sendJSON(res, 404, { error: "Scénario introuvable." });

            if (method === "GET" && action === "") {
                return sendJSON(res, 200, publicScenario(scenario));
            }

            if (method === "PUT" && action === "") {
                const data = await readJSONBody(req);
                const previousHook = scenario.trigger?.params?.hookId;
                applyScenarioInput(scenario, data);
                if (scenario.active && !scenario.trigger) scenario.active = false;
                if (previousHook && previousHook !== scenario.trigger?.params?.hookId) delete hooks[previousHook];
                saveScenarios();
                return sendJSON(res, 200, publicScenario(scenario));
            }

            if (method === "DELETE" && action === "") {
                const hookId = scenario.trigger?.params?.hookId;
                scenarios = scenarios.filter(item => item.id !== scenario.id);
                if (hookId) { delete hooks[hookId]; saveHooks(); }
                saveScenarios();
                return sendJSON(res, 200, { deleted: true });
            }

            if (method === "POST" && action === "/run") {
                let webhookPayload;
                if (scenario.trigger?.app === "webhooks") {
                    const hook = hooks[scenario.trigger.params?.hookId];
                    if (!hook) {
                        return sendJSON(res, 400, {
                            error: "Aucune donnée reçue sur ce webhook pour l'instant. Envoie une requête à l'URL du webhook (elle sera utilisée comme exemple), puis clique de nouveau sur « Exécuter une fois »."
                        });
                    }
                    webhookPayload = hook.sample;
                }
                const { run } = await runScenarioById(scenario.id, { source: "manual", webhookPayload });
                return sendJSON(res, 200, run);
            }

            if (method === "POST" && action === "/toggle") {
                const data = await readJSONBody(req);
                setActive(scenario, data.active !== undefined ? Boolean(data.active) : !scenario.active);
                return sendJSON(res, 200, scenarioSummary(scenario));
            }

            if (method === "POST" && action === "/clone") {
                const copy = JSON.parse(JSON.stringify(scenario));
                if (copy.trigger?.app === "webhooks") copy.trigger.params.hookId = randomUUID();
                const clone = createScenario({
                    name: `${scenario.name} (copie)`,
                    description: copy.description,
                    trigger: copy.trigger,
                    modules: copy.modules,
                    schedule: copy.schedule
                });
                return sendJSON(res, 201, scenarioSummary(clone));
            }

            if (method === "POST" && action === "/reset") {
                scenario.state = {};
                saveScenarios();
                return sendJSON(res, 200, { reset: true });
            }
        }

        // ---------- Modèles ----------
        if (method === "GET" && route === "/templates") {
            return sendJSON(res, 200, TEMPLATES.map(({ build, ...template }) => template));
        }

        if ((match = route.match(/^\/templates\/([\w-]+)\/use$/)) && method === "POST") {
            const template = TEMPLATES.find(item => item.id === match[1]);
            if (!template) return sendJSON(res, 404, { error: "Modèle introuvable." });
            return sendJSON(res, 201, publicScenario(createScenario(template.build())));
        }

        // ---------- Historique ----------
        if (method === "GET" && route === "/runs") {
            const scenarioId = url.searchParams.get("scenarioId");
            const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
            const withLogs = url.searchParams.get("logs") === "1";
            const list = runs
                .filter(run => !scenarioId || run.scenarioId === scenarioId)
                .slice(0, limit)
                .map(run => (withLogs ? run : { ...run, logs: undefined }));
            return sendJSON(res, 200, list);
        }

        if ((match = route.match(/^\/runs\/(run_\w+)$/)) && method === "GET") {
            const run = runs.find(item => item.id === match[1]);
            return run ? sendJSON(res, 200, run) : sendJSON(res, 404, { error: "Exécution introuvable." });
        }

        if (method === "DELETE" && route === "/runs") {
            runs = [];
            saveRuns();
            return sendJSON(res, 200, { deleted: true });
        }

        // ---------- Connexions ----------
        if (method === "GET" && route === "/connections") {
            return sendJSON(res, 200, connections.map(publicConnection));
        }

        if (method === "POST" && route === "/connections") {
            const data = await readJSONBody(req);
            const app = catalog.getApp(data.app);
            if (!app?.connection) return sendJSON(res, 400, { error: "Cette application n'utilise pas de connexion." });

            const values = {};
            for (const field of app.connection.fields) {
                const value = String(data.data?.[field.key] ?? "").trim();
                if (field.required && !value) {
                    return sendJSON(res, 400, { error: `Le champ « ${field.label} » est obligatoire.` });
                }
                values[field.key] = value;
            }

            const connection = {
                id: shortId("cn"),
                app: app.id,
                name: String(data.name || `Ma connexion ${app.name}`).trim().slice(0, 80),
                data: values,
                createdAt: new Date().toISOString()
            };
            connections.push(connection);
            saveConnections();
            return sendJSON(res, 201, publicConnection(connection));
        }

        if ((match = route.match(/^\/connections\/(cn_\w+)(\/test)?$/))) {
            const connection = connections.find(item => item.id === match[1]);
            if (!connection) return sendJSON(res, 404, { error: "Connexion introuvable." });

            if (method === "DELETE" && !match[2]) {
                connections = connections.filter(item => item.id !== connection.id);
                saveConnections();
                return sendJSON(res, 200, { deleted: true });
            }

            if (method === "POST" && match[2]) {
                const app = catalog.getApp(connection.app);
                if (typeof app?.connection?.test !== "function") {
                    return sendJSON(res, 400, { error: "Cette connexion ne peut pas être testée automatiquement." });
                }
                try {
                    const message = await app.connection.test(connection.data);
                    return sendJSON(res, 200, { ok: true, message });
                } catch (error) {
                    return sendJSON(res, 200, { ok: false, message: error.message });
                }
            }
        }

        // ---------- Webhooks (liste) ----------
        if (method === "GET" && route === "/hooks") {
            const list = scenarios
                .filter(scenario => scenario.trigger?.app === "webhooks" && scenario.trigger?.params?.hookId)
                .map(scenario => {
                    const hookId = scenario.trigger.params.hookId;
                    return {
                        hookId,
                        scenarioId: scenario.id,
                        scenarioName: scenario.name,
                        active: scenario.active,
                        path: `/api/automations/hooks/${hookId}`,
                        receivedAt: hooks[hookId]?.receivedAt || null,
                        sample: hooks[hookId]?.sample || null
                    };
                });
            return sendJSON(res, 200, list);
        }

        // ---------- Stockages de données ----------
        if (method === "GET" && route === "/datastores") {
            const db = catalog.readDatastore();
            return sendJSON(res, 200, Object.entries(db.stores).map(([name, records]) => ({
                name,
                count: Object.keys(records).length
            })));
        }

        if ((match = route.match(/^\/datastores\/([^/]+)(?:\/records(?:\/(.+))?)?$/))) {
            const name = decodeURIComponent(match[1]);
            const key = match[2] !== undefined ? decodeURIComponent(match[2]) : null;
            const isRecords = route.includes("/records");
            const db = catalog.readDatastore();

            if (method === "GET" && !isRecords) {
                const records = db.stores[name] || {};
                return sendJSON(res, 200, Object.entries(records).map(([recordKey, record]) => ({
                    key: recordKey,
                    value: record.value,
                    updatedAt: record.updatedAt
                })));
            }

            if (method === "DELETE" && !isRecords) {
                delete db.stores[name];
                catalog.writeDatastore(db);
                return sendJSON(res, 200, { deleted: true });
            }

            if (method === "POST" && isRecords && key === null) {
                const data = await readJSONBody(req);
                const recordKey = String(data.key || "").trim();
                if (!recordKey) return sendJSON(res, 400, { error: "La clé est obligatoire." });
                let value = data.value;
                if (typeof value === "string") {
                    try { value = JSON.parse(value); } catch { /* texte simple */ }
                }
                db.stores[name] = db.stores[name] || {};
                db.stores[name][recordKey] = { value, updatedAt: new Date().toISOString() };
                catalog.writeDatastore(db);
                return sendJSON(res, 201, { key: recordKey, value });
            }

            if (method === "DELETE" && isRecords && key !== null) {
                if (db.stores[name]) delete db.stores[name][key];
                catalog.writeDatastore(db);
                return sendJSON(res, 200, { deleted: true });
            }
        }

        return sendJSON(res, 404, { error: "Route d'automatisation introuvable." });
    } catch (error) {
        console.error("[AUTOMATIONS] Erreur :", error.message);
        return sendJSON(res, 400, { error: error.message });
    }
}

module.exports = {
    handleRequest,
    startScheduler,
    // exportés pour les tests
    _internal: { evalExpression, resolveValue, passesFilter, computeNextRun, executeScenario, createScenario, setActive }
};
