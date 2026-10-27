# TIMER 酒谱文件存档与原生拖放

`archive-bridge.ts` 暴露 `saveArchive({recipe, profile, target})`、`startArchiveDrag(archive_id)`、`listenArchiveDrop(onValidated, onError)` 以及显式 `importArchive(path)`。新导出名为 `中文酒名_english_drink_name.timermix`，例如 `蓝色飓风_blue_hurricane.timermix`；文件名不含UUID，与界面语言无关。中文保留，英文转小写，单词/标点用下划线分隔；合并连续分隔符并去掉首尾点和下划线，替换Windows非法字符，保留重音字母。两种名字共用80个UTF-16单元预算（分隔下划线另计），缺失时使用另一种名字或配方ID。

每次保存创建独立的 `recipe-archives/<UUID>/<友好名称>.timermix` 缓存目录，文件内容仍携带UUID和校验值，并以 `create_new`、`sync_all` 写入，不覆盖前次快照。OLE只复制文件，用户看到的名称不附加内部编号；目标文件夹已有同名文件时由Windows正常处理重名。旧平铺 `UUID.pixelmix` 及 `名称--UUID.pixelmix` 缓存兼容。界面在按下并移动超过阈值且仍按住时启动原生拖出；取消保留缓存文件，不声称桌面保存成功。

新输出统一使用 `.timermix`；旧 `.pixelmix` 和合法 JSON 存档保留读取兼容，既有磁盘文件不批量改名。此次只更新文件扩展名、界面提示及 Windows 文件关联；`pixelmix.recipe-archive` schema、容器分隔符、校验规则及本地数据库路径保持不变。

后缀迁移使用第4版 Shell 处理器契约：图标 CLSID 为 `{81AB84EC-130C-4A8F-84B1-A9C11F10BCCA}`，缩略图 CLSID 为 `{34AC24F9-FF06-4610-A459-A49A6E30535D}`。新类避免正在运行的 Explorer 继续复用只识别旧后缀的 COM 工厂；原有类与历史证据保留，存档内容格式不变。

Windows 拖出使用 `drag` 2.1.1 crate 的 `DragItem::Files`，在 Tauri 主 UI 线程执行 Windows OLE `DoDragDrop`，强制 `Copy`。只接受本应用已经校验的存档 UUID，不开放任意路径、数据类型或 shell 工具。预览图来自该杯存档自身的 64px 像素画像。drag crate 返回的是操作系统拖放结果，目标目录和目标文件复制结果应通过 Explorer/桌面实测单独验收。

V1.0 当前新导出的 `.timermix` 为标准多尺寸 ICO 加受校验 JSON 尾部；旧纯 JSON 存档仍兼容。容器为 `ICO + 换行PIXELMIX-ARCHIVE/2换行 + JSON + u32LE(JSON长度) + SHA256(前述全部字节) + PMIX-END2`；图标16/24/32/48/64/128px，无旁路文件。每杯由稳定配方内容生成不同杯型、颜色与纹理，300杯唯一性已测试。原数据 envelope 外层 `{body, sha256}`；body 固定 `schema="pixelmix.recipe-archive"`、`version=1`、`scope="personal_recipe_snapshot"`、UUID、时间戳和 `{recipe,profile,target}` 快照。SHA-256 包含 body 全部字段，对象键递归按字典序排序，数组顺序保持。校验值只能发现损坏或未同步修改，不是签名，也不能证明原始作者。未知字段、未知版本、重复 JSON 键、非有限数、非法向量、HTML 标记及控制字符均拒绝；五味仍为总和 10000 的整数基点，未知剂量与留存量保留 null，原有数量区间保留。

原生窗口收到一个真实系统文件 drop 时，授予该路径一次、60 秒内有效的读取许可；仅应用自行导出的缓存可直接读取：新格式限定一层UUID目录、唯一普通 `.timermix` 或兼容旧 `.pixelmix` 文件及目录UUID与快照UUID一致；旧平铺格式保留。拒绝缓存目录重解析点，不以任意路径前缀或JSON自报ID授予访问。读取限普通本地 `.timermix`、兼容旧 `.pixelmix` 或 `.json` 文件，最大 512 KiB，拒绝网络共享、设备路径、替代数据流和重解析点，不自动打开来源链接、不执行文件。文件扩展名为 `.json` 时仍必须满足完整存档 envelope，不把普通 JSON 当配方。

