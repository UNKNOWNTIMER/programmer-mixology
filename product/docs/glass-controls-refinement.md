# 字符杯、五味手势与估量修订（2026-09-21）

本轮仅修改 Glass、Controls、独立 CSS、估量函数及测试。主布局、独立配方窗口、原生窗口管理与打包由主任务负责。此前 900px / 固定红点 / 通用原创提示的记录属于旧版；本轮以 675×960 整合界面及下面实测为准。

## 当前行为与接口

`Glass({recipe,ingredients,profile?,target?})` 保持兼容。杯图仍是 100×65 的确定性 ASCII 字符网格，8 种轮廓，按真实方法/装饰文字绘制冰与装饰；不是 AI 位图或杯图 SVG。原始 `GLASSES` 和 `renderGlass` 保留用于参考黄金对照。

每次换酒重新随机分配三个 23px 红色热点（原 15px）。归一化坐标互距至少 28，随机尝试耗尽有安全分离后备位置。标题简化为“味觉 / 配料 / 资料”，杯型只显示名称。配料占比仍仅按来源明确的 ml 计算；未知、非 ml 或冲洗留存不擅自转换。

资料与酒语使用 React portal 直接挂到 body。fixed 定位按视口夹取，内容扩展及窗口缩放时重新测量；父杯图区 overflow 不会裁切。鼠标可以从红点移入弹层展开详情，点击和键盘同样可用，Escape 或关闭按钮收起。酒语读取 `recipe-quotes.json` 的 ID 映射；生成试调用含其酒名的确定性原创句。界面不再显示通用“系统原创”提示，也不伪托名人来源。

五味右侧锁按钮已移除。双击滑杆或味道标签锁定/解锁；锁住的滑杆仍接收解锁手势。键盘 L 切换，标签 Enter / 空格也可切换。为避免双击先跳值，点击轨道本身不提交新值；拖动移动超过 3px 才建立一次手势，固定手势锚点。滚轮与方向键仍以 50 基点、Shift 10 基点调整，HTML range step=1 保持精确表示。锁定拒绝滚轮、数字和方向键改值；touch 双击也已实测。

`TasteControls` 的 `presets` / `onSelectPreset` 接口不变。经典标记仍载入完整五味与七维。`SensoryControls` 保持独立七轴、滚轮 0.5 / Shift 0.1、键盘 0.1、每帧合并拖动与折线。

## 估量函数

```ts
estimateDrink(recipe, ingredients, options?)
// -> { abvPercent, caloriesKcal, baseVolumeMl, servedVolumeMl,
//      assumptions, reasons, sources }
formatEstimate(rangeOrNull, '%' | 'kcal' | 'ml')
```

范围对象为 `{min,max}`，无法估时为 null。格式统一为 `≈18.2–25.3% · 估` 或 `无法估`。`options.dilutionFraction` 和 `options.ingredientOverrides` 可以显式提供估量假设；这些不是剂量指令，不写入 Ingredient 原始营养字段，也不进入 host、权限或订单校验。

默认分类酒精度、非酒精热量和融水上下界都是编辑假设，不是测量、品牌标签或统计置信区间。明确标注的官方资料只支持换算基础与常见类别示例：

- [CDC / NIOSH Method 1400，第 4 页表 1](https://www.cdc.gov/niosh/docs/2003-154/pdfs/1400.pdf)：20°C 乙醇密度 0.789 g/ml。
- [欧盟委员会 JRC Alcoholic Beverages](https://knowledge4policy.ec.europa.eu/health-promotion-knowledge-gateway/alcoholic-beverages_en)：乙醇能量 7 kcal/g。
- [NIAAA What Is A Standard Drink](https://www.niaaa.nih.gov/alcohols-effects-health/what-standard-drink)：类别例示约烈酒 40%、利口酒 24%、加强葡萄酒 17%、葡萄酒 12%，并说明实际酒精度随产品变化。

已知总热量字段不再额外叠加一次乙醇能量。未知原料、非 ml、未知补足量、冲洗留存不完整时不会输出完整成杯估量。装饰按不食用假设排除；列出的非装饰可选项按加入估量。所有假设和失败原因在 title / 可展开“估量依据”中展示。实际 SKU、温度、融冰、甜度可能在编辑范围之外。

## 实际验证与边界

命令均在当前 Windows 本机执行：

```powershell
. ./product/scripts/enter-build-env.ps1
pnpm --dir product/apps/client test
pnpm --dir product/apps/client build
node product/apps/client/node_modules/vite/bin/vite.js --config product/tests/ui-components/vite.config.mjs --configLoader native
node product/tests/ui-components/check.cjs
node product/tests/ui-components/check-touch.cjs
node product/tests/ui-components/check-workbench.cjs
node product/tests/ui-components/check-mobile.cjs
node product/tests/e2e/browser-smoke.cjs
node --check product/tests/native-smoke.cjs
```

- 全包 Vitest：93/93 PASS（最后一轮含新增 archive-bridge 4 项）。包含估量 7 项、ASCII/配料/经典预设/随机间距/弹层夹取 10 项，及其它并行领域测试。
- 完整 `pnpm build` PASS。第一次构建因根任务新 `RecipeWindow.tsx` 尚未落盘而失败；文件就绪后重跑通过，没有掩盖失败。
- 隔离真实 React 浏览器检查：9 组 PASS、pageErrors=[]。涵盖八杯、portal 挂载、详情扩展夹取、独特酒语、双击不改值、锁定滚轮、L 解锁、真实拖动守恒、独立七轴与经典选择。
- 独立触摸检查：双击锁定、锁后双击解锁均 PASS，目标完全未变。
- 675×960 整合截图：document 恰好 675×960；Glass 431.47×431.81，taste 401.47×142.44，sensory 610.98×192.75，无页面异常。
- 390×844 整合触摸仿真：七区、七轴、经典选择框及 300px 宽 portal 都在视口内；无页面异常。首次检查误取了入场动画中的中间位置而失败，现等待实际 Web Animations 完成后再测边界，没有放宽阈值。
- 更新后的浏览器业务回归：15/15 PASS，含当前全部来源库、精确数值/实时匹配、取消/撤销、来源区分、收藏持久、真实评价隔离、库存硬过滤、离线草稿、无原生虚假生成、三种分辨率。
- `native-smoke.cjs` 已适配独立 `?view=recipe` 窗口、实时匹配和双击锁；语法检查 PASS。本轮此脚本由主任务后续统一执行，不在此声称原生实测通过。

PNG 与 JSON 证据在 `product/evidence/ui-components/` 及 `product/evidence/ui/browser-smoke.json`。截图为真实浏览器与隔离测试上下文，不替代原生窗口、Windows 安装、Android/iOS 真机或视觉验收。测试不写入生产 SQLite、订单或实际评价。

