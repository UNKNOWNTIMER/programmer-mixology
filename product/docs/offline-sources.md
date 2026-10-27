# 离线经典库增量来源与迁移报告

核查日期：2026-09-21。本次新增 **42 份** IBA 官方页面参考版本；总库 **112 份配方版本 = 102 份 IBA 参考 + 原有 10 份私人笔记**。原有 70 份内容不改写，原配方 revision、收藏、个人目标和真实评价快照不迁移成新版本。原料类型从 101 增为 **149**，新增 48 类，均不是用户已拥有的 SKU。

## 来源核查范围

通过浏览工具读取 [IBA 总目录](https://iba-world.com/cocktails/all-cocktails/) 及第 [2](https://iba-world.com/cocktails/all-cocktails/page/2/)、[3](https://iba-world.com/cocktails/all-cocktails/page/3/)、[4](https://iba-world.com/cocktails/all-cocktails/page/4/)、[5](https://iba-world.com/cocktails/all-cocktails/page/5/)、[6](https://iba-world.com/cocktails/all-cocktails/page/6/) 页，六页共 102 个名称。逐一读取其中原库未有的 42 个配方详情页面。**本次没有重新逐条审核旧 60 份 IBA 配方事实**，它们保留原交接资料的来源与查阅日期。名称覆盖当前目录不等于这 102 份配方都已实际调制验证，也不代表 IBA 永久标准。

|新增ID（均以 `iba_` 开头）|官方详情页|
|---|---|
|brandy_crusta|[Brandy Crusta](https://iba-world.com/iba-cocktail/brandy-crusta/)|
|canchanchara|[Canchanchara](https://iba-world.com/iba-cocktail/canchanchara/)|
|casino|[Casino](https://iba-world.com/iba-cocktail/casino/)|
|champagne_cocktail|[Champagne Cocktail](https://iba-world.com/iba-cocktail/champagne-cocktail/)|
|chartreuse_swizzle|[Chartreuse Swizzle](https://iba-world.com/iba-cocktail/chartreuse-swizzle/)|
|dons_special_daiquiri|[Don’s Special Daiquiri](https://iba-world.com/iba-cocktail/dons-special-daiquiri/)|
|fernandito|[Fernandito](https://iba-world.com/iba-cocktail/fernandito/)|
|grand_margarita|[Grand Margarita](https://iba-world.com/iba-cocktail/grand-margarita/)|
|hemingway_special|[Hemingway Special](https://iba-world.com/iba-cocktail/hemingway-special/)|
|iba_tiki|[IBA Tiki](https://iba-world.com/iba-cocktail/iba-tiki/)|
|illegal|[Illegal](https://iba-world.com/iba-cocktail/illegal/)|
|mary_pickford|[Mary Pickford](https://iba-world.com/iba-cocktail/mary-pickford/)|
|mint_julep|[Mint Julep](https://iba-world.com/iba-cocktail/mint-julep/)|
|missionarys_downfall|[Missionary’s Downfall](https://iba-world.com/iba-cocktail/missionarys-downfall/)|
|monkey_gland|[Monkey Gland](https://iba-world.com/iba-cocktail/monkey-gland/)|
|paradise|[Paradise](https://iba-world.com/iba-cocktail/paradise/)|
|pisco_punch|[Pisco Punch](https://iba-world.com/iba-cocktail/pisco-punch/)|
|planters_punch|[Planters Punch](https://iba-world.com/iba-cocktail/planters-punch/)|
|porn_star_martini|[Porn Star Martini](https://iba-world.com/iba-cocktail/porn-star-martini/)|
|porto_flip|[Porto Flip](https://iba-world.com/iba-cocktail/porto-flip/)|
|rabo_de_galo|[Rabo de Galo](https://iba-world.com/iba-cocktail/rabo-de-galo/)|
|ramos_fizz|[Ramos Fizz](https://iba-world.com/iba-cocktail/ramos-fizz/)|
|remember_the_maine|[Remember the Maine](https://iba-world.com/iba-cocktail/remember-the-maine/)|
|russian_spring_punch|[Russian Spring Punch](https://iba-world.com/iba-cocktail/russian-spring-punch/)|
|sea_breeze|[Sea Breeze](https://iba-world.com/iba-cocktail/sea-breeze/)|
|sex_on_the_beach|[Sex on the Beach](https://iba-world.com/iba-cocktail/sex-on-the-beach/)|
|sherry_cobbler|[Sherry Cobbler](https://iba-world.com/iba-cocktail/sherry-cobbler/)|
|south_side|[South Side](https://iba-world.com/iba-cocktail/south-side/)|
|spicy_fifty|[Spicy Fifty](https://iba-world.com/iba-cocktail/spicy-fifty/)|
|stinger|[Stinger](https://iba-world.com/iba-cocktail/stinger/)|
|suffering_bastard|[Suffering Bastard](https://iba-world.com/iba-cocktail/suffering-bastard/)|
|tequila_sunrise|[Tequila Sunrise](https://iba-world.com/iba-cocktail/tequila-sunrise/)|
|three_dots_and_a_dash|[Three Dots and a Dash](https://iba-world.com/iba-cocktail/three-dots-and-a-dash/)|
|tipperary|[Tipperary](https://iba-world.com/iba-cocktail/tipperary/)|
|tommys_margarita|[Tommy’s Margarita](https://iba-world.com/iba-cocktail/tommys-margarita/)|
|trinidad_sour|[Trinidad Sour](https://iba-world.com/iba-cocktail/trinidad-sour/)|
|tuxedo|[Tuxedo](https://iba-world.com/iba-cocktail/tuxedo/)|
|ve_n_to|[Ve.N.To](https://iba-world.com/iba-cocktail/ve-n-to/)|
|vesper|[Vesper](https://iba-world.com/iba-cocktail/vesper/)|
|vieux_carre|[Vieux Carré](https://iba-world.com/iba-cocktail/vieux-carre/)|
|white_lady|[White Lady](https://iba-world.com/iba-cocktail/white-lady/)|
|zombie|[Zombie](https://iba-world.com/iba-cocktail/zombie/)|

`iba_iba_tiki` 的双 `iba` 来自统一ID规则：来源前缀 `iba_` 加官方配方slug `iba-tiki`。Yellow Bird 不在本次读取的现行六页目录中，没有将它按“当前IBA目录条目”补入。

## 没有擅自补全的事实

- **IBA Tiki**：网页菠萝汁写数字90、青柠汁写数字30，没有单位。两行均保存 `quantity:null` / `unit:"unknown"`，原数字逐条写入 `quantity_note`；不能假定毫升。五滴樱桃利口酒保留 `5 drop`。
- **Porn Star Martini**：50 ml 香槟另杯随附，使用 `stage:"side"`，步骤明确不放入摇壶、不能并为主杯体积。原版配料分组界面需要认识这个新阶段。
- **Remember the Maine**：7.5 ml 苦艾酒是润杯投入量，润杯后弃去，`retained_ml:null`。不是7.5 ml都进入饮用酒液。
- **Missionary’s Downfall / South Side**：3–4块菠萝、5–6片薄荷分别保留区间，`quantity:null`。不把范围擅自变成中值。
- **Monkey Gland**：本次页面明确写1汤匙苦艾酒、1汤匙红石榴糖浆；保存 `tbsp`，没有用记忆中的其他版本改成dash。汤匙、茶匙、吧勺与滴均需独立校准，不能直接当精确ml。
- **Three Dots and a Dash**：多香果7.5 ml与青柠汁15 ml在网页同一行连排，按两组清晰原料及数值拆行并记录排版问题；碎冰12盎司未写质量／体积制式，步骤保留原单位，不换算克数。
- **Canchanchara**：原料栏为古巴Aguardiente，步骤泛称rum，按原料栏建独立原料并记录差异。未改为泛称白朗姆。
- **Zombie**：原文只给德梅拉拉朗姆类型，没有酒精度；没有补写151 proof。Donn’s Mix的2:1比例保留，肉桂糖浆浓度仍未知。
- 所有新增原料酒精度、糖含量、热量、密度、酸度仍为 `null`；装饰用量、各类补满、品牌标签及过敏原需管理员审核。每份配方 `preparation_review` 都是 `not_physically_tested`。

## 文件与合同

- `product/data/catalog/iba-completion-2026-09-21.json`：冻结增量包，含42配方、48原料、42先验及42来源。
- `product/data/catalog/source-review-2026-09-21.json`：逐份来源URL、日期、独立事实摘要的SHA-256。**这里的hash校验的是规范化SourceRecipe JSON，不是远程网页全文。**未保存网站图片、视频或全文快照。
- `product/contracts/catalog-extension.schema.json`：生产项目自己的JSON Schema；保留原始schema，增加 `tbsp`、`drop`、`piece`、`unknown` 单位和 `side` 阶段。
- `product/scripts/build-catalog-extension.py`：不联网的确定性资料构建脚本，只读原交接data，生成增量包和四份浏览器合并seed。
- `product/scripts/audit-catalog-extension.py`：独立离线关系、来源、数值和保留原数据检查，不修改seed。
- `product/apps/client/public/seed/`：原70 + 新42的合并浏览器离线资料，与Rust内嵌数据逐项比较。

新感官先验是编辑性的家族向量，并对是否存在碳酸原料等结构线索作有限修正，全部 `heuristic_unvalidated`、`measured:false`、`confidence:low`。五味均为总和10000的整数基点，七维各自0–10。它们不是IBA评分、成杯实测、用户目标或用户评价，也没有由大模型决定剂量。所有配方默认不可点单，进入客人菜单仍需真实SKU与经审核的ServingSpec。

## 数据库行为与回退边界

表结构仍为SQLite schema v1，`seed_sha256`继续只代表原70配方文件；另用 `metadata.catalog_pack:iba-completion-2026-09-21` 保存扩充包SHA-256。首次开启旧库时严格校验原内容，再以一个事务插入所有新增配方、原料、先验、来源及包标记。提交前逐条校验。已存在的原始记录不做UPDATE。

重复启动只校验，不重复导入。错误数量、额外冲突记录、旧配方被改写、扩充包哈希被改写或来源被篡改均拒绝。新来源包未来有修正时应创建显式新revision迁移，**不得在交付后原地改这个已发布包**。有效旧70备份可恢复，恢复后自动重放扩充包，备份的个人数据保持原样。

旧版仅认识70份酒谱的二进制不能读取已扩充112份的数据库。实际用户数据升级前应保留旧版个人备份；回退旧二进制需要恢复旧70备份，单纯重新安装旧版本不等于数据回退。本次测试使用临时数据库，没有对已安装应用的真实个人库进行升级。

## 实际验证

执行位置：项目根目录，真实Windows目标机；先运行 `. .\product\scripts\enter-build-env.ps1`。

|命令/检查|实际结果|
|---|---|
|`python product/scripts/build-catalog-extension.py`|42新增 / 112总数 / 149原料，退出0|
|`cargo test --manifest-path product/Cargo.toml -p pixelmix-catalog`|10 passed，0 failed；最终运行测试用时0.31秒|
|原70库升112|旧revision、收藏、目标、真实评价JSON和不可变snapshot逐项不变，PASS|
|原70备份恢复|恢复个人数据并重新安装扩充包，PASS|
|注入中途SQLite插入失败|所有扩充行与marker回滚，再试成功，PASS|
|重复启动/重复导入|无重复记录，PASS|
|资料篡改/冲突记录|拒绝导入或打开，PASS|
|浏览器seed与native内嵌数据|四表逐项相同，PASS|
|`python product/scripts/audit-catalog-extension.py`|PASS；来源hash、原资料保留、整数五味、未知事实及关系完整性无错误|
|`git diff --exit-code -- data reference agent tests schemas`|退出0，原交接目录无改动|

首轮Rust编译曾报告 `catalog_documents` 数组类型推断错误E0282；添加明确 `[Value;4]` 后编译与全部测试通过，未隐藏此失败。测试日志是 `product/evidence/catalog-extension-tests.txt`，独立审计结果是 `product/evidence/catalog-extension-audit.json`。

增量包SHA-256：`79c184b643a3a7d007571f204540efd469c3df1b202261488a82e57cbd6a9870`。

本子任务没有重打安装包，不能把先前70份安装包称作已经包含112份；新UI的实际运行与整体回归由集成任务记录。没有真机调酒验证，没有商业数据许可确认。引用官方来源不等于获IBA授权，旧10份笔记仍为私人交付范围，公共发布需另行处理授权。没有下载模型。
