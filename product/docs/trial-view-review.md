# 试调结果到工作台的独立集成审查

日期：2026-09-21。范围：`apps/client/src/trial-view.ts` 的传输数据验证与界面模型映射，以及新增 `trial-view.test.ts`。本任务未修改App状态逻辑、既有domain.test.ts、Rust领域实现或安装包；未加载或调用真实模型。

## 发现与修复

原映射直接类型断言读取传输结果，`NaN` 可绕过剂量比较，缺失steps/predicted产生低层异常；目录内任意原料都可能成为“试调原料”，未知家族默认映射到古典杯和搅拌。原料阶段、optional和审核标记检查不足；步骤与audit直接引用调用方对象，后续变更可能改变已载入历史。

现在读取实际Rust候选合同：限定三个已实现家族、受控15种原料、当前审核剂量包络和有限毫升整数；气泡原料只允许top。所有候选结构、五味基点、七维、来源锚点、步骤、候选集合与版本元数据均检查；所选候选除名字外必须与规则候选中的对应项一致。模型选择分支不能更改材料、剂量、步骤、预测或权限。

界面输出始终为generated_trial / experimental / requires_bartender_review；`default_orderable:false`且需要ServingSpec。预测强度保持null，先验为heuristic_unvalidated且未实测；成杯ABV和热量必须保持null。乙醇输入量不转换成成杯酒精度。测试库存显示明确说明。没有指定装饰时garnish为空，避免非空占位文字让ASCII杯图渲染出虚构装饰。

输出配方、预测与audit独立复制，变更调用方对象不会追溯修改已载入酒谱。目标只保留在audit中；映射不返回当前目标状态，App是否覆盖用户目标由集成测试另行验证。

## 实际Rust合同数据

新增 `crates/recipe_engine/examples/export_ui_fixtures.rs`，只调用现有 `generate` 和 `apply_model_choice` 纯函数导出 `tests/fixtures/trial-result-golden.json`。包含sour、highball、spirit_forward、nearest_only、no_feasible_candidate及model_selected六种真实序列化结果。model_selected仅测试确定性的模型选择结果校验，名字明确为契约测试；**不代表运行过模型**。

复现命令（项目根目录，先导入 `product/scripts/enter-build-env.ps1`）：

```powershell
cargo run --manifest-path product/Cargo.toml -p pixelmix-recipe-engine --example export_ui_fixtures -- product/tests/fixtures/trial-result-golden.json
pnpm --dir product/apps/client exec tsc -b
pnpm --dir product/apps/client test src/trial-view.test.ts
```

## 验证结果

Rust导出命令退出0。最终TypeScript编译退出0。Vitest **52 passed / 0 failed**，测试运行18ms，总时长612ms，日志见 `evidence/trial-view-tests.txt`。

测试覆盖真实三种家族映射、模型选择只改名字、不可实现目标与预测分离、规则回退标记、未知强度／酒精度／热量、深复制历史、非有限／负／零／超量／字符串／小数剂量、未知或未授权原料、重复原料、错误阶段、假审核、假测量、错误向量、无效步骤、未知锚点、额外权限字段、未知候选和选择后改写有效剂量。无可行候选被拒绝载入。

首轮Vitest52项通过但TypeScript检查发现三处测试代码读取unknown类型audit.chosen；已加显式测试类型断言，再次编译和测试通过。该失败不是产品运行时失败，集成任务另留首轮构建日志。

六组真实fixture压缩JSON的UTF-8长度为352–9491字节；四份最大fixture的完整audit约38KiB，未接近单次设置256KiB限制。此测量不代表所有未来扩展结果或无限增长的个人评价均不受容量约束。

## 保留的边界

前端检查属于额外防御，不接替Rust对真实库存、SKU标签、过敏原、用户排除项、杯容量和乙醇操作上限的权威校验，也不授予菜单审核或扣票权限。当前严格合同只接受现有三个规则家族；扩充引擎家族或结果字段时须同步升级映射并重导真实fixture。本任务没有验证真实试饮质量、真实模型推理或新安装包。
