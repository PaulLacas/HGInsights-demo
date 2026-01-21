import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const HG_MCP_URL = process.env.HG_MCP_URL;

async function main() {
  const mcpUrl = HG_MCP_URL;
  if (!mcpUrl) {
    throw new Error("HG_MCP_URL is not set");
  }

  const client = new Client({
    name: "hg-prospect-research",
    version: "0.1.0",
  });

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));

  await client.connect(transport as any);

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
