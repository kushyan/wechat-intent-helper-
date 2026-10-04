# 微信意图助手

读好友发来的消息,判断他到底想干什么,再给你三条不同打法的回复。每条回复都写明**理由 / 风险 / 优势**,你挑一条改改就能发。

核心是零第三方依赖:不配任何 API key 也能跑,配了模型就自动升级成模型生成。

## 在线版(不用装任何东西)

`docs/` 是一份**纯静态**页面:离线规则引擎被一比一移植成了 JavaScript,整站没有后端,
推到 GitHub Pages 就能直接用。

```text
https://<你的用户名>.github.io/wechat-intent-helper/
```

- 不填任何 key 也有完整结论,判读逻辑和命令行版一致
- 可选:在页面顶部「模型设置」里填任意 OpenAI 兼容接口,就会切换成模型生成
  (浏览器直连,key 只存在你本机 localStorage,不上传)
- 发布步骤见 [PUBLISH.md](PUBLISH.md)

## 快速开始

```bash
cd wechat-intent

# 1. 跑内置示例, 看输出长什么样
python -m wechat_intent demo --offline

# 2. 分析一条消息
python -m wechat_intent analyze -t "兄弟能不能先借我两万周转, 下个月还你" -c 老同学

# 3. 分析一段对话(每条一行, 「我:」表示你说的)
python -m wechat_intent analyze -f examples/sample_chat.json

# 4. 起网页工作台
python -m wechat_intent serve
# 打开 http://127.0.0.1:8765
```

也可以用管道:

```bash
echo "小雨: 最近好累，撑不住了" | python -m wechat_intent analyze -c 小雨
```

## 接入模型(可选)

任何 OpenAI 兼容的 `chat/completions` 接口都能用,配三个环境变量即可:

```bash
WECHAT_INTENT_BASE_URL=https://api.deepseek.com/v1
WECHAT_INTENT_API_KEY=sk-xxxx
WECHAT_INTENT_MODEL=deepseek-chat
```

参考 [.env.example](.env.example)。默认值已经指向 DeepSeek。换 OpenAI 官方就改成 `https://api.openai.com/v1` 加 `gpt-4o-mini` 之类。

模型不可用时会自动降级到离线规则引擎,并在结果里写明原因,不会卡住。

## 接入微信

个人微信没有官方开放接口,只能走桥接。程序本身只负责「消息进 → 建议出」,桥接方式三选一:

**方式一 · 本机 PC 微信(wcferry)**

```bash
pip install wcferry
python -m wechat_intent wechat -c 小雨
```

监听真实好友消息,终端直接打印三条建议。默认只提示不发送;加 `--allow-send` 才会在你输入序号后发送。

**方式二 · Wechaty 网关(跨平台)**

Wechaty 侧拿到消息后 POST 给本程序:

```bash
python -m wechat_intent serve
curl -X POST http://127.0.0.1:8765/api/ingest \
  -H "Content-Type: application/json" \
  -d "{\"contact\":\"小雨\",\"messages\":[{\"sender\":\"小雨\",\"text\":\"在吗\"}]}"
```

返回体里就是意图判读和三条回复,网关自己决定要不要发给公众号或你自己的号。

**方式三 · 文件桥**

任何能写文件的采集端,每行写一条 JSON 到 `inbox.jsonl`,程序负责监听:

```bash
python -m wechat_intent watch -f inbox.jsonl
```

> 提醒:自动化个人微信违反微信用户协议,存在封号风险。项目按「人做决定」的方式设计,不批量群发、不自动加人。

## 输出长什么样

```text
意图: 借钱谈钱   置信度: 95%   情绪: 中性   紧急度: 中
对方意图: 对方开口谈钱, 这是最容易伤关系、也最需要留证据的一类。
对方想要: 从你这拿到钱或者资金安排。
给你的建议: 先问清数目和归还时间, 心里设一条底线。

  1. [情绪优先]          理由 / 风险 / 优势
  2. [稳妥务实]  ★推荐    理由 / 风险 / 优势
  3. [边界清晰]          理由 / 风险 / 优势
```

三条回复固定对应三种社交策略,不是同一个意思换三种说法:

| 策略 | 打法 | 什么时候用 |
| --- | --- | --- |
| 情绪优先 | 先接住情绪和关系 | 对方在情绪里、关系值得维护 |
| 稳妥务实 | 把事情说清楚、留余地 | 需要推进或需要掌握信息 |
| 边界清晰 | 护住自己的底线 | 反复被越界、需要止损 |

## 能识别哪些意图

寒暄问候、日常闲聊、情绪倾诉、求安慰、求助请托、信息咨询、邀约见面、催确定行程、推销广告、借钱谈钱、抱怨指责、暧昧示好、道歉和解、商务合作、试探催回。

判定为纯规则时,看的是线索词 + 句式 + 上下文延续,比如「项目被砍了」本身没有强线索,会继承上文「好累 / 撑不住」的情绪语境,而不是误判成商务。具体方法论见 [SOCIAL_METHODS.md](SOCIAL_METHODS.md)。

## 命令行

| 命令 | 作用 |
| --- | --- |
| `python -m wechat_intent` | 跑内置示例 |
| `python -m wechat_intent analyze -t 文本` | 分析一段对话,`--json` 出机器可读格式 |
| `python -m wechat_intent serve` | 网页工作台 + `/api/analyze`、`/api/ingest` |
| `python -m wechat_intent watch -f inbox.jsonl` | 监听桥接层写入的消息文件 |
| `python -m wechat_intent wechat` | 直接监听真实微信(需 wcferry) |

公共参数:`--force auto|llm|offline`(强制引擎)、`-c 好友备注`。

## 项目结构

```text
wechat_intent/
  intents.py      意图体系 + 三档回复模板 + 社交打法库
  heuristics.py   离线规则引擎(零依赖)
  prompts.py      给模型的提示词
  llm.py          OpenAI 兼容客户端(只用标准库)
  analyzer.py     编排: 优先模型, 失败自动降级
  cli.py          命令行入口
  server.py       本地网页服务 + 桥接接口
  web/index.html  本地服务工作台界面
  adapters/       微信接入适配器(mock / wechatferry)

docs/             纯静态在线版(GitHub Pages 用, 无后端)
  index.html        页面
  engine.js         heuristics.py + intents.py 的 JS 移植
  llm.js            prompts.py + llm.py 的 JS 移植(可选模型通道)

tools/            对照测试的语料与期望值生成脚本
tests/            Python 测试 + JS 引擎对照测试
```

## 测试

```bash
# Python 侧: 意图判定、回复结构、真实起 HTTP 服务
python -m unittest discover -s tests -v

# 网页引擎对照测试: JS 版必须和 Python 版给出同样的结论
node tests/test_web_engine.mjs
```

16 项 Python 测试 + 34 条对照用例(102 条回复逐字段比对),全部不联网、不需要 key。

网页版和命令行版是两份实现,所以用对照测试把两边钉在一起:`tools/parity_cases.json`
是语料,`python tools/make_parity_fixture.py` 用 Python 引擎算出期望值,
`node tests/test_web_engine.mjs` 再拿 JS 引擎跑一遍逐字段比对。改任何一边的规则后,
重跑这两条命令即可。GitHub Actions 每次推送都会跑这个闸门。

## 边界

这个工具给的是选项和取舍,不替你做决定,也不教你操控别人。涉及借钱、暧昧、冲突这类敏感场景,建议只当参考,重要的事还是当面说。
