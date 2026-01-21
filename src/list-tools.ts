import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const HG_MCP_URL = process.env.HG_MCP_URL;

if (!HG_MCP_URL) {
  throw new Error("HG_MCP_URL is not set");
}

async function main() {
  const client = new Client({
    name: "hg-prospect-research",
    version: "0.1.0",
  });

  const transport = new StreamableHTTPClientTransport(new URL(HG_MCP_URL));

  await client.connect(transport);

  const tools = await client.listTools();

  console.log("TOOLS:");
  for (const tool of tools.tools) {
    console.log(`- ${tool.name}`);

  }

  await client.close();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