导入结果 `snapshot` 和 `personal.audit.original_snapshot` 保留原始配方、出处、预测与目标；`personal` 是独立 ID 的个人未审核快照，`source.kind="imported_snapshot"`、`default_orderable=false`、`needs_serving_configuration=true`、`measured=false`。原来的目标、预测和实饮评价不合并。账号、session、票据、库存、订单与 ServingSpec 授权不属于 schema，不能恢复。导入不会写主机数据库，也不能绕过发布时的权威目录来源检查。界面可由用户此次导入动作将 `personal` 与独立 `target` 载入工作台。

在用户要求逐杯图标的范围内，首次保存注册当前用户 `HKCU\Software\Classes\.timermix` 与本应用 `PixelMix.RecipeArchive.2`，保留 `DefaultIcon=%1`，并提供逐文件只读 `IExtractIcon` 处理器。该处理器从每个存档自身提取画像，避免文件列表复用旧的类型图标。原生 DLL 由仓库内 C++ 源码与 MSVC 构建，嵌入应用后释放到 `%LOCALAPPDATA%\local.pixelmix.workbench\shell-extensions\PixelMixIcon-<sha256>.dll`，不依赖网络下载；稳定 TIMER 后备图标位于同级 `file-icons\TIMER-<sha256>.ico`。两者独立于预览和数据库目录，已有同名不同内容文件不会覆盖。

处理器仅接受普通本地 `.timermix` 和兼容旧 `.pixelmix`，最多512KiB；先验证容器SHA-256与所有ICO帧边界，再生成所需尺寸。拒绝网络/设备/ADS/重解析文件、损坏容器及写入，不解析执行酒谱、不启动进程。COM 类仅注册在当前用户本应用专用 CLSID，采用 Apartment 模型；先检查关联及类拥有者，保留其他应用的 HKCR/UserChoice。不会提权、改 HKLM 或添加 shell/open/command。仅内容或关联变化时写入并通知 Shell。保存返回 `handler_clsid`、`handler_path`、`handler_threading`、`shell_icon_verified` 等诊断；后者只表示 `AssocQueryStringW` 解析成功，不等于 Explorer 实际显示验收。注册失败原因单独返回，存档保存仍有效。旧 JSON 存档没有内嵌画像，可重新导出获得图标；导入仍通过拖回应用完成。

同一DLL还提供独立CLSID的 `IThumbnailProvider`，支持文件初始化及Windows默认隔离所需的 `IInitializeWithStream`。流读取最多512KiB+1字节，复用完全相同的容器校验，输出不超过256px的BGRA位图并保持像素边缘。仅为本应用ProgID注册缩略图接口，没有禁用隔离或修改Approved/安全策略。

已有本应用旧 `PixelMix.RecipeArchive.1` 图标关联或旧UserChoice时，也更新该自有ProgID的图标/缩略图接口；不会改写UserChoice或其他应用关联。2026-09-21 本轮最终普通桌面程序注册后，真实 Explorer 详细列表和大图模式已显示逐杯画像，32 种轮廓通过实际窗口验收。原失败记录保留，不能把此前进程内调用结果追认为当时已经显示正确。

最新画像系统为 8 类来源杯型 × 4 种独立轮廓，共 32 种设计；300 杯的稳定细节/配色画像互异。`IExtractIcon` 类只暴露 `IPersistFile` 和图标接口，缩略图类才提供文件/流初始化。修正后的契约使用固定新版图标/缩略图 CLSID，旧类注册不删除，数据格式不变。安装的 DLL 和 ICO 先按文件句柄解析物理路径，以处理开发工具的 AppData 重定向。

开发验证须区分运行上下文：Codex 启动的子进程曾在私有 HKCU 视图中写入新关联，普通 Explorer 实际仍看到旧 ProgID1；`GetCurrentPackageFullName=NO_PACKAGE` 和正常 `NtQueryKey` 路径也不能排除这种差异。最终由真实 Explorer 启动固定隔离测试 EXE，应用的同一 `archive_save` 正常注册后，包外探针和实际图标视图才通过。可复现证据见 `evidence/archive-designs-32/`，普通用户日常从桌面快捷方式启动即可使用对应桌面关联。只读探针/固定隔离启动器是测试工具，不是安装产物。

