/* 页面冒烟测试: 没有浏览器也要能验证 docs/index.html 真的跑得起来。
 *
 * 做法是用 node:vm + 一个极简 DOM 桩, 加载真实的 engine.js / llm.js,
 * 再执行 index.html 里那段内联脚本, 检查它渲染出来的 HTML。
 * 顺带覆盖 llm.js 的三条分支: 调用成功、接口报错、没配 key。
 *
 * 运行(仓库根目录):
 *     node tests/test_web_page.mjs
 */

import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const readText = (rel) => readFileSync(new URL(rel, ROOT), "utf8");

// ------------------------------------------------------------------ DOM 桩

function makeElement(id) {
  const classes = new Set();
  const el = {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    open: false,
    disabled: false,
    style: {},
    dataset: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, on) => {
        const wanted = on === undefined ? !classes.has(name) : Boolean(on);
        if (wanted) { classes.add(name); } else { classes.delete(name); }
        return wanted;
      }
    },
    addEventListener() {},
    setAttribute() {},
    focus() {},
    select() {},
    appendChild() {},
    removeChild() {},
    querySelector: () => null,
    querySelectorAll: () => []
  };
  return el;
}

// ------------------------------------------------------------------ 用例

const failures = [];
function check(label, condition, detail) {
  if (condition) { return; }
  failures.push(label + (detail ? " → " + detail : ""));
}

function openAiResponse(payload) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({
      choices: [{ message: { role: "assistant", content: JSON.stringify(payload) } }]
    }))
  };
}

async function main() {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) { elements.set(id, makeElement(id)); }
      return elements.get(id);
    },
    addEventListener() {},
    createElement: (tag) => makeElement(tag),
    body: makeElement("body")
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    document,
    navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error("测试环境默认不联网"))
  };
  vm.createContext(context);

  vm.runInContext(readText("docs/engine.js"), context, { filename: "docs/engine.js" });
  vm.runInContext(readText("docs/llm.js"), context, { filename: "docs/llm.js" });
  check("engine.js 导出 WXEngine", Boolean(context.WXEngine));
  check("llm.js 导出 WXLLM", Boolean(context.WXLLM));

  // index.html 里的内联脚本(跳过带 src 的两个)
  const html = readText("docs/index.html");
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .join("\n");
  check("index.html 里有内联脚本", inline.trim().length > 0);

  vm.runInContext(inline, context, { filename: "docs/index.html#inline" });

  // 页面加载时会自动跑一遍示例, 等微任务跑完
  await new Promise((resolve) => setTimeout(resolve, 30));

  const out = elements.get("out");
  const rendered = out ? out.innerHTML : "";

  check("页面渲染出了意图判读", rendered.includes('class="readout"'));
  check("示例对话判读为「情绪倾诉」", rendered.includes("情绪倾诉"),
    rendered.slice(0, 160));
  check("渲染了三条回复", (rendered.match(/<article class="reply"/g) || []).length === 3,
    "实际 " + (rendered.match(/<article class="reply"/g) || []).length + " 条");
  check("标出了推荐项", rendered.includes("推荐"));
  check("三条回复都有理由/风险/优势",
    (rendered.match(/理由/g) || []).length === 3 &&
    (rendered.match(/风险/g) || []).length === 3 &&
    (rendered.match(/优势/g) || []).length === 3);
  check("没有未填充的占位符", !rendered.includes("{name_p}") && !rendered.includes("{time}"));

  const mode = elements.get("mode");
  check("未配置 key 时状态显示离线规则引擎", mode && mode.textContent === "离线规则引擎",
    mode && mode.textContent);
  const engineTag = elements.get("engineTag");
  check("结果标注为离线规则", engineTag && engineTag.textContent === "离线规则",
    engineTag && engineTag.textContent);

  // ---- llm.js: 模型返回正常, 走合并逻辑
  const modelPayload = {
    intent_key: "money",
    confidence: 0.91,
    emotion: "中性",
    urgency: "高",
    read: "模型给的解读",
    goal: "模型给的目标",
    advice: "模型给的建议",
    signals: ["模型给的依据"],
    replies: [
      { strategy: "warm", text: "模型 warm", reason: "r1", risk: "k1", advantage: "a1", tone: "t1" },
      { strategy: "steady", text: "模型 steady", reason: "r2", risk: "k2", advantage: "a2", tone: "t2" },
      { strategy: "boundary", text: "模型 boundary", reason: "r3", risk: "k3", advantage: "a3", tone: "t3" }
    ]
  };
  let seenRequest = null;
  context.fetch = (url, init) => {
    seenRequest = { url, init };
    return Promise.resolve(openAiResponse(modelPayload));
  };
  const llmResult = await context.WXLLM.analyze(
    [{ sender: "老同学", text: "能不能借我两万周转" }], "老同学", "auto",
    { baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-test", model: "deepseek-chat" }
  );
  check("模型通道: engine=llm", llmResult.engine === "llm", llmResult.engine);
  check("模型通道: 用上模型的回复", llmResult.replies[0].text === "模型 warm",
    llmResult.replies[0].text);
  check("模型通道: 置信度取模型值", Math.abs(llmResult.confidence - 0.91) < 0.001,
    String(llmResult.confidence));
  check("模型通道: 请求打到 /chat/completions",
    seenRequest && seenRequest.url === "https://api.deepseek.com/v1/chat/completions",
    seenRequest && seenRequest.url);
  check("模型通道: 带上 Bearer 头",
    seenRequest && seenRequest.init.headers.Authorization === "Bearer sk-test",
    seenRequest && seenRequest.init.headers.Authorization);
  check("模型通道: 请求体是标准 chat completions",
    seenRequest && JSON.parse(seenRequest.init.body).messages.length === 2);

  // ---- llm.js: 接口报错必须退回离线结果, 并且写明原因
  context.fetch = () => Promise.resolve({
    ok: false,
    status: 401,
    text: () => Promise.resolve("unauthorized")
  });
  const fallback = await context.WXLLM.analyze(
    [{ sender: "小雨", text: "最近好累，撑不住了" }], "小雨", "auto",
    { baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-bad", model: "deepseek-chat" }
  );
  check("接口报错时退回离线引擎", fallback.engine === "heuristic", fallback.engine);
  check("接口报错时写明原因", fallback.note.includes("模型不可用"), fallback.note);
  check("退回后判读仍然正确", fallback.intent_key === "venting", fallback.intent_key);

  // ---- llm.js: 强制走模型但没配 key
  const noKey = await context.WXLLM.analyze(
    [{ sender: "小雨", text: "在吗" }], "小雨", "llm", { baseUrl: "", apiKey: "", model: "" }
  );
  check("强制模型但没配 key 时给出提示",
    noKey.note === "未配置 API, 已用离线规则引擎", noKey.note);

  if (failures.length) {
    console.error("页面冒烟测试失败 " + failures.length + " 项:");
    failures.forEach((line) => console.error("  - " + line));
    process.exit(1);
  }
  console.log("页面冒烟测试通过: 渲染 1 次自动分析 / 3 条回复 / 模型通道 3 条分支");
}

main().catch((err) => {
  console.error("页面冒烟测试异常:", err);
  process.exit(1);
});
