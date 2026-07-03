const rawProfessionalCurriculum = `
# 第一阶段｜公司理财主干
## 01｜公司理财12讲
* [ ] 【01｜快读】公司理财总框架 p1
### 第一讲 公司理财导论 p2
* [ ] 【02｜快读】第一节 公司理财相关概念 p4
* [ ] 【03｜快读】第二节 企业的组织结构 p7
* [ ] 【04｜快读】第三节 代理问题和公司的控制 p9
### 第二讲 财务报表、财务分析与长期财务计划 p13
* [ ] 【05｜精读】第一节 财务报表 p14
* [ ] 【06｜精读】第二节 财务分析 p21
* [ ] 【07｜半精读】第三节 长期计划与增长 p30
### 第三讲 折现现金流估价 p39
* [ ] 【08｜精读】第一节 价值估值 p40
* [ ] 【09｜精读】第二节 复利计息期数 p41
* [ ] 【10｜精读】第三节 年金及其现值公式 p45
### 第四讲 资本预算 p53
* [ ] 【11｜精读】第一节 投资决策的方法 p54
* [ ] 【12｜精读】第二节 资本预算与投资决策 p71
* [ ] 【13｜精读】第三节 风险条件下的资本预算 p78
### 第五讲 利率与估值 p87
* [ ] 【14｜精读】第一节 利率与债券估值 p88
* [ ] 【15｜精读】第二节 股票估值 p96
### 第六讲 风险与收益 p108
* [ ] 【16｜精读】第一节 风险与收益的度量 p110
* [ ] 【17｜精读】第二节 资本资产定价模型 p113
* [ ] 【18｜半精读】第三节 套利定价模型 p130
### 第七讲 风险、资本成本和估值 p139
* [ ] 【19｜精读】第一节 权益资本成本 p140
* [ ] 【20｜精读】第二节 贝塔的影响因素 p143
* [ ] 【21｜精读】第三节 债务成本和优先股成本 p145
* [ ] 【22｜精读】第四节 加权平均资本成本 p146
### 第九讲 长期融资与资本结构 p162
* [ ] 【23｜精读】第一节 长期融资简介 p163
* [ ] 【24｜精读】第二节 资本结构与 MM 定理 p169
* [ ] 【25｜精读】第三节 资本结构与债务运用的限制 p189
### 第十讲 杠杆企业估值、资本预算与股利政策 p202
* [ ] 【26｜精读】第一节 杠杆企业的估值与资本预算 p203
* [ ] 【27｜半精读】第二节 股利政策和其他支付政策 p212
### 第八讲 有效资本市场和行为挑战 p152
* [ ] 【28｜后置】第一节 融资决策与价值创造 p153
* [ ] 【29｜后置】第二节 有效资本市场的描述 p153
* [ ] 【30｜后置】第三节 有效市场的类型 p155
* [ ] 【31｜后置】第四节 实证研究的证据 p158
* [ ] 【32｜后置】第五节 对市场有效性的挑战 p159
* [ ] 【33｜后置】第六节 对公司理财的意义 p160
### 第十一讲 期权、期货与公司理财 p224
* [ ] 【34｜后置】第一节 期权与公司理财 p225
* [ ] 【35｜后置】第二节 认股权证和可转换债券 p231
* [ ] 【36｜后置】第三节 衍生品与套期保值风险 p234
### 第十二讲 其他知识 p237
* [ ] 【37｜后置】第一节 短期财务计划 p238
* [ ] 【38｜后置】第二节 现金管理 p241
* [ ] 【39｜后置】第三节 信用和存货管理 p242
* [ ] 【40｜后置】第四节 收购与兼并 p245

# 第二阶段｜投资学主干
## 02｜投资学9讲
### 第一讲 投资学绪论 p1
* [ ] 【41｜快读】第一节 金融市场与金融工具 p3
* [ ] 【42｜快读】第二节 证券是如何交易的 p10
* [ ] 【43｜快读】第三节 共同基金和其他投资公司 p18
### 第二讲 投资组合理论 p23
* [ ] 【44｜精读】第一节 风险与收益度量 p25
* [ ] 【45｜精读】第二节 投资组合理论 p32
### 第三讲 指数模型与投资组合业绩评价 p61
* [ ] 【46｜精读】第一节 指数模型 p62
* [ ] 【47｜精读】第二节 投资组合业绩评价 p72
### 第四讲 资本资产定价模型和套利定价理论 p78
* [ ] 【48｜精读】第一节 资本资产定价模型 p79
* [ ] 【49｜精读】第二节 套利定价理论 p89
### 第六讲 债券估值和利率 p106
* [ ] 【50｜精读】第一节 债券的概念和定价 p108
* [ ] 【51｜精读】第二节 利率期限结构 p116
* [ ] 【52｜精读】第三节 债券资产组合管理 p122
### 第七讲 股票估值 p132
* [ ] 【53｜精读】第一节 绝对价值法 p133
* [ ] 【54｜精读】第二节 相对价值法 p139
### 第八讲 期权 p142
* [ ] 【55｜精读】第一节 期权基础知识 p144
* [ ] 【56｜半精读】第二节 期权策略 p151
* [ ] 【57｜精读】第三节 期权定价 p156
### 第九讲 期货、互换与风险管理 p169
* [ ] 【58｜精读】第一节 期货与期货市场 p171
* [ ] 【59｜精读】第二节 远期与期货定价 p175
* [ ] 【60｜半精读】第三节 期货与风险管理 p180
* [ ] 【61｜精读】第四节 互换 p189
### 第五讲 有效市场假说和行为金融理论 p94
* [ ] 【62｜后置】第一节 有效市场假说 p95
* [ ] 【63｜后置】第二节 行为金融理论 p102

# 第三阶段｜货币银行与国际金融主干
## 03｜金融10讲：货币银行 + 国际金融
### 第一讲 货币、信用与金融 p1
* [ ] 【64｜快读】第一节 货币 p2
* [ ] 【65｜快读】第二节 信用 p30
* [ ] 【66｜快读】第三节 金融 p33
### 第二讲 金融市场与金融中介 p38
* [ ] 【67｜快读】第一节 金融市场 p39
* [ ] 【68｜快读】第二节 金融中介 p70
* [ ] 【69｜快读】第三节 金融体系构成 p78
* [ ] 【70｜快读】第四节 金融体系效率 p83
### 第三讲 利率 p86
* [ ] 【71｜精读】第一节 利率的基础知识 p88
* [ ] 【72｜精读】第二节 利率决定理论 p95
* [ ] 【73｜精读】第三节 影响利率的一般因素 p103
* [ ] 【74｜精读】第四节 利率的风险结构 p110
* [ ] 【75｜精读】第五节 利率的期限结构 p115
* [ ] 【76｜精读】第六节 利率对经济的影响 p126
### 第四讲 商业银行 p133
* [ ] 【77｜精读】第一节 商业银行的基础知识 p135
* [ ] 【78｜精读】第二节 商业银行业务 p141
* [ ] 【79｜精读】第三节 商业银行管理理论 p155
* [ ] 【80｜精读】第四节 商业银行监管的必要性 p162
* [ ] 【81｜精读】第五节 商业银行监管的主要内容 p171
* [ ] 【82｜精读】第六节 银行监管的国际合作：巴塞尔协议 p182
### 第五讲 中央银行 p199
* [ ] 【83｜精读】第一节 中央银行的基础知识 p200
* [ ] 【84｜精读】第二节 中央银行的职能和业务 p204
* [ ] 【85｜精读】第三节 中央银行的独立性 p214
### 第六讲 货币需求和货币供给 p217
* [ ] 【86｜精读】第一节 货币需求 p218
* [ ] 【87｜精读】第二节 货币供给 p236
### 第八讲 货币政策 p299
* [ ] 【88｜精读】第一节 货币政策的基础知识 p301
* [ ] 【89｜精读】第二节 货币政策目标体系 p302
* [ ] 【90｜精读】第三节 货币政策工具体系 p321
* [ ] 【91｜精读】第四节 货币政策传导机制 p348
* [ ] 【92｜精读】第五节 货币政策调控中的若干问题 p353
### 第七讲 通货膨胀和通货紧缩 p262
* [ ] 【93｜半精读】第一节 通货膨胀的基础知识 p263
* [ ] 【94｜半精读】第二节 通货膨胀的影响 p269
* [ ] 【95｜半精读】第三节 通货膨胀的成因 p281
* [ ] 【96｜半精读】第四节 通货膨胀的治理 p289
* [ ] 【97｜半精读】第五节 通货紧缩 p293
### 第九讲 国际收支 p1
* [ ] 【98｜精读】第一节 国际收支的基础知识 p3
* [ ] 【99｜精读】第二节 国际收支平衡表 p4
* [ ] 【100｜精读】第三节 国际收支失衡的含义和影响 p32
* [ ] 【101｜精读】第四节 国际收支失衡的成因 p34
* [ ] 【102｜精读】第五节 国际收支失衡的自动调节机制 p36
* [ ] 【103｜精读】第六节 国际收支失衡的政策调节机制 p39
### 第十讲 汇率 p86
* [ ] 【104｜精读】第一节 汇率的基础知识 p87
* [ ] 【105｜精读】第二节 汇率决定理论 p95
* [ ] 【106｜精读】第三节 影响汇率的一般因素 p127
* [ ] 【107｜精读】第四节 汇率变动对经济的影响 p134

# 第四阶段｜第一轮回炉任务
## 回炉任务
* [ ] 【108｜回炉】公司理财公式总整理
* [ ] 【109｜回炉】公司理财错题与例题重做
* [ ] 【110｜回炉】投资学公式总整理
* [ ] 【111｜回炉】投资学模型关系图：组合理论、CAPM、APT、有效市场
* [ ] 【112｜回炉】债券、股票、期权、期货、互换专题整理
* [ ] 【113｜回炉】货币银行框架图：商业银行、中央银行、货币供求、货币政策
* [ ] 【114｜回炉】国际金融框架图：国际收支、汇率、国际资本流动
* [ ] 【115｜回炉】对照清华431大纲检查遗漏
* [ ] 【116｜回炉】开始按模块接触清华真题
`;

