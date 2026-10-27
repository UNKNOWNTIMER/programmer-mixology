from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
DOCS={
'README.md':r'''# PIXEL MIX｜像素调酒台：Codex 开发交接包

这是一份**开发任务书、来源化种子数据和可运行参考算法**的交接包，不是已完成的软件或安装包。工作名称尚未进行商标检索。

## 已包含

70份配方：60份逐页查阅的IBA参考版本、10份用户原始笔记版本；101个原料类型；70份单独保存、明确标记“未验证”的感官初始先验。配方来源是制作事实依据，不是感官分数的依据。

七区产品交互规范、跨平台架构、局域网票据与订单状态机、本地模型选型流程、调酒Agent约束、数据/发布规范及验收矩阵。提供五味100%重分配、匹配指标、酒精度缺失值处理、SQLite并发扣票、三个家族候选生成、受限本地模型命名和八种ASCII杯型的Python参考实现。Python仅用于可执行规格，不是要求产品运行时同时部署第二套Python后端。

## 使用

在Codex中打开本目录，首先读取 `AGENTS.md` 和 `CODEX_START_HERE.md`。具体目标是由Codex在 `product/` 中实现Tauri客户端与Rust核心，并实际构建首发Windows安装包；不要覆盖交接资料。

本包参考代码只需 Python 3.10+，无需下载模型，也不连接局域网：

```sh
python -m unittest discover -s tests -v
python scripts/validate_seed.py
python -m agent.reference_agent data/example_agent_request.json --output data/example_agent_output.json
python -m reference.ascii_glass
```

`tests/` 的通过只证明参考算法的已测行为，不代表真实界面、本地模型、手机、TLS或安装包通过测试。实际执行记录见 `docs/参考测试结果.md`。

## 数据边界

`data/recipes.json` 是酒谱事实；`data/profiles.seed.json` 是编辑性启发式先验。两者不可合并成“官方味觉评分”。未知酒精度、热量、dash毫升数、糖浆浓度、融冰量均保持未知；未完成调制配置和管理员审核前，种子酒谱可浏览但不可直接成为客人可下单项目。

示例Agent输入的库存和酒精度是测试夹具，并非用户现有酒瓶的实测信息。其输出为待审核试调，不是“已被证明好喝的新经典”。

## 未包含／待Codex实施

实际Tauri/React产品源码、真实网络服务、本地模型权重、字体文件、用户三张设计参考图、模型实机基准、签名证书及Windows/macOS/Android/iOS安装产物均不在本包中。不能把此ZIP改名成安装包交付。

## 参考图状态

本轮可用附件只有此前的酒瓶照片，没有用户描述的图1（风格）、图2（设计稿）、图3（票据Logo）。当前视觉规范为文字需求的暂定解释；后续将真实参考图放入 `assets/references/`，保留原文件名并建立映射，再进入视觉对齐验收。

## 权利与来源

配料事实附原网页链接，操作以中文重新表述，不包含原网站图片、长篇原文、模型或字体。引用不是取得整站数据库商用再分发授权的证明；公开发布前进行数据、品牌、模型、图标和字体的许可证审核。用户个人笔记默认仅在其私有库中使用。
''',
'AGENTS.md':r'''# Repository instructions

Read `CODEX_START_HERE.md`, then the document relevant to the current milestone. This is a product implementation task, not a request for another planning-only response.

- Preserve `data/`, `reference/`, `agent/`, `tests/` and this handoff. Build the production application under `product/`.
- Target a local-first Tauri 2 + React/TypeScript UI and Rust domain core. Windows first; mobile adapters are explicit work, not assumed sidecar compatibility.
- All recipe facts must have provenance. Seed sensory vectors are unvalidated priors, not measurements. Unknown quantities and nutrition stay unknown. Never fabricate reviews, citations, installed models, test success or binary artifacts.
- Five taste controls always sum to 10,000 integer basis points. Seven sensory controls are independent. Keep user targets separate from recipe predictions.
- Host is authoritative. Ticket debit, immutable order snapshot and outbox event commit atomically; replayed requests must not debit twice. Reference SQLite code has no authentication and must not be exposed as a server.
- LLM output is untrusted data. Whitelist ingredient IDs, constrain amounts, validate schemas and physical rules; no shell, executable HTML, arbitrary URL tools or public inference server.
- The three UI reference images have not been supplied. Use documented provisional tokens without claiming fidelity. Do not use bottle photos as UI designs.
- Do not download models, alter system permissions, publish, buy certificates or upload private data without explicit user approval. Never bundle font files from the assistant environment.
- After each milestone run its tests, record actual commands and failures in `product/BUILD_REPORT.md`, and update `product/STATUS.md`. Keep work resumable with small commits. No fake buttons, simulated production success, unexplained TODOs or screenshot-only delivery.
- A blocked platform/signing task does not block all other work. Deliver supported artifacts and state the exact unresolved prerequisite. Do not claim signed iOS or macOS output from an environment unable to build it.
''',
'CODEX_START_HERE.md':r'''# 交给Codex执行的总任务

请在当前工作区开发一款专业、本地优先、像素黑客风格的鸡尾酒软件，暂定名“PIXEL MIX｜像素调酒台”。你需要真正编写、运行、测试和打包产品，不是只输出方案或静态演示。以本交接包为需求和数据源，生产实现放在 `product/`。

## 第一步：审计环境与证据，不猜电脑配置

确认工作区可写、操作系统、CPU架构、可用RAM、GPU型号/显存或统一内存、驱动、Node、Rust、Windows C++构建工具、WebView2、Android/iOS工具链情况。记录缺失项，先实现可独立运行的部分。不要把云端或沙箱机器的配置当成用户电脑；跨机器时输出检测工具让目标设备执行。不得默认删文件、自动提权或更改防火墙。项目已在工作区则无需强行迁移桌面。

检查 `assets/references/`。当前三张界面参考图缺失，所以先执行七区功能与暂定设计系统；真实图到位后做视觉对齐。没有图片时不得宣称“完全还原图2”，也不要停下整个数据与业务开发。

## 第二步：验证交接包

运行README中的两条验证命令。阅读 `docs/01_产品与七区交互.md`、`docs/02_架构与平台.md`，初始化产品目录。将 `reference/core.py`、`reference/ticket_store.py`、`agent/reference_agent.py` 的明确行为移植为Rust测试，不要把这些原型直接接上网络就声称产品完成。

## 第三步：按闭环里程碑推进

M0：建立可启动Tauri应用、schema导入、数据库迁移、全局设置与错误页。离线可浏览70份酒谱及来源；不可有空壳链接。

M1：完成七区桌面界面，五味守恒滑杆、七维控制、经典检索、库存过滤、左向配方菜单、固定/撤销、ASCII杯型、交互热区、随机、收藏与真实评价分离。给出1280×800、1920×1080和高DPI截图以及交互测试，不只一张概念图。

M2：完成配对、角色权限、票据计划、主机订单事务、断网与重连、邮票撕开查看。至少两台不同设备真实点单验证；用并发及断电/重启模拟测试证明不重复扣票、不丢已提交订单。

M3：完成本地模型适配和硬件自检、明确许可的下载管理、规则Agent、结构化输出验证与失败回退。经典模式始终无模型可用。生成酒单默认“试调待审核”，不得自动列入客人可点菜单。

M4：完成性能、无障碍、备份恢复、日志脱敏、依赖和数据许可清单、安全审查、Windows安装/卸载/升级实测。打包实际可启动的安装文件，不把源代码ZIP当安装包。macOS、Android、iOS按平台工具链逐项构建，未验证的标为未验证。

M5：移动端适配：没有鼠标的交互全部可完成；本地网络权限、配对与主机AI代理在真机验证。移动端首版为客人客户端，不能承诺后台常驻主机。iOS/macOS签名与公证需要相应机器及账户。

## 必须遵守

五味百分比是偏好坐标，不是体积比例，也不是精确生理模型。经典匹配与AI创作分开。百分比守恒算法用整数基点；所有边界与锁定规则见算法规范。酒精感分数不替代成杯酒精度。热量只有标签与体积足够时才估算。

主机接受订单时冻结整份酒谱、步骤、版本与用户选择。客户端旋转动画不能决定扣票成功；网络重试不能生成新扣票事务。邮票撕开只是查看，不是接单、扣票或删除。

AI采用“规则候选 → 确定性校验 → 模型选择与命名 → 再校验”，不允许模型自由编造原料剂量。版本、来源、目标、预测、失败原因可追溯。不要用评分、过期票提醒或连胜机制诱导饮酒。

## 最终交付格式

交付生产源码、可安装产物及SHA-256、实际测试报告、依赖锁文件、SBOM/第三方许可、已知问题、构建/安装/恢复说明。`STATUS.md` 明确已完成、未验证和阻塞项。每次继续任务时先读取状态和最新失败日志，再推进下一闭环，不要反复重写架构。

现在先执行环境审计和M0，然后继续M1。遇到可自行解决的技术问题，定位根因并修复；只有权限、真实参考图、签名证书等无法从本地获取的必要外部信息才向用户提出明确请求。
''',
'docs/01_产品与七区交互.md':r'''# 01｜产品定义与七区交互

## 产品边界

目标是让用户通过口味偏好发现经典酒谱，并在可用库存和规则约束下创作可供调酒师审核的试调配方。专业性来自可追溯数据、可解释匹配、真实订单和可靠交付，不是“AI保证好喝”或单纯视觉炫技。

模式为：经典浏览、偏好匹配、规则试调、启用本地模型后的AI辅助创作。无外网、无模型、无主机时仍能浏览本地酒谱；无法连接主管理员时只能保存草稿，不能假装完成点单。

产品拥有TargetProfile（想要的口味）、RecipeSnapshot（当前酒谱）、Prediction（估计表现）三个独立状态。滑杆改动不是直接改写经典原配方；选择经典预设才整体加载其先验，必须有撤销。匹配结果展示目标和候选差异，不能偷偷把滑杆改成“刚好命中”。

## 暂定视觉系统

真实图1/图2/图3未提供。暂定配色：背景#0B0C0F，面板#13151B，主字#E8E3D7，次字#94979F，强调红#D9534F，边框#363A43。红色只用于热点/状态/重点字段，不以红色填满屏幕。成品以真实参考图确认后的tokens为准。

4px基础网格、8/12/16/24/32px间距；2px折角边框；轮廓阴影代替大面积玻璃模糊。中文与英文都使用覆盖相应字符的像素字体；字体来源和商用许可须实查，未加载时用清晰系统字，不许缺字方框。本文不附字体文件。ASCII画图区使用严格等宽ASCII网格，中文说明在独立DOM标签中显示，避免字符宽度破坏酒杯。

正文以可读性为先，中文至少约14–16 CSS px并验证DPI；“像素风”不是整段文字缩到8px。像素字体只在合适字号和整数缩放下使用。注意超长中文名、重音字符、无中文名字、切换语言、系统文字放大。

桌面参考尺寸1440×900，暂定左260px、中380px、右剩余宽度。左侧为1/2/3/4；中部上5下6；右7。大屏不无限拉长滑杆，窄屏不整体缩小字体。

## 1号｜中英文酒名

中文主标题与英文副标题必须同时保留。展示版本徽标：IBA参考／个人笔记／规则试调／AI试调／管理员已审核。切换酒谱使用约120ms淡入与微小位置变化，不出现长时间乱码遮盖名字。来源可一键展开，名称不拿AI生成内容冒充历史酒名。

点击名称进入搜索，支持中文别名、英文、原料与家族检索。生成中的标题保留上一有效酒谱，旁边显示处理中，不替换成未通过校验的名称。

## 2号｜左向菜单式配方抽屉

鼠标悬停配料入口约140ms开启，离开约180ms后关闭；菜单与入口共享hover区域，跨越二者不得闪退。点击入口固定，固定后可在菜单内滚动、复制、调整显示份数；再次点击或Esc解钉/关闭。键盘Enter与移动端点击等效。

左向展开的先决条件是有可用空间：桌面为抽屉预留窗口内侧空间，或整个工作台向右让位；位置必须钳制到窗口安全区。不能从应用左边缘跑到屏幕外。窄屏改成底部Sheet，功能不减少。

内容为材料名称、数值、单位、品牌/替代限制、库存缺口、装饰、制作顺序、杯型、冰型、来源、注意事项。mix/top/float/rinse/garnish阶段清晰分隔。“加满”“数滴”“一份”等原始单位保留，点击可建立管理员确认过的操作规格，不能直接换成编造的毫升。

经典原配方不可原地覆盖；编辑后另存变体与父版本。批量份数缩放不能简单把整块冰、摇壶容量、气泡保留与装饰处理视为线性。v1支持材料量缩放并明确分批操作，复杂预调留待专门验证。

## 3号｜设置与生成

设置包含动画/减少动态效果/声音关闭、字体缩放、语言、主题、单位与糖浆浓度、库存SKU与器具、过敏原与排除项、本地模型、局域网角色与主机、备份/日志/许可。管理设置与客人设置权限隔离。

AI默认关闭。按钮状态为“匹配经典”或“生成试调”，旁边显式标注当前引擎“本地规则／本地模型”。只拖滑杆不会不断调用模型；拖动节流进行本地匹配，点击生成才启动任务。支持取消、进度阶段、超时重试；不要伪造百分比进度。

生成过程不冻结窗口。用户继续拖杆时本次任务保留输入快照；结果显示“根据上一组偏好生成”，可重新生成，不覆盖新目标。缺少模型时降级需明确提示，不能仍标AI成功。

## 4号｜票据Logo、局域网与邮票订单

Logo状态：离线、未配对、无票、可用、提交中、确认已用、拒绝。可用时像素轮廓高亮，焦点时展示剩余票和窗口；颜色不是唯一反馈，还要文本与无障碍描述。

点击可用Logo，先确认当前酒谱、数量、过敏原声明，再发送请求。旋转约720ms，ease-out建议cubic-bezier(0.16,1,0.3,1)。立即进入提交中；只有主机确认订单已提交并扣票才转暗。超时显示“确认状态未知，正在查询”，同一请求ID重试，不能直接回亮让用户再扣一次。

主管理员收到订单后，应用内部边缘出现像素邮票。内容为客人昵称、时间、酒名与状态，不展示敏感资料。拖动边角呈现像素锯齿撕开，越过约宽度35%阈值后展开完整订单；未越阈值回弹。键盘/按钮可“打开订单”，不强迫拖动。减少动态效果时直接展开。

邮票不是贴到系统桌面的全局悬浮窗。撕开只标记已读，不改变业务状态。订单可以关闭再打开；不因清理视觉卡片删除数据库记录。订单列表支持搜索、未读、接单、制作中、可领取、完成、拒绝与退款策略。

## 5号｜五味水平像素滑杆

五行顺序固定：甜、酸、苦、咸、鲜；总和永远100.00%。每行显示当前数值和锁定开关。拖动、点轨道、方向键和悬停滚轮均支持。默认0.5个百分点一步，Shift为细调0.1；数值输入以基点落库。

鼠标指针真正悬停且组件可操作时才消费滚轮事件；不可让整页任意滚轮改变味觉。触屏使用拖拽和加减按钮，键盘Home/End为可行最小/最大。锁定后其他滑杆只能在剩余预算内变化；所有边界按03文档处理。

灰度标记表示经典配方先验投影，不是该区间内任何值都会得到同一杯酒。重叠标记展开候选列表，点击一次整体载入5+7维及酒谱，明确切换版本，并提供撤销。标记没有不真实的实验精度。

## 6号｜七维垂直控制

从左到右为酒精感、香气、酒体、气泡、清凉感、辣感、味韵。顶端10、底部0，独立评分不归一。软件字段finish表示余味/持续感，不是以秒为单位的客观时间。

拖动时拇指锚定与数值位置稳定；最多一帧一次更新绘制，不把每个像素变化写入数据库。松手保存；撤销单次手势而非上千个中间状态。说明中明确酒精感不同于ABV、清凉感不同于饮料温度。温度、融冰、酒精度上限是额外调制约束，放在高级设置，不破坏用户要求的七轴。

## 7号｜ASCII酒杯、信息热点、随机与评价

渲染器使用杯型轮廓、混合液面、冰、泡沫和装饰等离散参数，保持种子稳定。首版八种杯型在reference/ascii_glass.py，生产版扩展层与热点，不让模型自由输出可执行HTML。

摇匀酒体是一种混合状态，不能为了漂亮画成不存在的独立分层。真正float与奶油覆盖可在对应模板表达，但高度只是示意，除非体积映射有校准。别把“30%甜”画成30%糖浆液层。

悬浮或键盘焦点触发少量红色延伸线与短标签：基酒、配料体积构成、味觉偏好对照、估算ABV/热量、来源。字形扰动最多160–220ms后稳定，最多同时3个热点，不能持续快速闪烁。点击酒杯弹“酒语”；未核对出处的文字标“系统原创”，不假托名人。

左下随机按钮遵循库存、排除项、模式和酒精上限，可选“在当前偏好附近随机／整个可行库随机”；随机结果可撤销。不能随机绕过过敏原限制。

右下评分分为偏好匹配指数、规则校验、实饮评价。未评分显示“暂无实饮评价”，不伪造星级或人数。真实评价保存用户、版本、时间和同意选项；归因到酒谱快照，不能把旧版五星自动迁移给新配方。

## 移动端与动画性能

手机改成顶部酒名+ASCII预览，中部横向切换五味/七维，底部配方与点单；主管理员功能优先平板/桌面。hover行为全部有点击/长按/焦点替代。保持七个模块的功能，不把桌面缩成邮票大小。

动画状态由业务状态驱动，取消动画不改变事务。常态Canvas按需重绘，交互最高60fps，闲置停止requestAnimationFrame或显著降频。只在需要的区域绘制噪点；禁止全屏每帧随机字符与React全树重渲染。transform/opacity优先，文字和像素网格落到整数位置。
''',
'docs/02_架构与平台.md':r'''# 02｜技术架构、平台与发布边界

## 选型

采用Tauri 2桌面/移动壳、React + TypeScript + Vite前端、Rust业务核心、SQLite本地存储。UI使用可访问DOM控件，ASCII用Canvas2D，避免为了酒杯引入大型3D引擎。主机使用Rust Axum风格HTTP/WebSocket服务；精确库版本由Codex在实机初始化时核实、锁定并写入依赖报告，不在任务书中编造“已兼容最新版本”。

Tauri官方说明支持Rust与Web前端及桌面/移动目标：[Tauri](https://v2.tauri.app/start/)。采用这套架构是本项目工程取舍，不意味着每个插件在所有平台上行为相同。

## 生产目录建议

```text
product/
  apps/client/              React界面、Tauri入口、平台权限
  crates/domain/            纯数据类型、五味算法、评分与配方校验
  crates/catalog/           导入、SQLite仓库、版本迁移
  crates/recipe_engine/     家族模板、候选求解、规则解释
  crates/lan_host/          认证、票据、订单、outbox与事件同步
  crates/inference/         模型运行时、受限协议与下载管理
  crates/platform/          密钥、文件、局域网发现、硬件与移动桥接
  packages/contracts/      共享JSON Schema和生成的TS类型
  tests/e2e/               Playwright和设备集成测试
  packaging/               安装配置、签名占位说明和合法美术资产
  docs/ BUILD_REPORT.md STATUS.md
```

domain不得依赖Webview、网络、SQLite全局连接或模型进程。依赖方向为UI→应用服务→领域→端口；具体存储/网络/模型适配在外层。一个领域模型维护TS/Rust边界，通过schema生成或对照测试防止字段漂移。

## 状态和存储

实体：IngredientType、IngredientSKU、InventoryLot、Recipe、RecipeRevision、SourceRecord、ServingSpec、SensoryPrior、TastingRecord、TargetProfile、GeneratedDraft、GenerationAudit、Account、Device、HostProfile、TicketPolicy、TicketGrant、Order、OrderSnapshot、OutboxEvent、AppSettings。

酒谱内容存版本，用户收藏引用明确版本或“跟随最新版”选项。订单必须内嵌冻结快照，不依赖后来会改的外键内容。SKU维护实际酒精度、营养标签、糖浆配制质量比、过敏原和容量；原料类型不能替代SKU。

SQLite使用迁移、外键、事务、备份一致性操作，主机WAL；不要直接复制正在写入的db文件声称可靠备份。使用数据库备份接口或正确checkpoint/停写策略。绝不把数据库放在多人共享目录当网络数据库。导入先校验到临时区，再事务提交；失败保留原数据。

偏好缓存和动画状态在内存，手势结束后落盘；酒谱索引按版本构建。70至数千条酒谱无需向量数据库，直接排序更透明。首次导入以后不每次启动重新抓网。

## 网络与进程边界

未打开“作为主管理员”时不监听LAN端口。主机绑定用户选择的私有网卡，拒绝UPnP映射，不默默开放公网。HTTP/WebSocket访问通过认证、消息大小上限、速率限制、schema与权限校验。

桌面llama.cpp作为受控本地进程，只绑定loopback，随机端口和访问token；UI不直接暴露进程控制给客人。AI请求由应用层授权转发。子进程限制超时、内存并发、日志大小并支持取消/回收。使用Tauri capabilities最小权限，禁用任意shell调用；菜单/模型文本以纯文本显示。

## 跨平台现实边界

Windows首发：管理员与客人都支持，使用真实Windows工具链生成安装包。macOS可复用业务，但要独立构建、签名、公证。Android/iOS首版为客人客户端，支持经典浏览和调用同LAN已配对主机的生成服务；桌面外部二进制不能不改就塞进iOS执行。

后续手机端独立推理可采用经过验证的native llama.cpp bindings或平台原生推理，单列性能、内存、模型许可及应用体积预算。手机应用后台挂起后不保证持续接单；权威主机保持在桌面。不要在v1加入分布式主机选举或多主数据库。

Android局域网权限须按构建时targetSDK核实；当前官方文档明确Android17、target37及以上的本地网络访问限制要求，不能只声明INTERNET就假定发现、TCP和UDP都可用。Apple需本地网络用途说明及相应Bonjour服务声明，并验证用户拒绝权限时的降级。具体依据见官方链接，不将某一系统版本行为泛化到全部版本。

- [Android local network permission](https://developer.android.com/privacy-and-security/local-network-permission)
- [Apple local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
- [Tauri sidecars](https://v2.tauri.app/develop/sidecar/)
- [Tauri Windows installer](https://v2.tauri.app/distribute/windows-installer/)

## 依赖取舍

不同时引入Electron桌面、Flutter手机、React Native手机、Python服务和Rust核心四五套业务。Python参考实现仅保留为行为对照。无需云账户才能打开软件，无强制外网、遥测或商业API。外部搜索用于编辑维护期补充酒谱，不是每一次拖杆的运行依赖。

未来可替换模型与UI，但JSON契约、配方来源与订单一致性属于长期资产。任何新库必须说明其必要性、许可证、体积、维护情况及可替代方案。
''',
'docs/03_味觉算法与预测.md':r'''# 03｜味觉坐标、匹配与不可行目标

## 先纠正概念

甜、酸、苦、咸、鲜是基本味觉；完整风味还涉及嗅觉与其他口腔感觉。参考[NIDCD](https://www.nidcd.nih.gov/health/taste-disorders)。本产品五味100%是一种交互上的偏好分配，并不代表生理贡献比例。把原料固定向量按毫升相加不能精确推出人的感受；浓度、温度、稀释、酒精、香气与个体差异都需要进一步数据。

种子分数仅用于界面冷启动。它们没有来自IBA的感官实验，也没有经过用户试饮验证。保留绝对五味强度、归一偏好、独立七维感官、评分来源和不确定性。甜1酸1与甜8酸8可能拥有相同百分比，但强度不同；不能删掉绝对强度信息。五味都为零时应存“无可辨五味/缺失”，不能把它冒充实测20%各一份。

## 守恒操作算法

内部固定顺序[sweet,sour,bitter,salty,umami]，以整数基点保存，总数10,000。显示百分数为bps÷100。

手势开始拍摄anchor。选轴i希望变为x，锁定轴集合L，其余可分配轴U。预算B=10000−Σp[L]，x钳制到[0,B]；如果U为空，选轴只能等于B，禁止产生不存在的变化。

剩余R=B−x。若Σp[U]>0，则u_j=R×p_j/Σp[U]；若全部为零则等分。对u取整，再按小数余数从大到小分配不足的整数基点；余数相同按固定轴序处理。锁定值原样保留。

例：原[40,30,20,5,5]%，把甜改60%，其他维度按比例变为[20,13.34,3.33,3.33]%（最大余数与轴序决定最后0.01的归属），合计仍100%。正确结果以reference测试函数为准，UI不再独立算一套。

同一次拖动必须总是从手势开始的anchor计算，不能每次从已舍入结果再算，否则手指往返会造成漂移。键盘离散步进可以每次开新anchor。调其他滑杆的动画不再触发输入回调。浮点不得成为持久层主数据。

边界测试：100%单味后调低；全锁；选择锁定轴；只剩选轴未锁；目标<0或>预算；错误总和；非整数/NaN/无穷；10万次随机交互；触屏取消时恢复原快照。

## 七维与匹配

七维固定顺序[alcohol_heat,aroma,body,carbonation,cooling,spiciness,finish]，独立0–10，可存0.1分。ABV不是alcohol_heat，温度不是cooling，余味持续秒数也不是finish评分的同义词。

经典检索先按库存、原料排除、器具、调制规格和管理员菜单权限过滤，再比较相近度。不因更相近而越过硬性限制。

初始可解释距离：D_taste=Σ|p−q|/20000；D_sensory=Σ|s−t|/70；D=wD_taste+(1−w)D_sensory。匹配指数=100(1−D)，w初值0.6，仅为产品参数，需后续校准。它不是喜欢概率，也不叫“好喝率”。有缺失分数的轴不当成零；按可用维度归一并显示覆盖率，完全缺失则不打匹配分。

显示前3个候选与差异描述，例如“更苦、气泡更强、缺少干味美思”。库存接近而缺料的候选分组显示“需补材料”，不能显示“可立即制作”。距离很远时允许没有推荐结果；不把80分当通用好喝门槛。

经典滑杆预设必须关联recipe_revision_id，一次载入整组信息；手工改变之后保留“偏好已偏离本配方”的标志，不自动改变原经典比例。

## 成杯物理指标

对于已确认SKU和实际留存体积，乙醇体积约为Σ(消耗体积×ABV)，成杯ABV约为乙醇体积÷(留存液体总体积+融冰水)。这是体积相加近似，非实验室检测；融冰未知则展示区间或待配置，不能固定声称摇8秒必有25%稀释。

洗杯投入量不同于饮用留存量，尤其萨泽拉克；方糖、茶匙、吧勺、dash、整颗水果不能不经校准直接当毫升。盐边不是全部溶进酒体。原料营养标签足够时可按实际份量累加kcal；缺少完整标签、保留量或配料信息就显示“资料不足”，不报看似精确的134.7 kcal。可报告部分已知贡献，但必须标“下限/不完整”，不可作为总热量。

酒精操作上限由管理员设置，是业务上限，不是“安全饮用量”。酒精量、卡路里均由确定性代码算，绝不直接接受LLM文字生成结果。

## 优化而不是伪科学求解

候选先满足硬约束，再求低偏好距离、低库存缺口、低复杂度、适度新颖性等软目标。新颖性不足时标“经典变体”，不能把换名字称为全新发明。可行域应由测试过的家族和用量范围定义，不是任何五味百分比都能达到。

请求“鲜100%、酒精感0、香气10”时，如果家族库无法提供，说明不可实现或证据不足，显示最近候选并保留原目标。不得偷偷加大量盐/味精或宣称不含酒精。v1参考Agent只覆盖酸型、长饮、少量烈酒型；咸鲜型需要单独审核的后续模板。

建立测试反馈时优先收集用户自愿已有的实饮记录，标记温度、稀释、SKU、版本和评分口径；以留出数据看排名和偏好误差，不把用户重复点击当成好喝评价。不同人的评分尺度要校准，不能默认直接横向相加。不得为了训练提醒用户每天喝酒。
''',
'docs/04_局域网票据与订单.md':r'''# 04｜局域网协议、票据与订单一致性

## 拓扑与认证

一台主管理员主机是唯一权威，客人各自保存本地偏好与只读酒谱缓存。局域网并非可信区；mDNS只发现地址，不授予信任。提供手工IP与二维码备用，无法发现可能是访客网络隔离，不要靠关闭全部防火墙解决。

首次主机启动生成本地身份密钥与TLS证书；配对二维码包括host_id、协议版本、地址、证书/SPKI指纹和短期一次性高熵邀请。客人确认主机名称并校验证书绑定，主管理员批准设备。禁止通过mDNS返回值自动替换已信任的公钥。证书轮换走旧身份签名或重新配对流程。

Tauri原生网络适配负责证书绑定；不要让Webview跳过所有证书校验。不能使用 `rejectUnauthorized:false`、全局不安全TLS或明文传密码。邀请码只用于配对、不用作永久鉴权。

账户分admin、guest。管理员初始化无默认密码；采用成熟密码哈希/系统密钥保存方案与短期会话、刷新撤销、设备注销。客人只看自己的票据/订单，不能提交另一个guest_id或查看全体订单。服务器从认证上下文取得guest_id，不信任请求里的身份字段。管理员查看聚合信息需要明确权限。主机权限更新同步到已配对设备。

## 票据策略

TicketPolicy保存IANA时区、每天/指定日期、开始结束时间、每客数量、有效窗口、是否结转（默认不结转）、是否人工补发、政策版本、生效时间。一天由主机定义，客人系统时钟不决定票据。

每个窗口生成确定性的window_id。跨午夜窗口与夏令时重复/缺失本地时间需测试：按主机时区产生明确起止UTC；重复时刻不得双发。定时任务、主机重启和客人重连都可以触发补算，但唯一约束 `(guest_id,policy_version,window_id)` 防止重复发放。同一政策版本不能偷偷改每日配额；变更为新版本并记录生效边界，避免当天双领。

默认每天1张是管理员可配置权限，不是用户应每天喝一杯的建议。没有签到、连续饮酒奖励、“即将过期赶快喝”提醒、可交易积分或购买票据。支持关闭发放、零酒精/无酒精菜单和暂停营业。上架时遵守平台对过量饮酒及未成年人相关内容的限制，实际地区要求另审。

## 提交事务

客户端准备request_id（UUID）和请求payload hash，先验证界面基本字段，发送当前酒谱版本/候选审核ID与用户选择。服务端做最终库存、过敏原、酒精上限、模板审核和schema校验，再取得规范化的完整RecipeSnapshot；不要直接信任客人上传的“已验证=true”。

使用 `BEGIN IMMEDIATE` 或等效正确事务执行：

1. 查 `(guest_id,request_id)`：已存在且请求hash一致，返回原订单；hash不同返回409。
2. 查当前主机时间、ticket policy、可用额度和客人权限，必要时核对库存保留。
3. 原子扣1张票；保存不可变订单快照；追加outbox事件。
4. 提交以后再ACK和推送。任何步骤失败全部回滚。

网络是至少一次重试与可幂等消费，不宣称网络本身exactly once。主机崩溃在提交前则不扣票；提交后ACK丢失则客户端用原request_id查询得到同一订单。两台设备同时用最后一张票，只能一笔成功。SQLite同一时刻只有一个写事务，正确处理busy/retry并设置上限。[SQLite transaction](https://sqlite.org/lang_transaction.html)

单次订单v1固定1杯、1票；不能默认客人增加数量仍只扣1票。多杯以后按票/杯明确计数，单事务全成或全败。

## 状态分离

票据授权状态：可用、已用、过期、撤销；如实现制作前预留，另有reserved，但不能把UI提交中当已预留。v1建议服务器成功接收订单即扣票，后续拒绝按明确策略返还。

订单状态：received→accepted→mixing→ready→completed；received/accepted可由管理员拒绝或取消，mixing之后客人不能自动撤单。是否退款由policy和后台操作确定，补偿记录使用唯一键避免重复返还。参考原型仅实现发票和扣票，不实现完整退款，不得误报功能已交付。

UI邮票状态：unread/read/open，与制作状态独立。拖开并不接单。管理员必须点击“接单”才进入accepted。

## 快照至少保存

客人显示名和服务端身份ID、来源和酒谱revision、全部原料SKU与量纲、替换项与装饰、可操作的调制步骤、杯/冰/稀释假设、过敏原声明及审核结果、目标五味/七维、预计五味/七维及置信度、原料总量与估算字段、生成模型/规则版本、发送时间和接收时间、操作审计ID。

客人提交后再拖动滑杆，主机收到的旧单不变。生成候选未获管理员审核不能直接下单。注释长度和字符过滤，名称按纯文本显示，避免恶意HTML/终端转义。

## 同步与协议草案

所有端点 `/v1/`，消息 `protocol_version` 必须可协商。不兼容版本拒绝并解释，不能半读字段。

|端点|权限|语义|
|---|---|---|
|GET /v1/health|未配对可读取最小信息|只返回服务状态与版本，不暴露账户|
|POST /v1/pair|一次性邀请|请求配对，管理员确认设备|
|POST /v1/session|已注册账户|建立会话，限速与撤销支持|
|GET /v1/me/tickets|guest/admin|返回服务端票据状态与窗口|
|GET /v1/catalog|已认证|发布审核菜单revision摘要|
|POST /v1/orders|guest|提交1杯，Idempotency-Key必需|
|GET /v1/orders/by-request/{id}|本人|查询未知提交结果|
|GET /v1/me/orders|本人|自己的订单分页|
|GET /v1/admin/orders|admin|所有订单分页与状态过滤|
|POST /v1/admin/orders/{id}/transition|admin|有版本号的状态转换，冲突返回409|
|PUT /v1/admin/ticket-policy|admin|创建新政策版本|
|GET /v1/events?after_seq=N|按角色|恢复增量事件，必要时返回快照重同步|
|WS /v1/events/live|按角色|认证后推送事件，连接断开不代表订单取消|
|POST /v1/generation|授权客人|仅主机启用时代理限额AI任务，不暴露推理进程|

每条事件有host_id、递增seq、event_id、类型、实体版本和有权限的payload。outbox投递失败可重试；客户端按event_id去重，发现缺口做恢复。重连先重建权威票据和订单快照，再呈现Logo，不能沿用旧的“可点”状态。

离线订单只存草稿；重新连线须明确提交确认并检查票据窗口。主机不在线不能靠本地票据保证成功。mDNS被路由器禁用时用二维码/IP，网络隔离时提示路由配置而非装作数据已送达。

## 威胁与测试

重放邀请、伪造mDNS、跨账户读订单、密码撞库、同请求ID不同内容、重连双扣、政策重置双发、恶意长字符串、压缩炸弹/大体积JSON、WebSocket洪泛、LLM提示注入、主机证书变化、扫描公网地址等都有相应拒绝路径。

日志记录业务ID，不记录token/密码/完整二维码或不必要的过敏信息。用户可导出/删除自己的资料，但不可在未处理的订单审计中无痕改写；隐私留存策略与地区要求在公开发布前审查。
''',
'docs/05_本地模型与调酒Agent.md':r'''# 05｜本地模型、自检与受约束调酒Agent

## 模型角色

规则和确定性程序负责原料可用性、剂量、方法、数值和权限。模型负责有限空间内的组合选择、解释和原创中英文命名。模型不是调酒安全边界，JSON合法也不等于食材与剂量合法。

本地推理候选为llama.cpp，可用CPU，按实际构建支持CUDA、HIP/Vulkan、Metal等后端。AMD不等于所有显卡都支持同一后端；软件安装以后必须实际小样本推理验证。官方项目：[llama.cpp](https://github.com/ggml-org/llama.cpp)。移动端使用独立适配，不能直接照搬桌面sidecar。

候选模型以Qwen3.5-4B为首个试验档，2B作为轻量档、9B作为较高资源档，使用核对过来源和许可的量化版本。官方模型卡分别为 [2B](https://huggingface.co/Qwen/Qwen3.5-2B)、[4B](https://huggingface.co/Qwen/Qwen3.5-4B)、[9B](https://huggingface.co/Qwen/Qwen3.5-9B)。这些是候选，不是在用户电脑上测出的最优解；本包没有模型权重或真实推理速度报告。

使用Q4_K_M等量化需核实具体模型架构在锁定llama.cpp构建中的支持、tokenizer/chat template、合法GGUF转换、checksum与输出正确性。不提供未经核验的自动下载地址或伪造SHA-256。不能因为参数量小就推断所有8GB机器一定可运行。

## 硬件选择流程

采集OS/架构、物理和可用RAM、GPU与可用VRAM、统一内存、驱动和后端能力、磁盘剩余、当前负载。统一内存不把GPU内存与RAM重复相加。检测是目标设备本地操作，不把服务器硬件当用户硬件。

先排除不支持构建；预估权重+KV cache+runtime+系统保留；再在用户批准下载后测试短中文命名、严格JSON、4K上下文及并发取消。记录首token、每秒token、峰值RAM/VRAM、有效JSON率、超时和热降频情况。选最小满足质量与响应目标的候选，而不是盲目最大模型。主机后台生成默认只并发1个任务，UI优先。

OOME/不支持后端时降低上下文/批大小/显存卸载，再换较小模型或CPU；最后退回规则模式。每次降级都真实展示。AI关闭时不常驻占用大块显存。

下载前提示来源、许可、实际文件体积、额外磁盘空间、目的目录与取消选项。使用经过审查的manifest，包含发布页、commit/tag、文件hash和兼容后端。断点续传后完整校验；失败不运行。没有网络也能继续经典和规则模式。

## Agent流水线

A. FreezeRequest：冻结TargetProfile、SKU库存、排除项、过敏原、杯具、制作方式、酒精/体积操作上限与模式。

B. RetrieveAnchors：先筛选可用经典家族。引用真实source/revision，不用“LLM记得的经典”替换数据库；不得把用户的个人变体当IBA标准。

C. PlanFamily：酸型、长饮、烈酒型、气泡开胃型、热带型、奶油型、咸鲜型。生产版逐家族增加，未经审核的家族禁用。参考实现只覆盖前三类的有限子集。

D. Solve：枚举/优化角色与允许的剂量网格；用库存/容量/可食用性/管理员阈值硬筛。甜酸调整是模板启发式，不声称固定质量比适用所有柠檬与糖浆。新原料或浓缩材料没有批准的剂量范围就不能加入。

E. Predict：产生低置信口味先验和确定性物理计算；保留目标误差和不可行原因，不会把零酒精感自动解释成无酒精。

F. ConstrainedModel：只发排名前几个合法候选与受限原料/风格资料，结构化返回candidate_id和命名/简短解释；不让模型改任意毫升数。生产版如允许建议替换，也必须回到D重新求解。

G. Validate：schema、白名单、品牌/原料ID、候选ID、量纲、容量、总乙醇量、步骤顺序、过敏原、文字长度与注入字符全部重验。数值从程序重算，忽略模型给出的热量或“99%匹配”。允许最多两次修复，之后返回确定性候选并明确模型失败。

H. Render：使用允许杯型和参数生成ASCII；记录模型、规则、候选集、输入、seed、时间和版本。命名是纯文本；所有酒语原创或来源确证。

I. Review：输出标“试调待审核”，可收藏/编辑/试调记录。管理员完成配料SKU、实际量纲、方法和过敏审核后才发布到可点菜单。

## 模板规则

酸型一般包含基酒、酸源和甜源；橙酒、蜂蜜、果汁自身贡献不能忽略。初始候选可用45–60 ml基酒、15–25 ml酸源、10–20 ml已定义糖浆作为有限探索范围，但这是产品启发式起点，不是普适生理或调酒定律，不强制覆盖原始经典配方。

烈酒型通常以搅拌获取冰镇稀释，但来源方法优先；Angel Face的参考方法是摇和。长饮与气泡型最后加碳酸材料，禁止密闭摇壶中摇带气液体。漂浮层单列最后步骤；洗杯用量要分投入和留存。

奶油/酸并非永远不能同时出现，例如经验证的澄清工艺另有模板；v1未实施澄清则拒绝自动混合陌生奶酸结构。鸡蛋、奶、坚果、芹菜及带鱼类的调味汁要有明确过敏/处理提示；未知标签不当成“无过敏原”。只使用可食用、经批准原料，禁用工业酒精、精油任意加量、燃烧、液氮及未审查自制萃取。这里是生成范围限制，不代替专业食品安全规范。

苦精常为dash，不等于普通基酒；v1生成不得把浓缩苦精任意扩展成数十毫升，特殊来源配方需单独管理员批准。盐和其他强调味料同样用经审核的小剂量和精确工具规格。不能为了达到100%咸鲜而不设上限。

## 参考实现的真实能力

`python -m agent.reference_agent data/example_agent_request.json` 可离线生成候选并排序。提供 `--endpoint http://127.0.0.1:PORT/v1 --model 已加载的模型ID` 可尝试调用兼容服务进行选择与命名。端点仅允许字面loopback IP，拒绝重定向、外部代理和过大响应。

本包测试不启动真实模型，因此只能证明确定性候选和验证逻辑；联网协议、token、具体llama.cpp schema支持与模型质量必须由Codex实测。官方[server文档](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)说明结构化输出支持，但只支持其实现范围，生产代码需锁版本并进行恶意/残缺JSON测试。

参考Agent的启发式预测、三个家族和示例库存并非完整产品引擎。Codex必须补全规则配置加载、预算求解、家族审核、SKU溯源、去重和目标不可行判定，不得把样例输出当成可直接售卖的配方。
''',
'docs/06_数据与内容规范.md':r'''# 06｜来源化酒谱、原料与版本

## 此包数据范围

60份IBA网页参考版本+10份用户原始笔记版本，共70条。它们是70个配方版本，不意味着70种互不重复的鸡尾酒；例如玛格丽特、戴吉利与咖啡马天尼均有并行变体。101条ingredient type是种类目录，不是101瓶用户已拥有的酒。

`recipes.json`保存来源事实和独立中文改写步骤；`profiles.seed.json`保存编辑性家族先验；`ingredients.json`的营养/酒精度默认未知。`sources.json`逐条关联网页或用户笔记。中文版名称未必是唯一通用译名，保留英文与aliases扩展。

## 已识别的版本差异

|条目|本包参考事实|不能擅自做的事|
|---|---|---|
|Whiskey Sour|IBA45 ml波本、25 ml柠檬、20 ml糖浆|写成用户60/30/15却仍标IBA|
|Long Island Iced Tea|参考糖浆30 ml、兑和、可乐未量化|把聊天15 ml版本替换成唯一标准|
|Bee’s Knees|当前参考页含橙汁、蜂蜜糖浆以茶匙记录|因常见其他版本不含橙汁就删除|
|Angel Face|来源采用摇和|被“全部酒精就搅拌”程序覆盖|
|Bramble|黑莓利口酒|把黑加仑视作同种原料|
|Sazerac|苦艾酒投入洗杯，不全部饮用|把10 ml全计入成杯量和乙醇|
|Espresso Martini|一份浓缩咖啡未指定ml|默认等于30 ml且伪称原文|
|Mojito|薄荷按枝记录|自动变成同数量叶片|
|Mai-Tai|马提尼克糖蜜朗姆酒|自动改成农业朗姆酒|
|Singapore Sling|本页使用Cherry Sangue Morlacco|改写成Heering而不新建变体|

来源网页会变化。本包记录查阅日期而非永久标准声明；上线前重新核对差异并留存合法范围内的事实摘要/校验记录，不把互联网任一酒谱称作唯一真理。

## 三层数据

1. SourceRecipe：照来源保留数字、原单位、可选性、原料类别/指定品牌和方法，不补缺。
2. ServingSpec：管理员用实际SKU、杯型、吧勺/dash校准、糖浆质量比、espresso量、融冰与装饰建立能操作的版本。经典展示不必等所有SKU补齐；客人可点菜单必须基于审核ServingSpec。
3. SensoryPrior/TastingRecord：分开编辑先验、模型预测和真实试饮，记录来源/时间/版本，不虚构评分数。任何新配方只继承父配方的线索，不自动继承五星。

生产导入严格schema+业务校验。未知数量存null，另有unit及文字解释；区间单独保存，不将"2–3"硬塞数值。oz要记录US/imperial或当地量杯约定；30 ml的吧台约定与29.5735… ml的US fl oz不是同一个声明。dash、茶匙、吧勺必须校准后才能参与精确计算。

## 原料替代与库存

基酒类型、品牌SKU、批次库存分层。Cointreau属于橙味利口酒，但与其他糖度/ABV的Triple Sec不能对所有感官和乙醇计算视为一致；黑莓与黑加仑、椰奶与甜椰浆、姜汁汽水与姜汁啤酒均需要重新估计。苹果西打在不同产品语境可能含酒精，也可能不含，查标签。

用户现有酒瓶可由人工确认导入：猴肩作为待确认的Monkey Shoulder，所谓“三角”不得猜成Grant’s或Glenfiddich；后排模糊标签不要识别成确定SKU。照片识别结果一律draft，用户确认品牌、款式、ABV后才能被用于数值计算。

设置提供“我有的酒/果汁/糖浆/器具”与“缺料也显示”开关。禁用原料和过敏原属于硬约束；替代建议只出现在用户允许的范围，不自动加进购物车或请求采购。

## 后续扩库

优先顺序为IBA参考、原创调酒师/酒吧公开原配方、品牌官方配方、已授权专业资料、用户私有配方。可以保存多个可靠版本并比较；不要抓上千条没有来源或重复换名的数据冒充大库。扩至150–300条是后续编辑目标，不是本包已完成数量。

网站抓取遵守访问限制及条款，加入速率与缓存；遇到限制停止，不绕过登录/付费墙。仅提取需要的配料事实，以自己的中文写步骤，不抓取品牌照片、历史长文或未经授权的数据库整包。编辑者审核冲突、数量和可操作性之后再发布增量数据包。

联网资料视为不可信输入：去除脚本、指令与外部工具请求，不能让网页内容改变Agent系统规则。新资料不会未经审核自动推送到客人的可点菜单。

## 数据与资源许可

逐项记录SourceURL、Publisher、CheckedOn、LicenseStatus、AttributionRequirements、CommercialReviewStatus。引用不是商业许可；不能声称IBA已授权该软件。用户笔记默认不随公共安装包分发，发布版构建排除个人源，除非用户明确授权。

不捆绑字体或模型权重；Codex从合法来源取得需要的资产后另建第三方许可清单。参考图若仅用于风格借鉴，不自动取得其Logo、图标与原设计素材的复制权。所有示例酒语标为系统原创。
''',
'docs/07_实施验收与安装交付.md':r'''# 07｜实施验收、性能预算与安装交付

## 验收原则

优先打通“真实数据→滑杆→有效酒谱→可恢复订单→可安装程序”，再增加装饰动效。好看与可靠都要验收，但不得用动效视频替代程序。以下性能数字是目标，不是本包已实测成果。

|模块|最低可接受结果|验证方式|
|---|---|---|
|离线数据|70版本可浏览，中文/英文/来源正确|schema、导入一致性与离线启动|
|五味|始终10000基点、锁定不变、可撤销|随机属性测试与真实指针/滚轮/键盘|
|七维|0–10独立，不反向、不串联|边界值与触屏测试|
|预设|点击灰标完整加载同一revision|12维与配方快照比较|
|配方菜单|左向展开不出屏，可固定可用Esc|1280×800、缩放125/150/200%、长文|
|ASCII|八杯型稳定，不崩中文布局|确定性快照与热点键盘测试|
|票据|可配置时间数量，重启重连不双发|假时钟/跨午夜/DST用例|
|订单|一票只下1杯，ACK丢失不双扣|并发、断网、重启与幂等冲突|
|订单快照|客人改滑杆不改已下单|提交后修改本地state对照|
|邮票|拖开只阅读，键盘等效|UI状态与业务状态隔离断言|
|AI|未经审核不出现在可点菜单|非法原料/剂量/JSON/取消/OOM|
|真实评分|无评分显示暂无，不虚构星级|空库/导入/新版本继承测试|
|备份|升级失败可恢复，数据不丢|迁移前快照与故障注入|
|安装|新机安装可启动，卸载不误删用户资料|干净Windows虚拟机/实机|

## 性能目标与测试方法

指定并公开基准机器，不写“所有电脑最佳”。交互目标60fps，帧预算约16.7ms；滑杆不做同步模型推理，减少动态效果时无不必要循环。经典排序对10,000条索引数据争取P95<50ms；真实种子数70，与合成压力数据分开。20个并发客人提交需在同机事务队列下无重复消费，延迟目标根据网络与机器测定。

启动时间分别统计冷启动、热启动、无模型、模型已加载。模型记录首token与tokens/s、峰值内存、成功结构化输出率；不可把某一次最快速度写成所有设备宣传指标。热降频、电池/低性能模式、AMD/NVIDIA/CPU回退都要测试。

参考算法通过不代表UI、网络或模型通过。每项报告写命令、版本、OS/hardware、样本数、耗时、退出码与失败日志。测试标pass/fail/not_run，不允许把not_run折算pass。

## 自动化结构

Rust领域单元测试与属性测试；SQLite迁移/事务/故障测试；TypeScript状态机测试；Playwright桌面UI；网络契约测试；目标平台真机冒烟。参考Python结果做黄金样本对照，不把复杂业务仅靠截图比较。

安装器配置和发布脚本纳入CI；缓存不泄露签名密钥。第三方依赖锁版本并生成SBOM、许可证清单；更新使用签名与hash，不能从任意URL下载并执行更新脚本。

## 安装交付

Windows：产出真实NSIS .exe或MSI、便携说明（如实现）、SHA-256、WebView2依赖策略。安装路径/数据路径分离；安装器装饰可以用参考图批准后的像素素材，不篡改系统授权对话框。无签名时明确是未签名测试包，不保证SmartScreen不警告。要发布签名版本须合法签名证书与安全存储。

macOS：在macOS构建.app/.dmg，按发布渠道完成签名与公证；缺账户或机器标阻塞，不能伪造.dmg内容。Android：测试APK与面向商店的签名AAB分开，权限和targetSDK真机验证。iOS：Mac/Xcode、签名团队/证书/provisioning与设备或TestFlight流程明确；“预留架构”不等于已上架。

模型不默认捆进安装包，用户明确选择再下载；离线部署可提供另行审核的模型包与许可证，应用无模型仍工作。字体来源由发布构建合法取得，不从本交接包提取系统字体。

## 发布阻断项

未通过管理员配方ServingSpec审核、没有来源的公共酒谱、未标记感官估计、重复扣票、可越权读取他人订单、凭证明文日志、无效恢复/升级、未验证模型自动执行工具、无法取消长任务、移动无权限说明、字体缺字、引用Logo无权、所有按钮只是模拟均阻断相应发布范围。

公开发布前审查地区年龄要求及平台内容规则，不做健康改善或“安全饮酒额度”保证。Apple规则1.4.3禁止鼓励过量饮酒或鼓励未成年人饮酒：[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)。票据是服务权限，不是引导用户每日消费。

## 最终目录与声明

至少交付source、installer、checksums、BUILD_REPORT、KNOWN_ISSUES、USER_GUIDE、BACKUP_RESTORE、THIRD_PARTY_NOTICES、SBOM及依赖锁。每个平台单独说明是否构建、是否安装测试、是否签名、是否发布。不能将文档ZIP当产品安装包。
''',
'assets/references/README.md':r'''# 设计参考资产待提供

此目录故意不放占位“参考截图”。真实图1（视觉风格）、图2（七区设计稿与安装风格）、图3（高亮/旋转Logo）尚未出现。

到位后记录原文件名、图号、用途及允许使用范围，再创建reference_map.json。不要用旧酒瓶照片冒充设计图，不要声称当前暂定tokens已获用户视觉批准。
''',
'docs/研究来源.md':r'''# 研究来源与工程判断

检索快照日期：2026-09-21。以下为本次方案使用的公共主来源；工程方案和启发式数字是项目设计，不是来源已经认证的结论。

|主题|来源|用途|
|---|---|---|
|Codex项目指令|https://developers.openai.com/codex/guides/agents-md|AGENTS.md工作区说明机制|
|跨平台壳|https://v2.tauri.app/start/|Rust/Web前端与桌面移动平台|
|外部进程|https://v2.tauri.app/develop/sidecar/|按目标平台分发二进制及权限|
|Windows打包|https://v2.tauri.app/distribute/windows-installer/|安装器与平台依赖|
|推理后端|https://github.com/ggml-org/llama.cpp|CPU/GPU后端与本地推理能力|
|结构化输出|https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md|JSON/grammar接口与版本约束|
|模型候选|https://huggingface.co/Qwen/Qwen3.5-4B|官方模型卡与许可；非实机选型结论|
|轻量候选|https://huggingface.co/Qwen/Qwen3.5-2B|官方模型卡|
|较大候选|https://huggingface.co/Qwen/Qwen3.5-9B|官方模型卡|
|基础味觉|https://www.nidcd.nih.gov/health/taste-disorders|五味与风味感知边界|
|SQLite事务|https://sqlite.org/lang_transaction.html|单写者和事务行为|
|Android LAN权限|https://developer.android.com/privacy-and-security/local-network-permission|按系统/targetSDK适配网络访问|
|Apple LAN隐私|https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy|本地网络权限实施入口；需原生工具链继续核对|
|Apple发布规则|https://developer.apple.com/app-store/review/guidelines/|1.4.3饮酒内容边界|
|IBA参考库|https://iba-world.com/cocktails/|60个单独配方页面，逐条URL见data/sources.json|
|原创调酒师补充线索|https://jeffreymorgenthaler.com/bourbon-renewal/|后续扩库与原作者版本核对，不计入本包60条IBA|
|品牌官方版本线索|https://www.cointreau.com/int/en/cocktails/the-original-margarita|后续多版本核对，不计入本包70条|

不重复打包网页正文。资料可能更新；版本差异需要新建revision而不是抹掉旧来源。三张私有UI设计参考图未被任何公共网页替代。
'''
}
for name,text in DOCS.items():
    p=ROOT/name; p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text.strip()+'\n',encoding='utf-8')
# UI tokens are an executable design contract, not a mock image.
(ROOT/'data/ui_tokens.json').write_text(json.dumps({
 'status':'provisional_until_reference_images',
 'colors':{'background':'#0B0C0F','panel':'#13151B','text':'#E8E3D7','muted':'#94979F','accent':'#D9534F','border':'#363A43'},
 'spacing_px':[4,8,12,16,24,32], 'border_px':2,
 'motion':{'hover_open_ms':140,'hover_close_ms':180,'drawer_ms':200,'coin_ms':720,'text_scramble_max_ms':220,'ease_out':[0.16,1,0.3,1]},
 'font_assets_bundled':False,'maximum_simultaneous_hotspots':3,'minimum_touch_target_px':44,
 'reduced_motion_semantics':'same_final_state_no_animation'
},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Wrote',len(DOCS),'documents and tokens.')
