import { runCompanyAnalysis } from "./prospect-research.js";

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.log(`Usage:
  npx tsx src/research-prospect.ts "Stripe"
  npx tsx src/research-prospect.ts "taxjar.com"`);
    process.exit(0);
  }
  const analysis = await runCompanyAnalysis(query);
  console.log(JSON.stringify(analysis, null, 2));
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
