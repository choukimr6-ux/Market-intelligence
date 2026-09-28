interface Env {
  COMTRADE_API_KEY: string;
}

// قائمة الأدوات المصرح بها للنموذج
const TOOLS = [
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
          default: "156",
        },
        partnerCode: {
          type: "string",
          description: "رمز البلد الشريك (مثال: الجزائر = 012، الصين = 156)",
          default: "012",
        },
        cmdCode: {
          type: "string",
          description: "الرمز الجمركي للمنتج المكون من 2 إلى 6 أرقام (مثال: 730890)",
        },
        period: {
          type: "string",
          description: "السنة المطلوبة (مثال: 2023)",
          default: "2023",
        },
        flowCode: {
          type: "string",
          description: "حركة التجارة: X للصادرات الصينية (Mirror data) أو M للواردات",
          default: "X",
        },
      },
      required: ["cmdCode"],
    },
  },
];

// تنفيذ استدعاء واجهة Comtrade
async function executeComtradeTool(args: any, apiKey: string) {
  const reporter = args.reporterCode || "156";
  const partner = args.partnerCode || "012";
  const cmdCode = args.cmdCode;
  const period = args.period || "2023";
  const flow = args.flowCode || "X";

  const url = `https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=${reporter}&partnerCode=${partner}&cmdCode=${cmdCode}&period=${period}&flowCode=${flow}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      return {
        content: [{ type: "text", text: `Comtrade API Error: HTTP ${res.status} - ${res.statusText}` }],
        isError: true,
      };
    }

    const data = await res.json();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ترويسات CORS الأساسية
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. فتح قناة SSE (Server-Sent Events) المطلوبة لـ Claude و mcp-remote
    if (url.pathname === "/sse" || url.pathname === "/") {
      const sessionId = crypto.randomUUID();
      const endpointUrl = `${url.origin}/message?sessionId=${sessionId}`;

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // إرسال نقطة استقبال الرسائل فور إنشاء الاتصال
      writer.write(encoder.encode(`event: endpoint\ndata: ${endpointUrl}\n\n`));

      return new Response(readable, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // 2. استقبال أوامر JSON-RPC الخاصة بـ MCP
    if (url.pathname === "/message" && request.method === "POST") {
      try {
        const body: any = await request.json();

        // مرحلة تهيئة الاتصال والتحقق من الأدوات (Handshake)
        if (body.method === "initialize") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "china-algeria-mcp", version: "1.0.0" },
              },
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // إشعار اكتمال التهيئة
        if (body.method === "notifications/initialized") {
          return new Response(JSON.stringify({ jsonrpc: "2.0" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // عرض قائمة الأدوات
        if (body.method === "tools/list") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: { tools: TOOLS },
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // تشغيل أداة معينة
        if (body.method === "tools/call") {
          const toolName = body.params?.name;
          const toolArgs = body.params?.arguments || {};

          if (toolName === "get_un_comtrade_data") {
            const toolResult = await executeComtradeTool(toolArgs, env.COMTRADE_API_KEY);
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: toolResult,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              error: { code: -32601, message: `Tool not found: ${toolName}` },
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {},
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({ error: err.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};
