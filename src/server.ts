import "dotenv/config";
import http from "node:http";
import { runCompanyAnalysis } from "./prospect-research.js";

const PORT = Number(process.env.PORT);
const LLM_API_URL = process.env.LLM_API_URL || "";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "";
const LLM_INPUT_COST_PER_1K = Number(process.env.LLM_INPUT_COST_PER_1K);
const LLM_OUTPUT_COST_PER_1K = Number(process.env.LLM_OUTPUT_COST_PER_1K);

if (!Number.isFinite(PORT) || PORT <= 0) {
  throw new Error("PORT is not set");
}

function formatUsd(amount) {
  return "$" + amount.toFixed(6);
}

function logLLMCost(usage) {
  if (!usage) {
    console.log("[LLM] Cost: N/A (missing usage data)");
    return;
  }

  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
  const rawTotalCost = usage.total_cost ?? usage.totalCost ?? usage.cost;
  const totalCost =
    typeof rawTotalCost === "number"
      ? rawTotalCost
      : typeof rawTotalCost === "string"
        ? Number(rawTotalCost)
        : NaN;

  if (Number.isFinite(totalCost)) {
    console.log(
      "[LLM] Tokens: input=" +
        promptTokens +
        " output=" +
        completionTokens +
        " total=" +
        totalTokens +
        " | Cost: " +
        formatUsd(totalCost),
    );
    return;
  }

  if (!LLM_INPUT_COST_PER_1K && !LLM_OUTPUT_COST_PER_1K) {
    console.log(
      "[LLM] Tokens: input=" +
        promptTokens +
        " output=" +
        completionTokens +
        " total=" +
        totalTokens +
        " | Cost: N/A (set LLM_INPUT_COST_PER_1K / LLM_OUTPUT_COST_PER_1K)",
    );
    return;
  }

  const inputCost = (promptTokens / 1000) * LLM_INPUT_COST_PER_1K;
  const outputCost = (completionTokens / 1000) * LLM_OUTPUT_COST_PER_1K;
  const totalCostCalculated = inputCost + outputCost;

  console.log(
    "[LLM] Tokens: input=" +
      promptTokens +
      " output=" +
      completionTokens +
      " total=" +
      totalTokens +
      " | Cost: " +
      formatUsd(totalCostCalculated),
  );
}

async function callLLM(prompt) {
  if (!LLM_API_URL || !LLM_API_KEY || !LLM_MODEL) {
    return { error: "LLM not configured. Set LLM_API_URL, LLM_API_KEY, and LLM_MODEL." };
  }

  const response = await fetch(LLM_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + LLM_API_KEY,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: "You are a senior B2B sales strategist." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return { error: "LLM request failed: " + text };
  }

  const data = await response.json();
  logLLMCost(data?.usage);
  const content =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    data?.output_text ||
    "";
  return { content };
}

async function generateBrief(compact, companyDomain, companyName) {
  const prompt = `You will receive compact company data.
Return STRICTLY valid JSON (no markdown, no extra text), with EXACTLY this structure:
{
  "sales_thesis": {
    "primary_angle": "...",
    "why_now": "...",
    "business_impact": ["...", "..."]
  },
  "company_snapshot": {
    "what_matters_for_sales": ["...", "..."]
  },
  "key_pains_ranked": [
    {
      "pain": "...",
      "real_world_effect": "...",
      "sales_leverage": "..."
    }
  ],
  "challenger_talk_track": {
    "opening_statement": "...",
    "assumptions": ["...", "..."],
    "questions": ["...", "..."]
  },
  "recommended_next_step": {
    "positioning": "...",
    "format": "...",
    "outcome": "...",
    "why_it_converts": "..."
  },
  "product_recommendations": {
    "primary_fit": "...",
    "recommended_products": [
      {
        "product": "...",
        "vendor": "...",
        "category": "...",
        "why_fit": "...",
        "proof_points": ["..."]
      }
    ]
  }
}
RULES:
- Assertive, opinionated, closing-oriented tone (Challenger Sale).
- Forbidden words: "likely", "potential", "may".
- Max 3 pains. Max 5-6 questions.
- If data is missing, make an explicit, defensible assumption.
- Write in English.
- Product recommendations must be sales-ready and tied to the signals in the data.
 - Use sales_signals for ICP prioritization, qualification, and GTM credibility.
 - Use product_signals to ground product matches and proof points.
Company: ${companyName || "Unknown"} (${companyDomain})
Compact data:
${JSON.stringify(compact)}`;

  const result = await callLLM(prompt);
  if (result.error) return { error: result.error };
  const text = result.content || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch ? jsonMatch[0] : text;
  try {
    return JSON.parse(jsonText);
  } catch {
    return { error: "LLM response was not valid JSON.", raw: text };
  }
}

