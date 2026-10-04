"""用 Python 离线引擎跑一遍对照语料, 把结果固化成 JS 侧的期望值。

用法(在仓库根目录):
    python tools/make_parity_fixture.py

docs/engine.js 是 heuristics.py 的移植, 改任何一边的规则后都应该重跑本脚本,
再执行 `node tests/test_web_engine.mjs` 确认两边仍然一致。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from wechat_intent.adapters.mock import parse_transcript  # noqa: E402
from wechat_intent.analyzer import Analyzer  # noqa: E402
from wechat_intent.schemas import coerce_messages  # noqa: E402

CASES_PATH = ROOT / "tools" / "parity_cases.json"
OUT_PATH = ROOT / "tests" / "fixtures" / "parity_expected.json"


def build_messages(case: dict):
    contact = case.get("contact") or "好友"
    if case.get("transcript"):
        return parse_transcript(case["transcript"], contact)
    return coerce_messages(case.get("messages") or [])


def main() -> int:
    cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))["cases"]
    analyzer = Analyzer(enable_llm=False)

    results = []
    for case in cases:
        contact = case.get("contact") or "好友"
        messages = build_messages(case)
        analysis = analyzer.analyze(messages, contact=contact, force="offline")
        results.append({
            "name": case["name"],
            "contact": contact,
            # 原始输入一并存下, JS 侧要拿它重跑一遍
            "transcript": case.get("transcript"),
            "messages": case.get("messages"),
            "expected": analysis.to_dict(),
        })

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps({"cases": results}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("已写入", OUT_PATH, "共", len(results), "条用例")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
