import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

interface Env {
  COMTRADE_API_KEY: string;
}

// إنشاء وتعريف خادم MCP
function createMcpServer(apiKey: string) {
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

  // قائمة الأدوات المتاحة للذكاء الاصطناعي
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_un_comtrade_data",
          description:
            "استرجاع إحصاءات التجارة الرسمية من الأمم المتحدة (UN Comtrade) بين الجزائر والصين أو الشركاء الآخرين عبر الرمز الجمركي (HS Code).",
          inputSchema: {
            type: "object",
            properties: {
              reporterCode: {
                type: "string",
                description: "رمز البلد المصرح (مثال: الجزائر = 012، الصين = 156)",
                default: "012",
              },
              partnerCode: {
                type: "string",
                description: "رمز البلد الشريك (مثال: الصين = 156، العالم = 0)",
                default: "156",
              },
              cmdCode: {
                type: "string",
                description: "الرمز الجمركي للمنتج (HS Code) المكون من 2 إلى 6 أرقام (مثال: 730890 لهياكل الحديد وحوامل الكابلات)",
              },
              period: {
                type: "string",
                description: "السنة المطلوبة (مثال: 2023 أو 2022)",
                default: "2023",
              },
              flowCode: {
                type: "string",
                description: "نوع الحركة التجارية: M للواردات (Imports) أو X للصادرات (Exports)",
                default: "M",
              },
            },
            required: ["cmdCode"],
          },
        },
      ],
    };
  });

  // معالجة تشغيل الأداة
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "get_un_comtrade_data") {
      const args = request.params.arguments as {
        reporterCode?: string;
        partnerCode?: string;
        cmdCode: string;
        period?: string;
        flowCode?: string;
      };

      const reporter = args.reporterCode || "012";
      const partner = args.partnerCode || "156";
      const cmdCode = args.cmdCode;
      const period = args.period || "2023";
      const flow = args.flowCode || "M";

      const url = `https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=${reporter}&partnerCode=${partner}&cmdCode=${cmdCode}&period=${period}&flowCode=${flow}`;

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Ocp-Apim-Subscription-Key": apiKey,
            "Accept": "application/json",
          },
        });

        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Comtrade API Error: HTTP ${response.status} - ${response.statusText}`,
              },
            ],
            isError: true,
          };
        }

        const data = await response.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Network Error while fetching Comtrade: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    throw new Error(`Tool not found: ${request.params.name}`);
  });

  return server;
}

// نقطة الدخول لخادم Cloudflare Worker (Remote MCP Endpoint)
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // تفعيل CORS للسماح لأي عميل (Gemini/Claude/Web) بالاتصال
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          status: "online",
          server: "china-algeria-mcp",
          endpoints: ["/sse", "/message"],
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // استقبال رسائل JSON-RPC عبر بروتوكول HTTP POST
    if (request.method === "POST") {
      try {
        const body: any = await request.json();
        const server = createMcpServer(env.COMTRADE_API_KEY);

        // محاكاة استدعاء ميثود الـ MCP
        if (body.method === "tools/list") {
          const handler = (server as any)._requestHandlers.get("tools/list");
          const result = await handler(body);
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        if (body.method === "tools/call") {
          const handler = (server as any)._requestHandlers.get("tools/call");
          const result = await handler(body);
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } }),
          { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
      } catch (e: any) {
        return new Response(
          JSON.stringify({ error: e.message }),
          { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
      }
    }

    return new Response("Method Not Allowed", { status: 405 });
  },
};