const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sales Call Brief</title>
    <style>
      :root {
        --ink: #1c1d22;
        --muted: #5a5d66;
        --paper: #f7f1ea;
        --accent: #c2682a;
        --border: rgba(28, 29, 34, 0.14);
        --shadow: 0 20px 60px rgba(28, 29, 34, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Iowan Old Style", "Palatino Linotype", "Palatino", "Georgia", serif;
        color: var(--ink);
        background: radial-gradient(circle at 15% 20%, rgba(194, 104, 42, 0.18), transparent 55%),
          linear-gradient(160deg, #f7f1ea 0%, #efe6dd 100%);
      }

      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image: radial-gradient(rgba(28, 29, 34, 0.06) 1px, transparent 1px);
        background-size: 28px 28px;
        opacity: 0.35;
      }

      .shell {
        max-width: 1100px;
        margin: 0 auto;
        padding: 42px 20px 80px;
      }

      .kicker {
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
        font-size: 12px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--muted);
      }

      h1 {
        margin: 8px 0 10px;
        font-size: clamp(2rem, 3.4vw, 3rem);
      }

      .panel {
        background: rgba(255, 255, 255, 0.86);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 20px;
        box-shadow: var(--shadow);
      }

      .hero {
        display: grid;
        gap: 24px;
        align-items: center;
        grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
        margin-bottom: 28px;
      }

      @media (max-width: 900px) {
        .hero {
          grid-template-columns: 1fr;
        }
      }

      .hero-intro {
        display: grid;
        gap: 1px;
      }

      .hero-intro p {
        margin: 0;
        color: var(--muted);
        font-size: 16px;
        max-width: 560px;
      }

      .hero-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 6px;
      }

      .pill {
        padding: 6px 12px;
        border-radius: 999px;
        background: rgba(194, 104, 42, 0.12);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
      }

      .hero-card {
        display: grid;
        gap: 12px;
      }

      .board {
        display: grid;
        grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
        gap: 18px;
        align-items: start;
      }

      @media (max-width: 1000px) {
        .board {
          grid-template-columns: 1fr;
        }
      }

      .side {
        display: grid;
        gap: 16px;
        align-content: start;
      }

      .summary-card {
        display: grid;
        gap: 0;
        position: sticky;
        top: 18px;
        padding: 8px 10px;
        align-self: start;
      }

      .company-line {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px;
      }

      .company-name {
        font-size: 14px;
        font-weight: 600;
        line-height: 1;
      }

      .company-domain {
        color: var(--muted);
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
        font-size: 10px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        text-decoration: none;
        line-height: 1;
        display: inline-block;
      }

      .company-domain:hover {
        text-decoration: underline;
      }

      .summary-data {
        display: grid;
        margin-top: 2px;
        gap: 6px;
      }

      .summary-item {
        padding: 8px 10px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.8);
      }

      .summary-label {
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--muted);
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
      }

      .summary-value {
        margin-top: 4px;
        font-size: 14px;
        font-weight: 600;
      }

      .brief-grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      @media (max-width: 1000px) {
        .brief-grid {
          grid-template-columns: 1fr;
        }
      }

      .section-card {
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 18px;
        background: rgba(255, 255, 255, 0.9);
        position: relative;
        overflow: hidden;
      }

      .section-card::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4px;
        background: var(--accent);
      }

      .section-header {
        display: flex;
        gap: 12px;
        align-items: center;
        margin-bottom: 12px;
      }

      .section-number {
        width: 28px;
        height: 28px;
        border-radius: 999px;
        background: var(--accent);
        color: #fff;
        display: grid;
        place-items: center;
        font-weight: 600;
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
      }

      .section-title {
        font-size: 14px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
      }

      .section-subtitle {
        font-size: 13px;
        color: var(--muted);
      }


      form {
        display: grid;
        gap: 12px;
      }

      label {
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
        font-size: 12px;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 12px;
      }

      input[type="text"] {
        padding: 14px 16px;
        border-radius: 12px;
        border: 1px solid var(--border);
        font-size: 16px;
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
        background: rgba(255, 255, 255, 0.7);
      }

      button {
        padding: 12px 20px;
        border-radius: 12px;
        border: none;
        background: var(--accent);
        color: #fff;
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        box-shadow: 0 12px 24px rgba(194, 104, 42, 0.25);
      }

      button:disabled {
        opacity: 0.6;
        cursor: wait;
        box-shadow: none;
      }

      button:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 16px 28px rgba(194, 104, 42, 0.3);
      }

      .status {
        margin-top: 12px;
        font-size: 14px;
        color: var(--muted);
      }

      dl {
        margin: 0;
        display: grid;
        grid-template-columns: minmax(120px, 1fr) minmax(0, 2fr);
        gap: 8px 12px;
        font-size: 14px;
      }

      dt {
        font-weight: 600;
        color: var(--muted);
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 11px;
      }

      dd {
        margin: 0;
      }

      .kv-grid {
        display: grid;
        grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr);
        gap: 8px 12px;
      }

      .tag-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .tag {
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(194, 104, 42, 0.12);
        font-size: 12px;
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
      }

      .stack-label {
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--muted);
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
        margin-top: 10px;
      }

      .stack-value {
        margin-top: 6px;
        font-weight: 600;
      }

      .callout {
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(28, 29, 34, 0.06);
        font-size: 14px;
      }

      .callout.secondary {
        background: rgba(194, 104, 42, 0.12);
      }

      .callout.primary {
        background: rgba(28, 29, 34, 0.08);
        font-weight: 600;
      }


      .list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 10px;
      }

      .list li {
        border-radius: 12px;
        padding: 10px 12px;
        background: rgba(28, 29, 34, 0.05);
      }

      .talk-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 12px;
        align-items: start;
      }

      .talk-column {
        display: grid;
        gap: 8px;
      }

      @media (max-width: 900px) {
        .talk-grid {
          grid-template-columns: 1fr;
        }
      }

      .pain-item {
        padding: 12px 14px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.8);
        display: grid;
        gap: 6px;
      }

      .product-item {
        padding: 12px 14px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.8);
        display: grid;
        gap: 6px;
      }

      .pain-title {
        font-size: 14px;
        font-weight: 600;
      }

      .pain-block {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 8px;
        align-items: baseline;
      }

      .pain-label {
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
        font-family: "Avenir Next", "Futura", "Trebuchet MS", sans-serif;
      }

      .pain-text {
        font-size: 13px;
      }

      .item-meta {
        margin-top: 4px;
        font-size: 12px;
        color: var(--muted);
      }

      .error {
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(160, 40, 40, 0.1);
        color: #8a1f1f;
        display: none;
      }

      .error.show {
        display: block;
      }

      .empty {
        font-size: 13px;
        color: var(--muted);
        font-style: italic;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="hero">
        <div class="hero-intro">
          <div class="kicker">Sales Call Brief</div>
          <h1>Prepare a precise, structured, action-ready call.</h1>
          <p>An intelligent brief that turns HG signals into concrete sales angles.</p>
          <div class="hero-badges">
            <span class="pill">HG-powered</span>
            <span class="pill">Sales-ready</span>
            <span class="pill">5 key blocks</span>
          </div>
        </div>
        <div class="panel hero-card">
          <form id="form">
            <label for="query">Company or domain</label>
            <div class="row">
              <input id="query" type="text" placeholder="salesforce.com or Salesforce" />
              <button type="submit">Analyze</button>
            </div>
          </form>
          <div id="status" class="status">Ready.</div>
          <div id="error" class="error"></div>
        </div>
      </header>

      <section class="board">
        <aside class="side">
          <div class="panel summary-card">
            <div class="company-line">
              <div class="company-name" id="company-name">-</div>
              <a class="company-domain" id="company-domain" href="#" target="_blank" rel="noopener">-</a>
            </div>
            <div id="summary-data" class="summary-data"></div>
            <div id="brief-status" class="item-meta">Waiting for a query.</div>
            <div id="brief-error" class="error"></div>
          </div>
        </aside>

        <section class="brief-grid">
          <article class="section-card">
            <div class="section-header">
              <div class="section-number">1</div>
              <div>
                <div class="section-title">Primary Sales Thesis</div>
                <div class="section-subtitle">One opinionated thesis, closing-oriented</div>
              </div>
            </div>
            <div id="thesis-primary" class="callout primary">N/A</div>
            <div class="stack-label">Why now</div>
            <div id="thesis-why" class="callout">N/A</div>
            <div class="stack-label">Business impact</div>
            <ul id="thesis-impact" class="list"></ul>
            <div id="thesis-empty" class="empty">No thesis yet.</div>
          </article>

          <article class="section-card">
            <div class="section-header">
              <div class="section-number">2</div>
              <div>
                <div class="section-title">Company Snapshot</div>
                <div class="section-subtitle">Only what matters for selling</div>
              </div>
            </div>
            <ul id="snapshot-matters" class="list"></ul>
            <div id="brief-snapshot-empty" class="empty">No snapshot yet.</div>
          </article>

          <article class="section-card">
            <div class="section-header">
              <div class="section-number">3</div>
              <div>
                <div class="section-title">Key Pains Ranked</div>
                <div class="section-subtitle">Direct pains + sales leverage</div>
              </div>
            </div>
            <ul id="brief-pains" class="list"></ul>
            <div id="brief-pains-empty" class="empty">No pains yet.</div>
          </article>

          <article class="section-card">
            <div class="section-header">
              <div class="section-number">4</div>
              <div>
                <div class="section-title">Product Recommendations</div>
                <div class="section-subtitle">Sales-ready product match</div>
              </div>
            </div>
            <div id="product-fit" class="callout">N/A</div>
            <ul id="product-list" class="list"></ul>
            <div id="brief-product-empty" class="empty">No product recommendations yet.</div>
          </article>

          <article class="section-card" style="grid-column: span 2;">
            <div class="section-header">
              <div class="section-number">5</div>
              <div>
                <div class="section-title">Challenger Talk Track</div>
                <div class="section-subtitle">Opening, assumptions, questions</div>
              </div>
            </div>
            <div id="talk-opening" class="callout">N/A</div>
            <div class="talk-grid">
              <div class="talk-column">
                <div class="stack-label">Questions</div>
                <ul id="talk-questions" class="list"></ul>
              </div>
              <div class="talk-column">
                <div class="stack-label">Assumptions</div>
                <ul id="talk-assumptions" class="list"></ul>
              </div>
            </div>
            <div id="brief-talk-empty" class="empty">No talk track yet.</div>
          </article>

          <article class="section-card" style="grid-column: span 2;">
            <div class="section-header">
              <div class="section-number">6</div>
              <div>
                <div class="section-title">Recommended Next Step</div>
                <div class="section-subtitle">The step that converts</div>
              </div>
            </div>
            <ul id="brief-next" class="list"></ul>
            <div id="brief-next-empty" class="empty">No next step yet.</div>
          </article>
        </section>
      </section>
    </main>

    <script>
      const form = document.getElementById("form");
      const queryInput = document.getElementById("query");
      const statusEl = document.getElementById("status");
      const errorEl = document.getElementById("error");
      const companyNameEl = document.getElementById("company-name");
      const companyDomainEl = document.getElementById("company-domain");
      const summaryDataEl = document.getElementById("summary-data");
      const briefStatusEl = document.getElementById("brief-status");
      const briefErrorEl = document.getElementById("brief-error");
      const thesisPrimaryEl = document.getElementById("thesis-primary");
      const thesisWhyEl = document.getElementById("thesis-why");
      const thesisImpactEl = document.getElementById("thesis-impact");
      const thesisEmptyEl = document.getElementById("thesis-empty");
      const snapshotMattersEl = document.getElementById("snapshot-matters");
      const briefSnapshotEmpty = document.getElementById("brief-snapshot-empty");
      const briefPainsEl = document.getElementById("brief-pains");
      const briefPainsEmpty = document.getElementById("brief-pains-empty");
      const productFitEl = document.getElementById("product-fit");
      const productListEl = document.getElementById("product-list");
      const briefProductEmpty = document.getElementById("brief-product-empty");
      const talkOpeningEl = document.getElementById("talk-opening");
      const talkAssumptionsEl = document.getElementById("talk-assumptions");
      const talkQuestionsEl = document.getElementById("talk-questions");
      const briefTalkEmpty = document.getElementById("brief-talk-empty");
      const briefNextEl = document.getElementById("brief-next");
      const briefNextEmpty = document.getElementById("brief-next-empty");
      const analyzeBtn = form.querySelector("button[type='submit']");

      function showError(message) {
        errorEl.textContent = message;
        errorEl.classList.add("show");
      }

      function clearError() {
        errorEl.textContent = "";
        errorEl.classList.remove("show");
      }

      function renderList(el, rows, emptyEl) {
        el.innerHTML = "";
        const items = Array.isArray(rows) ? rows : [];
        items.forEach((text) => {
          const li = document.createElement("li");
          li.textContent = text;
          el.appendChild(li);
        });
        if (emptyEl) {
          emptyEl.style.display = items.length ? "none" : "block";
        }
      }

      function renderPains(pains) {
        briefPainsEl.innerHTML = "";
        const items = Array.isArray(pains) ? pains : [];
        items.forEach((p) => {
          const li = document.createElement("li");
          li.className = "pain-item";

          const title = document.createElement("div");
          title.className = "pain-title";
          title.textContent = p.pain || "Pain";
          li.appendChild(title);

          const impact = document.createElement("div");
          impact.className = "pain-block";
          const impactLabel = document.createElement("span");
          impactLabel.className = "pain-label";
          impactLabel.textContent = "Impact";
          const impactText = document.createElement("span");
          impactText.className = "pain-text";
          impactText.textContent = p.real_world_effect || "N/A";
          impact.appendChild(impactLabel);
          impact.appendChild(impactText);
          li.appendChild(impact);

          const leverage = document.createElement("div");
          leverage.className = "pain-block";
          const leverageLabel = document.createElement("span");
          leverageLabel.className = "pain-label";
          leverageLabel.textContent = "Leverage";
          const leverageText = document.createElement("span");
          leverageText.className = "pain-text";
          leverageText.textContent = p.sales_leverage || "N/A";
          leverage.appendChild(leverageLabel);
          leverage.appendChild(leverageText);
          li.appendChild(leverage);

          briefPainsEl.appendChild(li);
        });

        briefPainsEmpty.style.display = items.length ? "none" : "block";
      }

      function renderProducts(products) {
        productListEl.innerHTML = "";
        const items = Array.isArray(products) ? products : [];
        items.forEach((p) => {
          const li = document.createElement("li");
          li.className = "product-item";

          const title = document.createElement("div");
          title.className = "pain-title";
          title.textContent = [p.vendor, p.product].filter(Boolean).join(" - ") || "Product";
          li.appendChild(title);

          const category = document.createElement("div");
          category.className = "pain-block";
          const categoryLabel = document.createElement("span");
          categoryLabel.className = "pain-label";
          categoryLabel.textContent = "Category";
          const categoryText = document.createElement("span");
          categoryText.className = "pain-text";
          categoryText.textContent = p.category || "N/A";
          category.appendChild(categoryLabel);
          category.appendChild(categoryText);
          li.appendChild(category);

          const why = document.createElement("div");
          why.className = "pain-block";
          const whyLabel = document.createElement("span");
          whyLabel.className = "pain-label";
          whyLabel.textContent = "Why fit";
          const whyText = document.createElement("span");
          whyText.className = "pain-text";
          whyText.textContent = p.why_fit || "N/A";
          why.appendChild(whyLabel);
          why.appendChild(whyText);
          li.appendChild(why);

          const proof = document.createElement("div");
          proof.className = "pain-block";
          const proofLabel = document.createElement("span");
          proofLabel.className = "pain-label";
          proofLabel.textContent = "Proof";
          const proofText = document.createElement("span");
          proofText.className = "pain-text";
          proofText.textContent = Array.isArray(p.proof_points) && p.proof_points.length
            ? p.proof_points.slice(0, 2).join("; ")
            : "N/A";
          proof.appendChild(proofLabel);
          proof.appendChild(proofText);
          li.appendChild(proof);

          productListEl.appendChild(li);
        });

        briefProductEmpty.style.display = items.length ? "none" : "block";
      }

      function normalizeList(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === "string" && value.trim()) return [value.trim()];
        return [];
      }

      function renderSummary(data) {
        const company = data.compact && data.compact.company ? data.compact.company : {};
        const name = data.companyName || company.name || "-";
        const domain = data.companyDomain || company.domain || "-";
        companyNameEl.textContent = name;
        companyDomainEl.textContent = domain;
        companyDomainEl.href = domain ? "https://" + domain : "#";

        summaryDataEl.innerHTML = "";
        const items = [
          ["Industry", company.industry],
          ["HQ", company.hq],
          ["Employees", company.employees],
          ["Revenue (USD)", company.revenue_usd],
          ["IT spend (USD)", company.it_spend_usd],
          ["Data freshness", company.data_freshness],
          ["Confidence", company.confidence],
        ].filter((row) => row[1] !== undefined && row[1] !== null && row[1] !== "");
        items.forEach((row) => {
          const item = document.createElement("div");
          item.className = "summary-item";
          const label = document.createElement("div");
          label.className = "summary-label";
          label.textContent = row[0];
          const value = document.createElement("div");
          value.className = "summary-value";
          value.textContent = String(row[1]);
          item.appendChild(label);
          item.appendChild(value);
          summaryDataEl.appendChild(item);
        });
        summaryDataEl.style.display = items.length ? "grid" : "none";
      }

      function renderBrief(brief) {
        briefStatusEl.textContent = brief ? "Brief generated." : "Waiting for a query.";
        briefErrorEl.textContent = "";
        briefErrorEl.classList.remove("show");

        if (!brief) return;
        if (brief.error) {
          briefStatusEl.textContent = "Brief unavailable.";
          briefErrorEl.textContent = brief.error;
          briefErrorEl.classList.add("show");
          return;
        }

        const thesis = brief.sales_thesis || {};
        thesisPrimaryEl.textContent = thesis.primary_angle || "N/A";
        thesisWhyEl.textContent = thesis.why_now || "N/A";
        renderList(thesisImpactEl, normalizeList(thesis.business_impact), null);
        const hasThesis =
          Boolean(thesis.primary_angle) ||
          Boolean(thesis.why_now) ||
          (Array.isArray(thesis.business_impact) && thesis.business_impact.length);
        thesisEmptyEl.style.display = hasThesis ? "none" : "block";

        const snapshot = brief.company_snapshot || {};
        renderList(
          snapshotMattersEl,
          normalizeList(snapshot.what_matters_for_sales),
          briefSnapshotEmpty,
        );

        const pains = Array.isArray(brief.key_pains_ranked) ? brief.key_pains_ranked : [];
        renderPains(pains);

        const products = brief.product_recommendations || {};
        productFitEl.textContent = products.primary_fit || "N/A";
        const recommended = Array.isArray(products.recommended_products)
          ? products.recommended_products
          : [];
        renderProducts(recommended);

        const talk = brief.challenger_talk_track || {};
        const questions = normalizeList(talk.questions);
        const assumptions = normalizeList(talk.assumptions);
        const hasOpening = Boolean(talk.opening_statement);
        talkOpeningEl.textContent = talk.opening_statement || "N/A";
        renderList(talkAssumptionsEl, assumptions, null);
        renderList(talkQuestionsEl, questions, null);
        const hasTalkData = hasOpening || assumptions.length || questions.length;
        briefTalkEmpty.style.display = hasTalkData ? "none" : "block";

        const next = brief.recommended_next_step || {};
        const nextLines = [
          "Positioning: " + (next.positioning || "N/A"),
          "Format: " + (next.format || "N/A"),
          "Outcome: " + (next.outcome || "N/A"),
          "Why it converts: " + (next.why_it_converts || "N/A"),
        ];
        renderList(briefNextEl, nextLines, briefNextEmpty);
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const query = queryInput.value.trim();
        if (!query) {
          showError("Please enter a company name or domain.");
          return;
        }
        clearError();
        statusEl.textContent = "Analyzing...";
        analyzeBtn.disabled = true;

        try {
          const response = await fetch("/api/analysis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
          });
          if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error || "Server error.");
          }
          const data = await response.json();
          renderSummary(data);
          renderBrief(data.brief);
          statusEl.textContent = "Analysis complete.";
        } catch (error) {
          showError(error.message || "Unknown error.");
          statusEl.textContent = "Error.";
        } finally {
          analyzeBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>
`;

const server = http.createServer((req, res) => {
  const url = req.url || "/";

  if (req.method === "GET" && url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && url === "/api/analysis") {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large." }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", async () => {
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        const data = body ? JSON.parse(body) : {};
        const query = typeof data.query === "string" ? data.query.trim() : "";
        if (!query) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing query." }));
          return;
        }
          const analysis = await runCompanyAnalysis(query);
          const brief = await generateBrief(
            analysis.compact,
            analysis.companyDomain,
            analysis.companyName,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ...analysis, brief }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Server error." }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log("Company Analysis UI running on http://localhost:" + PORT);
});
