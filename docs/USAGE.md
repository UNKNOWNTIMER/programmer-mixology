# ▸ 使用说明 / User guide

[English README](../README.md) · [中文首页](../README.zh-CN.md) · [English section](#english)

~~~text
BROWSE -> ADJUST -> INSPECT -> QUEUE -> MAKE -> RECORD
~~~

## 中文

### 开始使用

打开程序员调酒台后，可以直接在本机浏览酒谱，不必先配置模型或局域网账户。新用户默认 English、125%字号和完整动态效果；在“Settings → General → Language”可选择中文，也可调整字号、启动动画或减少动态。已经保存的有效语言偏好会保留。“关于”包含版本与开发者信息。

浏览器开发页仅用于 UI 开发；需要 SQLite、存档文件、Windows 剪贴板、主机或模型时，请运行 Tauri 桌面应用。

### 找到一杯想做的酒

1. 点击 ASCII 酒杯右上角的酒谱库图标，或当前酒名，打开酒谱库；旁边的心形按钮切换收藏。
2. 拖动甜、酸、苦、咸、鲜控制杆，或悬停后滚动鼠标。五项始终合计100%。双击某轴锁定／解锁；键盘聚焦后可用 L。
3. 底部七个控制杆分别控制酒精感、香气、酒体、气泡、清凉感、辣感、味韵，互相独立。悬停约一秒查看简短判断标准。
4. 非 AI 模式下，调整控制杆实时刷新匹配；“匹配”按钮只在 AI 模式启用后可用。
5. 点击轨道下方半透明白色刻度加载附近酒谱，或点击杯图左下角随机。预设与随机会动画载入对应预测；普通选酒不会擅自替换目标。
6. 悬停配料区查看完整配料、步骤与成杯估算，点击固定。悬停杯图红点查看延展线末端的信息窗口；点击杯图可查看酒语。

显示的五味比例是偏好坐标，不是配方里糖浆、果汁等体积比例。匹配等级描述偏好距离，不是实际品尝评价。

### 自定义酒谱与小董 DLC

酒谱库可添加、复制、编辑、隐藏和删除酒谱；“已隐藏”和“已删除”中可恢复。编辑个人版本不会修改来源配方、旧订单或已导出文件。个人库有容量与条目上限，保存失败会保留编辑稿。

小董调酒笔记在“自定义”中作为独立 DLC 分组，默认启用。点组开关可整体隐藏或恢复。96杯工作配方包含小董原始内容，以及另外注明的缺失项建议和估算；授权原稿随项目公开，不将建议误记为作者的实作数据。

### 存档与制作队列

| 动作 | 结果 |
| :--- | :--- |
| 点击“＋ 队列” | 将当前酒与目标保存为独立制作快照 |
| 把 .timermix 拖进普通工作台 | 进入制作队列；允许同一文件多次导入 |
| 打开酒谱库后拖入 .timermix | 切换到自定义并添加个人配方副本 |
| 从酒谱库、杯图、TIMER 标签或队列拖出 | 导出对应酒谱的 .timermix 文件，带逐杯像素图标 |
| 主工作台 Ctrl+C | 把真实存档文件放入 Windows 文件剪贴板，可在资源管理器粘贴 |
| 主工作台 Ctrl+V | 从 Windows 文件剪贴板导入经过验证的存档 |
| 队列内上下拖动，或 Alt+↑／↓ | 调整制作顺序 |
| 点击队列项完成 | 条目向左消失后保存移除；完成队首时读取下一杯 |

酒谱库正在编辑时请先保存或取消，再导入。文本输入、选中文本或弹窗期间，工作台不会抢占普通复制粘贴。存档导入不恢复客人菜单批准、账户或票据权限。

文件名采用“中文名_english_name.timermix”的形式。旧 .pixelmix 和合法旧 JSON 存档仍可读取，新导出统一用 .timermix。不要通过改后缀把任意 JSON 变成有效酒谱。队列是本机待办，加入队列或完成条目不会提交局域网订单，也不会扣票。

### AI 模式与本地模型

在设置中开启 AI 模式，先配置和核对规则试调所用实际 SKU、ABV、可用量、食品级与过敏原资料，再点击匹配／生成。不可行时应看到约束原因，而不是虚构配方。

本地模型需要另外在“模型与网络”提供用户已准备的 llama-server、GGUF、SHA-256、构建版本和模型许可，并明确授权运行。基础酒谱浏览和规则试调不需要下载模型。模型只能在受约束候选中选择并命名；没有模型时可以回退规则。试调仍需实际制作、评价与审核。

### 局域网主机与订单

从 TIMER 标签或设置进入主机。先建立主管理员与客人账户，确认实际库存，创建并审核操作规格，再配置票据计划。没有默认密码，也不会自动把全部酒谱上架。

局域网监听需显式开启，客人连接需核对主机身份与证书指纹。界面连接成功不能替代两台物理设备的完整测试。提交订单时等待真实主机确认；超时应重试原请求，不创建新的请求 ID 来代替重试。管理员通过邮票／订单入口读取冻结快照并推进制作状态。

工作台队列与局域网订单是两套状态。队列动画完成不是订单提交成功；模型名字也不代表菜单已审核。

### 数据与估计

来源配方、预测、目标和实饮评价分别保存。热量、ABV、成杯量显示为估算时，应按实际瓶标、份数和操作理解；不是实验测量或完整营养分析。开启备份前先看备份范围：个人 SQLite 备份与主机账本备份不包含相同内容。

当前移动原生产物、真实模型基准、双物理设备 LAN 和物理跨窗拖放的具体接受范围，见本版本 [STATUS](../product/STATUS.md) 与 [BUILD_REPORT](../product/BUILD_REPORT.md)。

<a id="english"></a>
## English

### Start

Open Programmer Mixology to browse recipes locally without configuring a model or LAN account. New profiles default to English, 125% text, and full motion. Use Settings → General → Language to select 中文; General also offers text scale, startup animation, and reduced motion. Valid saved language preferences remain unchanged on upgrade. About shows the version and developer.

The browser development page is for UI work. Run the Tauri desktop application for SQLite, archives, Windows clipboard, host management, and model processes.

### Explore a drink

Open the library with the icon at the upper right of the ASCII glass or by clicking the drink name. The adjacent heart toggles favorites.

Drag or scroll over the five taste sliders. Their integer display always sums to 100%. Double-click an axis to lock/unlock it, or press L while focused. The seven bottom sliders are independent sensory axes. Hover for roughly one second to read a short interpretation.

Without AI mode, moving a slider updates classic matching live; the Match action is enabled only in AI mode. White marks below the taste tracks load nearby presets. Presets and random selection animate toward the recipe prediction; ordinary library selection preserves your target.

Hover over ingredients to open the external recipe window and click to pin it. Glass hotspots show information beside the ends of their extension lines. Clicking the glass opens a quote. Taste percentages are preference coordinates, not ingredient volume shares; the match grade is not a real tasting review.

### Personal recipes and Xiaodong DLC

Add, duplicate, edit, hide, delete, and restore recipes through the library. Editing a personal copy does not rewrite source recipes, historical orders, or exported files. The personal library has entry/size limits; a failed save retains the draft.

The Xiaodong notebook DLC is a separate group in Custom, enabled by default. Toggle the group to hide or restore its 96 working recipes. Original authored material is preserved separately from suggested completion and estimates. The authorized notebook is included with this public project; additions are not represented as the author's tested conclusions.

### Archives and the queue

Add the current drink with “+ Queue.” Drop a .timermix file on the ordinary workbench to queue it; duplicate imports are allowed. With the library open, dropping an archive adds a personal copy under Custom instead. Save or cancel an active editor before importing.

Drag out from the library, glass, TIMER tag, or queue to export the corresponding snapshot with its individual pixel icon. On the main workbench, Ctrl+C places a real archive file on the Windows file clipboard; paste it in Explorer. Ctrl+V imports validated files from the file clipboard. Normal text editing, selected text, and dialogs keep their ordinary shortcuts.

Reorder queue items by dragging or Alt+Up/Down. Completing an item animates it left, then persists removal; completing the head loads the next item. A failed save restores the item. Local queue operations neither submit host orders nor spend tickets.

Archive filenames use the form 中文名_english_name.timermix. Legacy .pixelmix and valid legacy JSON archives remain readable; new exports use .timermix. Renaming an arbitrary JSON file does not make it a valid archive. Import cannot restore account/ticket authority or menu approval.

### AI and local inference

Enable AI mode, configure actual SKU details, ABV, stock, food-grade status and allergen review in the trial settings, then request matching/generation. Infeasible requests should report constraints.

For optional local inference, provide your own llama-server executable and GGUF, reviewed hashes/build/license, and explicit approval in Model and network. Basic browsing and rule-based trials do not require a model. The model selects and names a bounded candidate; rules can provide a fallback. Trials still require preparation, evaluation, and review.

### LAN host and orders

Open Host from the TIMER tag or settings. Create an administrator and guests, confirm stock, create and approve serving specifications, and configure the ticket policy. There is no default password or automatic publication of every recipe to the guest menu.

Explicitly enable the listener and verify the host identity/certificate fingerprint on the guest. A successful connection is not evidence of full two-device acceptance. Wait for a real host acknowledgment after ordering. After a timeout, retry the original request rather than replacing its ID. Administrators read immutable snapshots through order/stamp controls and advance the preparation state.

A local queue and a LAN order are separate states. An animation is not an order acknowledgment, and a generated name is not menu approval.

### Data and estimates

Source facts, predictions, targets, and real reviews remain separate. Serving volume, ABV, and energy estimates depend on actual products, serving sizes, and preparation; they are not measurements or complete nutrition analyses. Personal SQLite backups and host-ledger backups cover different data.

Consult this version's [STATUS](../product/STATUS.md) and [BUILD_REPORT](../product/BUILD_REPORT.md) for the actual scope of native mobile, real-model, physical two-device LAN, and cross-window drag-and-drop acceptance.