function slug(text) {
  return String(text || "")
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "")
    .slice(0, 24);
}

function parseProfessionalCurriculum(raw) {
  const stages = [];
  const sections = [];
  let currentStage = null;
  let currentModule = "";
  let currentLecture = "总览";

  raw.split("\n").forEach((line) => {
    const text = line.trim();
    if (!text) return;

    const stageMatch = text.match(/^#\s+(.+)/);
    if (stageMatch) {
      currentStage = { id: `stage-${stages.length + 1}`, title: stageMatch[1] };
      stages.push(currentStage);
      currentModule = "";
      currentLecture = "总览";
      return;
    }

    const moduleMatch = text.match(/^##\s+(.+)/);
    if (moduleMatch) {
      currentModule = moduleMatch[1];
      currentLecture = "总览";
      return;
    }

    const lectureMatch = text.match(/^###\s+(.+)/);
    if (lectureMatch) {
      currentLecture = lectureMatch[1];
      return;
    }

    const itemMatch = text.match(/^\*\s+\[\s*\]\s+【(\d+)｜([^】]+)】(.+?)(?:\s+p(\d+))?$/);
    if (!itemMatch || !currentStage) return;

    const sectionTitle = currentLecture === "总览" ? currentModule : `${currentModule} · ${currentLecture}`;
    const sectionId = `${currentStage.id}-${slug(sectionTitle)}`;
    let sectionItem = sections.find((item) => item.id === sectionId);
    if (!sectionItem) {
      sectionItem = {
        id: sectionId,
        stageId: currentStage.id,
        stageTitle: currentStage.title,
        moduleTitle: currentModule,
        lectureTitle: currentLecture,
        title: sectionTitle,
        items: [],
      };
      sections.push(sectionItem);
    }

    const number = itemMatch[1].padStart(3, "0");
    sectionItem.items.push({
      id: `prof-${number}`,
      number,
      mode: itemMatch[2],
      title: itemMatch[3].trim(),
      page: itemMatch[4] ? `p${itemMatch[4]}` : "",
    });
  });

  return { stages, sections };
}

const parsedProfessionalCurriculum = parseProfessionalCurriculum(rawProfessionalCurriculum);

export const professionalStages = parsedProfessionalCurriculum.stages;
export const professionalCurriculum = parsedProfessionalCurriculum.sections;

export function getProfessionalProgressMap(progressRecords = []) {
  return progressRecords.reduce((map, record) => {
    map[record.itemId] = record;
    return map;
  }, {});
}

export function isProfessionalSectionComplete(sectionItem, progressMap) {
  return sectionItem.items.length > 0 && sectionItem.items.every((item) => progressMap[item.id]?.completed);
}

export function extractProfessionalProgressFromReview(parsed = {}) {
  const progressLines = parsed.subjects?.economy?.progress || [];
  return extractProfessionalProgressFromText(progressLines.join("\n"));
}

export function extractProfessionalProgressFromText(text) {
  const content = String(text || "");
  if (!content.trim()) return [];

  const matched = new Map();
  content.split(/\n+/).forEach((line) => {
    const hint = detectProfessionalModuleHint(line);
    extractProfessionalMentions(line).forEach((mention) => {
      findProfessionalCandidates(mention, hint).forEach(({ sectionItem, courseItem }) => {
        matched.set(courseItem.id, {
          itemId: courseItem.id,
          stageId: sectionItem.stageId,
          stageTitle: sectionItem.stageTitle,
          sectionId: sectionItem.id,
          sectionTitle: sectionItem.title,
          moduleTitle: sectionItem.moduleTitle,
          lectureTitle: sectionItem.lectureTitle,
          number: courseItem.number,
          label: `【${courseItem.number}｜${courseItem.mode}】`,
          mode: courseItem.mode,
          title: courseItem.title,
          page: courseItem.page,
          sourceText: line.trim(),
        });
      });
    });
  });

  return Array.from(matched.values());
}

function extractProfessionalMentions(line) {
  const mentions = [];
  const pattern = /(\d+)\.(\d+)\s*([^，,；;。]*)/g;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    mentions.push({
      lectureNumber: Number(match[1]),
      sectionNumber: Number(match[2]),
      keyword: normalizeProfessionalText(match[3]),
    });
  }
  return mentions;
}

function findProfessionalCandidates(mention, moduleHint) {
  return professionalCurriculum.flatMap((sectionItem) => {
    if (moduleHint && !moduleMatchesHint(sectionItem.moduleTitle, moduleHint)) return [];
    const lectureNumber = chineseOrdinalNumber(sectionItem.lectureTitle.match(/第(.+?)讲/)?.[1]);
    if (lectureNumber !== mention.lectureNumber) return [];
    return sectionItem.items
      .filter((courseItem) => {
        const sectionNumber = chineseOrdinalNumber(courseItem.title.match(/第(.+?)节/)?.[1]);
        if (sectionNumber !== mention.sectionNumber) return false;
        if (!mention.keyword) return true;
        return normalizeProfessionalText(courseItem.title).includes(mention.keyword) || mention.keyword.includes(normalizeProfessionalText(courseItem.title).replace(/^第.+?节/, ""));
      })
      .map((courseItem) => ({ sectionItem, courseItem }));
  });
}

function detectProfessionalModuleHint(line) {
  if (/公司理财|财务|资本预算|现金流|估值|股利|杠杆/.test(line)) return "公司理财";
  if (/投资学|组合|CAPM|APT|股票|债券|期权|期货|互换/.test(line)) return "投资学";
  if (/货币银行|商业银行|中央银行|货币政策|通货膨胀|金融市场/.test(line)) return "金融10讲";
  if (/国际金融|国际收支|汇率/.test(line)) return "金融10讲";
  return "";
}

function moduleMatchesHint(moduleTitle, hint) {
  if (!hint) return true;
  return String(moduleTitle || "").includes(hint);
}

function normalizeProfessionalText(text) {
  return String(text || "").replace(/[\s：:，,；;。·\-—｜|（）()]/g, "");
}

function chineseOrdinalNumber(value) {
  const text = String(value || "").trim();
  const direct = Number(text);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === "十") return 10;
  if (text.startsWith("十")) return 10 + (digits[text[1]] || 0);
  if (text.endsWith("十")) return (digits[text[0]] || 0) * 10;
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    return (digits[tens] || 1) * 10 + (digits[ones] || 0);
  }
  return digits[text] || 0;
}
