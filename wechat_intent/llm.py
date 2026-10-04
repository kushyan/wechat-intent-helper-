"""最小 OpenAI 兼容客户端: 只用标准库, 支持任意 chat/completions 服务。"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

from .config import Config


class LLMError(RuntimeError):
    pass


def _extract_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise LLMError("模型返回里没有找到 JSON 对象")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise LLMError("JSON 解析失败: " + str(exc)) from exc


class LLMClient:
    def __init__(self, config: Config):
        self.config = config

    @property
    def ready(self) -> bool:
        return self.config.llm_ready

    def complete_json(self, system: str, user: str) -> Dict[str, Any]:
        if not self.ready:
            raise LLMError("未配置 base_url / api_key / model")
        payload = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": self.config.temperature,
            "stream": False,
        }
        request = urllib.request.Request(
            self.config.chat_endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + self.config.api_key,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.config.timeout) as response:
                body = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise LLMError("接口返回 " + str(exc.code) + ": " + detail) from exc
        except urllib.error.URLError as exc:
            raise LLMError("网络不可达: " + str(exc.reason)) from exc

        try:
            data = json.loads(body)
        except json.JSONDecodeError as exc:
            raise LLMError("响应不是合法 JSON") from exc

        content = _read_content(data)
        if not content:
            raise LLMError("响应里没有 content 字段")
        return _extract_json(content)


def _read_content(data: Dict[str, Any]) -> Optional[str]:
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0] or {}
        message = first.get("message") or {}
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [part.get("text", "") for part in content if isinstance(part, dict)]
            return "".join(parts)
        if isinstance(first.get("text"), str):
            return first["text"]
    output = data.get("output_text")
    if isinstance(output, str):
        return output
    return None
