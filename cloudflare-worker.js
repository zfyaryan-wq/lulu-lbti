const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const CHAT_MODEL = "deepseek-ai/DeepSeek-V4-Flash";
const TTS_MODEL = "FunAudioLLM/CosyVoice2-0.5B";
const STATIC_BASE = "https://raw.githubusercontent.com/zfyaryan-wq/lulu-lbti/main";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function getApiKey(env) {
  if (!env.SILICONFLOW_API_KEY) {
    throw new Error("Missing SILICONFLOW_API_KEY");
  }
  return env.SILICONFLOW_API_KEY;
}

function getMime(pathname) {
  const lower = pathname.toLowerCase();
  const ext = Object.keys(MIME_TYPES).find((item) => lower.endsWith(item));
  return ext ? MIME_TYPES[ext] : "application/octet-stream";
}

function getStaticPath(url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") return "/index.html";
  if (pathname.endsWith("/")) return `${pathname}index.html`;
  if (pathname.includes("..")) return "/index.html";
  return pathname;
}

async function handleStatic(request) {
  const url = new URL(request.url);
  const pathname = getStaticPath(url);
  const upstream = await fetch(`${STATIC_BASE}${pathname}`, {
    headers: {
      "User-Agent": "lulu-lbti-worker"
    }
  });

  if (!upstream.ok) {
    const index = await fetch(`${STATIC_BASE}/index.html`, {
      headers: {
        "User-Agent": "lulu-lbti-worker"
      }
    });
    return new Response(index.body, {
      status: index.ok ? 200 : 404,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=120"
      }
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": getMime(pathname),
      "Cache-Control": pathname === "/index.html" ? "public, max-age=60" : "public, max-age=86400"
    }
  });
}

function trimMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-10)
    .filter((message) => message && typeof message.content === "string")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content.slice(0, 1200)
    }));
}

async function handleChat(request, env) {
  const body = await request.json();
  const result = typeof body.result === "string" ? body.result.slice(0, 80) : "";
  const messages = trimMessages(body.messages);

  const systemPrompt = [
    "你是水豚噜噜人格测试里的 AI 小噜噜。",
    "你的说话风格：可爱、嘴贫、短句、会吐槽、会围绕鼻孔/噜鼻/无孔可寻/指嘴为鼻这些梗玩笑。",
    "你可以和用户吐槽他的测试结果，但不要攻击用户，不要输出长篇大道理。",
    "每次回复 1 到 4 句，尽量有一个好笑的噜噜判断。",
    result ? `用户当前 LBTI 结果：${result}。` : "用户还没有提供 LBTI 结果。"
  ].join("\n");

  const response = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getApiKey(env)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      temperature: 0.9,
      max_tokens: 320,
      reasoning_effort: "high"
    })
  });

  const text = await response.text();
  if (!response.ok) {
    return json({ error: "chat_failed", detail: text.slice(0, 500) }, response.status);
  }

  const data = JSON.parse(text);
  return json({
    reply: data.choices?.[0]?.message?.content?.trim() || "噜噜刚刚无孔可寻，没想出来。"
  });
}

async function handleTts(request, env) {
  const body = await request.json();
  const text = String(body.text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

  if (!text) {
    return json({ error: "empty_text" }, 400);
  }

  const payload = {
    model: TTS_MODEL,
    input: text,
    response_format: "mp3",
    sample_rate: 32000,
    speed: 1.08,
    gain: 0
  };

  if (env.SILICONFLOW_TTS_VOICE) {
    payload.voice = env.SILICONFLOW_TTS_VOICE;
  }

  const response = await fetch("https://api.siliconflow.cn/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getApiKey(env)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text();
    return json({ error: "tts_failed", detail: detail.slice(0, 500) }, response.status);
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/api/chat") {
        return handleChat(request, env);
      }
      if (request.method === "POST" && url.pathname === "/api/tts") {
        return handleTts(request, env);
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({
          ok: true,
          service: "lulu-ai-worker",
          hasKey: Boolean(env.SILICONFLOW_API_KEY),
          static: "github-raw"
        });
      }
      if (request.method === "GET") {
        return handleStatic(request);
      }
      return json({ ok: true, service: "lulu-ai-worker" });
    } catch (error) {
      return json({ error: "worker_error", detail: error.message }, 500);
    }
  }
};
