"""命令行入口。

用法示例:
  python -m wechat_intent                 # 跑内置示例
  python -m wechat_intent analyze -t "在吗" -c 小雨
  python -m wechat_intent analyze -f chat.json --json
  python -m wechat_intent serve           # 网页工作台 + 桥接接口
  python -m wechat_intent watch -f inbox.jsonl
  python -m wechat_intent wechat -c 小雨   # 真实微信(需 wcferry)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

from .adapters.mock import parse_transcript
from .analyzer import Analyzer
from .schemas import Analysis, Message, coerce_messages


def _force_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass


def format_analysis(result: Analysis) -> str:
    lines: List[str] = []
    lines.append("")
    lines.append("=" * 60)
    lines.append(
        "意图: " + result.intent_label
        + "   置信度: " + str(round(result.confidence * 100)) + "%"
        + "   情绪: " + result.emotion_label
        + "   紧急度: " + result.urgency
        + "   引擎: " + ("模型" if result.engine == "llm" else "离线规则")
    )
    if result.note:
        lines.append("提示: " + result.note)
    lines.append("-" * 60)
    lines.append("对方意图: " + result.read)
    lines.append("对方想要: " + result.goal)
    lines.append("给你的建议: " + result.advice)
    if result.signals:
        lines.append("判读依据: " + " / ".join(result.signals))
    lines.append("")
    lines.append("三条可选回复:")
    for index, reply in enumerate(result.replies, 1):
        mark = "  ★推荐" if reply.recommended else ""
        lines.append("")
        lines.append("  " + str(index) + ". [" + reply.strategy_label + "]" + mark + "  语气: " + reply.tone)
        lines.append("     " + reply.text)
        lines.append("     理由: " + reply.reason)
        lines.append("     风险: " + reply.risk)
        lines.append("     优势: " + reply.advantage)
    lines.append("")
    lines.append("=" * 60)
    return "\n".join(lines)


DEMOS: List[Dict[str, object]] = [
    {
        "contact": "小雨",
        "messages": [
            {"sender": "小雨", "text": "在吗"},
            {"sender": "小雨", "text": "最近真的好累，感觉快撑不住了"},
            {"sender": "我", "text": "怎么了", "is_me": True},
            {"sender": "小雨", "text": "项目被砍了，我做了三个月的东西全白费"},
        ],
    },
    {
        "contact": "老同学",
        "messages": [
            {"sender": "老同学", "text": "兄弟最近手头紧不紧，能不能先借我两万周转一下，下个月发工资就还你"},
        ],
    },
    {
        "contact": "阿哲",
        "messages": [
            {"sender": "阿哲", "text": "这个副业真的能躺赚，限时名额，扫码进群我带你"},
        ],
    },
    {
        "contact": "小林",
        "messages": [
            {"sender": "小林", "text": "周末那家新开的店，一起去吃吗"},
            {"sender": "我", "text": "我看看时间", "is_me": True},
            {"sender": "小林", "text": "到底定了没啊，我好订位子"},
        ],
    },
    {
        "contact": "小满",
        "messages": [
            {"sender": "小满", "text": "你怎么一直不回我，人呢"},
            {"sender": "小满", "text": "在吗在吗"},
        ],
    },
]


def _load_input(args: argparse.Namespace) -> List[Message]:
    if args.file:
        raw = json.loads(Path(args.file).read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return coerce_messages(raw.get("messages", []))
        return coerce_messages(raw)
    if args.text:
        return parse_transcript(args.text, args.contact)
    data = sys.stdin.read()
    if not data.strip():
        return []
    return parse_transcript(data, args.contact)


def cmd_analyze(analyzer: Analyzer, args: argparse.Namespace) -> int:
    messages = _load_input(args)
    if not messages:
        print("没有收到消息。用 -t 传文本, 或 -f 传 JSON 文件, 也可以直接管道输入。")
        return 2
    result = analyzer.analyze(messages, contact=args.contact, force=args.force)
    if args.json:
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    else:
        print(format_analysis(result))
    return 0


def cmd_demo(analyzer: Analyzer, args: argparse.Namespace) -> int:
    for item in DEMOS:
        print("\n\n########## " + str(item["contact"]) + " ##########")
        result = analyzer.analyze(item["messages"], contact=str(item["contact"]), force=args.force)
        print(format_analysis(result))
    return 0


def cmd_serve(analyzer: Analyzer, args: argparse.Namespace) -> int:
    from .server import serve

    serve(analyzer, host=args.host, port=args.port)
    return 0


def cmd_watch(analyzer: Analyzer, args: argparse.Namespace) -> int:
    path = Path(args.file)
    print("[watch] 监听 " + str(path) + " (每行一条 JSON 消息, Ctrl+C 退出)")
    if not path.exists():
        path.touch()
    position = path.stat().st_size
    history: Dict[str, List[Message]] = {}
    try:
        while True:
            size = path.stat().st_size
            if size < position:
                position = 0
            if size > position:
                with path.open("r", encoding="utf-8") as handle:
                    handle.seek(position)
                    for line in handle:
                        line = line.strip()
                        if line:
                            _watch_line(analyzer, line, history, args)
                    position = handle.tell()
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\n[watch] 已停止")
    return 0


def _watch_line(analyzer: Analyzer, line: str, history: Dict[str, List[Message]], args) -> None:
    try:
        raw = json.loads(line)
    except json.JSONDecodeError:
        print("[watch] 跳过非 JSON 行: " + line[:60])
        return
    if not isinstance(raw, dict):
        return
    contact = str(raw.get("contact") or raw.get("sender") or args.contact)
    message = Message.from_any(raw)
    if not message.sender or message.sender == "好友":
        message.sender = contact
    history.setdefault(contact, []).append(message)
    history[contact] = history[contact][-8:]
    if message.is_me:
        return
    result = analyzer.analyze(history[contact], contact=contact, force=args.force)
    print(format_analysis(result))


def cmd_wechat(analyzer: Analyzer, args: argparse.Namespace) -> int:
    try:
        from .adapters.wechatferry_adapter import WeChatFerryBridge
    except Exception as exc:
        print("加载微信适配器失败: " + str(exc))
        return 1
    bridge = WeChatFerryBridge(
        analyzer,
        contact_filter=args.contact if args.contact != "好友" else None,
        allow_send=args.allow_send,
    )
    try:
        bridge.run()
    except RuntimeError as exc:
        print(str(exc))
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="wechat-intent",
        description="微信好友意图识别 + 三条回复建议(理由/风险/优势)",
    )
    parser.add_argument("--offline", action="store_true", help="强制使用离线规则引擎")
    parser.add_argument("--no-llm", action="store_true", help="完全不调用模型")
    sub = parser.add_subparsers(dest="command")

    def add_common(item: argparse.ArgumentParser) -> None:
        item.add_argument("-c", "--contact", default="好友", help="好友备注名")
        item.add_argument("--force", choices=["auto", "llm", "offline"], default="auto")
        item.add_argument("--offline", action="store_true", default=argparse.SUPPRESS,
                          help="强制使用离线规则引擎")
        item.add_argument("--no-llm", action="store_true", default=argparse.SUPPRESS,
                          help="完全不调用模型")

    analyze = sub.add_parser("analyze", help="分析一段对话")
    analyze.add_argument("-t", "--text", default="", help="对话文本, 每条一行")
    analyze.add_argument("-f", "--file", default="", help="对话 JSON 文件")
    analyze.add_argument("--json", action="store_true", help="输出完整 JSON")
    add_common(analyze)

    demo = sub.add_parser("demo", help="跑内置示例")
    add_common(demo)

    server = sub.add_parser("serve", help="启动网页工作台")
    server.add_argument("--host", default="127.0.0.1")
    server.add_argument("--port", type=int, default=8765)
    add_common(server)

    watch = sub.add_parser("watch", help="监听桥接层写入的 JSONL 文件")
    watch.add_argument("-f", "--file", required=True)
    add_common(watch)

    wechat = sub.add_parser("wechat", help="监听真实微信(需 wcferry)")
    wechat.add_argument("-c", "--contact", default="好友")
    wechat.add_argument("--force", choices=["auto", "llm", "offline"], default="auto")
    wechat.add_argument("--allow-send", action="store_true", help="允许手动选择后发送")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    _force_utf8()
    parser = build_parser()
    args = parser.parse_args(argv)
    if getattr(args, "offline", False) or getattr(args, "no_llm", False):
        args.force = "offline"
    if not hasattr(args, "force"):
        args.force = "auto"
    if not hasattr(args, "contact"):
        args.contact = "好友"

    analyzer = Analyzer(enable_llm=not getattr(args, "no_llm", False))
    command = args.command or "demo"
    handlers = {
        "analyze": cmd_analyze,
        "demo": cmd_demo,
        "serve": cmd_serve,
        "watch": cmd_watch,
        "wechat": cmd_wechat,
    }
    return handlers[command](analyzer, args)


if __name__ == "__main__":
    raise SystemExit(main())
