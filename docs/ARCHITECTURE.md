# ▸ 架构 / Architecture

[中文首页](../README.md) · [English README](../README.en.md) · [English section](#english)

~~~text
[ IMPLEMENTED CORE ]  facts -> constraints -> candidate -> review
[ RESEARCH TRACK  ]  composition -> calculation -> sensory calibration
~~~

![Architecture](media/architecture.svg)

## 中文 · 当前系统

程序员调酒台将交互、确定性计算、持久化、主机权限和模型进程分成不同层。调酒是现有规则和数据的领域；“扩展到食谱”意味着增加经过审阅的数据契约和计算器，而不是把任意模型输出直接当成配方。

| 层 | 实际代码 | 负责什么 |
| :--- | :--- | :--- |
| 工作台 | product/apps/client/src | 七区交互、控制杆、实时匹配、ASCII、资料窗、个人库、队列与语言 |
| 原生边界 | product/apps/client/src-tauri | Tauri 命令、文件与剪贴板、窗口、原生缓存、模型和主机调用 |
| 领域 | product/crates/domain | 五味分配、独立七维、匹配指标、成杯基础计算 |
| 来源与个人库 | product/crates/catalog | 严格数据导入、修订号、SQLite、真实评价与备份 |
| 候选引擎 | product/crates/recipe_engine | 原料白名单、版本化规则、剂量范围、库存与容量约束 |
| 本地模型 | product/crates/inference | 显式授权、文件哈希、进程生命周期、输出校验、回退 |
| 主机 | product/crates/lan_host | 认证、TLS、票据窗口、审核菜单、事务订单与 outbox |
| 参考规格 | reference、agent、tests、schemas | 可执行参考算法和结构契约，不作为另一套运行时后台 |

### 四类数据不能合并

| 数据 | 来源与修改方式 | 不应被解释成 |
| :--- | :--- | :--- |
| 来源酒谱 | 来源页面／授权笔记、原始量、步骤、出处与版本 | 官方味觉评分 |
| 用户目标 | 五味与七维控制杆 | 实际原料剂量 |
| 配方预测 | 编辑假设或版本化规则；保留其估计性质 | 真实品尝结果 |
| 实饮评价 | 使用者明确记录的品尝，绑定配方修订与快照 | 可任意迁移到另一版本的分数 |

五味为五个非负整数，总和恒为 10000。锁定部分味道后，剩余预算只在可动轴之间分配。显示采用最大余数法：例如 3333/3333/3334/0/0 基点显示 33/33/34/0/0；显示取整不改变保存的坐标。七维是七个独立的 0–10 数值，不要求合计为固定值。

### 规则与模型的边界

当前候选引擎从白名单原料与有限模板生成调酒候选，检查实际 SKU、库存、酒精度、过敏原审核、容量、乙醇操作上限和调制阶段。它不能仅凭“口味接近”放宽硬约束。

模型调用是可选步骤：先生成候选，再让模型在已提供的候选 ID 中选择并给出名字。适配层接受的业务结果只有：

~~~json
{
  "candidate_id": "012345abcdef",
  "name_zh": "示例名称",
  "name_en": "Example Name"
}
~~~

以上是字段形状示例，不是有效候选，也不会作为配方执行。额外的剂量、热量、权限、工具指令和未知候选 ID 会被拒绝。模型文件与 llama.cpp 可执行文件需要校验 SHA-256 和显式批准；服务只在受控本机环回地址运行，带超时、取消和回收机制。模型不可用或结果无效时记录原因并回退规则。

“AI 模式”开关本身不证明真实模型已经运行。只有实际进程状态和本次调用审计能说明是否使用了模型。普通控制杆匹配不需要推理。

### 估算层不覆盖事实层

展示估算位于前端独立模块，包括 assisted-estimates.ts 与 estimate-ingredient-assumptions.ts。它根据可用标签、明确的类别假设、单位、留存量、份数与融水约定计算范围；当前计算不是本地模型直接给出的数值。

缺失的实际标签不会因为界面需要一个数字就变成确定事实。来源原量、实际 SKU 信息、显示估计和主机操作规格保持不同身份。完整营养素面板、烹饪损耗和个体营养目标目前不在实现范围内。

### 本机队列、存档与订单

.timermix 是可交换的配方快照；重复导入可得到独立队列项或个人副本。文件还保留用户目标、配方预测、出处与图标。导入不恢复账户权限、不伪造实饮结果、不自动批准客人菜单。队列排序或完成也不扣票。

主机订单则必须经过认证、票据与菜单审核。提交请求有稳定 ID；扣票、库存变化、订单快照及 outbox 事件在一个 SQLite 事务中提交。重试读取原结果。之后修改酒谱或用户目标，不会改写历史订单的配料、目标和审阅信息。个人资料备份与主机账本备份是不同备份范围，不能互相替代。

<a id="research-roadmap"></a>
## ▸ 扩展路线 / Research roadmap

下表是**架构方向，不是已经实现的 API 或已验证的科研成果**。贡献可以逐项推进，先增加可复现的小样本，再扩展搜索空间。

| 模块方向 | 建议输入与输出 | 验证重点 |
| :--- | :--- | :--- |
| 原料成分适配器 / Composition adapter | 食物或 SKU ID、来源与许可、每 100 g／每份基准、营养成分、日期、缺失项 | 单位、可食部分、品牌差异、数据版本；未知不能等于零 |
| 单位与工艺 / Units and preparation | 质量、体积、密度、份数、烹饪产率、损耗／留存模型及假设 | 不把体积直接当质量，不重复计算配料或酒精能量 |
| 确定性营养计算 / Nutrition evaluator | 完整候选与成分版本 → 每份结果、范围、缺失项、约束解释 | 组合守恒、份数、缺失传播、数值稳定性、可复算 |
| 多目标候选搜索 / Candidate search | 味觉目标、营养约束、库存、工艺、过敏原 → 有来源的候选集 | 可行性优先；返回冲突原因，不偷偷放宽限制 |
| 味觉预测 / Sensory prediction | 配方版本、工艺和版本化模型 → 预测及适用范围 | 区分主观喜好、描述强度与个体差异，避免伪造客观分数 |
| 真实反馈与校准 / Calibration | 经同意收集的品尝记录、实验条件、独立保留集 | 重复性、数据泄漏、误差、偏差和未经验证的外推 |
| 非酒精／食物适配 / Food adapters | 新的合法原料、工艺与安全规则 | 领域专属审核；不复用调酒的默认容量和模板作为普遍规律 |

一种未来的营养计算结果应同时能表达“数值”与“为什么不能完整计算”。下面是**设计示意**，当前运行时不接受该 schema：

~~~json
{
  "recipe_revision": "example-r1",
  "composition_revision": "example-dataset-v1",
  "servings": 1,
  "values": [
    {
      "nutrient": "energy",
      "unit": "kcal",
      "amount": null,
      "status": "incomplete",
      "missing_ingredients": ["example-ingredient"]
    }
  ],
  "assumptions": [],
  "method_version": "proposal-not-implemented"
}
~~~

味觉偏好是目标函数的一部分，不应自动成为营养结论。未来接入模型时仍应由独立校验器负责单位、营养计算、允许的工艺和审核状态；模型可建议候选，但不能自签“已验证”。

### 建议的实验推进顺序

1. 选择一个小领域，例如非酒精酸甜饮品，建立有许可证的原料成分样本。
2. 建立手算可核对的单位、份数和成分计算金标准。
3. 定义可解释的约束与不可行原因，再引入候选搜索。
4. 用明确同意的实作反馈评估预测误差，保留配方修订与实验条件。
5. 在新的样本和人群上验证后，再扩展领域或模型职责。

## ▸ 检验与兼容

前端单测、Rust 单测、Python 参考测试、真实 Tauri 运行、实际安装、局域网多机测试和真实模型测试证明的是不同事情。一个层的成功不能替代另一层。版本验收见 [构建报告](../product/BUILD_REPORT.md)。

可见品牌改为程序员调酒台；内部 crate 名称、数据库应用标识和 .timermix schema 保留兼容。增加新的营养 schema、工艺或模型职责时，应显式版本化并验证旧存档读取和订单重试。

<a id="english"></a>
## English · Implemented system

Programmer Mixology separates interaction, deterministic calculations, persistence, host authority, and model processes. Cocktails are the current data and rules domain. Expanding to food recipes requires reviewed contracts and calculators; arbitrary model text does not become an executable recipe.

| Layer | Actual source | Responsibility |
| :--- | :--- | :--- |
| Workbench | product/apps/client/src | Seven panels, sliders, live matching, ASCII art, callouts, personal library, queue, language |
| Native boundary | product/apps/client/src-tauri | Tauri commands, file/clipboard/window integration, archive cache, model and host calls |
| Domain | product/crates/domain | Taste allocation, independent sensory axes, matching, basic serving calculations |
| Catalog | product/crates/catalog | Strict imports, revision identities, SQLite, real reviews and backups |
| Candidate engine | product/crates/recipe_engine | Ingredient allowlist, versioned rules, doses, stock and capacity constraints |
| Local inference | product/crates/inference | Explicit approval, hashes, process lifecycle, output validation, fallback |
| Host | product/crates/lan_host | Authentication, TLS, ticket windows, approved menu, transactional orders and outbox |
| Reference specification | reference, agent, tests, schemas | Executable reference algorithms and contracts; not a second production backend |

### Keep four data identities separate

Source recipes contain preparation facts, quantities, provenance, and revisions. User targets describe preferences. Recipe predictions are editorial or rule-based estimates. Real tasting reviews are explicitly recorded observations tied to a revision and snapshot. None of these should silently overwrite another.

Taste consists of five nonnegative integers summing to 10000. Locked axes preserve their share while the remaining budget is redistributed. Largest-remainder display turns 3333/3333/3334/0/0 into 33/33/34/0/0 without rewriting stored coordinates. The seven sensory values are independent 0–10 axes.

### Rules first; a bounded model choice

The engine builds candidates from an ingredient allowlist and limited templates. It checks actual SKU details, stock, ABV, allergen review, capacity, operational ethanol ceilings, and preparation stages. Similarity to a taste target cannot override a hard constraint.

The optional model receives candidates already produced by the rule engine. Its accepted response has exactly three fields: candidate_id, name_zh, and name_en. The illustrative JSON above is not an executable recipe. Unknown candidate IDs and extra doses, calories, permissions, or tool instructions are rejected.

The adapter verifies the reviewed executable and GGUF hashes, requires approval, runs on a controlled loopback address, and supports timeout, cancellation, and process cleanup. Invalid or unavailable model responses fall back to rules with a recorded reason. Enabling AI mode alone does not prove that a real model ran; process status and invocation audit establish that fact. Ordinary slider matching does not require inference.

### Estimates retain their identity

The separate frontend estimate modules calculate ranges from available labels and explicit category, unit, retention, serving, and dilution assumptions. The current calculation is deterministic, not a calorie value supplied by the local model. Missing product facts stay distinct from display estimates. Complete nutrient panels, cooking losses, and personalized nutrition goals are not implemented.

### Archives, local queues, and host orders

A .timermix file carries a recipe snapshot, target, prediction, provenance, and icon. Repeated imports create independent queue items or personal copies. Importing cannot restore permissions, manufacture real reviews, or approve a guest menu. Reordering/completing the local queue does not debit tickets.

Host orders require authentication, tickets, and an approved serving specification. A stable request ID identifies retries. Ticket debit, inventory changes, an immutable order snapshot, and the outbox event commit in one SQLite transaction. Recipe edits do not change historical snapshots. Personal backups and host-ledger backups cover different data and are not interchangeable.

### Research direction and interfaces

The bilingual roadmap above describes **proposed extensions, not implemented APIs or validated scientific results**:

- Composition adapters should preserve source/licensing, units, per-100-g or serving basis, dates, and missing values.
- Unit and preparation models must distinguish mass, volume, density, edible portion, yield, and retention.
- A deterministic nutrition evaluator should return reproducible per-serving estimates together with assumptions, missing inputs, and constraint explanations.
- Candidate search should report infeasibility rather than silently loosen restrictions.
- Sensory prediction should distinguish preference from perceived intensity and account for individual differences.
- Calibration requires consented real observations, recipe revisions, experimental conditions, independent evaluation data, and documented uncertainty.
- New food domains require their own ingredients, processes, and review rules; cocktail defaults are not general food laws.

The nutrition JSON above is a design sketch that the current runtime does not accept. It deliberately demonstrates an incomplete result rather than a fabricated number. A model may suggest a candidate; it cannot certify that candidate as validated.

A useful development sequence is a narrow nonalcoholic domain, licensed composition samples, hand-checkable calculation fixtures, explicit constraints, consented preparation/tasting records, then evaluation on new samples before expanding the scope.

Frontend tests, Rust tests, Python reference tests, native execution, actual installation, multi-device LAN acceptance, and real-model tests establish different claims. See the [build report](../product/BUILD_REPORT.md) for version-specific evidence. Preserve legacy app IDs, archive compatibility, and retry semantics when extending the system; version new data contracts explicitly.
