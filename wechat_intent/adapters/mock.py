"""离线消息来源: 手输文本 / JSON 文件。用于测试和本机演示。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, List

from ..schemas import Message

ME_ALIASES = {"我", "me", "自己", "本人", "myself"}


def parse_transcript(text: str, contact: str = "好友") -> List[Message]:
    """把 ``发送者: 内容`` 形式的文本解析成消息列表。

    没有前缀的行按对方(好友)的话处理。
    """
    messages: List[Message] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        sender, content = _split_line(line, contact)
        messages.append(Message(sender=sender, text=content, is_me=sender.lower() in ME_ALIASES))
    return messages


def _split_line(line: str, contact: str) -> tuple[str, str]:
    for sep in (": ", "：", ":"):
        if sep in line:
            head, tail = line.split(sep, 1)
            head = head.strip()
            if head and len(head) <= 24:
                return head, tail.strip()
    return contact, line


def load_messages(path: str) -> List[Message]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        items = raw.get("messages", [])
    else:
        items = raw
    return [Message.from_any(item) for item in items]


def dump_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)
