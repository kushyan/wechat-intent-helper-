"""本地服务: 网页工作台 + 给微信桥接层调用的 HTTP 接口。"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List

from .adapters.mock import parse_transcript
from .analyzer import Analyzer
from .schemas import coerce_messages

WEB_DIR = Path(__file__).parent / "web"
STATE_LOCK = threading.Lock()
STATE: Dict[str, Any] = {"latest": None, "feed": [], "selections": []}


class Handler(BaseHTTPRequestHandler):
    analyzer: Analyzer = None  # type: ignore

    def log_message(self, fmt: str, *args: Any) -> None:  # 静音默认日志
        return

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: Any) -> None:
        self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _read_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        try:
            data = json.loads(raw)
            return data if isinstance(data, dict) else {"messages": data}
        except json.JSONDecodeError:
            return {"text": raw}

    # ---- GET ----
    def do_GET(self) -> None:
        if self.path in ("/", "/index.html"):
            html = (WEB_DIR / "index.html").read_bytes()
            self._send(200, html, "text/html; charset=utf-8")
            return
        if self.path == "/api/health":
            config = self.analyzer.config
            self._json(200, {
                "ok": True,
                "llm_ready": self.analyzer.client.ready,
                "model": config.model if self.analyzer.client.ready else "offline-rules",
                "base_url": config.base_url,
            })
            return
        if self.path == "/api/state":
            with STATE_LOCK:
                self._json(200, {"latest": STATE["latest"], "feed": STATE["feed"][-20:]})
            return
        self._json(404, {"error": "not found"})

    # ---- POST ----
    def do_POST(self) -> None:
        if self.path == "/api/analyze":
            self._json(200, self._analyze(self._read_body()))
            return
        if self.path == "/api/ingest":
            payload = self._read_body()
            result = self._analyze(payload)
            with STATE_LOCK:
                STATE["latest"] = result
                STATE["feed"].append({
                    "contact": result.get("contact"),
                    "intent": result.get("intent_label"),
                    "text": (result.get("transcript") or [{}])[-1].get("text", ""),
                })
            self._json(200, result)
            return
        if self.path == "/api/select":
            payload = self._read_body()
            with STATE_LOCK:
                STATE["selections"].append(payload)
            self._json(200, {"ok": True})
            return
        self._json(404, {"error": "not found"})

    def _analyze(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        contact = str(payload.get("contact") or "好友")
        force = str(payload.get("force") or "auto")
        if payload.get("messages"):
            messages = coerce_messages(payload["messages"])
        else:
            messages = parse_transcript(str(payload.get("text") or ""), contact)
        if not messages:
            return {"error": "没有收到消息内容"}
        return self.analyzer.analyze(messages, contact=contact, force=force).to_dict()


def serve(analyzer: Analyzer, host: str = "127.0.0.1", port: int = 8765) -> None:
    Handler.analyzer = analyzer
    server = ThreadingHTTPServer((host, port), Handler)
    url = "http://" + host + ":" + str(port)
    mode = "LLM: " + analyzer.config.model if analyzer.client.ready else "离线规则引擎"
    print("[server] 已启动:", url)
    print("[server] 当前模式:", mode)
    print("[server] 桥接接口: POST " + url + "/api/ingest")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[server] 已停止")
    finally:
        server.server_close()
