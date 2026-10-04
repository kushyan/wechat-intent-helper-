/* 微信意图助手 · 浏览器模型通道(可选)
 *
 * 移植自 wechat_intent/prompts.py、llm.py 和 analyzer.py 的合并逻辑:
 * 先用离线引擎算出一份兜底结论, 再用模型的输出覆盖能覆盖的部分。
 * 模型不可用(未填 key / 跨域被拦 / 超时)时自动退回离线结果, 并写明原因。
 *
 * 注意: 填进来的 API key 只存在你自己浏览器的 localStorage 里, 直接发给你填的
 * 那个接口, 不经过任何第三方中转。
 */
(function () {
  "use strict";

  var Engine = globalThis.WXEngine;

  // ------------------------------------------------------------ 提示词

  function taxonomyBlock() {
    return Engine.INTENT_SPECS.map(function (spec) {
      return "- " + spec.key + " (" + spec.label + "): " + spec.desc;
    }).join("\n");
  }

  function strategyBlock() {
    return Engine.STRATEGY_ORDER.map(function (key) {
      var spec = Engine.STRATEGY_SPECS[key];
      return "- " + key + " (" + spec.label + "): 语气 " + spec.tone +
        "; 优势 " + spec.advantage +
        "; 风险 " + spec.risk;
    }).join("\n");
  }

  var SYSTEM_TEMPLATE = [
    "你是一个中文社交沟通顾问, 帮用户看懂微信好友的真实意图, 并给出可以直接发出去的回复。",
    "",
    "你要借用成熟的沟通研究方法来判断意图, 而不是只做关键词匹配:",
    "1. 言语行为(speech act): 这句话在\"做\"什么, 是在倾诉、请托、试探, 还是在施压。",
    "2. 面子理论: 这句话有没有让对方面子受损, 你回复时要不要补救。",
    "3. 关系与权力: 你们谁更需要这段关系, 谁在选择权上更主动。",
    "4. 情绪优先原则: 对方在情绪里时先共情, 不要急着给方案。",
    "",
    "意图只能从下面这套标签里选一个:",
    "@@TAXONOMY@@",
    "",
    "回复必须给三条, 分属三种策略(顺序固定):",
    "@@STRATEGIES@@",
    "",
    "硬性要求:",
    "- 三条回复的语气要自然口语, 像真人微信里会发的话, 不要书面腔, 不要客服腔。",
    "- 每条回复都要给 reason(为什么这么回)、risk(这么回的代价)、advantage(这么回的好处)。",
    "- 三条的差别要真实: 一条偏情绪、一条偏把事情说清、一条偏守边界, 不要三条一个味道。",
    "- 不要替用户做决定, 你只是把选项和取舍摆清楚。",
    "- 尊重用户和他人的边界, 不教任何操控、PUA 或欺骗话术。",
    "",
    "只输出 JSON, 不要任何解释文字或 markdown 代码块。格式:",
    "{\"intent_key\": \"...\", \"confidence\": 0.0, \"emotion\": \"...\", \"urgency\": \"高|中|低\", \"read\": \"一句话解读对方\", \"goal\": \"对方想要什么\", \"advice\": \"一句话给用户的建议\", \"signals\": [\"判读依据1\", \"判读依据2\"], \"replies\": [{\"strategy\": \"warm\", \"text\": \"...\", \"reason\": \"...\", \"risk\": \"...\", \"advantage\": \"...\", \"tone\": \"...\"}, {\"strategy\": \"steady\", ...}, {\"strategy\": \"boundary\", ...}]}"
  ].join("\n");

  function buildSystemPrompt() {
    return SYSTEM_TEMPLATE
      .replace("@@TAXONOMY@@", taxonomyBlock())
      .replace("@@STRATEGIES@@", strategyBlock());
  }

  function buildUserPrompt(transcript, contact) {
    var lines = (transcript || []).map(function (item) {
      var speaker = item.is_me ? "我" : (contact || "好友");
      return speaker + ": " + String(item.text == null ? "" : item.text);
    });
    var body = lines.length ? lines.join("\n") : "(无对话内容)";
    return "对话对象: " + (contact || "好友") + "\n" +
      "最近聊天记录(最后一条是对方刚发来的, 需要你判断意图并给回复):\n" +
      body +
      "\n\n请判断对方最后一条消息的意图, 并给出三条可选回复。";
  }

  // ------------------------------------------------------------ 接口调用

  function chatEndpoint(baseUrl) {
    var base = String(baseUrl || "").replace(/\/+$/, "");
    if (base.slice(-17) === "/chat/completions") { return base; }
    return base + "/chat/completions";
  }

  function extractJson(text) {
    var body = String(text || "").trim();
    var fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) { body = fence[1].trim(); }
    var start = body.indexOf("{");
    var end = body.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("模型返回里没有找到 JSON 对象");
    }
    return JSON.parse(body.slice(start, end + 1));
  }

  function readContent(data) {
    var choices = data && data.choices;
    if (Array.isArray(choices) && choices.length) {
      var first = choices[0] || {};
      var message = first.message || {};
      var content = message.content;
      if (typeof content === "string") { return content; }
      if (Array.isArray(content)) {
        return content.map(function (part) {
          return (part && part.text) || "";
        }).join("");
      }
      if (typeof first.text === "string") { return first.text; }
    }
    if (data && typeof data.output_text === "string") { return data.output_text; }
    return null;
  }

  function complete(system, user, config) {
    var endpoint = chatEndpoint(config.baseUrl);
    var payload = {
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: Number(config.temperature) || 0.7,
      stream: false
    };
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = setTimeout(function () { controller.abort(); }, (Number(config.timeout) || 60) * 1000);
    }
    return fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + config.apiKey
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      return response.text().then(function (body) {
        if (!response.ok) {
          throw new Error("接口返回 " + response.status + ": " + body.slice(0, 300));
        }
        var data;
        try {
          data = JSON.parse(body);
        } catch (err) {
          throw new Error("响应不是合法 JSON");
        }
        var content = readContent(data);
        if (!content) { throw new Error("响应里没有 content 字段"); }
        return extractJson(content);
      });
    }).finally(function () {
      if (timer) { clearTimeout(timer); }
    });
  }

  // ------------------------------------------------------------ 结果合并

  function mergeReplies(rawReplies, base) {
    var byStrategy = {};
    if (Array.isArray(rawReplies)) {
      rawReplies.forEach(function (item) {
        if (item && typeof item === "object" && item.text) {
          byStrategy[String(item.strategy || "")] = item;
        }
      });
    }
    return Engine.STRATEGY_ORDER.map(function (strategy, index) {
      var fallback = base.replies[index];
      var item = byStrategy[strategy] ||
        (Array.isArray(rawReplies) && rawReplies.length > index && typeof rawReplies[index] === "object"
          ? rawReplies[index] : null);
      if (!item) { return fallback; }
      var spec = Engine.STRATEGY_SPECS[strategy];
      return {
        strategy: strategy,
        strategy_label: spec.label,
        text: String(item.text || fallback.text),
        reason: String(item.reason || fallback.reason),
        risk: String(item.risk || fallback.risk),
        advantage: String(item.advantage || fallback.advantage),
        tone: String(item.tone || spec.tone),
        recommended: fallback.recommended
      };
    });
  }

  function merge(data, base, contact) {
    var intentKey = String(data.intent_key || "").trim();
    if (!Engine.INTENT_BY_KEY[intentKey]) {
      var label = String(data.intent_label || "").trim();
      intentKey = Engine.INTENT_KEYS.filter(function (key) {
        return Engine.INTENT_BY_KEY[key].label === label;
      })[0] || base.intent_key;
    }
    var spec = Engine.INTENT_BY_KEY[intentKey];

    var confidence = Number(data.confidence);
    if (!isFinite(confidence) || data.confidence === undefined || data.confidence === null || data.confidence === "") {
      confidence = base.confidence;
    }
    confidence = Math.max(0.05, Math.min(0.99, confidence));

    var signals = data.signals;
    if (!Array.isArray(signals) || !signals.length) { signals = base.signals; }

    var urgency = String(data.urgency || base.urgency);
    if (urgency !== "高" && urgency !== "中" && urgency !== "低") { urgency = base.urgency; }

    var rounded = Math.round((confidence + Number.EPSILON) * 1000) / 1000;

    return {
      engine: "llm",
      contact: contact,
      intent_key: intentKey,
      intent_label: spec.label,
      confidence: rounded,
      emotion_label: String(data.emotion || base.emotion_label),
      emotion_score: base.emotion_score,
      urgency: urgency,
      read: String(data.read || spec.read),
      goal: String(data.goal || spec.goal),
      advice: String(data.advice || spec.advice),
      signals: signals.map(function (item) { return String(item); }),
      replies: mergeReplies(data.replies, base),
      transcript: base.transcript,
      note: "",
      confidence_pct: Math.round(rounded * 100)
    };
  }

  function ready(config) {
    return Boolean(config && config.baseUrl && config.apiKey && config.model);
  }

  /* 与 CLI 的 --force 语义一致: auto 优先模型, offline 只走规则, llm 强制模型 */
  function analyze(rawMessages, contact, force, config) {
    var messages = Engine.coerceMessages(rawMessages);
    var base = Engine.analyze(messages, contact);
    var mode = force || "auto";
    var useLlm = (mode === "auto" || mode === "llm") && ready(config);
    if (mode === "offline") { useLlm = false; }
    if (!useLlm) {
      if (mode === "llm" && !ready(config)) {
        base.note = "未配置 API, 已用离线规则引擎";
      }
      return Promise.resolve(base);
    }
    return complete(buildSystemPrompt(), buildUserPrompt(base.transcript, contact), config)
      .then(function (data) {
        return merge(data, base, contact);
      })
      .catch(function (err) {
        var reason = (err && err.message) ? err.message : String(err);
        base.note = "模型不可用(" + reason.slice(0, 120) + "), 已用离线规则引擎";
        return base;
      });
  }

  globalThis.WXLLM = {
    analyze: analyze,
    merge: merge,
    ready: ready,
    complete: complete,
    buildSystemPrompt: buildSystemPrompt,
    buildUserPrompt: buildUserPrompt,
    chatEndpoint: chatEndpoint,
    extractJson: extractJson,
    readContent: readContent
  };
})();
