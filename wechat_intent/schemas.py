"""统一的数据结构, 离线引擎和 LLM 引擎都产出同一套结构。"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class Message:
    sender: str
    text: str
    is_me: bool = False
    ts: Optional[str] = None

    @classmethod
    def from_any(cls, raw: Any) -> "Message":
        if isinstance(raw, Message):
            return raw
        if isinstance(raw, dict):
            return cls(
                sender=str(raw.get("sender") or raw.get("from") or "好友"),
                text=str(raw.get("text") or raw.get("content") or raw.get("msg") or ""),
                is_me=bool(raw.get("is_me") or raw.get("from_me") or raw.get("self")),
                ts=raw.get("ts") or raw.get("time"),
            )
        return cls(sender="好友", text=str(raw))


@dataclass
class ReplyOption:
    strategy: str
    strategy_label: str
    text: str
    reason: str
    risk: str
    advantage: str
    tone: str
    recommended: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Analysis:
    engine: str
    contact: str
    intent_key: str
    intent_label: str
    confidence: float
    emotion_label: str
    emotion_score: float
    urgency: str
    read: str
    goal: str
    advice: str
    signals: List[str] = field(default_factory=list)
    replies: List[ReplyOption] = field(default_factory=list)
    transcript: List[Dict[str, Any]] = field(default_factory=list)
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["confidence_pct"] = round(self.confidence * 100)
        return data


def coerce_messages(raw_messages: Any) -> List[Message]:
    if isinstance(raw_messages, str):
        lines = [line.strip() for line in raw_messages.splitlines() if line.strip()]
        return [Message(sender="好友", text=line) for line in lines]
    if isinstance(raw_messages, dict):
        raw_messages = raw_messages.get("messages", [])
    return [Message.from_any(item) for item in (raw_messages or [])]
