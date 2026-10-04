/* 对照测试: docs/engine.js 必须和 Python 离线引擎给出同样的结论。
 *
 * 期望值由 Python 侧生成(tools/make_parity_fixture.py), 这里用 node:vm 加载
 * 浏览器用的那份 engine.js, 逐字段比对。
 *
 * 运行(仓库根目录):
 *     node tests/test_web_engine.mjs
 */

import { readFileSync } from "node:fs";
import vm from "node:vm";

const FIXTURE = new URL("./fixtures/parity_expected.json", import.meta.url);
const ENGINE = new URL("../docs/engine.js", import.meta.url);

const TOLERANCE = 0.001;
const EXACT_FIELDS = [
  "engine", "contact", "intent_key", "intent_label", "emotion_label",
  "urgency", "read", "goal", "advice", "note"
];
const NUMBER_FIELDS = ["confidence", "emotion_score"];
const REPLY_FIELDS = [
  "strategy", "strategy_label", "text", "reason", "risk", "advantage", "tone", "recommended"
];

function loadEngine() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(ENGINE, "utf8"), sandbox, { filename: "docs/engine.js" });
  if (!sandbox.WXEngine) {
    throw new Error("docs/engine.js 没有导出 WXEngine");
  }
  return sandbox.WXEngine;
}

function buildMessages(engine, testCase) {
  const contact = testCase.contact || "好友";
  if (testCase.transcript) {
    return engine.parseTranscript(testCase.transcript, contact);
  }
  return engine.coerceMessages(testCase.messages || []);
}

function diff(name, expected, actual, problems) {
  const at = (field) => name + " → " + field;

  for (const field of EXACT_FIELDS) {
    if (expected[field] !== actual[field]) {
      problems.push(at(field) + ": Python=" + JSON.stringify(expected[field]) +
        " JS=" + JSON.stringify(actual[field]));
    }
  }
  for (const field of NUMBER_FIELDS) {
    if (Math.abs(Number(expected[field]) - Number(actual[field])) > TOLERANCE) {
      problems.push(at(field) + ": Python=" + expected[field] + " JS=" + actual[field]);
    }
  }
  if (Math.abs(Number(expected.confidence_pct) - Number(actual.confidence_pct)) > 1) {
    problems.push(at("confidence_pct") + ": Python=" + expected.confidence_pct +
      " JS=" + actual.confidence_pct);
  }

  const expectedSignals = JSON.stringify(expected.signals || []);
  const actualSignals = JSON.stringify(actual.signals || []);
  if (expectedSignals !== actualSignals) {
    problems.push(at("signals") + ": Python=" + expectedSignals + " JS=" + actualSignals);
  }

  const expectedTranscript = JSON.stringify(expected.transcript || []);
  const actualTranscript = JSON.stringify(actual.transcript || []);
  if (expectedTranscript !== actualTranscript) {
    problems.push(at("transcript") + ": Python=" + expectedTranscript + " JS=" + actualTranscript);
  }

  const expectedReplies = expected.replies || [];
  const actualReplies = actual.replies || [];
  if (expectedReplies.length !== actualReplies.length) {
    problems.push(at("replies.length") + ": Python=" + expectedReplies.length +
      " JS=" + actualReplies.length);
  } else {
    expectedReplies.forEach((reply, index) => {
      for (const field of REPLY_FIELDS) {
        if (reply[field] !== actualReplies[index][field]) {
          problems.push(name + " → replies[" + index + "]." + field +
            ": Python=" + JSON.stringify(reply[field]) +
            " JS=" + JSON.stringify(actualReplies[index][field]));
        }
      }
    });
  }
}

function main() {
  const engine = loadEngine();
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const cases = fixture.cases || [];
  const problems = [];
  let replyCount = 0;

  for (const testCase of cases) {
    const expected = testCase.expected;
    const messages = buildMessages(engine, testCase);
    const actual = engine.analyze(messages, expected.contact);
    replyCount += (actual.replies || []).length;
    diff(testCase.name, expected, actual, problems);
  }

  if (problems.length) {
    console.error("对照失败 " + problems.length + " 处:");
    problems.slice(0, 40).forEach((line) => console.error("  - " + line));
    if (problems.length > 40) {
      console.error("  ... 其余 " + (problems.length - 40) + " 处省略");
    }
    process.exit(1);
  }

  console.log("对照通过: " + cases.length + " 条用例 / " + replyCount + " 条回复, 与 Python 引擎完全一致");
}

main();
