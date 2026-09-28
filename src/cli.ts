import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const COMTRADE_API_KEY = "6e52ff51aa534ee7923cb1f9264103b2";

const server = new Server(
  {
    name: "china-algeria-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_un_comtrade_data",
        description: "استرجاع إحصاءات التجارة الرسمية من UN Comtrade بين الجزائر والصين.",
        inputSchema: {
          type: "object",
          properties: {
            reporterCode: { type: "string", default: "156" },
            partnerCode: { type: "string", default: "012" },
            cmdCode: { type: "string", description: "الرمز الجمركي HS Code" },
            period: { type: "string", default: "2023" },
            flowCode: { type: "string", default: "X" },
          },
          required: ["cmdCode"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_un_comtrade_data") {
    const args = request.params.arguments as any;
    const reporter = args.reporterCode || "156";
    const partner = args.partnerCode || "012";
    const cmdCode = args.cmdCode;
    const period = args.period || "2023";
    const flow = args.flowCode || "X";

    const url = `https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=${reporter}&partnerCode=${partner}&cmdCode=${cmdCode}&period=${period}&flowCode=${flow}`;

    const res = await fetch(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": COMTRADE_API_KEY,
        "Accept": "application/json",
      },
    });

    const data = await res.json();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  throw new Error("Tool not found");
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
