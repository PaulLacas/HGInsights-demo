import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildCompactPayload, compactTechnographic } from "./compact.js";

const HG_MCP_URL = process.env.HG_MCP_URL;
if (!HG_MCP_URL) throw new Error("HG_MCP_URL is not set");

type Company = {
  companyName?: string;
  domain?: string;
};

export type CompanyAnalysis = {
  query: string;
  companyDomain: string;
  companyName?: string;
  compact: unknown;
};

// Read structuredContent when present.
function unwrap(result: unknown) {
  if (result && typeof result === "object" && "structuredContent" in result) {
    const structured = (result as { structuredContent?: unknown }).structuredContent;
    if (structured !== undefined) return structured;
  }
  return result;
}

// Pause between calls.
function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Call a tool. Retry on failure.
async function tool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  retries = 2,
) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return unwrap(await client.callTool({ name, arguments: args }));
    } catch (error) {
      if (attempt >= retries) return { error: String(error) };
      await pause(400 * (attempt + 1));
    }
  }
  return { error: "Tool call failed." };
}

// Normalize domains. Keep root.
function normalizeDomain(input: string) {
  const trimmed = input.toLowerCase().trim().replace(/^www\./, "");
  const parts = trimmed.split(".").filter(Boolean);
  if (parts.length <= 2) return trimmed;
  const last = parts[parts.length - 1] ?? "";
  const secondLast = parts[parts.length - 2] ?? "";
  const isCcTld = last.length === 2 && secondLast.length <= 3;
  const keep = isCcTld ? 3 : 2;
  return parts.slice(-keep).join(".");
}

// Extract a domain from a URL-like query.
function extractDomain(query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed || !trimmed.includes(".")) return "";
  const url = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return normalizeDomain(trimmed.split("/")[0] ?? trimmed);
  }
}

// Create a .com guess from a name.
function guessDomain(query: string) {
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return slug ? `${slug}.com` : "";
}

// Pick the best company match.
function pickCompany(companies: Company[], query: string) {
  const q = query.toLowerCase().trim();
  return (
    companies.find((c) => normalizeDomain(c.domain ?? "") === q) ||
    companies.find((c) => (c.companyName ?? "").toLowerCase() === q) ||
    companies.find((c) => (c.companyName ?? "").toLowerCase().includes(q)) ||
    companies.find((c) => c.domain) ||
    companies[0]
  );
}

// Pick the most likely official domain.
function extractDomainFromWebSearch(result: any, query: string) {
  const results =
    result?.results ??
    result?.structuredContent?.results ??
    result?.structuredContent?.items ??
    [];
  if (!Array.isArray(results)) return "";

  const blocked = new Set([
    "wikipedia.org",
    "linkedin.com",
    "crunchbase.com",
    "reddit.com",
    "facebook.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "youtube.com",
  ]);

  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3);
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (slug && !tokens.includes(slug)) tokens.unshift(slug);

  function scoreDomain(domain: string) {
    let score = 0;
    for (const token of tokens) {
      if (domain === `${token}.com`) score = Math.max(score, 100);
      else if (domain === `${token}.io`) score = Math.max(score, 96);
      else if (domain === `${token}.co`) score = Math.max(score, 94);
      else if (domain === `${token}.ai`) score = Math.max(score, 92);
      else if (domain === `${token}.net`) score = Math.max(score, 90);
      else if (domain === `${token}.org`) score = Math.max(score, 88);
      else if (domain.startsWith(`${token}.`)) score = Math.max(score, 80);
      else if (domain.includes(token)) score = Math.max(score, 60);
    }
    return score;
  }

  let bestDomain = "";
  let bestScore = 0;

  for (const r of results) {
    const url = r?.url ?? r?.link ?? r?.href;
    if (!url || typeof url !== "string") continue;
    try {
      const domain = normalizeDomain(new URL(url).hostname);
      if ([...blocked].some((d) => domain === d || domain.endsWith(`.${d}`))) {
        continue;
      }
      const score = scoreDomain(domain);
      if (score > bestScore) {
        bestScore = score;
        bestDomain = domain;
      } else if (!bestDomain && score === bestScore) {
        bestDomain = domain;
      }
    } catch {
      continue;
    }
  }

  return bestDomain;
}

// Resolve a company domain.
async function resolveCompanyDomain(
  client: Client,
  query: string,
): Promise<{ domain: string; name?: string }> {
  const direct = extractDomain(query);
  if (direct) return { domain: direct };

  const search: any = await tool(client, "search_companies", { searchCriteria: query });
  const companies: Company[] = search?.error
    ? []
    : (search as any)?.companies ?? (search as any)?.structuredContent?.companies ?? [];

  if (companies.length) {
    const best = pickCompany(companies, query);
    const domain = best?.domain ? normalizeDomain(best.domain) : "";
    if (domain) return { domain, name: best?.companyName };
  }

  const web: any = await tool(client, "web_search", {
    query: `${query} official website`,
    limit: 5,
  });
  const webDomain = extractDomainFromWebSearch(web, query);
  if (webDomain) return { domain: webDomain };

  return { domain: guessDomain(query) };
}

// Run the company analysis.
export async function runCompanyAnalysis(query: string): Promise<CompanyAnalysis> {
  const client = new Client({ name: "hg-company-analysis", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(HG_MCP_URL));
  await client.connect(transport);

  const resolved = await resolveCompanyDomain(client, query);
  const companyDomain = resolved.domain;
  const companyName = resolved.name;

  if (!companyDomain) {
    await client.close();
    throw new Error("Could not resolve company domain from query.");
  }

  const firmographic = await tool(client, "company_firmographic", { companyDomain });
  await pause(350);
  const technographic = await tool(client, "company_technographic", { companyDomain });
  await pause(350);
  const fai = await tool(client, "company_fai", { companyDomain });
  await pause(350);
  const securitySpend = await tool(client, "company_spend", {
    companyDomain,
    spendCategory: "Security",
  });
  await pause(350);
  const contracts = await tool(client, "company_contracts", { companyDomain });
  await pause(350);
  const cloudSpend = await tool(client, "company_cloud_spend", { companyDomain });
  await pause(350);

  const productCategories = await tool(client, "list_product_categories", {});
  await pause(200);
  const productVendors = await tool(client, "list_vendors", {});
  await pause(200);
  const productAttributes = await tool(client, "list_product_attributes", {});
  await pause(200);
  const intentTopics = await tool(client, "list_intent_topics", {});
  await pause(200);

  const seedRows = compactTechnographic(technographic, 2);
  const seedProducts = Array.isArray(seedRows)
    ? seedRows.map((row: any) => row.product).filter(Boolean)
    : [];
  const productInfo = seedProducts.length
    ? await tool(client, "get_product_information", { productName: seedProducts[0] })
    : { error: "No product seed available." };
  await pause(200);
  const productReviews = seedProducts.length
    ? await tool(client, "get_product_reviews", { productName: seedProducts[0] })
    : { error: "No product seed available." };

  try {
    await client.close();
  } catch {
    // Ignore close errors.
  }
const analysis: CompanyAnalysis = {
  query,
  companyDomain,
  compact: buildCompactPayload({
    firmo: firmographic,
    techno: technographic,
    cloudSpend,
    fai,
    securitySpend,
    contracts,
    productCategories,
    productVendors,
    productAttributes,
    intentTopics,
    productInfo,
    productReviews,
  }),
};

if (companyName) {
  analysis.companyName = companyName;
}

return analysis;
