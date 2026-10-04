"""本地服务冒烟测试: 真实起一个 HTTP 服务, 验证网页与桥接接口。"""

from __future__ import annotations

import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

from wechat_intent.analyzer import Analyzer
from wechat_intent.server import Handler


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Handler.analyzer = Analyzer(enable_llm=False)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def _get(self, path):
        url = "http://127.0.0.1:" + str(self.port) + path
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.status, response.read().decode("utf-8")

    def _post(self, path, payload):
        url = "http://127.0.0.1:" + str(self.port) + path
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_health(self):
        status, body = self._get("/api/health")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data["ok"])
        self.assertFalse(data["llm_ready"])

    def test_dashboard_html(self):
        status, body = self._get("/")
        self.assertEqual(status, 200)
        self.assertIn("微信意图助手", body)

    def test_analyze_text(self):
        status, data = self._post(
            "/api/analyze",
            {"text": "小雨: 最近好累，撑不住了", "contact": "小雨", "force": "offline"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["intent_key"], "venting")
        self.assertEqual(len(data["replies"]), 3)
        self.assertEqual(data["engine"], "heuristic")

    def test_analyze_messages(self):
        status, data = self._post(
            "/api/analyze",
            {
                "messages": [{"sender": "老同学", "text": "能不能先借我两万周转"}],
                "contact": "老同学",
                "force": "offline",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["intent_key"], "money")

    def test_ingest_updates_state(self):
        status, data = self._post(
            "/api/ingest",
            {"messages": [{"sender": "阿哲", "text": "限时优惠，扫码进群"}], "contact": "阿哲"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["intent_key"], "promotion")
        status, body = self._get("/api/state")
        state = json.loads(body)
        self.assertIsNotNone(state["latest"])


if __name__ == "__main__":
    unittest.main()