小标签按下即创建独立取消标记并捕获指针，快速移出仍能触发8px阈值；保存期间保持捕获，抬起/取消/丢失捕获/新按下/卸载使旧手势失效。保存完成后只有原手势有效才可一次性handoff，并在OLE交接前释放捕获。异步保存完成后，原生主线程再检查鼠标左键是否仍按下：已松开则返回取消，保留本地缓存，不在下一次点击开始过期拖放。
## 当前杯加入制作队列（2026-09-22）

匹配右侧的「＋ 队列」保存当前显示酒的配方、预测与当前目标，追加为独立的一份；不要求开启AI或登录主机。同一杯可连续添加多份，各自有队列ID和冻结快照。按钮仅在真实桌面应用中可用，保存过程中暂时禁用，SQLite保存成功后旋转TIMER标签并展开左下队列。工作台的选酒、目标、锁定和试调记录不会因加入而改变。

制作队列和存档导入共用左下菜单：点队首 × 完成这一杯，自动读取下一份保存的完整配方与目标；点后面的 × 只移除相应待办项。队列会随本机数据库保存，重启后恢复。没有向主机提交订单，也没有扣票。正常成功反馈直接体现在队列数目和菜单中，不再弹出主窗口底部提示；保存错误仍显示。

入队通过已有Rust存档保存／校验流程生成真实文件、原始快照和校验值。上限20份，UI状态预算240 KiB；入队同时检查后续FIFO激活时的状态大小，旧队列完成时也检查容量，超限明确拒绝且保留原队列。后续调整滑杆或切换酒不会回写已排队的快照。

点击滑轨下方白色预设刻度、再选择酒时，五味及七维滑块在约420ms内移动到配方坐标；视觉五味每一帧仍合计10000整数基点，界面数值仍只显示整数。启用「减少动态效果」时直接到达终点。撤销恢复之前的选酒、目标及锁定。

## 左下 TIMER 存档队列（2026-09-21）

每次拖入一份存档，通过原生完整校验后按到达顺序排队。首杯自动读取完整个人配方和原存档目标；后续导入加入队尾，不覆盖正在调制的配方、目标或锁。队列首项标「调制中」，后续标「待调制」；点首项 × 完成后自动读取下一杯，点后续条目 × 只取消该待办项。最后一杯完成后保留当前配方在工作台。这里只移除队列条目，源 `.timermix` 或旧存档文件不删除。

队列保存在工作台 SQLite 设置中，完整记录个人快照、独立目标、文件 UUID、校验值和导入时间。相同文件每次拖入均以新的队列 UUID 独立入队，文件 UUID + SHA-256 只记录来源，不用于去重。移除或完成其中一杯不移除另一份相同配方。最多20杯，导入后的完整工作台状态不得超过240KiB（数据库单设置上限256KiB）；超限明确拒绝本次导入，绝不自动丢弃排队存档。最近4份已读取个人配方仍保留在原试调缓存。

有效导入会使 TIMER 标签缓出旋转720ms，并展开本机队列菜单；损坏/拒绝的导入不旋转、不改变队列。软件内「减少动态效果」开启时跳过动画，默认关闭；按用户要求以软件内设置为准，Windows的动画偏好不再强制覆盖。启动读取已保存队列不重播成功动画。菜单在左下区域内部滚动，主工作台固定不滚动；点「队列」切换回真实票据/邮票，Escape 收起并保留键盘焦点。导入、排队和完成均不是点单，不触发扣票、接单或菜单审核。

`recipe-details` 副窗口的自定义 invoke dispatcher 仅允许读取弹层 payload、发送 ready 及事件插件前缀；主机、模型、存档和其他主窗口命令均拒绝。

以下为此前实现的历史验证记录（当前结果见 BUILD_REPORT.md 最新章节）：

