# ▸ 参与开发 / Contributing

[中文首页](README.md) · [English README](README.en.md) · [English section](#english)

~~~text
FORK -> FEATURE BRANCH -> LOCAL CHECKS -> PULL REQUEST -> REVIEW
~~~

## 中文

欢迎提交代码、文档、翻译、ASCII 美术、规则、带许可的原料数据和可复现的研究方案。仓库公开，允许 Fork、clone 与分支开发；向上游写入仍经过 Pull Request 审阅。

### 开始一个改动

先阅读 [README](README.md) 和 [架构](docs/ARCHITECTURE.md)。较大的数据契约、营养算法、账户权限或平台改动，建议先用 Issue 说明问题、预期行为与验证方法。小修复可以直接提交 PR。

~~~powershell
# 先在 GitHub 上 Fork 到自己的账号
git clone https://github.com/YOUR_ACCOUNT/programmer-mixology.git
cd programmer-mixology
git remote add upstream https://github.com/UNKNOWNTIMER/programmer-mixology.git
git switch -c feat/short-description
~~~

不要把个人数据库、模型权重、令牌、证书私钥、账户密码、真实订单、无授权原稿或整套工具链放进提交。用于测试的账户与样本应明确为合成数据。

### 在哪里修改

| 改动 | 入口与要求 |
| :--- | :--- |
| UI、语言与美术 | product/apps/client；中文与英文同时检查，覆盖125%字号与减少动态选项 |
| 五味、匹配、物理约束 | product/crates/domain；验证边界与整数守恒 |
| 生成与模型 | recipe_engine / inference；先说明权限边界，保留拒绝与回退路径 |
| 数据与酒谱 | data / schemas；注明来源、许可、原始单位、编辑改写与估算部分 |
| 账户、票据、订单 | lan_host；测试事务、并发、重试及不可变快照 |
| 营养扩展 | 先定义数据来源、缺失值、单位、版本和可核对的计算例子 |
| 移动平台 | 提供实际原生产物／真机证据，不能只提交浏览器截图作为完成证明 |

### 验证并提交

从已具备 README 所列工具的环境执行，选择与改动相关的检查。业务核心、数据格式、订单或生成约束的改动应运行对应完整测试，并补充能证明实际行为的回归用例。

~~~powershell
pnpm --dir product/apps/client install --frozen-lockfile
pnpm --dir product/apps/client test
pnpm --dir product/apps/client build
cargo test --workspace --locked --manifest-path product/Cargo.toml
python -m unittest discover -s tests -v
python scripts/validate_seed.py
git diff --check
~~~

文档修改应检查链接和图片；界面修改附真实运行截图；原生文件、SQLite 或网络变更需要原生验证，不以浏览器模拟替代。不要把旧版本或另一台机器的测试写成本次结果。若某项环境不可用，明确记录未验证项即可。

~~~powershell
git add path/to/changed-file
git commit -m "Describe the concrete change"
git push -u origin feat/short-description
~~~

然后从自己的分支向上游默认分支创建 PR。描述应包括：

- 具体问题以及修改后的行为。
- 实际执行的验证命令与结果。
- 数据格式／兼容性影响、未验证项。
- 新增数据与素材的作者、来源、许可。

### 必须保留的约束

五味保存值始终为10000整数基点；用户目标、配方预测、实饮评价分开。未经审核的生成酒谱不进入客人可点菜单。模型不能决定剂量、热量、权限或票据。订单请求重试不重复扣票，历史快照不被后续编辑覆盖。未知数据不能悄悄变成零，估算不能冒充实测。

营养和味觉研究贡献应给出输入数据、方法版本、误差与适用范围。不要把个体偏好写成普遍营养结论，也不要伪造来源、品尝记录或验证结果。

### 许可

提交者应有权贡献所提交的内容。项目原创贡献按根目录 MIT 许可接纳；第三方代码、字体、数据和素材须保留其许可与作者信息，并确认与分发方式兼容。来源链接本身不能替代授权。

<a id="english"></a>
## English

Contributions to code, documentation, translation, ASCII art, rules, licensed ingredient data, and reproducible research are welcome. The repository is public and supports forks, clones, and feature branches. Upstream changes are reviewed through pull requests.

### Start a change

Read the [README](README.en.md) and [architecture](docs/ARCHITECTURE.md#english). For substantial schema, nutrition, authority, or platform changes, an issue describing the problem, intended behavior, and validation method is helpful. Small fixes can go directly to a PR.

Fork the repository, then use the commands above with YOUR_ACCOUNT replaced by your GitHub login. Work on a focused feature branch.

Do not commit personal databases, model weights, tokens, private keys, passwords, real orders, unauthorized source documents, or entire toolchains. Test accounts and fixtures should be explicitly synthetic.

### Choose the right layer

UI, language, and art changes belong in product/apps/client and should cover both languages, 125% text, and reduced motion. Taste/ranking constraints belong in domain; candidate/model work belongs in recipe_engine and inference. Data changes need sources, licensing, original units, and a clear separation of facts and estimates. Host changes need transaction, concurrency, retry, and snapshot checks. Nutrition proposals need versioned inputs, missing-value semantics, units, and independently checkable calculations. Mobile completion needs actual native evidence, not only a responsive browser screenshot.

### Validate and submit

The commands above cover frontend tests/build, Rust workspace tests, reference algorithms, seed validation, and whitespace checks. Select checks appropriate to the change; changes to core constraints, formats, ordering, or generation require the relevant full tests and meaningful regressions.

Check documentation links and images. Include real screenshots for UI changes. Verify native file/SQLite/network behavior through the native application. Record actual commands and results, and identify unavailable or untested environments rather than reusing evidence from an older version.

Commit the intended files, push the feature branch to your fork, and open a PR against the upstream default branch. Describe the concrete problem and resulting behavior, actual validation, compatibility impact and remaining gaps, and authorship/source/licensing of added material.

### Preserve the contract

Five taste values always total 10000 integer basis points. Targets, predictions, and actual reviews remain separate. Unreviewed generated recipes do not enter the guest menu. Models cannot set doses, calories, permissions, or ticket outcomes. Request replay does not debit another ticket, and later edits cannot rewrite order snapshots. Missing data is not silently zero; estimates are not measurements.

Nutrition and sensory contributions should document input data, method versions, error, and applicability. Personal preference is not a universal nutrition conclusion. Do not fabricate sources, tasting records, or validation.

Contributors must have the right to submit their material. Original contributions are accepted under the root MIT license. Preserve third-party licenses and attribution and check compatibility with redistribution. A source URL alone is not a license.
