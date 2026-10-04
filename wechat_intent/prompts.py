"""给 LLM 的提示词: 约束它必须输出结构化的三选一建议。"""

from __future__ import annotations

from typing import Any, Dict, List

from .intents import INTENT_SPECS, STRATEGY_ORDER, STRATEGY_SPECS


def _taxonomy_block() -> str:
    lines = []
    for spec in INTENT_SPECS:
        lines.append("- " + spec["key"] + " (" + spec["label"] + "): " + spec["desc"])
    return "\n".join(lines)


def _strategy_block() -> str:
    lines = []
    for key in STRATEGY_ORDER:
        spec = STRATEGY_SPECS[key]
        lines.append(
            "- " + key + " (" + spec["label"] + "): 语气 " + spec["tone"]
            + "; 优势 " + spec["advantage"]
            + "; 风险 " + spec["risk"]
        )
    return "\n".join(lines)


SYSTEM_PROMPT = """你是一个中文社交沟通顾问, 帮用户看懂微信好友的真实意图, 并给出可以直接发出去的回复。

你要借用成熟的沟通研究方法来判断意图, 而不是只做关键词匹配:
1. 言语行为(speech act): 这句话在"做"什么, 是在倾诉、请托、试探, 还是在施压。
2. 面子理论: 这句话有没有让对方面子受损, 你回复时要不要补救。
3. 关系与权力: 你们谁更需要这段关系, 谁在选择权上更主动。
4. 情绪优先原则: 对方在情绪里时先共情, 不要急着给方案。

意图只能从下面这套标签里选一个:
{taxonomy}

回复必须给三条, 分属三种策略(顺序固定):
{strategies}

硬性要求:
- 三条回复的语气要自然口语, 像真人微信里会发的话, 不要书面腔, 不要客服腔。
- 每条回复都要给 reason(为什么这么回)、risk(这么回的代价)、advantage(这么回的好处)。
- 三条的差别要真实: 一条偏情绪、一条偏把事情说清、一条偏守边界, 不要三条一个味道。
- 不要替用户做决定, 你只是把选项和取舍摆清楚。
- 尊重用户和他人的边界, 不教任何操控、PUA 或欺骗话术。

只输出 JSON, 不要任何解释文字或 markdown 代码块。格式:
{{"intent_key": "...", "confidence": 0.0, "emotion": "...", "urgency": "高|中|低", "read": "一句话解读对方", "goal": "对方想要什么", "advice": "一句话给用户的建议", "signals": ["判读依据1", "判读依据2"], "replies": [{{"strategy": "warm", "text": "...", "reason": "...", "risk": "...", "advantage": "...", "tone": "..."}}, {{"strategy": "steady", ...}}, {{"strategy": "boundary", ...}}]}}"""


def build_system_prompt() -> str:
    return SYSTEM_PROMPT.format(taxonomy=_taxonomy_block(), strategies=_strategy_block())


def build_user_prompt(messages: List[Dict[str, Any]], contact: str) -> str:
    lines = []
    for item in messages:
        speaker = "我" if item.get("is_me") else (contact or "好友")
        lines.append(speaker + ": " + str(item.get("text", "")))
    transcript = "\n".join(lines) if lines else "(无对话内容)"
    return (
        "对话对象: " + (contact or "好友") + "\n"
        "最近聊天记录(最后一条是对方刚发来的, 需要你判断意图并给回复):\n"
        + transcript
        + "\n\n请判断对方最后一条消息的意图, 并给出三条可选回复。"
    )
