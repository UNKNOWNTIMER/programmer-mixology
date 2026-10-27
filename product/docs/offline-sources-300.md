# 300 条离线酒谱：本轮来源与校验记录

本轮范围为在既有 112 条基础上增加 188 条真实来源记录，合计准确 300 条。原 70 条交接数据和之后 42 条 IBA 增量包的配方、来源、先验、修订依据保持不变。数量按来源分为 102 条 IBA、10 条既有私人笔记版本、188 条 TheCocktailDB 社区配方；**不能把全部 300 条称为 IBA 官方经典**。

最终离线校验 PASS：255 条原料定义（新增106）、300条唯一引语、29条候选拒绝、零组新增配方重复；新增188条中有112行单位未知、143行数值未知，均保留来源措辞。最终不可变包 SHA-256：`d352f2b02886c5c6cc542ff5107f648fb0fbe20029972e7ac439f9864a803958`。此后编辑改正须另开修订，不能修改该包字节。

增量包已有持久化哈希基于 Windows CRLF 字节；`product/.gitattributes` 将 `data/catalog/*.json` 固定为 CRLF，新生成脚本也明确输出同样字节。原交接 `data/*.json` 则保持已有 LF。两者不能统一换行后仍假称迁移哈希未变。

新增记录来自 TheCocktailDB 自身公开 API，2026-09-21 实际逐条查询。发现列表只用于挑选，配方事实以 `lookup.php?i=<idDrink>` 的单条响应为准。每条保存稳定详情 URL、API URL、读取时间、完整响应 SHA-256、来源修改日期（可空）、原料原名与计量原文。中文步骤为独立转述，未假造作者、发明年代、历史典故或品尝评价。

