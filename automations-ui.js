// ==========================================================
// AGENTS_IA — ONGLET AUTOMATISATIONS (interface façon Make.com)
// Scénarios, éditeur visuel, connexions, webhooks,
// stockages de données, modèles et historique.
// ==========================================================

(function () {
  "use strict";

  const AX_API = (typeof API !== "undefined" ? API : "http://localhost:3000") + "/api/automations";
  const SERVER = typeof API !== "undefined" ? API : "http://localhost:3000";

  const NODE = 84;          // diamètre d'un module
  const GAP_X = 190;        // espace horizontal entre modules
  const ROW_H = 190;        // hauteur d'une route
  const ORIGIN_X = 130;
  const ORIGIN_Y = 150;

  const DAYS = ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."];

  const OPERATORS = [
    { value: "exists", label: "Existe", unary: true },
    { value: "notExists", label: "N'existe pas", unary: true },
    { value: "equals", label: "Égal à" },
    { value: "notEquals", label: "Différent de" },
    { value: "contains", label: "Contient" },
    { value: "notContains", label: "Ne contient pas" },
    { value: "startsWith", label: "Commence par" },
    { value: "endsWith", label: "Se termine par" },
    { value: "matches", label: "Correspond au motif (regex)" },
    { value: "greater", label: "Supérieur à" },
    { value: "greaterEq", label: "Supérieur ou égal à" },
    { value: "less", label: "Inférieur à" },
    { value: "lessEq", label: "Inférieur ou égal à" },
    { value: "isTrue", label: "Est vrai", unary: true },
    { value: "isFalse", label: "Est faux", unary: true }
  ];

  const FUNCTIONS = [
    ["upper(texte)", "Met en MAJUSCULES"],
    ["lower(texte)", "Met en minuscules"],
    ["capitalize(texte)", "Première lettre en majuscule"],
    ["trim(texte)", "Supprime les espaces au début et à la fin"],
    ["length(texte ou tableau)", "Longueur"],
    ["substring(texte; début; fin)", "Extrait une partie du texte"],
    ["replace(texte; cherche; remplace)", "Remplace un texte"],
    ["split(texte; séparateur)", "Découpe en tableau"],
    ["join(tableau; séparateur)", "Assemble un tableau en texte"],
    ["get(tableau; position)", "Élément à une position (à partir de 1)"],
    ["first(tableau)", "Premier élément"],
    ["last(tableau)", "Dernier élément"],
    ["contains(texte; cherche)", "Vrai si le texte contient…"],
    ["if(condition; si vrai; si faux)", "Condition"],
    ["ifempty(valeur; remplacement)", "Valeur par défaut si vide"],
    ["formatDate(date; \"DD/MM/YYYY HH:mm\")", "Formate une date"],
    ["addDays(date; nombre)", "Ajoute des jours"],
    ["now", "Date et heure actuelles"],
    ["parseNumber(texte)", "Convertit en nombre"],
    ["round(nombre; décimales)", "Arrondit"],
    ["sum(a; b; …)", "Additionne"],
    ["toJSON(valeur)", "Convertit en texte JSON"],
    ["parseJSON(texte)", "Lit un texte JSON"],
    ["stripHTML(texte)", "Retire les balises HTML"],
    ["encodeURL(texte)", "Encode pour une URL"],
    ["uuid()", "Identifiant unique"]
  ];

  const CONNECTION_HELP = {
    claude: "Crée une clé sur console.anthropic.com → API Keys.",
    openai: "Crée une clé sur platform.openai.com → API keys.",
    slack: "Dans Slack : Applications → Incoming Webhooks → Ajouter à un canal, puis copie l'URL.",
    discord: "Dans Discord : Paramètres du salon → Intégrations → Webhooks → Nouveau webhook → Copier l'URL.",
    telegram: "Sur Telegram, écris à @BotFather, tape /newbot et copie le jeton qu'il te donne.",
    notion: "Sur notion.so/my-integrations, crée une intégration interne puis partage ta base avec elle.",
    airtable: "Sur airtable.com/create/tokens, crée un jeton avec les droits data.records:read/write."
  };

  const state = {
    apps: [],
    appsById: {},
    page: "scenarios",
    filter: "all",
    scenarios: [],
    connections: [],
    hooks: [],
    editor: null,
    loaded: false,
    refreshTimer: null
  };

  const $main = () => document.getElementById("ax-main");

  // ---------------------------------------------------------
  // OUTILS
  // ---------------------------------------------------------

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
  }

  function notify(message, kind = "") {
    if (typeof toast === "function") toast(message, kind);
    else console.log(message);
  }

  async function api(pathname, options = {}) {
    const response = await fetch(AX_API + pathname, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      body: options.body !== undefined && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
    });
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      throw new Error(data?.error || `Erreur serveur (HTTP ${response.status})`);
    }
    return data;
  }

  function el(html) {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }

  function timeAgo(value) {
    if (!value) return "Jamais";
    const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
    if (seconds < 60) return "À l'instant";
    if (seconds < 3600) return `Il y a ${Math.round(seconds / 60)} min`;
    if (seconds < 86400) return `Il y a ${Math.round(seconds / 3600)} h`;
    return formatDate(value);
  }

  function scheduleLabel(schedule, trigger) {
    if (trigger?.app === "webhooks") return "Immédiatement (webhook)";
    if (!schedule) return "À la demande";
    switch (schedule.type) {
      case "interval": {
        const m = Number(schedule.minutes) || 15;
        return m % 60 === 0 ? `Toutes les ${m / 60 === 1 ? "" : m / 60 + " "}heure${m / 60 > 1 ? "s" : ""}` : `Toutes les ${m} minutes`;
      }
      case "daily": return `Tous les jours à ${schedule.time || "09:00"}`;
      case "weekly": return `${(schedule.days || []).map(d => DAYS[d]).join(" ")} à ${schedule.time || "09:00"}`;
      case "instant": return "Immédiatement (webhook)";
      default: return "À la demande";
    }
  }

  function statusLabel(status) {
    return { success: "Succès", warning: "Avertissement", error: "Erreur", running: "En cours" }[status] || status || "—";
  }

  function appIcon(appId, size = "") {
    const app = state.appsById[appId];
    if (!app) return `<span class="ax-icon ${size}" style="--app:#999">?</span>`;
    return `<span class="ax-icon ${size}" style="--app:${esc(app.color)}" title="${esc(app.name)}">${esc(app.icon)}</span>`;
  }

  function moduleDef(module) {
    return state.appsById[module?.app]?.modules.find(m => m.id === module.module) || null;
  }

  function isRouter(module) {
    return module?.app === "flow" && module?.module === "router";
  }

  function copyText(text) {
    const done = () => notify("Copié dans le presse-papiers", "success");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else {
      fallback();
    }
    function fallback() {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      ok ? done() : notify("Copie impossible", "error");
    }
  }

  function hookUrl(hookId) {
    return `${SERVER}/api/automations/hooks/${hookId}`;
  }

  // ---------------------------------------------------------
  // MODALES
  // ---------------------------------------------------------

  function openModal({ title, body, actions = [], wide = false, className = "" }) {
    const overlay = el(`
      <div class="ax-modal-overlay">
        <div class="ax-modal ${wide ? "wide" : ""} ${className}" role="dialog" aria-modal="true">
          <div class="ax-modal-head">
            <h3>${esc(title)}</h3>
            <button type="button" class="ax-icon-btn" data-close aria-label="Fermer">✕</button>
          </div>
          <div class="ax-modal-body"></div>
          <div class="ax-modal-foot"></div>
        </div>
      </div>`);

    const bodyEl = overlay.querySelector(".ax-modal-body");
    if (typeof body === "string") bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);

    const foot = overlay.querySelector(".ax-modal-foot");
    const close = () => {
      overlay.remove();
      hideMapper();
    };

    actions.forEach(action => {
      const button = el(`<button type="button" class="${action.className || "ax-btn"}">${esc(action.label)}</button>`);
      button.addEventListener("click", async () => {
        if (action.onClick) {
          const result = await action.onClick(close, button);
          if (result === false) return;
        }
        if (action.close !== false) close();
      });
      foot.appendChild(button);
    });
    if (!actions.length) foot.remove();

    overlay.querySelector("[data-close]").addEventListener("click", close);
    overlay.addEventListener("mousedown", event => {
      if (event.target === overlay) close();
    });

    document.getElementById("automations-view").appendChild(overlay);
    return { overlay, body: bodyEl, close };
  }

  function confirmModal(title, message, confirmLabel = "Confirmer", danger = true) {
    return new Promise(resolve => {
      let answered = false;
      const modal = openModal({
        title,
        body: `<p class="ax-muted">${esc(message)}</p>`,
        actions: [
          { label: "Annuler", className: "ax-btn", onClick: () => { answered = true; resolve(false); } },
          { label: confirmLabel, className: danger ? "ax-btn danger" : "ax-btn primary", onClick: () => { answered = true; resolve(true); } }
        ]
      });
      const observer = new MutationObserver(() => {
        if (!modal.overlay.isConnected) {
          observer.disconnect();
          if (!answered) resolve(false);
        }
      });
      observer.observe(document.getElementById("automations-view"), { childList: true });
    });
  }

  function jsonViewer(value) {
    let text;
    try { text = JSON.stringify(value, null, 2); } catch { text = String(value); }
    return `<pre class="ax-json">${esc(text ?? "null")}</pre>`;
  }

  // ---------------------------------------------------------
  // CHARGEMENT
  // ---------------------------------------------------------

  async function loadBase() {
    const [apps, connections] = await Promise.all([api("/apps"), api("/connections")]);
    state.apps = apps;
    state.appsById = Object.fromEntries(apps.map(app => [app.id, app]));
    state.connections = connections;
    state.loaded = true;
  }

  async function open(page) {
    // Retour sur l'onglet pendant l'édition : on garde l'éditeur tel quel
    if (!page && state.loaded && state.page === "editor") {
      if (state.editor && $main().querySelector(".ax-editor")) return;
      page = "scenarios";
    }

    try {
      if (!state.loaded) {
        $main().innerHTML = `<div class="ax-loading">Chargement des automatisations…</div>`;
        await loadBase();
      }
      await go(page || state.page || "scenarios");
    } catch (error) {
      $main().innerHTML = `
        <div class="ax-page"><div class="ax-empty">
          <div class="ax-empty-icon">⚠</div>
          <h3>Chargement impossible</h3>
          <p>${esc(error.message)}</p>
          <p class="ax-muted">Vérifie que le serveur tourne (<code>node server.js</code>) puis réessaie.</p>
          <button type="button" class="ax-btn primary" data-retry>Réessayer</button>
        </div></div>`;
      $main().querySelector("[data-retry]").addEventListener("click", () => open(page));
    }
  }

  async function go(page, options = {}) {
    if (state.editor?.dirty && page !== "editor") {
      const leave = await confirmModal("Modifications non enregistrées", "Quitter l'éditeur sans enregistrer ?", "Quitter sans enregistrer");
      if (!leave) return;
    }
    if (page !== "editor") state.editor = null;
    hideMapper();

    state.page = page;
    document.querySelectorAll("#automations-view [data-ax-page]").forEach(button => {
      button.classList.toggle("active", button.dataset.axPage === (page === "editor" ? "scenarios" : page));
    });

    clearInterval(state.refreshTimer);

    const pages = {
      scenarios: renderScenarios,
      templates: renderTemplates,
      connections: renderConnections,
      webhooks: renderWebhooks,
      datastores: renderDatastores,
      history: renderHistory,
      editor: () => openEditor(options.id)
    };
    await (pages[page] || renderScenarios)(options);
  }

  // ---------------------------------------------------------
  // PAGE : SCÉNARIOS
  // ---------------------------------------------------------

  async function renderScenarios() {
    const main = $main();
    main.innerHTML = `
      <div class="ax-page">
        <header class="ax-page-head">
          <div>
            <h2>Scénarios</h2>
            <p>Automatise tes tâches en reliant tes applications entre elles.</p>
          </div>
          <div class="ax-head-actions">
            <button type="button" class="ax-btn" data-go="templates">◫ Partir d'un modèle</button>
            <button type="button" class="ax-btn primary" data-create>＋ Créer un nouveau scénario</button>
          </div>
        </header>
        <div class="ax-tabs">
          <button type="button" data-filter="all">Tous</button>
          <button type="button" data-filter="active">Actifs</button>
          <button type="button" data-filter="inactive">Inactifs</button>
        </div>
        <div class="ax-list" id="ax-scenario-list"><div class="ax-loading">Chargement…</div></div>
      </div>`;

    main.querySelector("[data-create]").addEventListener("click", createScenario);
    main.querySelector("[data-go]").addEventListener("click", () => go("templates"));
    main.querySelectorAll("[data-filter]").forEach(button => {
      button.classList.toggle("active", button.dataset.filter === state.filter);
      button.addEventListener("click", () => {
        state.filter = button.dataset.filter;
        main.querySelectorAll("[data-filter]").forEach(b => b.classList.toggle("active", b === button));
        drawScenarioList();
      });
    });

    await refreshScenarios();
    state.refreshTimer = setInterval(() => {
      if (state.page === "scenarios" && isVisible()) refreshScenarios().catch(() => {});
    }, 10000);
  }

  async function refreshScenarios() {
    state.scenarios = await api("/scenarios");
    drawScenarioList();
  }

  function drawScenarioList() {
    const list = document.getElementById("ax-scenario-list");
    if (!list) return;

    const items = state.scenarios.filter(s =>
      state.filter === "all" || (state.filter === "active" ? s.active : !s.active));

    if (!items.length) {
      list.innerHTML = `
        <div class="ax-empty">
          <div class="ax-empty-icon">⟳</div>
          <h3>${state.scenarios.length ? "Aucun scénario dans ce filtre" : "Aucun scénario pour l'instant"}</h3>
          <p>Un scénario relie un déclencheur (ex. : un nouvel e-mail) à des actions (ex. : un message Telegram).</p>
          <div class="ax-head-actions">
            <button type="button" class="ax-btn" data-tpl>Partir d'un modèle</button>
            <button type="button" class="ax-btn primary" data-new>＋ Créer un scénario</button>
          </div>
        </div>`;
      list.querySelector("[data-new]").addEventListener("click", createScenario);
      list.querySelector("[data-tpl]").addEventListener("click", () => go("templates"));
      return;
    }

    list.innerHTML = "";
    for (const scenario of items) {
      const icons = [...new Set(scenario.apps)].slice(0, 6).map(id => appIcon(id, "sm")).join("");
      const last = scenario.lastRun;
      const row = el(`
        <div class="ax-row" tabindex="0">
          <div class="ax-row-icons">${icons || `<span class="ax-icon sm" style="--app:#c4c4cc">＋</span>`}</div>
          <div class="ax-row-main">
            <strong>${esc(scenario.name)}</strong>
            <small>${esc(scheduleLabel(scenario.schedule, { app: scenario.apps[0] }))}${scenario.active && scenario.nextRunAt ? ` · prochaine exécution ${esc(formatDate(scenario.nextRunAt))}` : ""}</small>
          </div>
          <div class="ax-row-stat">
            ${scenario.running ? `<span class="ax-status running">En cours…</span>` :
              last ? `<span class="ax-status ${esc(last.status)}">${esc(statusLabel(last.status))}</span><small>${esc(timeAgo(last.at))}</small>` :
              `<small class="ax-muted">Jamais exécuté</small>`}
          </div>
          <div class="ax-row-stat"><strong>${scenario.stats?.operations || 0}</strong><small>opérations</small></div>
          <label class="ax-switch" title="${scenario.active ? "Désactiver" : "Activer"}">
            <input type="checkbox" ${scenario.active ? "checked" : ""}>
            <span></span>
          </label>
          <div class="ax-row-actions">
            <button type="button" class="ax-icon-btn" data-act="run" title="Exécuter maintenant">▶</button>
            <button type="button" class="ax-icon-btn" data-act="clone" title="Dupliquer">⧉</button>
            <button type="button" class="ax-icon-btn danger" data-act="delete" title="Supprimer">🗑</button>
          </div>
        </div>`);

      row.addEventListener("click", event => {
        if (event.target.closest(".ax-switch, .ax-row-actions")) return;
        go("editor", { id: scenario.id });
      });
      row.addEventListener("keydown", event => {
        if (event.key === "Enter" && event.target === row) go("editor", { id: scenario.id });
      });

      row.querySelector(".ax-switch input").addEventListener("change", async event => {
        const wanted = event.target.checked;
        try {
          await api(`/scenarios/${scenario.id}/toggle`, { method: "POST", body: { active: wanted } });
          notify(wanted ? "Scénario activé" : "Scénario désactivé", "success");
        } catch (error) {
          event.target.checked = !wanted;
          notify(error.message, "error");
        }
        refreshScenarios().catch(() => {});
      });

      row.querySelector("[data-act=run]").addEventListener("click", async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const run = await api(`/scenarios/${scenario.id}/run`, { method: "POST" });
          notify(`« ${scenario.name} » : ${statusLabel(run.status)} (${run.operations} opération(s))`, run.status === "error" ? "error" : "success");
          if (run.error) notify(run.error, "error");
        } catch (error) {
          notify(error.message, "error");
        }
        button.disabled = false;
        refreshScenarios().catch(() => {});
      });

      row.querySelector("[data-act=clone]").addEventListener("click", async () => {
        try {
          await api(`/scenarios/${scenario.id}/clone`, { method: "POST" });
          notify("Scénario dupliqué", "success");
          refreshScenarios();
        } catch (error) { notify(error.message, "error"); }
      });

      row.querySelector("[data-act=delete]").addEventListener("click", async () => {
        if (!(await confirmModal("Supprimer le scénario", `Supprimer définitivement « ${scenario.name} » ?`, "Supprimer"))) return;
        try {
          await api(`/scenarios/${scenario.id}`, { method: "DELETE" });
          notify("Scénario supprimé", "success");
          refreshScenarios();
        } catch (error) { notify(error.message, "error"); }
      });

      list.appendChild(row);
    }
  }

  async function createScenario() {
    try {
      const scenario = await api("/scenarios", { method: "POST", body: { name: "Nouveau scénario" } });
      await go("editor", { id: scenario.id });
    } catch (error) {
      notify(error.message, "error");
    }
  }

  // ---------------------------------------------------------
  // PAGE : MODÈLES
  // ---------------------------------------------------------

  async function renderTemplates() {
    const main = $main();
    main.innerHTML = `
      <div class="ax-page">
        <header class="ax-page-head">
          <div><h2>Modèles</h2><p>Des scénarios prêts à l'emploi : il ne reste qu'à choisir tes connexions.</p></div>
        </header>
        <div class="ax-grid" id="ax-templates"><div class="ax-loading">Chargement…</div></div>
      </div>`;

    const templates = await api("/templates");
    const grid = document.getElementById("ax-templates");
    grid.innerHTML = "";

    templates.forEach(template => {
      const card = el(`
        <article class="ax-card">
          <div class="ax-card-icons">${template.apps.map(id => appIcon(id)).join("")}</div>
          <h3>${esc(template.name)}</h3>
          <p>${esc(template.description)}</p>
          <button type="button" class="ax-btn primary">Utiliser ce modèle</button>
        </article>`);
      card.querySelector("button").addEventListener("click", async event => {
        event.currentTarget.disabled = true;
        try {
          const scenario = await api(`/templates/${template.id}/use`, { method: "POST" });
          notify("Scénario créé depuis le modèle", "success");
          await go("editor", { id: scenario.id });
        } catch (error) {
          notify(error.message, "error");
          event.currentTarget.disabled = false;
        }
      });
      grid.appendChild(card);
    });
  }

  // ---------------------------------------------------------
  // PAGE : CONNEXIONS
  // ---------------------------------------------------------

  async function renderConnections() {
    const main = $main();
    main.innerHTML = `
      <div class="ax-page">
        <header class="ax-page-head">
          <div>
            <h2>Connexions</h2>
            <p>Les accès à tes comptes (clés API, jetons). Ils restent sur ton PC, dans <code>data/automation-connections.json</code>.</p>
          </div>
          <div class="ax-head-actions"><button type="button" class="ax-btn primary" data-add>＋ Ajouter une connexion</button></div>
        </header>
        <div class="ax-info">Gmail, Gemini et AGENTS_IA n'ont pas besoin de connexion ici : ils utilisent déjà ton <code>token.json</code> et ton fichier <code>.env</code>.</div>
        <div class="ax-list" id="ax-connection-list"></div>
      </div>`;

    main.querySelector("[data-add]").addEventListener("click", () => openConnectionModal(null, () => renderConnections()));

    state.connections = await api("/connections");
    const list = document.getElementById("ax-connection-list");

    if (!state.connections.length) {
      list.innerHTML = `<div class="ax-empty"><div class="ax-empty-icon">🔗</div><h3>Aucune connexion</h3><p>Ajoute une connexion pour utiliser Slack, Discord, Telegram, Notion, Airtable, Claude ou OpenAI.</p></div>`;
      return;
    }

    state.connections.forEach(connection => {
      const app = state.appsById[connection.app];
      const preview = Object.values(connection.fields || {}).join(" · ");
      const row = el(`
        <div class="ax-row static">
          <div class="ax-row-icons">${appIcon(connection.app)}</div>
          <div class="ax-row-main">
            <strong>${esc(connection.name)}</strong>
            <small>${esc(app?.name || connection.app)} · ${esc(preview)} · créée le ${esc(formatDate(connection.createdAt))}</small>
          </div>
          <div class="ax-row-test ax-muted"></div>
          <div class="ax-row-actions">
            ${app?.connection?.testable ? `<button type="button" class="ax-btn" data-test>Tester</button>` : ""}
            <button type="button" class="ax-btn danger" data-del>Supprimer</button>
          </div>
        </div>`);

      row.querySelector("[data-test]")?.addEventListener("click", async event => {
        const output = row.querySelector(".ax-row-test");
        event.currentTarget.disabled = true;
        output.textContent = "Test en cours…";
        try {
          const result = await api(`/connections/${connection.id}/test`, { method: "POST" });
          output.textContent = result.message;
          output.className = `ax-row-test ${result.ok ? "ok" : "ko"}`;
        } catch (error) {
          output.textContent = error.message;
          output.className = "ax-row-test ko";
        }
        event.currentTarget.disabled = false;
      });

      row.querySelector("[data-del]").addEventListener("click", async () => {
        if (!(await confirmModal("Supprimer la connexion", `Supprimer « ${connection.name} » ? Les modules qui l'utilisent devront en choisir une autre.`, "Supprimer"))) return;
        try {
          await api(`/connections/${connection.id}`, { method: "DELETE" });
          notify("Connexion supprimée", "success");
          renderConnections();
        } catch (error) { notify(error.message, "error"); }
      });

      list.appendChild(row);
    });
  }

  function openConnectionModal(appId, onCreated) {
    const apps = state.apps.filter(app => app.connection);
    let current = appId || apps[0]?.id;

    const body = el(`<div class="ax-form"></div>`);

    function draw() {
      const app = state.appsById[current];
      body.innerHTML = `
        <label class="ax-field">
          <span>Application</span>
          <select data-app ${appId ? "disabled" : ""}>
            ${apps.map(a => `<option value="${esc(a.id)}" ${a.id === current ? "selected" : ""}>${esc(a.name)}</option>`).join("")}
          </select>
        </label>
        <label class="ax-field">
          <span>Nom de la connexion</span>
          <input type="text" data-name value="Ma connexion ${esc(app.name)}">
        </label>
        ${app.connection.fields.map(field => `
          <label class="ax-field">
            <span>${esc(field.label)}${field.required ? " *" : ""}</span>
            <input type="${field.type === "password" ? "password" : "text"}" data-key="${esc(field.key)}" placeholder="${esc(field.placeholder || "")}" autocomplete="off">
          </label>`).join("")}
        ${CONNECTION_HELP[current] ? `<p class="ax-help">💡 ${esc(CONNECTION_HELP[current])}</p>` : ""}`;

      body.querySelector("[data-app]").addEventListener("change", event => {
        current = event.target.value;
        draw();
      });
    }
    draw();

    openModal({
      title: "Ajouter une connexion",
      body,
      actions: [
        { label: "Annuler", className: "ax-btn" },
        {
          label: "Enregistrer",
          className: "ax-btn primary",
          onClick: async (close, button) => {
            const data = {};
            body.querySelectorAll("[data-key]").forEach(input => { data[input.dataset.key] = input.value; });
            button.disabled = true;
            try {
              const connection = await api("/connections", {
                method: "POST",
                body: { app: current, name: body.querySelector("[data-name]").value, data }
              });
              state.connections.push(connection);
              notify("Connexion enregistrée", "success");
              onCreated?.(connection);
              return true;
            } catch (error) {
              notify(error.message, "error");
              button.disabled = false;
              return false;
            }
          }
        }
      ]
    });
  }

  // ---------------------------------------------------------
  // PAGE : WEBHOOKS
  // ---------------------------------------------------------

  async function renderWebhooks() {
    const main = $main();
    main.innerHTML = `
      <div class="ax-page">
        <header class="ax-page-head">
          <div>
            <h2>Webhooks</h2>
            <p>Une URL qui déclenche un scénario dès qu'un autre service lui envoie des données.</p>
          </div>
          <div class="ax-head-actions"><button type="button" class="ax-btn primary" data-new>＋ Créer un scénario webhook</button></div>
        </header>
        <div class="ax-info">Ces URL fonctionnent sur ton PC (<code>localhost</code>). Pour qu'un service sur Internet (formulaire, Stripe…) puisse les appeler, il faut un <strong>tunnel</strong> : un outil comme ngrok qui donne une adresse publique redirigée vers ton PC.</div>
        <div class="ax-list" id="ax-hook-list"></div>
      </div>`;

    main.querySelector("[data-new]").addEventListener("click", async () => {
      try {
        const { hookId } = await api("/new-hook-id");
        const scenario = await api("/scenarios", {
          method: "POST",
          body: { name: "Nouveau scénario webhook", trigger: { id: 1, app: "webhooks", module: "customWebhook", params: { hookId } }, modules: [] }
        });
        await go("editor", { id: scenario.id });
      } catch (error) { notify(error.message, "error"); }
    });

    state.hooks = await api("/hooks");
    const list = document.getElementById("ax-hook-list");

    if (!state.hooks.length) {
      list.innerHTML = `<div class="ax-empty"><div class="ax-empty-icon">⚓</div><h3>Aucun webhook</h3><p>Crée un scénario qui commence par le module « Webhooks › Webhook personnalisé ».</p></div>`;
      return;
    }

    state.hooks.forEach(hook => {
      const row = el(`
        <div class="ax-row static">
          <div class="ax-row-icons">${appIcon("webhooks")}</div>
          <div class="ax-row-main">
            <strong>${esc(hook.scenarioName)}</strong>
            <code class="ax-url">${esc(hookUrl(hook.hookId))}</code>
            <small>${hook.receivedAt ? `Dernières données reçues : ${esc(formatDate(hook.receivedAt))}` : "En attente de données…"} · ${hook.active ? "scénario actif" : "scénario inactif"}</small>
          </div>
          <div class="ax-row-actions">
            <button type="button" class="ax-btn" data-copy>Copier l'URL</button>
            ${hook.sample ? `<button type="button" class="ax-btn" data-sample>Voir les données</button>` : ""}
            <button type="button" class="ax-btn" data-open>Ouvrir le scénario</button>
          </div>
        </div>`);
      row.querySelector("[data-copy]").addEventListener("click", () => copyText(hookUrl(hook.hookId)));
      row.querySelector("[data-sample]")?.addEventListener("click", () => openModal({ title: "Dernières données reçues", body: jsonViewer(hook.sample), wide: true }));
      row.querySelector("[data-open]").addEventListener("click", () => go("editor", { id: hook.scenarioId }));
      list.appendChild(row);
    });
  }

  // ---------------------------------------------------------
  // PAGE : STOCKAGES DE DONNÉES
  // ---------------------------------------------------------

  async function renderDatastores(options = {}) {
    const main = $main();
    main.innerHTML = `
      <div class="ax-page">
        <header class="ax-page-head">
          <div>
            <h2>Stockages de données</h2>
            <p>Une petite base de données (clé → valeur) que tes scénarios remplissent et relisent.</p>
          </div>
          <div class="ax-head-actions"><button type="button" class="ax-btn primary" data-add>＋ Ajouter un enregistrement</button></div>
        </header>
        <div class="ax-split">
          <div class="ax-list" id="ax-store-list"></div>
          <div class="ax-panel" id="ax-store-records"><p class="ax-muted">Sélectionne un stockage pour voir son contenu.</p></div>
        </div>
      </div>`;

    main.querySelector("[data-add]").addEventListener("click", () => openRecordModal(options.store || "", () => renderDatastores({ store: options.store })));

    const stores = await api("/datastores");
    const list = document.getElementById("ax-store-list");

    if (!stores.length) {
      list.innerHTML = `<div class="ax-empty small"><div class="ax-empty-icon">▤</div><h3>Aucun stockage</h3><p>Il sera créé automatiquement par le module « Stockage de données », ou ajoute un enregistrement.</p></div>`;
      return;
    }

    stores.forEach(store => {
      const row = el(`
        <div class="ax-row ${options.store === store.name ? "selected" : ""}" tabindex="0">
          <div class="ax-row-icons">${appIcon("datastore", "sm")}</div>
          <div class="ax-row-main"><strong>${esc(store.name)}</strong><small>${store.count} enregistrement(s)</small></div>
        </div>`);
      row.addEventListener("click", () => renderDatastores({ store: store.name }));
      list.appendChild(row);
    });

    if (options.store) await drawRecords(options.store);
  }

  async function drawRecords(name) {
    const panel = document.getElementById("ax-store-records");
    const records = await api(`/datastores/${encodeURIComponent(name)}`);
    panel.innerHTML = `
      <div class="ax-panel-head">
        <h3>${esc(name)}</h3>
        <button type="button" class="ax-btn danger" data-drop>Supprimer le stockage</button>
      </div>
      ${records.length ? `
        <table class="ax-table">
          <thead><tr><th>Clé</th><th>Valeur</th><th>Modifié</th><th></th></tr></thead>
          <tbody>${records.map((record, i) => `
            <tr>
              <td><code>${esc(record.key)}</code></td>
              <td class="ax-cell-value">${esc(typeof record.value === "string" ? record.value : JSON.stringify(record.value)).slice(0, 300)}</td>
              <td>${esc(formatDate(record.updatedAt))}</td>
              <td><button type="button" class="ax-icon-btn danger" data-del="${i}" title="Supprimer">🗑</button></td>
            </tr>`).join("")}</tbody>
        </table>` : `<p class="ax-muted">Ce stockage est vide.</p>`}`;

    panel.querySelector("[data-drop]").addEventListener("click", async () => {
      if (!(await confirmModal("Supprimer le stockage", `Supprimer « ${name} » et tous ses enregistrements ?`, "Supprimer"))) return;
      await api(`/datastores/${encodeURIComponent(name)}`, { method: "DELETE" });
      notify("Stockage supprimé", "success");
      renderDatastores();
    });

    panel.querySelectorAll("[data-del]").forEach(button => {
      button.addEventListener("click", async () => {
        const record = records[Number(button.dataset.del)];
        await api(`/datastores/${encodeURIComponent(name)}/records/${encodeURIComponent(record.key)}`, { method: "DELETE" });
        notify("Enregistrement supprimé", "success");
        renderDatastores({ store: name });
      });
    });
  }

  function openRecordModal(storeName, onDone) {
    const body = el(`
      <div class="ax-form">
        <label class="ax-field"><span>Stockage *</span><input type="text" data-store value="${esc(storeName)}" placeholder="ex. : clients"></label>
        <label class="ax-field"><span>Clé *</span><input type="text" data-key placeholder="ex. : lea@exemple.fr"></label>
        <label class="ax-field"><span>Valeur (texte ou JSON)</span><textarea data-value rows="4" placeholder='{"nom": "Léa"}'></textarea></label>
      </div>`);

    openModal({
      title: "Ajouter un enregistrement",
      body,
      actions: [
        { label: "Annuler", className: "ax-btn" },
        {
          label: "Enregistrer",
          className: "ax-btn primary",
          onClick: async () => {
            const store = body.querySelector("[data-store]").value.trim();
            if (!store) { notify("Indique le nom du stockage.", "error"); return false; }
            try {
              await api(`/datastores/${encodeURIComponent(store)}/records`, {
                method: "POST",
                body: { key: body.querySelector("[data-key]").value, value: body.querySelector("[data-value]").value }
              });
              notify("Enregistrement ajouté", "success");
              onDone?.(store);
              renderDatastores({ store });
              return true;
            } catch (error) {
              notify(error.message, "error");
              return false;
            }
          }
        }
      ]
    });
  }

  // ---------------------------------------------------------
  // PAGE : HISTORIQUE
  // ---------------------------------------------------------

  async function renderHistory() {
    const main = $main();
    main.innerHTML = `
      <div class="ax-page">
        <header class="ax-page-head">
          <div><h2>Historique des exécutions</h2><p>Les 200 dernières exécutions de tous tes scénarios.</p></div>
          <div class="ax-head-actions">
            <button type="button" class="ax-btn" data-refresh>↻ Actualiser</button>
            <button type="button" class="ax-btn danger" data-clear>Vider l'historique</button>
          </div>
        </header>
        <div class="ax-panel" id="ax-history"></div>
      </div>`;

    main.querySelector("[data-refresh]").addEventListener("click", renderHistory);
    main.querySelector("[data-clear]").addEventListener("click", async () => {
      if (!(await confirmModal("Vider l'historique", "Supprimer toutes les exécutions enregistrées ?", "Vider"))) return;
      await api("/runs", { method: "DELETE" });
      notify("Historique vidé", "success");
      renderHistory();
    });

    const runs = await api("/runs?limit=200");
    const panel = document.getElementById("ax-history");
    panel.innerHTML = runs.length ? runTable(runs, true) : `<p class="ax-muted">Aucune exécution pour l'instant.</p>`;
    bindRunTable(panel, runs);
  }

  function runTable(runs, withScenario) {
    const sources = { manual: "Manuelle", schedule: "Planifiée", webhook: "Webhook" };
    return `
      <table class="ax-table clickable">
        <thead><tr><th>Date</th>${withScenario ? "<th>Scénario</th>" : ""}<th>Origine</th><th>Statut</th><th>Opérations</th><th>Durée</th></tr></thead>
        <tbody>${runs.map((run, i) => `
          <tr data-run="${i}">
            <td>${esc(formatDate(run.startedAt))}</td>
            ${withScenario ? `<td>${esc(run.scenarioName)}</td>` : ""}
            <td>${esc(sources[run.source] || run.source)}</td>
            <td><span class="ax-status ${esc(run.status)}">${esc(statusLabel(run.status))}</span></td>
            <td>${run.operations}</td>
            <td>${(run.durationMs / 1000).toFixed(1)} s</td>
          </tr>`).join("")}</tbody>
      </table>`;
  }

  function bindRunTable(container, runs) {
    container.querySelectorAll("[data-run]").forEach(row => {
      row.addEventListener("click", async () => {
        try {
          const run = await api(`/runs/${runs[Number(row.dataset.run)].id}`);
          openRunDetails(run);
        } catch (error) { notify(error.message, "error"); }
      });
    });
  }

  function openRunDetails(run) {
    const modules = Object.entries(run.logs || {});
    const body = el(`<div>
      <div class="ax-run-summary">
        <span class="ax-status ${esc(run.status)}">${esc(statusLabel(run.status))}</span>
        <span>${esc(formatDate(run.startedAt))}</span>
        <span>${run.operations} opération(s)</span>
        <span>${(run.durationMs / 1000).toFixed(1)} s</span>
      </div>
      ${run.error ? `<div class="ax-error-box">${esc(run.error)}</div>` : ""}
      ${modules.map(([id, log]) => {
        const app = state.appsById[log.app];
        const def = app?.modules.find(m => m.id === log.module);
        return `
          <details class="ax-log">
            <summary>${appIcon(log.app, "sm")} <strong>${esc(id)}. ${esc(app?.name || log.app)}</strong> – ${esc(def?.name || log.module)}
              <span class="ax-muted">${log.count} opération(s)${log.filtered ? ` · ${log.filtered} filtrée(s)` : ""}${log.errors ? ` · <span class="ko">${log.errors} erreur(s)</span>` : ""}</span>
            </summary>
            ${log.operations.map((op, i) => `
              <div class="ax-op">
                <div class="ax-op-title">Opération ${i + 1}${op.filtered ? " — arrêtée par le filtre" : ""}</div>
                ${op.error ? `<div class="ax-error-box">${esc(op.error)}</div>` : ""}
                ${op.input !== undefined && op.input !== null ? `<div class="ax-op-label">Entrée</div>${jsonViewer(op.input)}` : ""}
                ${op.output !== undefined && op.output !== null ? `<div class="ax-op-label">Sortie</div>${jsonViewer(op.output)}` : ""}
              </div>`).join("")}
          </details>`;
      }).join("") || `<p class="ax-muted">Aucun module exécuté.</p>`}
    </div>`);
    openModal({ title: `Exécution — ${run.scenarioName}`, body, wide: true });
  }

  // =========================================================
  // ÉDITEUR DE SCÉNARIO
  // =========================================================

  async function openEditor(id) {
    const main = $main();
    main.innerHTML = `<div class="ax-loading">Ouverture du scénario…</div>`;

    const [scenario, lastRuns, hooks, connections] = await Promise.all([
      api(`/scenarios/${id}`),
      api(`/runs?scenarioId=${id}&limit=1&logs=1`),
      api("/hooks"),
      api("/connections")
    ]);

    state.connections = connections;
    state.hooks = hooks;
    state.editor = {
      scenario,
      dirty: false,
      lastRun: lastRuns[0] || null,
      zoom: 1,
      running: false,
      openModuleId: null
    };

    main.innerHTML = `
      <div class="ax-editor">
        <header class="ax-editor-head">
          <button type="button" class="ax-icon-btn" data-back title="Retour aux scénarios">←</button>
          <input type="text" class="ax-name-input" data-name maxlength="120" aria-label="Nom du scénario">
          <span class="ax-dirty" data-dirty hidden>● Modifications non enregistrées</span>
          <div class="ax-head-actions">
            <button type="button" class="ax-btn" data-history>⏱ Historique</button>
            <button type="button" class="ax-btn primary" data-save>Enregistrer</button>
          </div>
        </header>
        <div class="ax-canvas-wrap" data-canvas-wrap>
          <div class="ax-canvas" data-canvas></div>
          <div class="ax-run-banner" data-banner hidden></div>
        </div>
        <footer class="ax-toolbar">
          <button type="button" class="ax-run-btn" data-run title="Exécuter une fois">
            <span class="ax-run-icon">▶</span>
            <span>Exécuter une fois</span>
          </button>
          <div class="ax-tool-group">
            <label class="ax-switch big" title="Activer / désactiver la planification">
              <input type="checkbox" data-active>
              <span></span>
            </label>
            <div class="ax-tool-text">
              <strong data-active-label>OFF</strong>
              <button type="button" class="ax-link" data-schedule></button>
            </div>
          </div>
          <div class="ax-tool-group">
            <button type="button" class="ax-tool" data-zoom-out title="Dézoomer">−</button>
            <button type="button" class="ax-tool" data-zoom-reset title="Taille réelle">100 %</button>
            <button type="button" class="ax-tool" data-zoom-in title="Zoomer">＋</button>
          </div>
          <div class="ax-tool-group">
            <button type="button" class="ax-tool wide" data-reset-state title="Oublier les éléments déjà traités par les déclencheurs (e-mails, messages…)">↺ Réinitialiser le déclencheur</button>
          </div>
          <p class="ax-toolbar-hint">Clique sur un module pour le configurer · sur l'icône entre deux modules pour ajouter un filtre · Ctrl+S pour enregistrer</p>
        </footer>
      </div>`;

    const nameInput = main.querySelector("[data-name]");
    nameInput.value = scenario.name;
    nameInput.addEventListener("input", () => {
      state.editor.scenario.name = nameInput.value;
      markDirty();
    });

    main.querySelector("[data-back]").addEventListener("click", () => go("scenarios"));
    main.querySelector("[data-save]").addEventListener("click", () => saveScenario());
    main.querySelector("[data-history]").addEventListener("click", openScenarioHistory);
    main.querySelector("[data-run]").addEventListener("click", runOnce);
    main.querySelector("[data-schedule]").addEventListener("click", openScheduleModal);
    main.querySelector("[data-active]").addEventListener("change", toggleActiveFromEditor);
    main.querySelector("[data-zoom-in]").addEventListener("click", () => setZoom(state.editor.zoom + 0.1));
    main.querySelector("[data-zoom-out]").addEventListener("click", () => setZoom(state.editor.zoom - 0.1));
    main.querySelector("[data-zoom-reset]").addEventListener("click", () => setZoom(1));
    main.querySelector("[data-reset-state]").addEventListener("click", resetTriggerState);

    enablePan(main.querySelector("[data-canvas-wrap]"));
    updateToolbar();
    drawCanvas();

    if (!scenario.trigger) {
      setTimeout(() => openAppPicker({ mode: "trigger" }), 150);
    }
  }

  function markDirty() {
    if (!state.editor) return;
    state.editor.dirty = true;
    const flag = document.querySelector("#automations-view [data-dirty]");
    if (flag) flag.hidden = false;
  }

  function clearDirty() {
    if (!state.editor) return;
    state.editor.dirty = false;
    const flag = document.querySelector("#automations-view [data-dirty]");
    if (flag) flag.hidden = true;
  }

  function updateToolbar() {
    const editor = state.editor;
    if (!editor) return;
    const root = $main();
    const scenario = editor.scenario;
    const isHook = scenario.trigger?.app === "webhooks";
    root.querySelector("[data-active]").checked = Boolean(scenario.active);
    root.querySelector("[data-active-label]").textContent = scenario.active ? "ON" : "OFF";
    root.querySelector("[data-schedule]").textContent = "⏱ " + scheduleLabel(scenario.schedule, scenario.trigger);
    root.querySelector("[data-schedule]").disabled = isHook;
    root.querySelector("[data-zoom-reset]").textContent = `${Math.round(editor.zoom * 100)} %`;
    const runButton = root.querySelector("[data-run]");
    runButton.disabled = editor.running;
    runButton.classList.toggle("running", editor.running);
    runButton.querySelector("span:last-child").textContent = editor.running ? "Exécution…" : "Exécuter une fois";
  }

  function setZoom(value) {
    state.editor.zoom = Math.min(1.5, Math.max(0.5, Math.round(value * 10) / 10));
    drawCanvas();
    updateToolbar();
  }

  function enablePan(wrap) {
    let start = null;
    wrap.addEventListener("mousedown", event => {
      if (event.button !== 0 || event.target.closest(".ax-node, .ax-edge-btn, .ax-add-route, .ax-run-banner")) return;
      start = { x: event.clientX, y: event.clientY, left: wrap.scrollLeft, top: wrap.scrollTop };
      wrap.classList.add("panning");
    });
    window.addEventListener("mousemove", event => {
      if (!start) return;
      wrap.scrollLeft = start.left - (event.clientX - start.x);
      wrap.scrollTop = start.top - (event.clientY - start.y);
    });
    window.addEventListener("mouseup", () => {
      start = null;
      wrap.classList.remove("panning");
    });
  }

  // ---------- Structure du scénario ----------

  function allModules(scenario = state.editor.scenario) {
    const list = [];
    const walk = chain => (chain || []).forEach(module => {
      list.push(module);
      if (module.routes) module.routes.forEach(walk);
    });
    if (scenario.trigger) list.push(scenario.trigger);
    walk(scenario.modules);
    return list;
  }

  function nextModuleId() {
    return allModules().reduce((max, module) => Math.max(max, Number(module.id) || 0), 0) + 1;
  }

  function findModule(id) {
    const scenario = state.editor.scenario;
    if (scenario.trigger?.id === id) return { module: scenario.trigger, chain: null, index: -1, isTrigger: true };
    let found = null;
    const walk = chain => {
      (chain || []).forEach((module, index) => {
        if (found) return;
        if (module.id === id) found = { module, chain, index, isTrigger: false };
        else if (module.routes) module.routes.forEach(walk);
      });
    };
    walk(scenario.modules);
    return found;
  }

  function getChain(key) {
    const scenario = state.editor.scenario;
    if (key === "root") return scenario.modules;
    const [routerId, routeIndex] = key.split(":").map(Number);
    return findModule(routerId)?.module.routes?.[routeIndex] || null;
  }

  function ancestorsOf(id) {
    const scenario = state.editor.scenario;
    if (!scenario.trigger || scenario.trigger.id === id) return [];
    let result = null;
    const walk = (chain, before) => {
      for (let i = 0; i < chain.length && !result; i++) {
        const module = chain[i];
        if (module.id === id) { result = before.concat(chain.slice(0, i)); return; }
        if (module.routes) {
          module.routes.forEach(route => {
            if (!result) walk(route, before.concat(chain.slice(0, i + 1)));
          });
        }
      }
    };
    walk(scenario.modules || [], [scenario.trigger]);
    return (result || []).filter(module => !isRouter(module));
  }

  // ---------- Dessin du canevas ----------

  function drawCanvas() {
    const editor = state.editor;
    if (!editor) return;
    const canvas = $main().querySelector("[data-canvas]");
    if (!canvas) return;

    const scenario = editor.scenario;
    const nodes = [];
    const edges = [];
    const logs = editor.lastRun?.logs || {};

    const startPos = { x: ORIGIN_X, y: ORIGIN_Y };
    if (scenario.trigger) {
      nodes.push({ type: "module", module: scenario.trigger, x: startPos.x, y: startPos.y, isTrigger: true });
    } else {
      nodes.push({ type: "start", x: startPos.x, y: startPos.y });
    }

    function layout(chain, x, y, key, prev) {
      for (let i = 0; i < chain.length; i++) {
        const module = chain[i];
        nodes.push({ type: "module", module, x, y, chainKey: key, index: i });
        if (prev) edges.push({ from: prev, to: { x, y }, module, chainKey: key, index: i });
        prev = { x, y };

        if (isRouter(module)) {
          let routeY = y;
          let height = 0;
          (module.routes || []).forEach((route, routeIndex) => {
            const h = layout(route, x + GAP_X, routeY, `${module.id}:${routeIndex}`, { x, y });
            routeY += h;
            height += h;
          });
          nodes.push({ type: "addRoute", routerId: module.id, x, y });
          return Math.max(height, ROW_H);
        }
        x += GAP_X;
      }

      if (scenario.trigger || chain.length || key !== "root") {
        nodes.push({ type: "add", x, y, chainKey: key, index: chain.length });
        if (prev) edges.push({ from: prev, to: { x, y }, add: true });
      }
      return ROW_H;
    }

    layout(scenario.modules || [], startPos.x + GAP_X, startPos.y, "root", startPos);

    const width = Math.max(...nodes.map(n => n.x)) + 260;
    const height = Math.max(...nodes.map(n => n.y)) + 220;
    const zoom = editor.zoom;

    canvas.style.width = `${width * zoom}px`;
    canvas.style.height = `${height * zoom}px`;
    canvas.innerHTML = `
      <div class="ax-canvas-inner" style="width:${width}px;height:${height}px;transform:scale(${zoom})">
        <svg class="ax-edges" width="${width}" height="${height}">
          ${edges.map(edge => {
            const x1 = edge.from.x + NODE / 2 + 4, y1 = edge.from.y;
            const x2 = edge.to.x - (edge.add ? 24 : NODE / 2 + 4), y2 = edge.to.y;
            const c = Math.max(40, (x2 - x1) / 2);
            return `<path d="M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}" class="${edge.add ? "add" : ""}"/>`;
          }).join("")}
        </svg>
      </div>`;

    const inner = canvas.firstElementChild;

    // Boutons de filtre sur les liens
    edges.filter(edge => !edge.add).forEach(edge => {
      const x1 = edge.from.x + NODE / 2, x2 = edge.to.x - NODE / 2;
      const mx = (x1 + x2) / 2;
      const my = (edge.from.y + edge.to.y) / 2 + (edge.from.y === edge.to.y ? 0 : 0);
      const filter = edge.module.filter;
      const hasFilter = filter && filter.groups?.some(g => g.length);
      const button = el(`
        <button type="button" class="ax-edge-btn ${hasFilter ? "on" : ""}" style="left:${mx}px;top:${my}px" title="${hasFilter ? esc(filter.label || "Filtre") : "Filtre / insérer un module"}">
          <svg viewBox="0 0 24 24"><path d="M3 4h18l-7 8v6l-4 2v-8z"/></svg>
        </button>`);
      if (hasFilter && filter.label) {
        inner.appendChild(el(`<span class="ax-edge-label" style="left:${mx}px;top:${my - 30}px">${esc(filter.label)}</span>`));
      }
      button.addEventListener("click", event => {
        event.stopPropagation();
        openEdgeMenu(button, edge);
      });
      inner.appendChild(button);
    });

    nodes.forEach(node => {
      if (node.type === "start") {
        const start = el(`
          <div class="ax-node start" style="left:${node.x - NODE / 2}px;top:${node.y - NODE / 2}px">
            <button type="button" class="ax-node-bubble">＋</button>
            <div class="ax-node-label"><strong>Choisis un déclencheur</strong><small>Ce qui lance le scénario</small></div>
          </div>`);
        start.querySelector("button").addEventListener("click", () => openAppPicker({ mode: "trigger" }));
        inner.appendChild(start);
      }

      if (node.type === "add") {
        const add = el(`
          <button type="button" class="ax-add" style="left:${node.x - 22}px;top:${node.y - 22}px" title="Ajouter un module">＋</button>`);
        add.addEventListener("click", () => openAppPicker({ mode: "action", chainKey: node.chainKey, index: node.index }));
        inner.appendChild(add);
      }

      if (node.type === "addRoute") {
        const button = el(`<button type="button" class="ax-add-route" style="left:${node.x - 46}px;top:${node.y + NODE / 2 + 44}px">＋ Ajouter une route</button>`);
        button.addEventListener("click", () => {
          findModule(node.routerId).module.routes.push([]);
          markDirty();
          drawCanvas();
        });
        inner.appendChild(button);
      }

      if (node.type === "module") {
        const module = node.module;
        const app = state.appsById[module.app];
        const def = moduleDef(module);
        const log = logs[module.id];
        const badge = log
          ? `<button type="button" class="ax-node-badge ${log.errors ? "ko" : "ok"}" title="Voir les données traitées">${log.count}${log.filtered && !log.count ? "⊘" : ""}</button>`
          : "";
        const needsSetup = def && def.fields.some(field => field.required && field.type !== "hook" && (module.params?.[field.key] === undefined || module.params[field.key] === "" || (Array.isArray(module.params[field.key]) && !module.params[field.key].length)));

        const item = el(`
          <div class="ax-node ${node.isTrigger ? "trigger" : ""} ${isRouter(module) ? "router" : ""} ${state.editor.openModuleId === module.id ? "selected" : ""} ${state.editor.running ? "pulse" : ""}"
               style="left:${node.x - NODE / 2}px;top:${node.y - NODE / 2}px;--app:${esc(app?.color || "#999")}" data-id="${module.id}">
            <button type="button" class="ax-node-bubble" aria-label="Configurer ${esc(def?.name || module.module)}">${esc(app?.icon || "?")}</button>
            <span class="ax-node-num">${module.id}</span>
            ${node.isTrigger && (def?.polling || def?.instant) ? `<span class="ax-node-clock" title="${def.instant ? "Déclencheur instantané" : "Déclencheur planifié"}">${def.instant ? "⚡" : "⏱"}</span>` : ""}
            ${needsSetup ? `<span class="ax-node-warn" title="Champs obligatoires à remplir">!</span>` : ""}
            ${badge}
            <div class="ax-node-label">
              <strong>${esc(module.label || app?.name || module.app)}</strong>
              <small>${esc(def?.name || module.module)}</small>
            </div>
          </div>`);

        item.querySelector(".ax-node-bubble").addEventListener("click", () => {
          if (isRouter(module)) openRouterDrawer(module);
          else openModuleDrawer(module.id);
        });
        item.querySelector(".ax-node-badge")?.addEventListener("click", event => {
          event.stopPropagation();
          openModuleLog(module);
        });
        inner.appendChild(item);
      }
    });

    if (editor.lastRun?.error) {
      showBanner(editor.lastRun);
    }
  }

  function showBanner(run) {
    const banner = $main().querySelector("[data-banner]");
    if (!banner) return;
    if (!run || run.status === "success") { banner.hidden = true; return; }
    banner.hidden = false;
    banner.className = `ax-run-banner ${run.status}`;
    banner.innerHTML = `<strong>${run.status === "error" ? "Le scénario s'est arrêté" : "Exécution terminée avec des erreurs ignorées"}</strong><span>${esc(run.error || "Certaines opérations ont échoué mais l'option « Ignorer les erreurs » était active.")}</span><button type="button" class="ax-icon-btn" aria-label="Fermer">✕</button>`;
    banner.querySelector("button").addEventListener("click", () => { banner.hidden = true; });
  }

  function openEdgeMenu(anchor, edge) {
    document.querySelectorAll(".ax-popover").forEach(p => p.remove());
    const rect = anchor.getBoundingClientRect();
    const menu = el(`
      <div class="ax-popover" style="left:${rect.left + rect.width / 2}px;top:${rect.bottom + 8}px">
        <button type="button" data-filter>⧩ ${edge.module.filter ? "Modifier le filtre" : "Configurer un filtre"}</button>
        <button type="button" data-insert>＋ Insérer un module ici</button>
        ${edge.module.filter ? `<button type="button" data-remove class="danger">Supprimer le filtre</button>` : ""}
      </div>`);
    document.getElementById("automations-view").appendChild(menu);

    const close = () => { menu.remove(); window.removeEventListener("mousedown", outside, true); };
    const outside = event => { if (!menu.contains(event.target)) close(); };
    setTimeout(() => window.addEventListener("mousedown", outside, true), 0);

    menu.querySelector("[data-filter]").addEventListener("click", () => { close(); openFilterModal(edge.module); });
    menu.querySelector("[data-insert]").addEventListener("click", () => {
      close();
      openAppPicker({ mode: "action", chainKey: edge.chainKey, index: edge.index });
    });
    menu.querySelector("[data-remove]")?.addEventListener("click", () => {
      close();
      edge.module.filter = null;
      markDirty();
      drawCanvas();
    });
  }

  // ---------- Sélecteur d'application ----------

  function openAppPicker({ mode, chainKey, index }) {
    const wantTrigger = mode === "trigger";
    const apps = state.apps
      .map(app => ({
        ...app,
        modules: app.modules.filter(module => (wantTrigger ? module.kind === "trigger" : module.kind !== "trigger"))
      }))
      .filter(app => app.modules.length);

    const body = el(`
      <div class="ax-picker">
        <input type="search" class="ax-search" placeholder="Rechercher une application ou un module…" autofocus>
        <div class="ax-picker-content"></div>
      </div>`);
    const content = body.querySelector(".ax-picker-content");
    const search = body.querySelector("input");

    const modal = openModal({
      title: wantTrigger ? "Choisis le déclencheur du scénario" : "Ajouter un module",
      body,
      wide: true
    });

    function drawApps(query = "") {
      const q = query.trim().toLowerCase();
      const matchingModules = q
        ? apps.flatMap(app => app.modules
            .filter(module => (`${app.name} ${module.name} ${module.description}`).toLowerCase().includes(q))
            .map(module => ({ app, module })))
        : [];

      if (q) {
        content.innerHTML = matchingModules.length
          ? `<div class="ax-module-list">${matchingModules.map(({ app, module }, i) => moduleItem(app, module, i)).join("")}</div>`
          : `<p class="ax-muted">Aucun résultat. Le module <strong>HTTP › Faire une requête</strong> permet de se connecter à n'importe quelle API.</p>`;
        content.querySelectorAll("[data-pick]").forEach(button => {
          const { app, module } = matchingModules[Number(button.dataset.pick)];
          button.addEventListener("click", () => pick(app, module));
        });
        return;
      }

      const categories = [...new Set(apps.map(app => app.category))];
      content.innerHTML = categories.map(category => `
        <div class="ax-picker-cat">${esc(category)}</div>
        <div class="ax-app-grid">
          ${apps.filter(app => app.category === category).map(app => `
            <button type="button" class="ax-app-tile" data-app="${esc(app.id)}">
              ${appIcon(app.id, "lg")}
              <span>${esc(app.name)}</span>
            </button>`).join("")}
        </div>`).join("");

      content.querySelectorAll("[data-app]").forEach(button => {
        button.addEventListener("click", () => drawModules(apps.find(a => a.id === button.dataset.app)));
      });
    }

    function moduleItem(app, module, i) {
      const kinds = { trigger: "Déclencheur", action: "Action", search: "Recherche", router: "Contrôle du flux" };
      return `
        <button type="button" class="ax-module-item" data-pick="${i}">
          ${appIcon(app.id)}
          <span>
            <strong>${esc(module.name)}</strong>
            <small>${esc(app.name)} · ${esc(kinds[module.kind] || module.kind)}${module.instant ? " · instantané" : ""}</small>
            ${module.description ? `<em>${esc(module.description)}</em>` : ""}
          </span>
        </button>`;
    }

    function drawModules(app) {
      content.innerHTML = `
        <button type="button" class="ax-link" data-back>← Toutes les applications</button>
        <div class="ax-picker-app">${appIcon(app.id, "lg")}<div><strong>${esc(app.name)}</strong><p class="ax-muted">${esc(app.description)}</p></div></div>
        <div class="ax-module-list">${app.modules.map((module, i) => moduleItem(app, module, i)).join("")}</div>`;
      content.querySelector("[data-back]").addEventListener("click", () => drawApps(search.value));
      content.querySelectorAll("[data-pick]").forEach(button => {
        button.addEventListener("click", () => pick(app, app.modules[Number(button.dataset.pick)]));
      });
    }

    async function pick(app, module) {
      const created = await buildModule(app.id, module);
      if (!created) return;
      modal.close();

      const scenario = state.editor.scenario;
      if (wantTrigger) {
        scenario.trigger = created;
        if (app.id === "webhooks") scenario.schedule = { type: "instant" };
        else if (!scenario.schedule || scenario.schedule.type === "instant") scenario.schedule = { type: "interval", minutes: 15, time: "09:00", days: [1, 2, 3, 4, 5] };
      } else {
        const chain = getChain(chainKey);
        if (!chain) return;
        if (isRouter(created)) {
          const rest = chain.splice(index);
          created.routes = [rest, []];
          chain.push(created);
        } else {
          chain.splice(index, 0, created);
        }
      }

      markDirty();
      drawCanvas();
      updateToolbar();
      if (!isRouter(created)) openModuleDrawer(created.id);
    }

    search.addEventListener("input", () => drawApps(search.value));
    drawApps();
    setTimeout(() => search.focus(), 50);
  }

  async function buildModule(appId, def) {
    const module = { id: nextModuleId(), app: appId, module: def.id, params: {}, filter: null, onError: "stop" };

    for (const field of def.fields) {
      if (field.type === "keyvalue") module.params[field.key] = [];
      else if (field.type === "boolean") module.params[field.key] = Boolean(field.default);
      else if (field.type === "connection") {
        const options = state.connections.filter(c => c.app === appId);
        module.params[field.key] = options.length === 1 ? options[0].id : "";
      } else if (field.type === "hook") {
        try {
          module.params[field.key] = (await api("/new-hook-id")).hookId;
        } catch (error) {
          notify(error.message, "error");
          return null;
        }
      } else if (field.default !== undefined) module.params[field.key] = field.default;
      else module.params[field.key] = "";
    }

    if (isRouter(module)) module.routes = [[], []];
    return module;
  }

  function cloneModule(module) {
    const copy = JSON.parse(JSON.stringify(module));
    let id = nextModuleId();
    const renumber = item => {
      item.id = id++;
      (item.routes || []).forEach(route => route.forEach(renumber));
    };
    renumber(copy);
    return copy;
  }

  // ---------- Panneau de configuration d'un module ----------

  function closeDrawer() {
    document.querySelector("#automations-view .ax-drawer")?.remove();
    hideMapper();
    if (state.editor) {
      state.editor.openModuleId = null;
      drawCanvas();
    }
  }

  function openRouterDrawer(module) {
    closeDrawer();
    state.editor.openModuleId = module.id;
    const drawer = el(`
      <aside class="ax-drawer" style="--app:${esc(state.appsById.flow.color)}">
        <div class="ax-drawer-head">
          ${appIcon("flow")}
          <div><strong>Routeur</strong><small>Module ${module.id} · ${module.routes.length} route(s)</small></div>
          <button type="button" class="ax-icon-btn" data-close aria-label="Fermer">✕</button>
        </div>
        <div class="ax-drawer-body">
          <p class="ax-muted">Le routeur envoie chaque paquet de données dans toutes ses routes, l'une après l'autre. Pour choisir quelle route s'exécute, ajoute un <strong>filtre</strong> sur le lien de départ de chaque route (l'icône en entonnoir).</p>
          <div class="ax-route-list">
            ${module.routes.map((route, i) => `
              <div class="ax-route-item">
                <span>Route ${i + 1} — ${route.length} module(s)</span>
                <button type="button" class="ax-icon-btn danger" data-del-route="${i}" title="Supprimer la route">🗑</button>
              </div>`).join("")}
          </div>
          <button type="button" class="ax-btn" data-add-route>＋ Ajouter une route</button>
        </div>
        <div class="ax-drawer-foot">
          <button type="button" class="ax-btn danger" data-delete>Supprimer le routeur</button>
          <button type="button" class="ax-btn primary" data-ok>OK</button>
        </div>
      </aside>`);

    drawer.querySelector("[data-close]").addEventListener("click", closeDrawer);
    drawer.querySelector("[data-ok]").addEventListener("click", closeDrawer);
    drawer.querySelector("[data-add-route]").addEventListener("click", () => {
      module.routes.push([]);
      markDirty();
      openRouterDrawer(module);
    });
    drawer.querySelectorAll("[data-del-route]").forEach(button => {
      button.addEventListener("click", async () => {
        const i = Number(button.dataset.delRoute);
        if (module.routes[i].length && !(await confirmModal("Supprimer la route", `La route ${i + 1} contient ${module.routes[i].length} module(s). Les supprimer ?`, "Supprimer"))) return;
        module.routes.splice(i, 1);
        markDirty();
        openRouterDrawer(module);
      });
    });
    drawer.querySelector("[data-delete]").addEventListener("click", () => deleteModule(module.id));

    $main().querySelector(".ax-editor").appendChild(drawer);
    drawCanvas();
  }

  function openModuleDrawer(id) {
    closeDrawer();
    const found = findModule(id);
    if (!found) return;
    const { module, isTrigger } = found;
    const app = state.appsById[module.app];
    const def = moduleDef(module);
    state.editor.openModuleId = id;

    const drawer = el(`
      <aside class="ax-drawer" style="--app:${esc(app.color)}">
        <div class="ax-drawer-head">
          ${appIcon(app.id)}
          <div><strong>${esc(app.name)}</strong><small>${esc(def.name)} · module ${module.id}</small></div>
          <button type="button" class="ax-icon-btn" data-close aria-label="Fermer">✕</button>
        </div>
        <div class="ax-drawer-body"></div>
        <div class="ax-drawer-foot">
          <button type="button" class="ax-btn danger" data-delete>Supprimer</button>
          ${!isTrigger ? `<button type="button" class="ax-btn" data-clone>Dupliquer</button>` : ""}
          <button type="button" class="ax-btn primary" data-ok>OK</button>
        </div>
      </aside>`);

    const bodyEl = drawer.querySelector(".ax-drawer-body");
    renderFields(bodyEl, module, def, isTrigger);

    drawer.querySelector("[data-close]").addEventListener("click", closeDrawer);
    drawer.querySelector("[data-ok]").addEventListener("click", closeDrawer);
    drawer.querySelector("[data-delete]").addEventListener("click", () => deleteModule(module.id));
    drawer.querySelector("[data-clone]")?.addEventListener("click", () => {
      const copy = cloneModule(module);
      found.chain.splice(found.index + 1, 0, copy);
      markDirty();
      openModuleDrawer(copy.id);
      notify("Module dupliqué", "success");
    });

    $main().querySelector(".ax-editor").appendChild(drawer);
    drawCanvas();
  }

  function renderFields(container, module, def, isTrigger) {
    module.params = module.params || {};
    container.innerHTML = "";

    if (def.description) container.appendChild(el(`<p class="ax-muted ax-desc">${esc(def.description)}</p>`));

    const labelField = el(`
      <label class="ax-field">
        <span>Nom affiché sur le canevas (optionnel)</span>
        <input type="text" value="${esc(module.label || "")}" placeholder="${esc(state.appsById[module.app].name)}">
      </label>`);
    labelField.querySelector("input").addEventListener("input", event => {
      module.label = event.target.value;
      markDirty();
      drawCanvas();
    });
    container.appendChild(labelField);

    def.fields.forEach(field => container.appendChild(renderField(field, module, () => renderFields(container, module, def, isTrigger))));

    if (!isTrigger) {
      const ancestors = ancestorsOf(module.id);
      if (ancestors.length) {
        container.appendChild(el(`<p class="ax-help">💡 Clique dans un champ : un panneau s'ouvre avec les données des modules précédents. Un clic insère par exemple <code>{{${ancestors[0].id}.nom_du_champ}}</code>, qui sera remplacé par la vraie valeur à chaque exécution.</p>`));
      }

      const errorField = el(`
        <label class="ax-field">
          <span>En cas d'erreur</span>
          <select>
            <option value="stop">Arrêter le scénario</option>
            <option value="ignore">Ignorer l'erreur et continuer avec le paquet suivant</option>
          </select>
        </label>`);
      errorField.querySelector("select").value = module.onError || "stop";
      errorField.querySelector("select").addEventListener("change", event => {
        module.onError = event.target.value;
        markDirty();
      });
      container.appendChild(errorField);
    }

    if (isTrigger && def.polling) {
      container.appendChild(el(`<p class="ax-help">⏱ Ce déclencheur vérifie s'il y a du nouveau à chaque exécution. Règle la fréquence avec le bouton de planification en bas, puis passe le scénario sur ON.</p>`));
    }
  }

  function renderField(field, module, rerender) {
    const value = module.params[field.key];
    const req = field.required ? " *" : "";
    const set = newValue => {
      module.params[field.key] = newValue;
      markDirty();
    };

    if (field.type === "hook") {
      const hookId = value;
      const hook = state.hooks.find(h => h.hookId === hookId);
      const url = hookUrl(hookId);
      const wrapper = el(`
        <div class="ax-field">
          <span>${esc(field.label)}</span>
          <div class="ax-hook-box">
            <code class="ax-url">${esc(url)}</code>
            <div class="ax-hook-actions">
              <button type="button" class="ax-btn" data-copy>Copier l'URL</button>
              <button type="button" class="ax-btn" data-check>↻ Vérifier les données reçues</button>
            </div>
            <p class="${hook?.receivedAt ? "ax-ok" : "ax-muted"}">${hook?.receivedAt ? `✔ Données reçues le ${esc(formatDate(hook.receivedAt))} — leurs champs sont disponibles pour les modules suivants.` : "En attente de données… Enregistre le scénario, puis envoie une requête à cette URL."}</p>
            <details>
              <summary>Tester avec une commande</summary>
              <pre class="ax-json">curl -X POST "${esc(url)}" -H "Content-Type: application/json" -d "{\\"name\\":\\"Léa\\",\\"email\\":\\"lea@exemple.fr\\",\\"message\\":\\"Bonjour\\"}"</pre>
            </details>
          </div>
        </div>`);
      wrapper.querySelector("[data-copy]").addEventListener("click", () => copyText(url));
      wrapper.querySelector("[data-check]").addEventListener("click", async () => {
        if (state.editor.dirty) await saveScenario(true);
        state.hooks = await api("/hooks");
        rerender();
        drawCanvas();
      });
      return wrapper;
    }

    if (field.type === "connection") {
      const options = state.connections.filter(c => c.app === module.app);
      const wrapper = el(`
        <label class="ax-field">
          <span>${esc(field.label)}${req}</span>
          <div class="ax-inline">
            <select>
              <option value="">${options.length ? "— Choisis une connexion —" : "— Aucune connexion —"}</option>
              ${options.map(c => `<option value="${esc(c.id)}" ${c.id === value ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
            </select>
            <button type="button" class="ax-btn">Ajouter</button>
          </div>
        </label>`);
      wrapper.querySelector("select").addEventListener("change", event => { set(event.target.value); drawCanvas(); });
      wrapper.querySelector("button").addEventListener("click", event => {
        event.preventDefault();
        openConnectionModal(module.app, connection => {
          set(connection.id);
          rerender();
          drawCanvas();
        });
      });
      return wrapper;
    }

    if (field.type === "select") {
      const wrapper = el(`
        <label class="ax-field">
          <span>${esc(field.label)}${req}</span>
          <select>${field.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select>
        </label>`);
      const select = wrapper.querySelector("select");
      select.value = value ?? field.default ?? "";
      select.addEventListener("change", () => set(select.value));
      return wrapper;
    }

    if (field.type === "boolean") {
      const wrapper = el(`
        <div class="ax-field ax-bool">
          <span>${esc(field.label)}</span>
          <label class="ax-switch"><input type="checkbox" ${value ? "checked" : ""}><span></span></label>
        </div>`);
      wrapper.querySelector("input").addEventListener("change", event => set(event.target.checked));
      if (field.help) wrapper.appendChild(el(`<small class="ax-field-help">${esc(field.help)}</small>`));
      return wrapper;
    }

    if (field.type === "keyvalue") {
      const pairs = Array.isArray(value) ? value : [];
      if (!Array.isArray(value)) module.params[field.key] = pairs;
      const wrapper = el(`
        <div class="ax-field">
          <span>${esc(field.label)}${req}</span>
          <div class="ax-kv"></div>
          <button type="button" class="ax-link" data-add>＋ Ajouter un élément</button>
          ${field.help ? `<small class="ax-field-help">${esc(field.help)}</small>` : ""}
        </div>`);
      const list = wrapper.querySelector(".ax-kv");
      pairs.forEach((pair, i) => {
        const row = el(`
          <div class="ax-kv-row">
            <input type="text" placeholder="Nom" value="${esc(pair.key || "")}" data-k>
            <input type="text" placeholder="Valeur" value="${esc(typeof pair.value === "string" ? pair.value : JSON.stringify(pair.value ?? ""))}" class="ax-map" data-v>
            <button type="button" class="ax-icon-btn danger" title="Retirer">✕</button>
          </div>`);
        row.querySelector("[data-k]").addEventListener("input", event => { pair.key = event.target.value; markDirty(); });
        row.querySelector("[data-v]").addEventListener("input", event => { pair.value = event.target.value; markDirty(); });
        attachMapper(row.querySelector("[data-v]"), module.id);
        row.querySelector("button").addEventListener("click", () => {
          pairs.splice(i, 1);
          markDirty();
          rerender();
        });
        list.appendChild(row);
      });
      wrapper.querySelector("[data-add]").addEventListener("click", () => {
        pairs.push({ key: "", value: "" });
        set(pairs);
        rerender();
      });
      return wrapper;
    }

    const multiline = field.type === "textarea";
    const wrapper = el(`
      <label class="ax-field">
        <span>${esc(field.label)}${req}</span>
        ${multiline
          ? `<textarea rows="4" class="ax-map" placeholder="${esc(field.placeholder || "")}"></textarea>`
          : `<input type="text" class="ax-map" ${field.type === "number" ? "inputmode=\"decimal\"" : ""} placeholder="${esc(field.placeholder || "")}">`}
        ${field.help ? `<small class="ax-field-help">${esc(field.help)}</small>` : ""}
      </label>`);
    const input = wrapper.querySelector(".ax-map");
    input.value = value === undefined || value === null ? "" : (typeof value === "object" ? JSON.stringify(value) : String(value));
    input.addEventListener("input", () => {
      set(field.type === "number" && /^-?\d+(\.\d+)?$/.test(input.value.trim()) ? Number(input.value) : input.value);
    });
    attachMapper(input, module.id);
    return wrapper;
  }

  async function deleteModule(id) {
    const found = findModule(id);
    if (!found) return;
    const { module, isTrigger } = found;
    const def = moduleDef(module);

    if (isRouter(module)) {
      const count = module.routes.reduce((n, route) => n + route.length, 0);
      if (count && !(await confirmModal("Supprimer le routeur", `Le routeur et ses ${count} module(s) seront supprimés.`, "Supprimer"))) return;
    }

    if (isTrigger) {
      state.editor.scenario.trigger = null;
      state.editor.scenario.active = false;
    } else {
      found.chain.splice(found.index, 1);
    }

    markDirty();
    closeDrawer();
    updateToolbar();
    notify(`Module « ${def?.name || module.module} » supprimé`, "success");
  }

  // ---------- Panneau de mapping ----------

  let mapperTarget = null;
  let mapperModuleId = null;

  function attachMapper(input, moduleId) {
    input.addEventListener("focus", () => showMapper(input, moduleId));
  }

  function sampleFor(module) {
    const log = state.editor.lastRun?.logs?.[module.id];
    const output = log?.operations?.find(op => Array.isArray(op.output) && op.output.length)?.output?.[0];
    if (output && typeof output === "object") return output;
    if (module.app === "webhooks" && module.module === "customWebhook") {
      return state.hooks.find(h => h.hookId === module.params?.hookId)?.sample || null;
    }
    return null;
  }

  function flatten(object, prefix = "", depth = 0, out = []) {
    if (!object || typeof object !== "object" || Array.isArray(object)) return out;
    Object.keys(object).slice(0, 80).forEach(key => {
      const value = object[key];
      const pathText = prefix ? `${prefix}.${key}` : key;
      let preview;
      if (Array.isArray(value)) preview = `[${value.length} élément(s)]`;
      else if (value && typeof value === "object") preview = "{…}";
      else preview = String(value ?? "").slice(0, 60);
      out.push({ path: pathText, label: key, preview, depth });
      if (value && typeof value === "object" && !Array.isArray(value) && depth < 2) flatten(value, pathText, depth + 1, out);
    });
    return out;
  }

  function showMapper(input, moduleId) {
    mapperTarget = input;
    mapperModuleId = moduleId;
    const ancestors = ancestorsOf(moduleId);

    let panel = document.querySelector("#automations-view .ax-mapper");
    if (!panel) {
      panel = el(`
        <div class="ax-mapper">
          <div class="ax-mapper-tabs">
            <button type="button" data-tab="data" class="active">Données</button>
            <button type="button" data-tab="fn">Fonctions</button>
            <button type="button" class="ax-icon-btn" data-close aria-label="Fermer">✕</button>
          </div>
          <div class="ax-mapper-body"></div>
        </div>`);
      panel.addEventListener("mousedown", event => {
        if (!event.target.closest("[data-close]")) event.preventDefault();
      });
      panel.querySelector("[data-close]").addEventListener("click", hideMapper);
      panel.querySelectorAll("[data-tab]").forEach(tab => {
        tab.addEventListener("click", () => {
          panel.querySelectorAll("[data-tab]").forEach(t => t.classList.toggle("active", t === tab));
          drawMapper(panel, tab.dataset.tab);
        });
      });
      document.getElementById("automations-view").appendChild(panel);
    }
    panel.dataset.ancestors = ancestors.map(a => a.id).join(",");
    const active = panel.querySelector("[data-tab].active")?.dataset.tab || "data";
    drawMapper(panel, active);
  }

  function drawMapper(panel, tab) {
    const body = panel.querySelector(".ax-mapper-body");
    const ancestors = ancestorsOf(mapperModuleId);

    if (tab === "fn") {
      body.innerHTML = `
        <p class="ax-help">Une fonction transforme une donnée. Exemple : <code>{{upper(1.subject)}}</code> met l'objet en majuscules. Les arguments se séparent par <code>;</code>.</p>
        ${FUNCTIONS.map(([signature, description]) => `
          <button type="button" class="ax-chip fn" data-insert="${esc(signature === "now" ? "{{now}}" : `{{${signature.split("(")[0]}()}}`)}">
            <strong>${esc(signature)}</strong><small>${esc(description)}</small>
          </button>`).join("")}`;
    } else if (!ancestors.length) {
      body.innerHTML = `<p class="ax-muted">Aucun module avant celui-ci : il n'y a pas encore de données à insérer.</p>`;
    } else {
      body.innerHTML = ancestors.map(module => {
        const app = state.appsById[module.app];
        const def = moduleDef(module);
        const sample = sampleFor(module);
        const items = sample
          ? flatten(sample)
          : (def?.outputs || []).map(o => ({ path: o.key, label: o.label, preview: "", depth: 0 }));
        return `
          <div class="ax-mapper-group">
            <div class="ax-mapper-title" style="--app:${esc(app?.color)}">${appIcon(module.app, "sm")} ${module.id}. ${esc(module.label || app?.name)} <small>${esc(def?.name || "")}</small></div>
            ${items.length ? items.map(item => `
              <button type="button" class="ax-chip" style="--app:${esc(app?.color)};margin-left:${item.depth * 12}px" data-insert="{{${module.id}.${esc(item.path)}}}" title="{{${module.id}.${esc(item.path)}}}">
                <strong>${esc(item.label)}</strong>${item.preview ? `<small>${esc(item.preview)}</small>` : ""}
              </button>`).join("") : `<p class="ax-muted small">${sample === null ? "Exécute le scénario une fois pour voir les champs disponibles." : "Aucun champ."}</p>`}
            ${!sample && items.length ? `<p class="ax-muted small">Champs prévus. Exécute le scénario une fois pour voir les vraies données.</p>` : ""}
          </div>`;
      }).join("");
    }

    body.querySelectorAll("[data-insert]").forEach(chip => {
      chip.addEventListener("click", () => insertIntoTarget(chip.dataset.insert));
    });
  }

  function insertIntoTarget(text) {
    const input = mapperTarget;
    if (!input || !input.isConnected) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(text, start, end, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  function hideMapper() {
    document.querySelector("#automations-view .ax-mapper")?.remove();
    mapperTarget = null;
  }

  document.addEventListener("focusin", event => {
    if (!document.querySelector("#automations-view .ax-mapper")) return;
    if (!event.target.closest?.(".ax-map, .ax-mapper")) hideMapper();
  });

  // ---------- Filtres ----------

  function openFilterModal(module) {
    const draft = JSON.parse(JSON.stringify(module.filter || { label: "", groups: [[{ a: "", op: "equals", b: "" }]] }));
    if (!draft.groups.length) draft.groups.push([{ a: "", op: "equals", b: "" }]);

    const body = el(`<div class="ax-filter"></div>`);

    function draw() {
      body.innerHTML = `
        <label class="ax-field"><span>Nom du filtre</span><input type="text" data-label value="${esc(draft.label || "")}" placeholder="ex. : Seulement les factures"></label>
        <p class="ax-help">Le module ${module.id} ne s'exécute que si les conditions sont remplies. Toutes les conditions d'un bloc doivent être vraies (ET) ; il suffit qu'un bloc soit vrai (OU).</p>
        <div data-groups></div>
        <button type="button" class="ax-btn" data-or>＋ Ajouter une règle OU</button>`;

      body.querySelector("[data-label]").addEventListener("input", event => { draft.label = event.target.value; });
      const groupsEl = body.querySelector("[data-groups]");

      draft.groups.forEach((group, gi) => {
        if (gi > 0) groupsEl.appendChild(el(`<div class="ax-or">OU</div>`));
        const box = el(`<div class="ax-filter-group"></div>`);
        group.forEach((condition, ci) => {
          const op = OPERATORS.find(o => o.value === condition.op) || OPERATORS[0];
          if (ci > 0) box.appendChild(el(`<div class="ax-and">ET</div>`));
          const row = el(`
            <div class="ax-condition">
              <input type="text" class="ax-map" data-a placeholder="Valeur à tester, ex. {{1.subject}}" value="${esc(condition.a || "")}">
              <select data-op>${OPERATORS.map(o => `<option value="${o.value}" ${o.value === op.value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>
              <input type="text" class="ax-map" data-b placeholder="Comparer avec…" value="${esc(condition.b || "")}" ${op.unary ? "hidden" : ""}>
              <button type="button" class="ax-icon-btn danger" title="Retirer">✕</button>
            </div>`);
          row.querySelector("[data-a]").addEventListener("input", event => { condition.a = event.target.value; });
          row.querySelector("[data-b]").addEventListener("input", event => { condition.b = event.target.value; });
          row.querySelector("[data-op]").addEventListener("change", event => { condition.op = event.target.value; draw(); });
          attachMapper(row.querySelector("[data-a]"), module.id);
          attachMapper(row.querySelector("[data-b]"), module.id);
          row.querySelector("button").addEventListener("click", () => {
            group.splice(ci, 1);
            if (!group.length) draft.groups.splice(gi, 1);
            if (!draft.groups.length) draft.groups.push([{ a: "", op: "equals", b: "" }]);
            draw();
          });
          box.appendChild(row);
        });
        const andButton = el(`<button type="button" class="ax-link">＋ Ajouter une condition ET</button>`);
        andButton.addEventListener("click", () => { group.push({ a: "", op: "equals", b: "" }); draw(); });
        box.appendChild(andButton);
        groupsEl.appendChild(box);
      });

      body.querySelector("[data-or]").addEventListener("click", () => {
        draft.groups.push([{ a: "", op: "equals", b: "" }]);
        draw();
      });
    }
    draw();

    openModal({
      title: `Filtre avant le module ${module.id}`,
      body,
      wide: true,
      className: "ax-filter-modal",
      actions: [
        ...(module.filter ? [{
          label: "Supprimer le filtre",
          className: "ax-btn danger",
          onClick: () => { module.filter = null; markDirty(); drawCanvas(); }
        }] : []),
        { label: "Annuler", className: "ax-btn" },
        {
          label: "OK",
          className: "ax-btn primary",
          onClick: () => {
            draft.groups = draft.groups
              .map(group => group.filter(c => String(c.a || "").trim()))
              .filter(group => group.length);
            module.filter = draft.groups.length ? draft : null;
            markDirty();
            drawCanvas();
          }
        }
      ]
    });
  }

  // ---------- Journal d'un module ----------

  function openModuleLog(module) {
    const log = state.editor.lastRun?.logs?.[module.id];
    if (!log) return;
    const app = state.appsById[module.app];
    const def = moduleDef(module);
    const body = el(`<div>
      <p class="ax-muted">${log.count} opération(s)${log.filtered ? ` · ${log.filtered} paquet(s) arrêté(s) par le filtre` : ""}${log.errors ? ` · ${log.errors} erreur(s)` : ""}${log.operations.length < log.count + log.filtered ? ` · seules les ${log.operations.length} premières sont affichées` : ""}</p>
      ${log.operations.map((op, i) => `
        <details class="ax-log" ${i === 0 ? "open" : ""}>
          <summary><strong>Opération ${i + 1}</strong> ${op.filtered ? `<span class="ax-muted">— arrêtée par le filtre</span>` : ""}${op.error ? ` <span class="ko">— erreur</span>` : ""}</summary>
          ${op.error ? `<div class="ax-error-box">${esc(op.error)}</div>` : ""}
          ${op.input !== undefined && op.input !== null ? `<div class="ax-op-label">Entrée (paramètres utilisés)</div>${jsonViewer(op.input)}` : ""}
          ${op.output !== undefined && op.output !== null ? `<div class="ax-op-label">Sortie (paquets produits)</div>${jsonViewer(op.output)}` : ""}
        </details>`).join("")}
    </div>`);
    openModal({ title: `${module.id}. ${app?.name} – ${def?.name}`, body, wide: true });
  }

  // ---------- Planification ----------

  function openScheduleModal() {
    const scenario = state.editor.scenario;
    if (scenario.trigger?.app === "webhooks") return;
    const draft = { type: "interval", minutes: 15, time: "09:00", days: [1, 2, 3, 4, 5], ...(scenario.schedule || {}) };
    if (draft.type === "instant") draft.type = "interval";

    const body = el(`<div class="ax-form"></div>`);
    function draw() {
      body.innerHTML = `
        <label class="ax-field">
          <span>Exécuter le scénario</span>
          <select data-type>
            <option value="interval">À intervalles réguliers</option>
            <option value="daily">Tous les jours</option>
            <option value="weekly">Certains jours de la semaine</option>
            <option value="manual">À la demande uniquement</option>
          </select>
        </label>
        ${draft.type === "interval" ? `
          <label class="ax-field"><span>Toutes les (minutes)</span><input type="number" min="1" max="10080" data-minutes value="${esc(draft.minutes)}"></label>` : ""}
        ${draft.type === "weekly" ? `
          <div class="ax-field"><span>Jours</span><div class="ax-days">${[1, 2, 3, 4, 5, 6, 0].map(d => `
            <label><input type="checkbox" value="${d}" ${draft.days.includes(d) ? "checked" : ""}> ${DAYS[d]}</label>`).join("")}</div></div>` : ""}
        ${draft.type === "daily" || draft.type === "weekly" ? `
          <label class="ax-field"><span>Heure</span><input type="time" data-time value="${esc(draft.time)}"></label>` : ""}
        <p class="ax-help">${draft.type === "manual" ? "Le scénario ne tournera que lorsque tu cliqueras sur « Exécuter une fois »." : "La planification ne fonctionne que si le scénario est sur ON et que le serveur tourne."}</p>`;

      body.querySelector("[data-type]").value = draft.type;
      body.querySelector("[data-type]").addEventListener("change", event => { draft.type = event.target.value; draw(); });
      body.querySelector("[data-minutes]")?.addEventListener("input", event => { draft.minutes = Number(event.target.value); });
      body.querySelector("[data-time]")?.addEventListener("input", event => { draft.time = event.target.value; });
      body.querySelectorAll(".ax-days input").forEach(box => box.addEventListener("change", () => {
        draft.days = [...body.querySelectorAll(".ax-days input:checked")].map(b => Number(b.value));
      }));
    }
    draw();

    openModal({
      title: "Planification",
      body,
      actions: [
        { label: "Annuler", className: "ax-btn" },
        {
          label: "OK",
          className: "ax-btn primary",
          onClick: () => {
            if (draft.type === "interval" && (!draft.minutes || draft.minutes < 1)) { notify("L'intervalle doit être d'au moins 1 minute.", "error"); return false; }
            if (draft.type === "weekly" && !draft.days.length) { notify("Choisis au moins un jour.", "error"); return false; }
            scenario.schedule = draft;
            markDirty();
            updateToolbar();
          }
        }
      ]
    });
  }

  // ---------- Enregistrer / exécuter / activer ----------

  async function saveScenario(silent = false) {
    const editor = state.editor;
    if (!editor) return false;
    const scenario = editor.scenario;
    const button = $main().querySelector("[data-save]");
    if (button) button.disabled = true;
    try {
      const saved = await api(`/scenarios/${scenario.id}`, {
        method: "PUT",
        body: {
          name: scenario.name,
          trigger: scenario.trigger,
          modules: scenario.modules,
          schedule: scenario.schedule
        }
      });
      scenario.active = saved.active;
      scenario.schedule = saved.schedule;
      scenario.nextRunAt = saved.nextRunAt;
      clearDirty();
      updateToolbar();
      if (!silent) notify("Scénario enregistré", "success");
      return true;
    } catch (error) {
      notify(error.message, "error");
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function runOnce() {
    const editor = state.editor;
    if (!editor || editor.running) return;
    if (!editor.scenario.trigger) {
      notify("Ajoute d'abord un déclencheur.", "error");
      openAppPicker({ mode: "trigger" });
      return;
    }
    if (editor.dirty && !(await saveScenario(true))) return;

    editor.running = true;
    updateToolbar();
    drawCanvas();

    try {
      const run = await api(`/scenarios/${editor.scenario.id}/run`, { method: "POST" });
      if (state.editor !== editor) return;
      editor.lastRun = run;
      const kind = run.status === "error" ? "error" : "success";
      notify(`Exécution : ${statusLabel(run.status)} — ${run.operations} opération(s)`, kind);
      showBanner(run);
      state.hooks = await api("/hooks").catch(() => state.hooks);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      editor.running = false;
      if (state.editor === editor) {
        updateToolbar();
        drawCanvas();
        const openId = editor.openModuleId;
        if (openId && findModule(openId) && !isRouter(findModule(openId).module)) openModuleDrawer(openId);
      }
    }
  }

  async function toggleActiveFromEditor(event) {
    const wanted = event.target.checked;
    const editor = state.editor;
    if (editor.dirty && !(await saveScenario(true))) {
      event.target.checked = !wanted;
      return;
    }
    try {
      const summary = await api(`/scenarios/${editor.scenario.id}/toggle`, { method: "POST", body: { active: wanted } });
      editor.scenario.active = summary.active;
      notify(summary.active ? `Scénario activé — ${scheduleLabel(summary.schedule, editor.scenario.trigger)}` : "Scénario désactivé", "success");
    } catch (error) {
      notify(error.message, "error");
    }
    updateToolbar();
  }

  async function resetTriggerState() {
    const ok = await confirmModal(
      "Réinitialiser le déclencheur",
      "Le déclencheur oubliera les éléments déjà traités (e-mails, messages Telegram…). Selon le réglage « Choisir où commencer », la prochaine exécution repartira de maintenant ou retraitera les derniers éléments.",
      "Réinitialiser",
      false
    );
    if (!ok) return;
    try {
      await api(`/scenarios/${state.editor.scenario.id}/reset`, { method: "POST" });
      notify("Déclencheur réinitialisé", "success");
    } catch (error) { notify(error.message, "error"); }
  }

  async function openScenarioHistory() {
    try {
      const runs = await api(`/runs?scenarioId=${state.editor.scenario.id}&limit=50`);
      const body = el(`<div>${runs.length ? runTable(runs, false) : `<p class="ax-muted">Ce scénario n'a jamais été exécuté.</p>`}</div>`);
      openModal({ title: "Historique du scénario", body, wide: true });
      bindRunTable(body, runs);
    } catch (error) { notify(error.message, "error"); }
  }

  // ---------------------------------------------------------
  // RACCOURCIS ET INITIALISATION
  // ---------------------------------------------------------

  function isVisible() {
    const view = document.getElementById("automations-view");
    return view && !view.classList.contains("hidden");
  }

  document.addEventListener("keydown", event => {
    if (!isVisible()) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && state.editor) {
      event.preventDefault();
      saveScenario();
    }
    if (event.key === "Escape") {
      const overlays = document.querySelectorAll("#automations-view .ax-modal-overlay");
      if (overlays.length) overlays[overlays.length - 1].remove();
      else if (document.querySelector("#automations-view .ax-mapper")) hideMapper();
      else if (document.querySelector("#automations-view .ax-drawer")) closeDrawer();
    }
  });

  window.addEventListener("beforeunload", event => {
    if (state.editor?.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  function init() {
    const view = document.getElementById("automations-view");
    if (!view) return;

    view.querySelectorAll("[data-ax-page]").forEach(button => {
      button.addEventListener("click", () => go(button.dataset.axPage));
    });

    view.querySelectorAll("[data-ax-go]").forEach(button => {
      button.addEventListener("click", async () => {
        if (state.editor?.dirty) {
          const leave = await confirmModal("Modifications non enregistrées", "Quitter l'éditeur sans enregistrer ?", "Quitter sans enregistrer");
          if (!leave) return;
          state.editor = null;
          state.page = "scenarios";
        }
        hideMapper();
        document.querySelectorAll("#automations-view .ax-popover").forEach(p => p.remove());
        const target = button.dataset.axGo;
        if (typeof showView === "function") showView(target);
        if (target === "gmail" && typeof loadGmailEmails === "function") loadGmailEmails();
        if (target === "gmail" && typeof loadGmailMonitor === "function") loadGmailMonitor();
        if (target === "plugins" && typeof loadPlugins === "function") loadPlugins();
      });
    });
  }

  window.AgentsAutomations = { open };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
