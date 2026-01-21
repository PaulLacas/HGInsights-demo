type Firmo = any;
type Techno = any;
type CloudSpend = any;
type Fai = any;
type Spend = any;
type Contracts = any;
type ProductList = any;

const normalizeVendorName = (s: string) => s.trim();

const looksLikeHostnameNoise = (s: string) => {
  const value = s.toLowerCase();
  return value.includes("awsglobalaccelerator.com") || value.includes("placeholder") || value.includes("cdn-");
};

const toIsoDateFromMMDDYY = (s?: string) => {
  if (!s) return undefined;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return s;
  const mm = m[1];
  const dd = m[2];
  const yy = m[3];
  const year = Number(yy) >= 70 ? `19${yy}` : `20${yy}`;
  return `${year}-${mm}-${dd}`;
};

const unwrapTool = (input: any) => {
  if (!input || typeof input !== "object") return input;
  if (input.error) return { error: input.error };
  if (input.structuredContent) return input.structuredContent;
  if (input.data) return input.data;
  return input;
};

const pickArray = (input: any, keys: string[]) => {
  for (const key of keys) {
    const value = input?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
};

const toLabel = (value: any) => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (!value) return "";
  return value?.name ?? value?.title ?? value?.category ?? value?.label ?? "";
};

const flattenTechnologies = (t: any) => {
  const techGroups = t?.technologies ?? t?.data?.technologies;
  if (!Array.isArray(techGroups)) return [];
  const rows: any[] = [];
  for (const group of techGroups) {
    const category = group?.category ?? group?.name;
    const products = group?.products ?? [];
    if (!Array.isArray(products)) continue;
    for (const p of products) {
      rows.push({
        productName: p?.name ?? p?.productName,
        vendorName: p?.vendorName ?? category,
        intensity: p?.intensity ?? p?.usageLevel ?? 1,
        firstVerifiedDate: p?.firstVerifiedDate,
        lastVerifiedDate: p?.lastVerifiedDate,
        productAttributes: p?.productAttributes ?? [],
        productLocations: p?.productLocations ?? 0,
      });
    }
  }
  return rows;
};

export function compactFirmographic(input: Firmo) {
  const f = unwrapTool(input);
  if (f?.error) return f;

  const name = f?.companyName ?? f?.name;
  const domain = f?.domain ?? f?.website ?? f?.websiteUrl;
  const naicsName = f?.industryCodes?.naics?.name;
  const industry = naicsName ?? f?.industry;

  const city = f?.location?.city ?? f?.headquarters?.city;
  const country = f?.location?.country ?? f?.headquarters?.country;
  const hq = [city, country].filter(Boolean).join(", ");

  return {
    name,
    domain,
    industry,
    hq: hq || undefined,
    employees: f?.employeeCount ?? f?.employees,
    revenue_usd: f?.revenue ?? f?.annualRevenue,
    it_spend_usd: f?.itSpend ?? f?.itSpendUsd,
    data_freshness: f?.metadata?.lastUpdated?.slice(0, 10),
    confidence: f?.metadata?.confidence,
  };
}

export function compactTechnographic(input: Techno, topN = 15) {
  const t = unwrapTool(input);
  if (t?.error) return t;

  const products: any[] =
    t?.products ?? t?.data?.products ?? t?.productList ?? t?.data?.productList ?? flattenTechnologies(t);

  const map = new Map<string, any>();
  for (const p of products) {
    const key = `${p.productName}__${p.vendorName}`;
    const prev = map.get(key);

    const intensity = Number(p.intensity ?? 0);
    const first = p.firstVerifiedDate;
    const last = p.lastVerifiedDate;

    if (!prev) {
      map.set(key, {
        product: p.productName,
        vendor: p.vendorName,
        intensity,
        first_seen: first,
        last_seen: last,
        attributes: Array.isArray(p.productAttributes) ? p.productAttributes.slice(0, 3) : [],
        locations: Number(p.productLocations ?? 0),
      });
    } else {
      prev.intensity += intensity;
      prev.locations += Number(p.productLocations ?? 0);
      if (first && (!prev.first_seen || first < prev.first_seen)) prev.first_seen = first;
      if (last && (!prev.last_seen || last > prev.last_seen)) prev.last_seen = last;
      for (const a of p.productAttributes ?? []) {
        if (prev.attributes.length < 3 && !prev.attributes.includes(a)) prev.attributes.push(a);
      }
    }
  }

  return Array.from(map.values())
    .sort((a, b) => (b.intensity ?? 0) - (a.intensity ?? 0))
    .slice(0, topN);
}

export function compactCloudSpend(input: CloudSpend, perServiceTopN = 5, minMonthlySpend = 1000) {
  const c = unwrapTool(input);
  if (c?.error) return c;

  const services: any[] = c?.technologyServices ?? c?.services ?? c?.cloudServices ?? [];
  const rows: any[] = [];

  for (const s of services) {
    const serviceName = s?.serviceName ?? s?.name;
    const vendors: any[] = s?.vendors ?? s?.providers ?? [];

    const filtered = vendors
      .filter((v) => typeof v?.vendorName === "string")
      .filter((v) => !looksLikeHostnameNoise(String(v.vendorName)))
      .map((v) => ({
        service: serviceName,
        vendor: normalizeVendorName(String(v.vendorName)),
        monthly_spend_usd: typeof v.estimatedMonthlySpend === "number" ? v.estimatedMonthlySpend : undefined,
        first_seen: toIsoDateFromMMDDYY(v.firstSeen),
      }))
      .filter((v) => (v.monthly_spend_usd ?? 0) >= minMonthlySpend)
      .sort((a, b) => (b.monthly_spend_usd ?? 0) - (a.monthly_spend_usd ?? 0))
      .slice(0, perServiceTopN);

    rows.push(...filtered);
  }

  const recent = rows
    .filter((r) => typeof r.first_seen === "string" && r.first_seen >= "2024-01-01")
    .slice(0, 10)
    .map((r) => ({ vendor: r.vendor, first_seen: r.first_seen }));

  return { top_spend: rows, recent_adoptions: recent };
}