- API 说明：[TheCocktailDB API](https://www.thecocktaildb.com/api.php)。开发测试 key `1` 仅用于此次开发研究；运行中的离线应用不请求该 API。
- 使用条款：[Terms of use](https://www.thecocktaildb.com/terms_of_use.php)。本次实际读取条款允许通过正式 API 复制、调整返回内容并要求保留版权信息；文案中存在 TheMealDB 模板名称，公开分发/商业使用前仍需向服务方确认适用许可及生产 key 要求。本轮没有购买、发布或打包。
- 保留署名 `TheCocktailDB` 与 `© 2026 TheCocktailDB`。没有下载、显示、转存酒杯照片。API 中 `strCreativeCommonsConfirmed` 是源元数据，未把它当作整库自由版权许可。

## 数据与复现文件

`data/catalog/community-188-2026-09-21.json` 是第二个不可变增量包；`community-source-records-2026-09-21.json` 保留所选 API 文本记录以便离线重建，`community-source-review-2026-09-21.json` 是每条来源与规范化事实哈希账本。前者的响应哈希指原始 HTTP API 响应；后者 `facts_sha256` 指规范化单条配方 JSON，两者不是同一种哈希。记录中的远程文本都是资料，不是执行指令。

`community-editorial-a.json`、`community-editorial-b.json`、`community-editorial-c.tsv` 与 `community-editorial-replacements.json` 是逐条中文编辑记录。研究候选和拒绝记录有意保留用于解释筛选过程，只有最终增量包中的 188 条导入应用。`community-shortlist.json` 保持最初 212 个候选顺序；替补独立记录，未篡改研究名单。

在已经保存的来源记录上可离线运行 `python product/scripts/build-community-extension.py`。脚本保留原始 112 条，读取编辑分片，重新生成 188 条增量、300 条浏览器 seed 和 300 条引语。`fetch-community-recipes.ps1` 是明确调用才运行的网络研究脚本，不属于应用启动逻辑。已发布不可变包若需要修正，须创建新修订/迁移，不能将同名包改写后静默替换已安装事实。

## 计量、制法与未知值

cl、dl、L 仅按精确定义换成 ml，原始值仍在 `quantity_note`。oz 不假定美制/英制；shot、jigger、cup、part、bottle、glass 保留来源单位，不猜固定容量。区间值保留上下界，单值字段为 null；空计量、“适量”、果实挤汁未给出产汁体积等继续保持未知。`unknown` 单位的数值必须为 null。

素材明确把含气原料放在最后时标记 `top`，润杯标记 `rinse` 并保持实际留存量未知；例如 Pink Gin 不能把倒掉的苦精全部算进成杯。原文杯型字段和步骤使用杯型有轻微差异时，两者都在说明中保留，画面杯型属于编辑映射。含气原料密闭摇和、缺少关键原料、无界加酒、未确定鲜苦艾草安全用量等候选已剔除。批量桑格利亚/热红酒保留批量事实，不假称单杯剂量；热红酒加热不等于酒精完全消失。

原料总表的酒精度、糖、热量、密度、酸度全部仍为 null；各类来源品牌和风格没有擅自混同为指定 SKU。新增配方的绝对五味强度为 null。五味 10000 整数基点和七维数值是明确标注 `heuristic_unvalidated`、`measured=false` 的编辑家族先验，仅用于匹配冷启动，不是来源评分或实测。

每条新增记录均 `default_orderable=false`、`needs_serving_configuration=true`、`actual_user_rating=null`。库存/过敏原/实际剂量/每份容量须由主机 SKU 和经审核 ServingSpec 确定，导入参考库不使饮品自动成为客人菜单。模型允许的生成原料白名单没有随资料库扩张。

## 引语属性

`apps/client/src/recipe-quotes.json` 是准确 300 个 recipe_id → 中文短句的映射。每句为此次产品编辑撰写，结合酒名或原料的想象性短句；不是酒名起源、资料引文、名人语录、官方评价或真实饮后感。界面直接呈现文案，不增加“系统原创”字样；原创属性在本文件记录。生成试调不属于这 300 个来源 ID，其临时文案由界面逻辑另行处理。

## 实际运行与边界

- `cargo test --manifest-path product/Cargo.toml -p pixelmix-catalog`：13 项，涵盖 300 条导入/重开、70 与112条旧库升级、旧评价/修订/偏好完整保留、备份还原补齐增量、中途插入失败全部回滚、重试无重复、防伪来源/哈希以及浏览器与本机 seed 一致。
- `python product/scripts/audit-community-catalog.py`：离线逐行核对来源原料/计量、原112条完整性、188新增链接与事实哈希、未知量、五味基点、七维、300唯一引语和规范化配方重复；输出 `evidence/catalog-300-audit.json`。
- `python product/scripts/audit-catalog-extension.py`：继续审计原112条前缀，42条 IBA 包 SHA-256 仍为 `79c184b643a3a7d007571f204540efd469c3df1b202261488a82e57cbd6a9870`。
- `pnpm --dir product/apps/client test src/source-url.test.ts src/catalog-content.test.ts`：3项；精确 HTTPS 来源域允许列表、300条引语/来源分布、未知绝对强度与未实测先验。

第一次独立重复检测发现 Almond Joy 与 Foxy Lady 规范化后剂量和主要原料完全相同，已替换 Foxy Lady，未将其算作两个新增配方。又剔除原料表与步骤主要原料不一致的两条记录；最终替补包括 Chocolate Black Russian、Tomato Tang 和 Turkeyball，均完成正式API查询并按源转述。独立界面同伴审计还修正了热红酒柠檬皮的浸泡阶段、樱桃装饰阶段、Russchian补足阶段和 Long Vodka 的直调方法，避免把杯壁润苦精误当作整杯摇和。

初次审计脚本在系统 Python 3.8 上因 `removeprefix` 不可用退出，改成兼容索引后重跑；这是验证脚本兼容性问题，未改数据语义。最终精确统计和增量包校验值以 `catalog-300-audit.json` 的 PASS 结果为准。`catalog-300-tests.log` 是本子任务的13项迁移验证记录；冻结后主任务另跑全工作区及原生回归，以其最终证据为准，不能用本文件替代整应用验收。

本轮完成资料导入与离线/迁移验证；没有实物调制、感官测量或商业许可授予，没有制作新的安装包。原生 GUI 的全链验收由主任务单独记录。
