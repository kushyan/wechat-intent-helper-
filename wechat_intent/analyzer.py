"""分析编排: 优先用 LLM, 失败或未配置时自动降级到离线规则引擎。"""

from __future__ import annotations

from typing import Any, List, Optional

from . import heuristics
from .config import Config, load_config
from .intents import FALLBACK_INTENT, INTENT_BY_KEY, STRATEGY_ORDER, STRATEGY_SPECS
from .llm import LLMClient, LLMError
from .prompts import build_system_prompt, build_user_prompt
from .schemas import Analysis, Message, ReplyOption, coerce_messages


class Analyzer:
    def __init__(self, config: Optional[Config] = None, enable_llm: bool = True):
        self.config = config or load_config()
        self.client = LLMClient(self.config)
        self.enable_llm = enable_llm

    def analyze(
        self,
        raw_messages: Any,
        contact: str = "好友",
        force: str = "auto",
    ) -> Analysis:
        messages: List[Message] = coerce_messages(raw_messages)
        base = heuristics.analyze(messages, contact)

        use_llm = force in ("auto", "llm") and self.enable_llm and self.client.ready
        if force == "offline":
            use_llm = False
        if not use_llm:
            if force == "llm" and not self.client.ready:
                base.note = "未配置 API, 已用离线规则引擎"
            return base

        transcript = [{"sender": m.sender, "text": m.text, "is_me": m.is_me} for m in messages]
        try:
            data = self.client.complete_json(
                build_system_prompt(),
                build_user_prompt(transcript, contact),
            )
        except LLMError as exc:
            base.note = "LLM 不可用(" + str(exc)[:120] + "), 已用离线规则引擎"
            return base

        merged = self._merge(data, base, contact)
        merged.engine = "llm"
        return merged

    def _merge(self, data: dict, base: Analysis, contact: str) -> Analysis:
        intent_key = str(data.get("intent_key") or "").strip()
        if intent_key not in INTENT_BY_KEY:
            label = str(data.get("intent_label") or "").strip()
            intent_key = next(
                (spec["key"] for spec in INTENT_BY_KEY.values() if spec["label"] == label),
                base.intent_key,
            )
        spec = INTENT_BY_KEY[intent_key]

        try:
            confidence = float(data.get("confidence", base.confidence))
        except (TypeError, ValueError):
            confidence = base.confidence
        confidence = max(0.05, min(0.99, confidence))

        replies = self._merge_replies(data.get("replies"), base)
        signals = data.get("signals")
        if not isinstance(signals, list) or not signals:
            signals = base.signals

        urgency = str(data.get("urgency") or base.urgency)
        if urgency not in ("高", "中", "低"):
            urgency = base.urgency

        return Analysis(
            engine="llm",
            contact=contact,
            intent_key=intent_key,
            intent_label=spec["label"],
            confidence=round(confidence, 3),
            emotion_label=str(data.get("emotion") or base.emotion_label),
            emotion_score=base.emotion_score,
            urgency=urgency,
            read=str(data.get("read") or spec["read"]),
            goal=str(data.get("goal") or spec["goal"]),
            advice=str(data.get("advice") or spec["advice"]),
            signals=[str(item) for item in signals],
            replies=replies,
            transcript=base.transcript,
        )

    def _merge_replies(self, raw_replies: Any, base: Analysis) -> List[ReplyOption]:
        by_strategy = {}
        if isinstance(raw_replies, list):
            for item in raw_replies:
                if isinstance(item, dict) and item.get("text"):
                    by_strategy[str(item.get("strategy") or "")] = item

        merged: List[ReplyOption] = []
        for index, strategy in enumerate(STRATEGY_ORDER):
            fallback = base.replies[index]
            item = by_strategy.get(strategy) or (raw_replies[index] if isinstance(raw_replies, list) and len(raw_replies) > index and isinstance(raw_replies[index], dict) else None)
            if not item:
                merged.append(fallback)
                continue
            spec = STRATEGY_SPECS[strategy]
            merged.append(
                ReplyOption(
                    strategy=strategy,
                    strategy_label=spec["label"],
                    text=str(item.get("text") or fallback.text),
                    reason=str(item.get("reason") or fallback.reason),
                    risk=str(item.get("risk") or fallback.risk),
                    advantage=str(item.get("advantage") or fallback.advantage),
                    tone=str(item.get("tone") or spec["tone"]),
                    recommended=fallback.recommended,
                )
            )
        return merged