```powershell
. ./product/scripts/enter-build-env.ps1
cargo +stable check --locked --manifest-path product/Cargo.toml -p pixel-mix
cargo +stable test --locked --manifest-path product/Cargo.toml -p pixel-mix archive:: --lib
node --check product/tests/native-archive.cjs
```

Rust 存档 9 项测试通过，包含全部当前源酒谱/预测的 roundtrip；首次编译发现 Windows API 常量类型错误和测试路径错误，修复后通过。全量 roundtrip 还发现真实源数据含 `quantity_range` 和 `retained_ml`，已添加有界校验并保留其未知值。前端 bridge 4 项单元测试通过，使用明确标注的 IPC mock，只验证桥接契约，不能算作原生成功。

`tests/native-archive.cjs` 必须在 `native-host-contract.cjs` 之后、同一隔离 debug `evidence/native-test-data/final-300` 下串行执行。冻结300杯后主任务实际运行 **7组全通过**，`evidence/native-archive-contract.json` 证明真实原生保存/读取、SHA/schema/权限边界、HKCU图标及宿主订单不变；图标注册成功且没有 shell/open/command。第7组通过**合成Tauri文件事件**将真实缓存文件交给App，校验个人快照、目标与原配方引语恢复；它只证明事件接收链路，不是实际OS投递。全部300杯通过Rust往返测试；合法CRLF保留，孤立CR仍拒绝。Explorer双向物理拖放未通过验收：当前Computer Use拖动坐标受来源窗口边界限制，目标文件复制不能由API通过推断。真实两设备局域网与移动系统文件关联均不属于本次证据。

取消拖出仍保留本地缓存文件。当前没有缓存清理或卸载时的文件图标关联清理界面；关联路径所用专用图标应保留。存档不包含完整原料定义字典，导入到缺少同一原料ID的目录时会显示ID而非猜测材料名称。

实现依据：[drag-rs 维护方源代码](https://github.com/crabnebula-dev/drag-rs)、[Windows 自定义文件类型图标](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-assign-a-custom-icon-to-a-file-type)。依赖下载仅为普通开发库，没有下载模型权重。

## V1.1：多入口拖出、文件剪贴板与队列排序

- 在经典酒谱库按住酒名拖出，导出该行酒谱和对应配方预测；不先切换当前工作台。该入口存档的目标取该酒配方预测。
- 按住ASCII酒杯或TIMER标签拖出，保存当前酒、配方预测和独立用户目标。短点击酒杯仍打开酒语，红点仍显示资料。
- 主工作台 Ctrl+C 将真实 `.timermix` 缓存文件放入 Windows CF_HDROP 剪贴板，可在桌面或资源管理器粘贴。Ctrl+V 从文件剪贴板校验并导入制作队列；相同文件允许重复入队。文本编辑、选中文本、弹窗与组合输入不拦截快捷键，不把普通文本解释为磁盘路径。
- 一批剪贴板最多20个文件，全部格式验证和容量检查通过后整体入队；损坏／超限不部分入队。缓存包含原配方、预测、目标、逐杯图标和校验，不恢复客人点单权限。
- 制作队列内部上下拖动改变顺序；Alt+↑／↓也可排序。排序不改工作台、不改快照、不扣票。拖出主窗口导出该条目冻结的原配方和目标，不读取当前显示的另一杯。
- 点击完成，条目约220ms向左移出并淡去，再提交移除；数据库失败恢复条目并显示错误。队首完成读取新队首，非队首完成保留当前杯。开启减少动态效果时省略动画。
- 排序／完成以有序SQLite写入确认后更新队列，排队自动保存和实饮评价不会写回旧队列快照。写入期间新的目标、设置和评价保持。
- 五味数字显示采用最大余数分配，甜酸苦咸鲜每一帧的五个整数百分比合计100。相同规则用于滑杆、读屏、悬停值、饼图和个人酒谱编辑器；例如3333/3333/3334/0/0基点显示33/33/34/0/0。保存、匹配、订单仍保留10000整数基点，不把整数显示回写进配方或目标。

Windows物理文件复制、原生缓存／SQLite和动画的本轮实际验收范围见 BUILD_REPORT 最新章节。CDP鼠标手势创建了真实缓存与原生调用，不等同于Explorer接收物理跨窗OLE拖放。
