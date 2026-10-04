/* 微信意图助手 · 离线规则引擎(浏览器版)
 *
 * 这是 wechat_intent/intents.py 与 wechat_intent/heuristics.py 的逐行移植:
 * 同样的线索词、同样的权重、同样的兜底逻辑, 所以同一段对话在网页版和
 * 命令行版会得到一致的判读(见 tests/test_web_engine.mjs 的对照测试)。
 *
 * 不依赖任何后端, 打开页面就能算。挂到 GitHub Pages 上也能跑。
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- 社交打法库

  var STRATEGY_SPECS = {
    warm: {
      label: "情绪优先",
      tone: "温和、有陪伴感",
      reason: "先接住对方的情绪和关系, 让对方觉得被看见, 防备心会降下来。",
      risk: "情绪投入大, 容易被对方持续依赖, 也容易把自己拖进耗能的关系里。",
      advantage: "关系升温最快, 对方的好感和信任会明显上升。"
    },
    steady: {
      label: "稳妥务实",
      tone: "坦率、把事情说清楚",
      reason: "回应了对方真正要的那件事, 同时把信息补全, 避免空头承诺和来回拉扯。",
      risk: "偏理性, 如果对方当下只想要情绪, 可能会觉得你有点冷。",
      advantage: "边界清楚又留余地, 推进效率高, 事后不容易背锅。"
    },
    boundary: {
      label: "边界清晰",
      tone: "客气但坚定",
      reason: "先护住自己的时间和底线, 把选择权拿回自己手里。",
      risk: "关系短期会有张力, 对方可能感觉被拒绝, 需要你承受一点尴尬。",
      advantage: "长期最省心, 能筛掉消耗型关系, 避免被反复越界。"
    }
  };

  var STRATEGY_ORDER = ["warm", "steady", "boundary"];

  // ---------------------------------------------------------------- 意图体系

  var INTENT_SPECS = [
    {
      key: "greeting",
      label: "寒暄问候",
      desc: "打招呼、试探你在不在, 想重新建立连接。",
      cues: ["在吗", "在么", "在不在", "你好", "您好", "好久不见", "最近怎么样", "干嘛呢", "干啥呢", "嗨", "hi", "hello", "早", "早上好", "晚安", "睡了吗"],
      default_strategy: "warm",
      read: "对方在跟你重新搭上线, 重点是「想聊」, 还没说到具体的事。",
      goal: "确认你在不在, 顺便试探你有没有空陪聊。",
      advice: "先给个有温度的回应, 再抛一个问题把话头接住, 别只回「在」。",
      replies: {
        warm: "{name_p}看到你消息我还挺开心的。最近怎么样, 有什么新鲜事跟我说说?",
        steady: "{name_p}我在, 好久没聊了。你最近忙什么呢?",
        boundary: "{name_p}我在, 这两天手头事有点多。你先说事儿, 能帮的我尽量。"
      }
    },
    {
      key: "smalltalk",
      label: "日常闲聊",
      desc: "分享日常、吐槽小事, 想要互动而不是解决问题。",
      cues: ["哈哈", "天气", "吃了", "外卖", "电视剧", "综艺", "游戏", "追星", "好玩", "无聊", "刚下班", "周末", "笑死", "绝了"],
      default_strategy: "warm",
      read: "对方就是来找你唠嗑的, 想要的是一来一回的热闹感。",
      goal: "找个人分享当下, 有人接话就开心。",
      advice: "顺着他的话往下接, 反问一个细节, 比给建议管用得多。",
      replies: {
        warm: "哈哈这个我也有同感, 你多说说, 我听着呢。",
        steady: "听起来还挺有意思的, 后来呢?",
        boundary: "哈哈先记下了, 我这边在赶点事, 晚点接着跟你聊。"
      }
    },
    {
      key: "venting",
      label: "情绪倾诉",
      desc: "在倒情绪垃圾, 需要被理解, 不是要方案。",
      cues: ["烦", "好累", "累死", "难受", "崩溃", "委屈", "郁闷", "压力", "撑不住", "想哭", "emo", "心累", "不开心", "焦虑", "心态崩", "熬不住"],
      default_strategy: "warm",
      read: "对方正在情绪里, 现在最需要的是被理解, 不是被指导。",
      goal: "把情绪倒出来, 确认有人站在他这边。",
      advice: "先共情再说话, 千万别急着讲道理或者给解决方案。",
      replies: {
        warm: "听你这么说我也跟着揪心, 你已经扛很多了。想说什么都倒给我, 我在。",
        steady: "这事换谁碰上都不好受。你先说说最卡的是哪一步, 我陪你捋一捋。",
        boundary: "我懂你现在不好受。不过我今天状态一般, 怕接不住太多情绪, 咱们晚点我认真听你说。"
      }
    },
    {
      key: "comfort_seek",
      label: "求安慰",
      desc: "自我怀疑、想要被肯定和抱抱。",
      cues: ["陪陪我", "有人吗", "安慰", "抱抱", "我是不是", "是不是我不行", "我错了吗", "我好失败", "没人懂我", "怎么办啊", "我撑得好辛苦"],
      default_strategy: "warm",
      read: "对方在自我怀疑, 想要的是被肯定, 而不是被评判。",
      goal: "被肯定、被安慰, 确认自己没那么糟。",
      advice: "先给情绪一个落点, 再给一点点具体的肯定, 别泛泛地说「没事的」。",
      replies: {
        warm: "抱抱, 你已经做得比自己以为的好很多了。别一个人硬撑, 我陪着你。",
        steady: "别太苛责自己, 这事本来就不全是你的问题。先让自己缓一缓。",
        boundary: "我在, 但我也没法替你把情绪全兜住。我们挑一件现在最想解决的小事, 先动起来, 好吗?"
      }
    },
    {
      key: "ask_help",
      label: "求助请托",
      desc: "找你帮忙、请教问题, 是明确的请求行为。",
      cues: ["帮我", "帮个忙", "帮我看", "帮我看看", "帮我弄", "麻烦你", "麻烦你一下", "可以帮", "能不能帮", "能不能帮我", "请教", "求你了", "搭把手", "拜托", "借一下", "帮我搞"],
      default_strategy: "steady",
      read: "对方是有具体事要你出力, 这是实打实的请托, 不是闲聊。",
      goal: "让你出一份力或者给一个答案。",
      advice: "先答应「可以聊」, 再问清范围和截止时间, 别一口价全包。",
      replies: {
        warm: "行, 我来帮你看看。你先把具体情况说给我, 卡在哪一步?",
        steady: "我可以帮, 不过先跟你确认两件事: 时间来得及吗, 需要我做到哪一步?",
        boundary: "这次我可能真帮不上, 怕耽误你的事。你先按这个思路试试, 不行我们再想别的办法。"
      }
    },
    {
      key: "question",
      label: "信息咨询",
      desc: "打听信息、问办法, 想知道一个答案。",
      cues: ["怎么", "什么", "为什么", "哪里", "哪儿", "多少钱", "多少", "是不是", "可不可以", "请问", "咨询", "问一下", "有没有", "知道吗", "靠谱吗"],
      default_strategy: "steady",
      read: "对方在找答案, 把你当成了信息源, 期待一个明确回复。",
      goal: "拿到一个能用的答案或判断。",
      advice: "能确定就给结论, 不确定就直说不知道, 并告诉他去哪问更靠谱。",
      replies: {
        warm: "这个我正好知道一点, 我把我了解的都跟你说, 你看对不对得上。",
        steady: "我确认一下再给你准话。先说结论: {kw}这块大概是这么回事, 你还想细到哪一层?",
        boundary: "这个我不是很有把握, 怕说错误导你。建议你找个更专业的渠道确认, 需要的话我帮你想怎么问。"
      }
    },
    {
      key: "invitation",
      label: "邀约见面",
      desc: "约饭、约玩、约见面, 带时间或活动信息。",
      cues: ["一起吃", "一起", "约", "出来", "见面", "有空吗", "去不去", "要不要来", "聚聚", "喝酒", "吃饭", "电影", "爬山", "唱k", "开黑", "来玩", "过来"],
      default_strategy: "steady",
      read: "对方在约你, 想把你拉进一个具体的线下安排。",
      goal: "敲定你去不去、什么时候。",
      advice: "给答复要明确, 能去就顺手定时间地点, 去不了给个替代方案。",
      replies: {
        warm: "好啊, 听着就来劲。{time}我把时间留出来, 咱们定个大概点?",
        steady: "可以约。{time}我这边方便, 地点你定还是我来定?",
        boundary: "最近我排得比较满, {time}可能悬。要不往后放放, 定下来我肯定到。"
      }
    },
    {
      key: "plan_confirm",
      label: "催确定行程",
      desc: "追问你定了没、要一个准信, 有点催的意思。",
      cues: ["定了吗", "确定吗", "考虑得怎么样", "到底", "决定了吗", "答复", "准信", "行不行", "什么时候", "给个话", "还去不去", "定了没"],
      default_strategy: "steady",
      read: "对方在等你的准话, 时间压力已经有点上来了。",
      goal: "尽快拿到一个明确答复, 好安排自己。",
      advice: "要么给准信, 要么给一个明确的时间点, 别用「再看」拖住对方。",
      replies: {
        warm: "我在的, 别急, 咱们这就把它定下来。",
        steady: "我今晚之前给你准信, 你可以先按{time}那边准备着。",
        boundary: "我理解你着急, 但我现在真定不下来。给我到{time}, 我一定回你一个明确答复。"
      }
    },
    {
      key: "promotion",
      label: "推销广告",
      desc: "推销、拉群、发链接、拉你做生意。",
      cues: ["优惠", "活动", "限时", "免费送", "免费领", "代理", "名额", "链接", "扫码", "拼团", "秒杀", "特价", "兼职", "日结", "点赞", "关注", "拉你进群", "躺赚", "副业"],
      default_strategy: "boundary",
      read: "对方在向你推东西, 你们的关系此刻更像渠道和客户。",
      goal: "让你下单、进群、或者帮他转发。",
      advice: "态度客气但立场要清楚, 不想参与就一次说明白, 不留钩子。",
      replies: {
        warm: "谢谢你还想着我。不过这个我暂时用不上, 你也别为我特意留。",
        steady: "我先了解下, 但最近确实没这个需求。以后真要买我主动找你。",
        boundary: "这类我确实不需要, 以后也不用特意发给我了, 咱们聊点别的。"
      }
    },
    {
      key: "money",
      label: "借钱谈钱",
      desc: "借钱、周转、拉投资, 涉及真金白银。",
      cues: ["借钱", "借点", "周转", "手头紧", "还钱", "还我", "转账", "红包", "工资", "贷", "分期", "利息", "投资", "稳赚", "凑一", "先借"],
      default_strategy: "boundary",
      read: "对方开口谈钱, 这是最容易伤关系、也最需要留证据的一类。",
      goal: "从你这拿到钱或者资金安排。",
      advice: "先问清数目和归还时间, 心里设一条底线, 借出去就当可能收不回。",
      replies: {
        warm: "我知道你开口也挺难的。但我这边最近手头也紧, 钱上真帮不上, 别的能帮的我一定说。",
        steady: "先跟我说下数目和大概什么时候能还? 我得看看自己这边能不能周转得开。",
        boundary: "抱歉, 借钱这事我有原则, 朋友之间我不借。这个口子我不开, 你也别为难我。"
      }
    },
    {
      key: "complaint",
      label: "抱怨指责",
      desc: "对你有情绪, 抱怨、指责、翻旧账。",
      cues: ["你怎么", "凭什么", "都是你", "你从来", "你总是", "太过分", "生气", "讨厌", "失望", "说话不算数", "骗我", "不靠谱", "我白", "无语"],
      default_strategy: "steady",
      read: "对方带着情绪冲你来, 关系的张力已经出来了。",
      goal: "要一个说法, 或者要你认错、改变。",
      advice: "先别辩解, 把对方最在意的那一条拎出来单独回应, 一次只谈一件事。",
      replies: {
        warm: "你的感受我收到了, 是我没考虑到。我先跟你说声抱歉。",
        steady: "咱们把事说清楚: 你觉得最不舒服的是哪一点? 就着这一条聊。",
        boundary: "我可以听你说, 但这样的说话方式我不接受。咱们都冷静一下再谈。"
      }
    },
    {
      key: "flirt",
      label: "暧昧示好",
      desc: "示好、试探感情, 想拉近关系。",
      cues: ["想你", "喜欢你", "宝贝", "亲爱的", "心跳", "好可爱", "好看", "爱你", "么么", "亲亲", "抱你", "梦到你", "在干嘛呀", "有没有对象", "单身吗"],
      default_strategy: "steady",
      read: "对方在往感情方向试探, 你们之间的关系可能要重新定义。",
      goal: "看你的反应, 确认有没有机会更进一步。",
      advice: "别被气氛推着走, 该接的接、该说的说清, 态度前后一致最重要。",
      replies: {
        warm: "你这么说我有点开心, 也有点不好意思。",
        steady: "谢谢你的话, 我收到了。咱们慢慢处着看, 别急着定调子。",
        boundary: "你的心意我收到了。但我现在只当朋友, 别误会, 也别为难自己。"
      }
    },
    {
      key: "apology",
      label: "道歉和解",
      desc: "道歉、求和, 想把关系修复回来。",
      cues: ["对不起", "抱歉", "我错了", "别生气", "原谅", "道歉", "是我的问题", "我不该", "消消气", "别往心里去"],
      default_strategy: "steady",
      read: "对方主动低头, 想修复关系, 这是一个可以谈条件的窗口。",
      goal: "得到你的原谅, 把这件事翻篇。",
      advice: "原谅可以给, 但把你在意的边界一并说清, 别只图当下和气。",
      replies: {
        warm: "没事了, 我知道你不是故意的。咱们翻篇。",
        steady: "你的道歉我接受。不过我希望下次遇到类似的事, 咱们能早点说开。",
        boundary: "道我收到了。但我需要点时间, 不是一句话就能过去的, 你理解一下。"
      }
    },
    {
      key: "business",
      label: "商务合作",
      desc: "谈合作、谈项目, 带着明确的商业目的。",
      cues: ["合作", "项目合作", "做项目", "接项目", "报价", "方案", "预算", "合同", "甲方", "乙方", "对接", "商务", "排期", "落地", "能不能做", "怎么收费"],
      default_strategy: "steady",
      read: "这是一次带商业目的的沟通, 对方在评估你, 你也在被定价。",
      goal: "推进合作, 或者摸你的底价和档期。",
      advice: "先问预算和交付标准再谈方案, 顺序反了后面很难谈。",
      replies: {
        warm: "听着挺对路的, 咱们可以聊。你先说说你的想法和预期。",
        steady: "可以谈。为了效率我先列下需要确认的: 预算、时间、交付标准, 这三样清楚了好推进。",
        boundary: "这个方向我暂时不接。以后有合适的项目, 我再主动联系你。"
      }
    },
    {
      key: "followup_nudge",
      label: "试探催回",
      desc: "查岗、催回复、连着追问你在不在。",
      cues: ["怎么不回", "回我一下", "回我啊", "看到没", "人呢", "几点回", "忙什么", "查岗", "又去哪", "怎么不理我", "在吗在吗", "说话呀"],
      default_strategy: "boundary",
      read: "对方在用追问的方式要你的注意力, 背后多半是没安全感。",
      goal: "让你尽快出现, 确认你还在意他。",
      advice: "安抚一句 + 说明节奏就够了, 别为每一次追问都停下来。",
      replies: {
        warm: "刚在忙没顾上回你, 别多想啊, 我看到了。",
        steady: "我看到了, 手头收个尾就回你。有事直接说重点就行。",
        boundary: "我不太喜欢被追着问, 看到我会回。你不用一直盯着。"
      }
    }
  ];

  var INTENT_BY_KEY = {};
  var INTENT_KEYS = [];
  for (var i = 0; i < INTENT_SPECS.length; i += 1) {
    INTENT_BY_KEY[INTENT_SPECS[i].key] = INTENT_SPECS[i];
    INTENT_KEYS.push(INTENT_SPECS[i].key);
  }

  var FALLBACK_INTENT = "smalltalk";

  var STRATEGY_HINTS = {
    venting: {
      warm: "这是对方此刻最想要的回应方式",
      steady: "适合对方情绪已经过去一半的时候",
      boundary: "适合你此刻确实没精力承接情绪"
    },
    money: {
      warm: "适合你不想伤感情、又不打算借",
      steady: "适合你还在权衡, 想先掌握信息",
      boundary: "适合你已经想好不借, 要一次说清"
    },
    promotion: {
      warm: "适合关系不错, 只是这次不参与",
      steady: "适合你还想留个商业上的口子",
      boundary: "适合反复被推销、需要止损"
    },
    complaint: {
      warm: "适合你确实有做得不到位的地方",
      steady: "适合你想把问题谈清楚而不是吵",
      boundary: "适合对方越界、言语攻击的时候"
    },
    flirt: {
      warm: "适合你也有好感、想给回应",
      steady: "适合你还没想好、需要时间观察",
      boundary: "适合你只想做朋友、不想被误会"
    },
    followup_nudge: {
      warm: "适合对方只是没安全感, 关系还在",
      steady: "适合你想建立稳定的回复节奏",
      boundary: "适合对方追得太紧、开始影响你"
    },
    invitation: {
      warm: "适合你也想去, 想顺势把关系拉近",
      steady: "适合你想去但需要把安排敲定",
      boundary: "适合你这次去不了, 想留好关系"
    }
  };

  // ---------------------------------------------------------------- 词表与正则

  var NEG_WORDS = [
    "烦", "累", "难受", "崩溃", "委屈", "郁闷", "压力", "撑不住", "想哭", "心累",
    "不开心", "焦虑", "生气", "失望", "讨厌", "难过", "害怕", "孤独", "累死", "无语",
    "白费", "黄了", "泡汤", "没戏", "被砍", "扛不住", "熬不住", "顶不住"
  ];
  var POS_WORDS = [
    "开心", "高兴", "太好了", "喜欢", "爱你", "哈哈", "笑死", "爽", "棒", "谢谢",
    "感谢", "期待", "惊喜", "感动"
  ];
  var URGENT_WORDS = ["急", "赶紧", "马上", "立刻", "现在就", "尽快", "等着", "赶紧的", "催"];

  var TIME_RE = /(今天|明天|后天|大后天|今晚|晚上|中午|早上|上午|下午|周末|周六|周日|周[一二三四五六日]|下周|这周|月底|下个月|\d{1,2}\s*点|\d{1,2}:\d{2}|\d{1,2}月\d{1,2}[日号]|\d{1,2}[日号])/;
  var MONEY_RE = /(\d+(?:\.\d+)?)\s*(万|千|百|块|元|k|K|w)/;
  var LINK_RE = /(https?:\/\/|www\.|扫码|二维码|点此|戳我)/;
  var ASCII_CUE_RE = /^[a-zA-Z0-9 ]+$/;
  var CJK_CHUNK_RE = /[\u4e00-\u9fff]{2,6}/g;
  var LEFTOVER_SLOT_RE = /\{[a-z_]+\}/g;

  var STOPWORDS = {};
  ["我", "你", "他", "她", "它", "我们", "你们", "他们", "的", "了", "吗", "呢", "吧",
    "啊", "呀", "是", "在", "有", "和", "就", "都", "也", "还", "不", "没", "很", "太",
    "这", "那", "一个", "什么", "怎么", "可以", "能不能", "帮我", "一下", "现在", "今天"
  ].forEach(function (word) { STOPWORDS[word] = true; });

  var ME_ALIASES = {};
  ["我", "me", "自己", "本人", "myself"].forEach(function (word) { ME_ALIASES[word] = true; });

  // ---------------------------------------------------------------- 基础工具

  function countOccurrences(haystack, needle) {
    if (!needle) { return 0; }
    return haystack.split(needle).length - 1;
  }

  function countWords(text, words) {
    var total = 0;
    for (var i = 0; i < words.length; i += 1) { total += countOccurrences(text, words[i]); }
    return total;
  }

  function isAsciiAlnum(ch) {
    return ch !== "" && /[a-zA-Z0-9]/.test(ch);
  }

  // 对应 Python 侧 re.findall(r"(?<![a-zA-Z0-9])cue(?![a-zA-Z0-9])", text_lower)
  function asciiCueHits(needle, textLower) {
    var count = 0;
    var index = 0;
    while (true) {
      index = textLower.indexOf(needle, index);
      if (index === -1) { break; }
      var before = index > 0 ? textLower.charAt(index - 1) : "";
      var after = textLower.charAt(index + needle.length);
      if (!isAsciiAlnum(before) && !isAsciiAlnum(after)) { count += 1; }
      index += needle.length;
    }
    return count;
  }

  function cueHit(cue, text, textLower) {
    if (ASCII_CUE_RE.test(cue)) { return asciiCueHits(cue.toLowerCase(), textLower); }
    return countOccurrences(text, cue);
  }

  function detectTime(text) {
    var match = TIME_RE.exec(text);
    return match ? match[0] : "";
  }

  function detectAmount(text) {
    var match = MONEY_RE.exec(text);
    return match ? (match[1] + match[2]) : "";
  }

  function extractKeyword(text) {
    var chunks = text.match(CJK_CHUNK_RE) || [];
    for (var i = 0; i < chunks.length; i += 1) {
      if (!STOPWORDS[chunks[i]]) { return chunks[i]; }
    }
    return "这个";
  }

  function emotionOf(text) {
    var neg = countWords(text, NEG_WORDS);
    var pos = countWords(text, POS_WORDS);
    var total = neg + pos;
    if (total === 0) { return { label: "中性", score: 0 }; }
    var score = (pos - neg) / Math.max(total, 1);
    if (score <= -0.6) { return { label: "明显负面", score: score }; }
    if (score < 0) { return { label: "偏负面", score: score }; }
    if (score >= 0.6) { return { label: "明显正面", score: score }; }
    return { label: "偏正面", score: score };
  }

  function round3(value) {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

  function lstripChars(text, chars) {
    var index = 0;
    while (index < text.length && chars.indexOf(text.charAt(index)) !== -1) { index += 1; }
    return text.slice(index);
  }

  // ---------------------------------------------------------------- 引擎主体

  function recentFriendMessages(messages, limit) {
    var cap = limit || 6;
    var friend = messages.filter(function (m) { return !m.isMe; });
    return friend.length ? friend.slice(-cap) : messages.slice(-cap);
  }

  function scoreIntents(recent, last) {
    var text = last.text;
    var textLower = text.toLowerCase();
    var earlier = recent.filter(function (m) { return m !== last; });
    var context = earlier.map(function (m) { return m.text; }).join(" ");
    var contextLower = context.toLowerCase();

    var lastScores = {};
    var windowScores = {};
    var evidence = {};
    INTENT_KEYS.forEach(function (key) {
      lastScores[key] = 0;
      windowScores[key] = 0;
      evidence[key] = [];
    });

    INTENT_SPECS.forEach(function (spec) {
      var key = spec.key;
      spec.cues.forEach(function (cue) {
        var hits = cueHit(cue, text, textLower);
        if (hits) {
          var weight = 1 + 0.25 * (cue.length - 1);
          lastScores[key] += weight * Math.min(hits, 3);
          evidence[key].push(cue);
        }
      });
      if (!context) { return; }
      spec.cues.forEach(function (cue) {
        if (evidence[key].indexOf(cue) !== -1) { return; }
        var windowHits = cueHit(cue, context, contextLower);
        if (windowHits) {
          var weight = 1 + 0.25 * (cue.length - 1);
          windowScores[key] += weight * Math.min(windowHits, 2);
          evidence[key].push(cue + "(上文)");
        }
      });
    });

    // 上文整体偏负面时, 情绪类意图应该被继承下来
    if (countWords(context, NEG_WORDS) >= 2) {
      windowScores.venting += 1.3;
      evidence.venting.push("整段对话偏负面");
    }

    var scores = {};
    var maxLast = Math.max.apply(null, INTENT_KEYS.map(function (key) { return lastScores[key]; }));
    if (maxLast <= 0) {
      // 最后一句没有明显线索, 按上文语境延续
      INTENT_KEYS.forEach(function (key) { scores[key] = windowScores[key] * 0.9; });
    } else {
      INTENT_KEYS.forEach(function (key) { scores[key] = lastScores[key] + 0.4 * windowScores[key]; });
    }

    // 结构性线索
    if (LINK_RE.test(text)) {
      scores.promotion += 2.5;
      evidence.promotion.push("疑似链接/二维码");
    }
    if (detectAmount(text) && scores.money > 0) {
      scores.money += 1.5;
      evidence.money.push("出现金额");
    }
    var fullText = recent.map(function (m) { return m.text; }).join(" ");
    var nudgeHits = countOccurrences(fullText, "在吗") + countOccurrences(fullText, "在么") + countOccurrences(fullText, "在不在");
    if (nudgeHits >= 2) {
      scores.followup_nudge += 2;
      evidence.followup_nudge.push("反复追问在不在");
    }
    var hasAny = ["?", "？", "在", "回"].some(function (w) { return text.indexOf(w) !== -1; });
    if (recent.length >= 3 && text.length <= 12 && hasAny) {
      scores.followup_nudge += 1;
    }
    if ((text.slice(-1) === "?" || text.slice(-1) === "？") && scores.question > 0) {
      scores.question += 0.8;
    }
    var timeExpr = detectTime(text);
    if (timeExpr) {
      ["invitation", "plan_confirm"].forEach(function (key) {
        if (scores[key] > 0) {
          scores[key] += 1.2;
          evidence[key].push("时间信息:" + timeExpr);
        }
      });
    }
    var neg = countWords(text, NEG_WORDS);
    if (neg >= 2) {
      scores.venting += 1.5;
      evidence.venting.push("负面情绪词密集");
    }
    if (countWords(text, URGENT_WORDS) >= 1) {
      scores.plan_confirm += 0.8;
      scores.followup_nudge += 0.6;
    }
    if (text.length >= 60 && neg >= 1) {
      scores.venting += 1;
      evidence.venting.push("长段+负面");
    }

    return { scores: scores, evidence: evidence };
  }

  function pick(scores) {
    var ranked = INTENT_KEYS.map(function (key) { return [key, scores[key]]; });
    ranked.sort(function (a, b) { return b[1] - a[1]; });
    var topKey = ranked[0][0];
    var topScore = ranked[0][1];
    var secondScore = ranked.length > 1 ? ranked[1][1] : 0;
    if (topScore <= 0) { return { key: FALLBACK_INTENT, confidence: 0.32 }; }
    var margin = (topScore - secondScore) / Math.max(topScore, 1e-6);
    var confidence = 0.45 + 0.32 * Math.min(topScore / 4, 1) + 0.2 * margin;
    return { key: topKey, confidence: Math.max(0.3, Math.min(0.95, confidence)) };
  }

  function urgencyOf(intentKey, recent, last) {
    var text = last.text;
    if (URGENT_WORDS.some(function (word) { return text.indexOf(word) !== -1; })) { return "高"; }
    if (intentKey === "plan_confirm" || intentKey === "followup_nudge" || intentKey === "money") { return "中"; }
    if (recent.filter(function (m) { return m.text.length <= 6; }).length >= 3) { return "中"; }
    return "低";
  }

  function buildSignals(evidence, intentKey, last, recent) {
    var signals = [];
    var seen = {};
    (evidence[intentKey] || []).slice(0, 6).forEach(function (cue) {
      if (!seen[cue]) {
        seen[cue] = true;
        signals.push("命中线索:" + cue);
      }
    });
    var text = last.text;
    if (LINK_RE.test(text)) { signals.push("消息里带链接或二维码, 像推广素材"); }
    var amount = detectAmount(text);
    if (amount) { signals.push("出现金额数字:" + amount); }
    var nudgeHits = 0;
    recent.forEach(function (m) { nudgeHits += countOccurrences(m.text, "在吗") + countOccurrences(m.text, "在么"); });
    if (nudgeHits >= 2) { signals.push("连续追问在不在, 共 " + nudgeHits + " 次"); }
    var timeExpr = detectTime(text);
    if (timeExpr) { signals.push("出现时间信息:" + timeExpr); }
    if (countOccurrences(text, "!") >= 2 || countOccurrences(text, "！") >= 2) {
      signals.push("感叹号密集, 情绪外露");
    }
    var tail = recent.slice(-3);
    if (recent.length >= 3 && tail.every(function (m) { return m.text.length <= 8; })) {
      signals.push("短消息连发, 节奏急");
    }
    if (!signals.length) { signals.push("没有强线索, 按日常对话处理"); }
    return signals;
  }

  var TEXT_FIXES = [
    ["，，", "，"], ["。。", "。"], ["，。", "。"], ["：，", "："],
    ["，？", "？"], ["，！", "！"], ["？，", "？"], ["！，", "！"],
    ["，?", "?"], ["，!", "!"], ["?,", "?"], ["!,", "!"], ["  ", " "]
  ];

  function fill(template, slots) {
    var text = template;
    Object.keys(slots).forEach(function (key) {
      text = text.split("{" + key + "}").join(slots[key]);
    });
    var leftovers = text.match(LEFTOVER_SLOT_RE) || [];
    leftovers.forEach(function (leftover) { text = text.split(leftover).join(""); });
    TEXT_FIXES.forEach(function (pair) {
      while (text.indexOf(pair[0]) !== -1) { text = text.split(pair[0]).join(pair[1]); }
    });
    return lstripChars(text.trim(), "，。、；： !?").trim();
  }

  function strategyHint(intentKey, strategy) {
    var group = STRATEGY_HINTS[intentKey];
    return (group && group[strategy]) || "";
  }

  function buildReplies(intentKey, slots) {
    var spec = INTENT_BY_KEY[intentKey] || INTENT_BY_KEY[FALLBACK_INTENT];
    var defaultStrategy = spec.default_strategy || "steady";
    return STRATEGY_ORDER.map(function (strategy) {
      var strategySpec = STRATEGY_SPECS[strategy];
      var template = spec.replies[strategy] || "";
      var reason = strategySpec.reason;
      var hint = strategyHint(intentKey, strategy);
      if (hint) { reason = reason + " 适用场景:" + hint + "。"; }
      return {
        strategy: strategy,
        strategy_label: strategySpec.label,
        text: fill(template, slots),
        reason: reason,
        risk: strategySpec.risk,
        advantage: strategySpec.advantage,
        tone: strategySpec.tone,
        recommended: strategy === defaultStrategy
      };
    });
  }

  function coerceMessages(raw) {
    if (typeof raw === "string") {
      return raw.split(/\r?\n/).map(function (line) { return line.trim(); })
        .filter(function (line) { return line; })
        .map(function (line) { return { sender: "好友", text: line, isMe: false }; });
    }
    if (raw && !Array.isArray(raw) && Array.isArray(raw.messages)) { raw = raw.messages; }
    return (raw || []).map(function (item) {
      if (typeof item === "string") { return { sender: "好友", text: item, isMe: false }; }
      return {
        sender: String(item.sender || item.from || "好友"),
        text: String(item.text || item.content || item.msg || ""),
        isMe: Boolean(item.is_me || item.isMe || item.from_me || item.self)
      };
    });
  }

  /* 把「发送者: 内容」形式的文本解析成消息列表, 对应 adapters/mock.py */
  function parseTranscript(text, contact) {
    var name = contact || "好友";
    var messages = [];
    String(text || "").split(/\r?\n/).forEach(function (rawLine) {
      var line = rawLine.trim();
      if (!line) { return; }
      var sep = null;
      var seps = [": ", "：", ":"];
      for (var i = 0; i < seps.length; i += 1) {
        if (line.indexOf(seps[i]) !== -1) { sep = seps[i]; break; }
      }
      var sender = name;
      var content = line;
      if (sep !== null) {
        var at = line.indexOf(sep);
        var head = line.slice(0, at).trim();
        if (head && head.length <= 24) {
          sender = head;
          content = line.slice(at + sep.length).trim();
        }
      }
      messages.push({
        sender: sender,
        text: content,
        isMe: ME_ALIASES[sender.toLowerCase()] === true
      });
    });
    return messages;
  }

  function analyze(rawMessages, contact) {
    var name = contact || "好友";
    var messages = coerceMessages(rawMessages);
    if (!messages.length) { messages = [{ sender: name, text: "", isMe: false }]; }

    var recent = recentFriendMessages(messages);
    var last = recent.length ? recent[recent.length - 1] : messages[messages.length - 1];

    var scored = scoreIntents(recent, last);
    var picked = pick(scored.scores);
    var spec = INTENT_BY_KEY[picked.key];
    var emotion = emotionOf(recent.map(function (m) { return m.text; }).join(" "));
    var confidence = round3(picked.confidence);

    var slots = {
      name: name,
      name_p: (name && name !== "好友") ? (name + ", ") : "",
      their: last.text ? ("「" + last.text.slice(0, 18) + "」") : "你说的那件事",
      time: detectTime(last.text) || "你方便的时候",
      kw: extractKeyword(last.text)
    };

    return {
      engine: "heuristic",
      contact: name,
      intent_key: picked.key,
      intent_label: spec.label,
      confidence: confidence,
      emotion_label: emotion.label,
      emotion_score: round3(emotion.score),
      urgency: urgencyOf(picked.key, recent, last),
      read: spec.read,
      goal: spec.goal,
      advice: spec.advice,
      signals: buildSignals(scored.evidence, picked.key, last, recent),
      replies: buildReplies(picked.key, slots),
      transcript: messages.map(function (m) { return { sender: m.sender, text: m.text, is_me: m.isMe }; }),
      note: "",
      confidence_pct: Math.round(confidence * 100)
    };
  }

  globalThis.WXEngine = {
    analyze: analyze,
    parseTranscript: parseTranscript,
    coerceMessages: coerceMessages,
    detectTime: detectTime,
    detectAmount: detectAmount,
    extractKeyword: extractKeyword,
    buildReplies: buildReplies,
    INTENT_SPECS: INTENT_SPECS,
    INTENT_BY_KEY: INTENT_BY_KEY,
    INTENT_KEYS: INTENT_KEYS,
    STRATEGY_SPECS: STRATEGY_SPECS,
    STRATEGY_ORDER: STRATEGY_ORDER,
    FALLBACK_INTENT: FALLBACK_INTENT
  };
})();
