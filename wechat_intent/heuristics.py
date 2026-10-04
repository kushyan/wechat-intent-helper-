"""离线意图判读引擎: 纯规则, 零依赖, 不联网也能给出完整结论。

它保证程序永远有输出, 同时给 LLM 路径提供兜底和结构校验。
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .intents import (
    FALLBACK_INTENT,
    INTENT_BY_KEY,
    INTENT_SPECS,
    STRATEGY_ORDER,
    STRATEGY_SPECS,
    strategy_hint,
)
from .schemas import Analysis, Message, ReplyOption

NEG_WORDS = [
    "烦", "累", "难受", "崩溃", "委屈", "郁闷", "压力", "撑不住", "想哭", "心累",
    "不开心", "焦虑", "生气", "失望", "讨厌", "难过", "害怕", "孤独", "累死", "无语",
    "白费", "黄了", "泡汤", "没戏", "被砍", "扛不住", "熬不住", "顶不住",
]
POS_WORDS = [
    "开心", "高兴", "太好了", "喜欢", "爱你", "哈哈", "笑死", "爽", "棒", "谢谢",
    "感谢", "期待", "惊喜", "感动",
]
URGENT_WORDS = ["急", "赶紧", "马上", "立刻", "现在就", "尽快", "等着", "赶紧的", "催"]

TIME_RE = re.compile(
    r"(今天|明天|后天|大后天|今晚|晚上|中午|早上|上午|下午|周末|周六|周日|周[一二三四五六日]"
    r"|下周|这周|月底|下个月|\d{1,2}\s*点|\d{1,2}:\d{2}|\d{1,2}月\d{1,2}[日号]|\d{1,2}[日号])"
)
MONEY_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(万|千|百|块|元|k|K|w)")
LINK_RE = re.compile(r"(https?://|www\.|扫码|二维码|点此|戳我)")

ASCII_CUE_RE = re.compile(r"^[a-zA-Z0-9 ]+$")

STOPWORDS = {
    "我", "你", "他", "她", "它", "我们", "你们", "他们", "的", "了", "吗", "呢", "吧",
    "啊", "呀", "是", "在", "有", "和", "就", "都", "也", "还", "不", "没", "很", "太",
    "这", "那", "一个", "什么", "怎么", "可以", "能不能", "帮我", "一下", "现在", "今天",
}


def _cue_hit(cue: str, text: str, text_lower: str) -> int:
    if ASCII_CUE_RE.match(cue):
        return len(re.findall(r"(?<![a-zA-Z0-9])" + re.escape(cue.lower()) + r"(?![a-zA-Z0-9])", text_lower))
    return text.count(cue)


def detect_time(text: str) -> str:
    match = TIME_RE.search(text)
    return match.group(0) if match else ""


def detect_amount(text: str) -> str:
    match = MONEY_RE.search(text)
    return (match.group(1) + match.group(2)) if match else ""


def extract_keyword(text: str) -> str:
    chunks = re.findall(r"[\u4e00-\u9fff]{2,6}", text)
    for chunk in chunks:
        if chunk not in STOPWORDS:
            return chunk
    return "这个"


def emotion_of(text: str) -> Tuple[str, float]:
    neg = sum(text.count(word) for word in NEG_WORDS)
    pos = sum(text.count(word) for word in POS_WORDS)
    total = neg + pos
    if total == 0:
        return "中性", 0.0
    score = (pos - neg) / max(total, 1)
    if score <= -0.6:
        return "明显负面", score
    if score < 0:
        return "偏负面", score
    if score >= 0.6:
        return "明显正面", score
    return "偏正面", score


def _recent_friend_messages(messages: List[Message], limit: int = 6) -> List[Message]:
    friend = [m for m in messages if not m.is_me]
    return friend[-limit:] if friend else messages[-limit:]


def _score_intents(recent: List[Message], last: Message) -> Tuple[Dict[str, float], Dict[str, List[str]]]:
    text = last.text
    text_lower = text.lower()
    earlier = [m for m in recent if m is not last]
    window = " ".join(m.text for m in earlier)
    window_lower = window.lower()

    last_scores: Dict[str, float] = {spec["key"]: 0.0 for spec in INTENT_SPECS}
    window_scores: Dict[str, float] = {spec["key"]: 0.0 for spec in INTENT_SPECS}
    evidence: Dict[str, List[str]] = {spec["key"]: [] for spec in INTENT_SPECS}

    for spec in INTENT_SPECS:
        key = spec["key"]
        for cue in spec["cues"]:
            hits = _cue_hit(cue, text, text_lower)
            if hits:
                weight = 1.0 + 0.25 * (len(cue) - 1)
                last_scores[key] += weight * min(hits, 3)
                evidence[key].append(cue)
        if not window:
            continue
        for cue in spec["cues"]:
            if cue in evidence[key]:
                continue
            window_hits = _cue_hit(cue, window, window_lower)
            if window_hits:
                weight = 1.0 + 0.25 * (len(cue) - 1)
                window_scores[key] += weight * min(window_hits, 2)
                evidence[key].append(cue + "(上文)")

    # 上文整体偏负面时, 情绪类意图应该被继承下来
    window_neg = sum(window.count(word) for word in NEG_WORDS)
    if window_neg >= 2:
        window_scores["venting"] += 1.3
        evidence["venting"].append("整段对话偏负面")

    if max(last_scores.values()) <= 0:
        # 最后一句没有明显线索, 按上文语境延续
        scores = {key: window_scores[key] * 0.9 for key in window_scores}
    else:
        scores = {key: last_scores[key] + 0.4 * window_scores[key] for key in last_scores}

    # 结构性线索
    if LINK_RE.search(text):
        scores["promotion"] += 2.5
        evidence["promotion"].append("疑似链接/二维码")
    if detect_amount(text) and scores["money"] > 0:
        scores["money"] += 1.5
        evidence["money"].append("出现金额")
    full_text = " ".join(m.text for m in recent)
    nudge_hits = full_text.count("在吗") + full_text.count("在么") + full_text.count("在不在")
    if nudge_hits >= 2:
        scores["followup_nudge"] += 2.0
        evidence["followup_nudge"].append("反复追问在不在")
    if len(recent) >= 3 and len(text) <= 12 and any(w in text for w in ["?", "？", "在", "回"]):
        scores["followup_nudge"] += 1.0
    if (text.endswith("?") or text.endswith("？")) and scores["question"] > 0:
        scores["question"] += 0.8
    if time_expr := detect_time(text):
        for key in ("invitation", "plan_confirm"):
            if scores[key] > 0:
                scores[key] += 1.2
                evidence[key].append("时间信息:" + time_expr)
    neg = sum(text.count(word) for word in NEG_WORDS)
    if neg >= 2:
        scores["venting"] += 1.5
        evidence["venting"].append("负面情绪词密集")
    if sum(text.count(word) for word in URGENT_WORDS) >= 1:
        scores["plan_confirm"] += 0.8
        scores["followup_nudge"] += 0.6
    if len(text) >= 60 and neg >= 1:
        scores["venting"] += 1.0
        evidence["venting"].append("长段+负面")

    return scores, evidence


def _pick(scores: Dict[str, float], evidence: Dict[str, List[str]]) -> Tuple[str, float]:
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    top_key, top_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    if top_score <= 0:
        return FALLBACK_INTENT, 0.32
    margin = (top_score - second_score) / max(top_score, 1e-6)
    confidence = 0.45 + 0.32 * min(top_score / 4.0, 1.0) + 0.2 * margin
    return top_key, max(0.30, min(0.95, confidence))


def _urgency(intent_key: str, recent: List[Message], last: Message) -> str:
    text = last.text
    if any(word in text for word in URGENT_WORDS):
        return "高"
    if intent_key in ("plan_confirm", "followup_nudge", "money"):
        return "中"
    if len([m for m in recent if len(m.text) <= 6]) >= 3:
        return "中"
    return "低"


def _build_signals(
    evidence: Dict[str, List[str]],
    intent_key: str,
    last: Message,
    recent: List[Message],
) -> List[str]:
    signals: List[str] = []
    seen = set()
    for cue in evidence.get(intent_key, [])[:6]:
        if cue not in seen:
            seen.add(cue)
            signals.append("命中线索:" + cue)
    text = last.text
    if LINK_RE.search(text):
        signals.append("消息里带链接或二维码, 像推广素材")
    if amount := detect_amount(text):
        signals.append("出现金额数字:" + amount)
    nudge_hits = sum(m.text.count("在吗") + m.text.count("在么") for m in recent)
    if nudge_hits >= 2:
        signals.append("连续追问在不在, 共 " + str(nudge_hits) + " 次")
    if time_expr := detect_time(text):
        signals.append("出现时间信息:" + time_expr)
    if text.count("!") >= 2 or text.count("！") >= 2:
        signals.append("感叹号密集, 情绪外露")
    if len(recent) >= 3 and all(len(m.text) <= 8 for m in recent[-3:]):
        signals.append("短消息连发, 节奏急")
    if not signals:
        signals.append("没有强线索, 按日常对话处理")
    return signals


def _fill(template: str, slots: Dict[str, str]) -> str:
    text = template
    for key, value in slots.items():
        text = text.replace("{" + key + "}", value)
    for leftover in re.findall(r"\{[a-z_]+\}", text):
        text = text.replace(leftover, "")
    fixes = [("，，", "，"), ("。。", "。"), ("，。", "。"), ("：，", "："),
             ("，？", "？"), ("，！", "！"), ("？，", "？"), ("！，", "！"),
             ("，?", "?"), ("，!", "!"), ("?,", "?"), ("!,", "!"), ("  ", " ")]
    for bad, good in fixes:
        while bad in text:
            text = text.replace(bad, good)
    return text.strip().lstrip("，。、；： !?").strip()


def build_replies(intent_key: str, slots: Dict[str, str]) -> List[ReplyOption]:
    spec = INTENT_BY_KEY.get(intent_key, INTENT_BY_KEY[FALLBACK_INTENT])
    default_strategy = spec.get("default_strategy", "steady")
    replies: List[ReplyOption] = []
    for strategy in STRATEGY_ORDER:
        strategy_spec = STRATEGY_SPECS[strategy]
        template = spec["replies"].get(strategy, "")
        reason = strategy_spec["reason"]
        hint = strategy_hint(intent_key, strategy)
        if hint:
            reason = reason + " 适用场景:" + hint + "。"
        replies.append(
            ReplyOption(
                strategy=strategy,
                strategy_label=strategy_spec["label"],
                text=_fill(template, slots),
                reason=reason,
                risk=strategy_spec["risk"],
                advantage=strategy_spec["advantage"],
                tone=strategy_spec["tone"],
                recommended=(strategy == default_strategy),
            )
        )
    return replies


def analyze(messages: List[Message], contact: str = "好友") -> Analysis:
    if not messages:
        messages = [Message(sender=contact, text="", is_me=False)]
    recent = _recent_friend_messages(messages)
    last = recent[-1] if recent else messages[-1]

    scores, evidence = _score_intents(recent, last)
    intent_key, confidence = _pick(scores, evidence)
    spec = INTENT_BY_KEY[intent_key]

    emotion_label, emotion_score = emotion_of(" ".join(m.text for m in recent))
    slots = {
        "name": contact,
        "name_p": (contact + ", ") if contact and contact != "好友" else "",
        "their": "「" + last.text[:18] + "」" if last.text else "你说的那件事",
        "time": detect_time(last.text) or "你方便的时候",
        "kw": extract_keyword(last.text),
    }

    return Analysis(
        engine="heuristic",
        contact=contact,
        intent_key=intent_key,
        intent_label=spec["label"],
        confidence=round(confidence, 3),
        emotion_label=emotion_label,
        emotion_score=round(emotion_score, 3),
        urgency=_urgency(intent_key, recent, last),
        read=spec["read"],
        goal=spec["goal"],
        advice=spec["advice"],
        signals=_build_signals(evidence, intent_key, last, recent),
        replies=build_replies(intent_key, slots),
        transcript=[{"sender": m.sender, "text": m.text, "is_me": m.is_me} for m in messages],
    )
