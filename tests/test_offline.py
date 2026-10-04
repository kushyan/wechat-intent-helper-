"""离线引擎的回归测试, 不联网、不需要 API key。"""

from __future__ import annotations

import unittest

from wechat_intent.analyzer import Analyzer
from wechat_intent.intents import INTENT_BY_KEY, STRATEGY_ORDER


def run_case(text, contact="好友"):
    analyzer = Analyzer(enable_llm=False)
    return analyzer.analyze([{"sender": contact, "text": text}], contact=contact)


class IntentTests(unittest.TestCase):
    def test_venting(self):
        result = run_case("最近真的好累，感觉快撑不住了", "小雨")
        self.assertEqual(result.intent_key, "venting")

    def test_money(self):
        result = run_case("兄弟能不能先借我两万周转一下，下个月还你", "老同学")
        self.assertEqual(result.intent_key, "money")

    def test_promotion(self):
        result = run_case("这个副业能躺赚，限时名额，扫码进群", "阿哲")
        self.assertEqual(result.intent_key, "promotion")

    def test_invitation(self):
        result = run_case("周末那家新开的店，一起去吃吗", "小林")
        self.assertEqual(result.intent_key, "invitation")

    def test_followup_nudge(self):
        analyzer = Analyzer(enable_llm=False)
        result = analyzer.analyze(
            [
                {"sender": "小满", "text": "在吗"},
                {"sender": "小满", "text": "在吗在吗"},
                {"sender": "小满", "text": "你怎么一直不回我"},
            ],
            contact="小满",
        )
        self.assertEqual(result.intent_key, "followup_nudge")

    def test_apology(self):
        result = run_case("对不起，昨天是我不对，别生气了好吗")
        self.assertEqual(result.intent_key, "apology")

    def test_empty_input_still_returns_analysis(self):
        result = run_case("")
        self.assertTrue(result.intent_label)
        self.assertEqual(len(result.replies), 3)


class ReplyShapeTests(unittest.TestCase):
    def test_every_intent_has_three_complete_replies(self):
        analyzer = Analyzer(enable_llm=False)
        for key in INTENT_BY_KEY:
            spec = INTENT_BY_KEY[key]
            for strategy in STRATEGY_ORDER:
                self.assertIn(strategy, spec["replies"], key + " 缺少 " + strategy)

    def test_replies_have_reason_risk_advantage(self):
        for text in [
            "在吗",
            "最近好累，撑不住了",
            "能不能借我点钱周转",
            "周末一起去吃饭吗",
            "扫码进群，限时优惠",
            "你怎么这样，太过分了",
            "对不起是我错了",
        ]:
            result = run_case(text)
            self.assertEqual(len(result.replies), 3)
            for reply in result.replies:
                self.assertTrue(reply.text.strip())
                self.assertTrue(reply.reason.strip())
                self.assertTrue(reply.risk.strip())
                self.assertTrue(reply.advantage.strip())
                self.assertTrue(reply.tone.strip())

    def test_exactly_one_recommended(self):
        result = run_case("周末一起去吃饭吗")
        self.assertEqual(sum(1 for reply in result.replies if reply.recommended), 1)

    def test_no_unfilled_placeholders(self):
        result = run_case("周末一起去吃饭吗", "小林")
        blob = " ".join(reply.text for reply in result.replies)
        self.assertNotIn("{", blob)
        self.assertNotIn("}", blob)


if __name__ == "__main__":
    unittest.main()