export function compactFAI(input: Fai, topN = 4) {
  const data = unwrapTool(input);
  if (data?.error) return data;

  const departments = pickArray(data, ["departments", "teams", "functionalAreas"]);
  const rows = departments
    .map((d: any) => ({
      name: d?.name ?? d?.departmentName ?? d?.functionName,
      employees: d?.employeeCount ?? d?.headcount,
      spending_level: d?.spendingLevel ?? d?.spendLevel,
      tech_count: Array.isArray(d?.technologies) ? d.technologies.length : d?.technologyCount,
      top_tech: Array.isArray(d?.technologies) ? d.technologies.slice(0, 3) : [],
    }))
    .filter((row: any) => row.name);

  return rows
    .sort((a: any, b: any) => (b.employees ?? 0) - (a.employees ?? 0))
    .slice(0, topN);
}

export function compactSpend(input: Spend, topN = 5) {
  const data = unwrapTool(input);
  if (data?.error) return data;

  const breakdown = pickArray(data, ["breakdown", "categories", "categoryBreakdown"]);
  const rows = breakdown
    .map((b: any) => ({
      subcategory: b?.subcategory ?? b?.category ?? b?.name,
      spend_usd: b?.spend ?? b?.totalSpend ?? b?.amount,
      products: Array.isArray(b?.products) ? b.products.slice(0, 3) : [],
    }))
    .filter((row: any) => row.subcategory)
    .slice(0, topN);

  return {
    category: data?.category ?? data?.spendCategory ?? "Security",
    total_spend_usd: data?.totalSpend ?? data?.total_spend ?? data?.spend,
    yoy_growth: data?.yearOverYearGrowth ?? data?.yoyGrowth ?? data?.growth,
    breakdown: rows,
  };
}

export function compactContracts(input: Contracts, topN = 5) {
  const data = unwrapTool(input);
  if (data?.error) return data;

  const contracts = pickArray(data, ["contracts", "items", "agreements"]);
  const rows = contracts
    .map((c: any) => ({
      vendor: c?.vendorName ?? c?.vendor ?? c?.provider,
      value_usd: c?.totalValue ?? c?.value ?? c?.amount,
      start_date: c?.startDate ?? c?.start,
      end_date: c?.endDate ?? c?.end,
    }))
    .filter((row: any) => row.vendor)
    .slice(0, topN);

  return {
    contracts_count: data?.count ?? contracts.length,
    total_value_usd: data?.totalValue ?? data?.totalContractValue ?? data?.total,
    recent_contracts: rows,
  };
}

export function compactProductList(input: ProductList, topN = 15) {
  const data = unwrapTool(input);
  if (data?.error) return data;

  const items = pickArray(data, ["categories", "vendors", "attributes", "topics", "items"]);
  return items
    .map((item: any) => toLabel(item))
    .filter((label: string) => label)
    .slice(0, topN);
}

export function compactProductInfo(input: any) {
  const data = unwrapTool(input);
  if (data?.error) return data;
  return {
    name: data?.name ?? data?.productName ?? data?.title,
    category: data?.category ?? data?.productCategory,
    pricing: data?.pricing ?? data?.price,
    features: Array.isArray(data?.features) ? data.features.slice(0, 3) : [],
  };
}

export function compactProductReviews(input: any) {
  const data = unwrapTool(input);
  if (data?.error) return data;
  return {
    rating: data?.rating ?? data?.avgRating ?? data?.averageRating,
    review_count: data?.reviewCount ?? data?.reviewsCount ?? data?.count,
    pros: Array.isArray(data?.pros) ? data.pros.slice(0, 2) : [],
    cons: Array.isArray(data?.cons) ? data.cons.slice(0, 2) : [],
  };
}

export function buildCompactPayload(opts: {
  firmo: any;
  techno: any;
  cloudSpend: any;
  fai: any;
  securitySpend: any;
  contracts: any;
  productCategories: any;
  productVendors: any;
  productAttributes: any;
  intentTopics: any;
  productInfo: any;
  productReviews: any;
}) {
  const company = compactFirmographic(opts.firmo);
  const languages_tools = compactTechnographic(opts.techno, 15);
  const cloud = compactCloudSpend(opts.cloudSpend, 5, 1000);
  const fai = compactFAI(opts.fai, 4);
  const securitySpend = compactSpend(opts.securitySpend, 5);
  const contracts = compactContracts(opts.contracts, 5);

  const categories = compactProductList(opts.productCategories, 12);
  const vendors = compactProductList(opts.productVendors, 12);
  const attributes = compactProductList(opts.productAttributes, 12);
  const topics = compactProductList(opts.intentTopics, 12);
  const productInfo = compactProductInfo(opts.productInfo);
  const productReviews = compactProductReviews(opts.productReviews);

  return {
    company,
    tech_highlights: {
      languages_tools,
      cloud_stack_top_spend: cloud?.top_spend ?? cloud,
      recent_adoptions: cloud?.recent_adoptions ?? [],
    },
    sales_signals: {
      icp_departments: fai,
      security_spend: securitySpend,
      contracts,
    },
    product_signals: {
      categories,
      vendors,
      attributes,
      intent_topics: topics,
      product_info: productInfo,
      product_reviews: productReviews,
    },
  };
}
