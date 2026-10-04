"""真实微信接入(可选): 通过 wcferry 监听 PC 微信消息。

设计成"建议模式": 只在终端打印三条候选回复, 由人决定发什么。
默认不自动发送; 需要显式加 --allow-send 才会在选中后发送。

依赖: pip install wcferry  (Windows, 需已登录 PC 微信)
"""

from __future__ import annotations

import time
from typing import Optional

from ..analyzer import Analyzer
from ..schemas import Message

try:  # 可选依赖
    from wcferry import Wcf  # type: ignore
except Exception:  # pragma: no cover
    Wcf = None  # type: ignore


class WeChatFerryBridge:
    def __init__(
        self,
        analyzer: Analyzer,
        contact_filter: Optional[str] = None,
        allow_send: bool = False,
    ):
        self.analyzer = analyzer
        self.contact_filter = contact_filter
        self.allow_send = allow_send
        self.history: list[Message] = []

    def run(self) -> None:
        if Wcf is None:
            raise RuntimeError(
                "没找到 wcferry。请先执行: pip install wcferry, 并确保已登录 PC 微信。"
            )
        wcf = Wcf()
        print("[bridge] 已连接微信, 正在监听消息 (Ctrl+C 退出)")
        try:
            while True:
                msg = wcf.get_msg()
                if msg is None:
                    time.sleep(0.3)
                    continue
                self._handle(wcf, msg)
        except KeyboardInterrupt:
            print("\n[bridge] 已停止监听")

    def _handle(self, wcf, msg) -> None:
        if getattr(msg, "from_self", None):
            return
        sender = getattr(msg, "sender_remark", "") or getattr(msg, "sender", "")
        if self.contact_filter and self.contact_filter not in sender:
            return
        content = (getattr(msg, "content", "") or "").strip()
        if not content:
            return

        self.history.append(Message(sender=sender, text=content, is_me=False))
        self.history = self.history[-8:]
        result = self.analyzer.analyze(
            [{"sender": m.sender, "text": m.text, "is_me": m.is_me} for m in self.history],
            contact=sender,
        )
        self._print(result)

        if self.allow_send:
            choice = input("[bridge] 回复序号 1/2/3 (回车跳过): ").strip()
            if choice in {"1", "2", "3"}:
                text = result.replies[int(choice) - 1].text
                try:
                    wcf.send_text(text, sender)
                    self.history.append(Message(sender=sender, text=text, is_me=True))
                    print("[bridge] 已发送")
                except Exception as exc:  # pragma: no cover
                    print("[bridge] 发送失败:", exc)

    @staticmethod
    def _print(result) -> None:
        print("\n" + "=" * 56)
        print("意图:", result.intent_label, "| 置信度", str(round(result.confidence * 100)) + "%",
              "| 情绪:", result.emotion_label, "| 紧急:", result.urgency)
        print("解读:", result.read)
        for index, reply in enumerate(result.replies, 1):
            star = "  [推荐]" if reply.recommended else ""
            print("-" * 56)
            print(str(index) + ". [" + reply.strategy_label + "]" + star)
            print("   " + reply.text)
            print("   理由:" + reply.reason)
            print("   风险:" + reply.risk)
            print("   优势:" + reply.advantage)
