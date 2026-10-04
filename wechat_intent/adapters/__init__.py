"""微信接入适配器: 把不同桥接方案统一成「消息进 -> 建议出」。"""

from .mock import parse_transcript, load_messages

__all__ = ["parse_transcript", "load_messages"]
