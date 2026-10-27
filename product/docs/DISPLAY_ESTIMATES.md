# 成杯资料的独立估算层

版本：2026-09-22.1。按用户本轮“缺少的信息通过 AI 评估填写”的要求增加展示估算；没有修改来源酒谱、原料标签、订单快照或菜单审核状态。

`estimate-ingredient-assumptions.ts` 是由 Codex 辅助整理的 255 个原料 ID 显式分类表。原数据的 ABV、热量、密度仍保留原值；类别范围是编辑假设，不是品牌标签、实测值或统计置信区间。不存在将名字像 gin 的未知原料自动识别成 gin 的规则。真实标签有效时优先采用标签；无效标签或不支持的输入使展示总量缺失，不能借旧类别回退伪造完整数值。

`assisted-estimates.ts` 使用确定性代码计算区间。它不调用本地或远端模型，不接受模型给出的最终成杯量、ABV 或 kcal。原严格估算器和测试保留。展示值包含 `≈` 和 `估` / `est.`；估算依据及版本位于数值的悬浮标题与审计文件，不增加底部说明块。

## 估算约定

- 来源明确的 ml/cl/l 等和质量单位优先；数量区间保留区间。未注明地区的 oz/tsp/tbsp/cup 按现有美制容量显示约定；来源原量不变。
- 未校准 dash、drop、barspoon、shot/jigger、splash 等使用独立范围；这些范围不转成配料清单里的正式调制剂量。
- 糖、香草、香料、盐、饼干按质量估算能量；果实采用独立的可食用留存/出汁量假设。密度假设与源质量、源体积区分。洗杯只算约 0.1–2 ml 留存，不把投入全量算进成杯。
- `part` 共享同一个杯量尺度，计算酒精度时保留固定比例关联。多个补足项共享一次补足预算，不能每个都添加一整杯。补足预算与原液的其他相关性未作概率建模，区间是保守展示范围。
- 明列的冰不再次按整块体积加入；融水单独按方法估量。三份已识别批量配方和热咖啡/热巧克力不自动加融冰水。加热蒸发未实测，热红酒按挥发前混合物计算并在估值标题注明。
- Sangria 以整壶约 6–8 份、Gluehwein 约 5–6 份估量；Tomato Tang 采用来源可选的两份中杯。应用这些约定须同时匹配酒谱 ID、来源 URL 和完整内容签名，改过内容的同 ID 存档不会继承。Radler 的约 710 ml 保持来源所述大份，不擅自除成两杯。
- 原谱装饰默认不食用，另杯随附从本杯估值排除。非装饰可选配料按加入估算。实际产品、杯型、糖量、留存、份数和操作会改变结果。

## 基础来源及边界

以下来源支持基础换算或类别背景，**不认证软件选择的估算上下界**。2026-09-22 核对：

- [CDC / NIOSH 1400，表 1](https://www.cdc.gov/niosh/docs/2003-154/pdfs/1400.pdf)：乙醇在 20°C 的密度为 0.789 g/ml。
- [欧盟委员会 JRC](https://knowledge4policy.ec.europa.eu/health-promotion-knowledge-gateway/alcoholic-beverages_en)：乙醇按 7 kcal/g 计算能量。
- [NIAAA 常见酒类示例](https://www.niaaa.nih.gov/alcohols-effects-health/what-standard-drink)：类别酒精含量会变化；示例不是具体 SKU 的认证。
- [NIST 容量换算](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8)：公制/美制单位换算因子。

总能量按非酒精能量加乙醇能量计算；若有有效的原料总热量标签，则直接使用该总量，不重复加乙醇。ABV 是各液体的乙醇量与混合体积的比值，再考虑融水。用户味觉目标、配方预测、实饮评价仍各自独立，模型权限、配方审核和主机票据没有改动。

## 可复现检查

进入 `scripts/enter-build-env.ps1` 环境后：

```powershell
pnpm --dir product/apps/client test
node product/scripts/audit-display-estimates.mjs
```

审计脚本在本机通过 Vite 的无监听 SSR 模式加载真实生产计算模块，检查所有 300 杯并生成 `evidence/assisted-estimates/catalog-estimates.json` 和摘要。它不写用户 SQLite，不启动推理模型。原生回归命令和最终产物见 `BUILD_REPORT.md` 本轮记录。
