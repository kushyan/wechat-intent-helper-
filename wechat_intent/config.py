"""运行配置: 全部来自环境变量, 不写死密钥。"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _first(*names: str, default: str = "") -> str:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value.strip()
    return default


@dataclass
class Config:
    base_url: str
    api_key: str
    model: str
    temperature: float
    timeout: int
    port: int

    @property
    def chat_endpoint(self) -> str:
        base = self.base_url.rstrip("/")
        if base.endswith("/chat/completions"):
            return base
        return base + "/chat/completions"

    @property
    def llm_ready(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)


def load_config() -> Config:
    return Config(
        base_url=_first(
            "WECHAT_INTENT_BASE_URL",
            "OPENAI_BASE_URL",
            default="https://api.deepseek.com/v1",
        ),
        api_key=_first("WECHAT_INTENT_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY"),
        model=_first(
            "WECHAT_INTENT_MODEL",
            "OPENAI_MODEL",
            default="deepseek-chat",
        ),
        temperature=float(_first("WECHAT_INTENT_TEMPERATURE", default="0.7")),
        timeout=int(_first("WECHAT_INTENT_TIMEOUT", default="60")),
        port=int(_first("WECHAT_INTENT_PORT", default="8765")),
    )
