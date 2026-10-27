# 主机事务、TLS 与本地模型适配实现记录

记录日期：2026-09-21。实现目录：`crates/lan_host`、`crates/inference`。这份记录描述已实现的代码与已运行的测试；不将同机测试写成双设备验收，也不将协议测试写成真实模型推理。

## 主机权威服务

`pixelmix-lan-host` 使用 SQLite WAL、`synchronous=FULL`、5 秒 busy timeout。`HostStore::open` 本身不会打开网络端口。数据库具有应用标识 `0x504d4853`、schema version 1 与严格结构识别，拒绝外来或更新版本数据库。

主要接口：

- `bootstrap_admin`、`login`、`logout`：无默认密码；Argon2id 密码哈希，随机 256 位 session token；数据库仅保存 token 的 SHA-256。会话有效期 15 分钟。每账户每分钟最多 5 次登录尝试；每会话每分钟最多 120 次授权业务请求。
- `create_pair_invite`、`request_pair`、`approve_pair`：邀请 5 分钟有效、一次性使用；审批前鉴权并核对 pending 状态。管理员批准后生成单独设备账户与随机设备凭证；`revoke_guest` 撤销账户及当前会话。当前设备凭证需要由管理员在可信渠道交给该设备，没有实现二维码自动安全回传。
- `save_sku`、`publish_serving_spec`：SKU 的 ABV、库存、剂量上限、食品及过敏原审核由管理员确认。审核规格必须包含确定的 ml 剂量和来源、步骤、杯型、容量、预测状态；缺乏校准的 dash、洗杯留存量不能被默认换算。原始种子酒谱没有默认可点权限。
- `save_policy`、`tickets`：主机时间、IANA 时区、独立政策版本、每日或指定日期窗口；处理跨午夜、DST 重复时刻与不存在时刻。同一服务日与实际 UTC 重叠窗口都不能因政策或时区变化重复发票；暂停政策阻止继续点单。
- `place_order`：身份取自 session；只允许 1 杯 / 1 票。`BEGIN IMMEDIATE` 内核对 request hash、审核规格、库存、排除项、过敏原、容量、乙醇上限与有效票据，再原子写入扣票、库存扣减、不可变快照、outbox。失败请求的限速计数在业务事务之外持久化，回滚不能绕过限速。
- `own_orders`、`order_by_request`、`admin_orders`、`events`：按身份筛选读取。相同 request ID / 相同内容返回原订单；不同内容返回冲突。重试不重新依赖已经下架的菜单。
- `open_stamp` 只记录该查看者的阅读状态。`transition` 显式修改制作状态且核对版本；制作前拒绝或取消可由管理员明确退票，补偿记录唯一。库存不会自动恢复，以免将实际消耗或浪费当作未发生。
- `admin_accounts`、`pending_pairs`、`admin_skus`、`admin_policies`：管理员清单；不返回密码哈希或 session token 清单。

快照冻结来源酒谱、审核规格、SKU 标签与 ABV、剂量、步骤、目标与预测、审核人/时间、接收时间与审计 ID。SQLite trigger 阻止修改订单快照字段。未知稀释量不会推导成杯 ABV，未知营养不会生成热量。

Tauri `host_commands` 在发布前从正式 Catalog 重新读取真实来源与 revision，覆盖请求中的来源对象，并拒绝生成草稿的发布。本地库本身不依赖 Catalog；网络模块没有任何远程发布菜单入口，不能绕过原生来源绑定。

## 默认关闭的 TLS 传输

`transport::TlsHost::start` 需要有效管理员 session、`explicitly_enabled=true` 与明确私网 IPv4 / loopback IP。禁止 `0.0.0.0`、IPv6 wildcard 与公共地址，也拒绝非私网远端连接。未修改防火墙、系统权限或路由，没有自动提权。

Windows 首次启动生成本地 TLS 身份，私钥由当前用户 DPAPI 加密保存。`PairingIdentity` 包含 host_id、协议版本、实际地址、公开证书与 SHA-256。`GuestClient::connect` 要求确认该指纹，随后执行精确叶证书绑定及标准主机名、有效期、证书链和握手签名校验。没有 `danger_accept_invalid_certs` 或 WebView 全局 TLS 例外。持久证书不覆盖新 IP 时，监听之前返回明确错误，要求显式创建新身份并重新配对。

网络只开放 `/v1/health`、单次邀请配对、guest 登录、审核目录、本人票据/订单、幂等订单提交与事件拉取。即使持有本机 admin bearer token，也不能将其用作 guest 网络会话。管理员修改全部留在本机原生命令。禁止代理、重定向、压缩/分块请求、重复 HTTP header；header 上限 8 KiB，JSON 上限 64 KiB，读取绝对 deadline 5 秒，最多 8 个同时处理的连接，每 IP 每分钟最多 120 个请求。

已测试真实同机 TLS 连接和证书拒绝；尚未验证两台物理设备、访客网络隔离、路由器 mDNS、二维码流程、WebSocket 推送、移动本地网络权限、自动证书轮换与刷新凭证流程。当前事件同步是显式拉取。不能把这些缺项称为完整 M2 网络验收。

## 受控 llama.cpp 适配

`pixelmix-inference` 不下载模型，不附带 llama-server 或 GGUF。`ManagedModel::start_cancellable` 要求用户明确批准的本地绝对路径、可识别 GGUF magic、可执行文件与权重的已审核 SHA-256、构建标识和许可记录。校验按 64 KiB 分块读取且响应取消。

直接 `Command` 启动名为 `llama-server` 的本地二进制，不经过 shell。固定 loopback、随机空闲端口、随机 bearer token、单任务并发和受限上下文/线程/批大小；清除继承的 LLAMA/HF/代理控制项，显式 `--offline --no-agent --no-webui --no-slots`。启动时核对 health，以及授权端点确实拒绝匿名请求。Windows 子进程不显示控制台。取消、超时及传输故障停止子进程，关闭应用也停止受控进程。

模型仅获得规则候选摘要，最多 8 个；输出只允许 `candidate_id`、`name_zh`、`name_en` 三个字段。额外剂量、热量、权限、tool call、不在候选集的 ID、超长文字、HTML/控制字符与畸形 JSON 全部拒绝。初始尝试加最多两次结构修复后，明确返回确定性命名与失败原因；任何结果都保持 `requires_bartender_review`、`guest_orderable=false`。数值与规则候选由规则引擎决定。

官方 CLI 参数依据：[llama.cpp server 文档](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)。具体用户安装构建对 flags、GGUF 架构和 JSON schema 的兼容性仍需真实验证；本任务未下载或运行权重，未测 tokens/s、峰值 VRAM、OOM 降级或真实模型取消。没有自动下载管理、兼容模型 manifest 或经过验证的推荐模型选择。

## 实际验证记录

命令从仓库根目录执行，先 `. ./product/scripts/enter-build-env.ps1`；目标为用户本机 Windows x86_64，硬件证据位于 `evidence/host-audit.json`。

| 命令 / 项目 | 实际结果 |
|---|---|
| `cargo test -p pixelmix-lan-host -p pixelmix-inference --manifest-path product/Cargo.toml` | 最后一次模块测试 40 个 host + 17 个 inference 均通过，0 fail；`evidence/lan-inference-tests-current.log` |
| 20 线程抢最后一张票 | 只成功 1 单；1 次扣票、1 条 received outbox |
| outbox 注入故障 | 扣票、订单、库存全回滚 |
| ACK 丢失后关闭连接并重新打开数据库 | 返回原订单，未再次扣票 |
| TLS loopback / exact pin / 身份重启 / 配对 | 实际 socket、TLS、DPAPI 与 SQLite 联合测试通过；不是物理双设备 |
| 模型 HTTP 协议 | 实际 loopback 测试服务验证 token、schema、禁重定向、体积限制和 timeout；测试服务不代表模型 |
| `node --check product/tests/native-host-contract.cjs` | 通过；完整实际 Tauri 结果以 root 运行后的 `evidence/native-host-contract.json` 为准 |
| `pnpm exec tsc -b`，目录 `product/apps/client` | 主机备份 UI 加入后通过 |
| `cargo check -p pixel-mix --manifest-path product/Cargo.toml` | 主机备份 bridge 加入后通过 |
| `cargo test -p pixelmix-lan-host --example recover_host --manifest-path product/Cargo.toml` | 2 个离线恢复测试通过；`evidence/host-recovery-example-tests.log` |

实际遇到的失败与处理：初次 Cargo 检查因另一个并行 workspace member 的 manifest 尚未创建而退出，补齐后通过。首次 TLS 集成有 3 个失败：Windows 接受的 socket 继承 listener 非阻塞模式，出现 Windows 10035；为 TLS worker 显式切回有 deadline 的阻塞 IO 后，全部通过。一次检查命令误写不存在的 package `pixelmix-client`，改为实际 package `pixel-mix` 后通过。尝试 Clippy 时本地工具链尚无 `cargo-clippy.exe`，该次命令未运行检查，不标作 pass；如全局后续补装，以全局构建报告为准。

新增主机备份边界与离线恢复操作见 [BACKUP_RESTORE.md](BACKUP_RESTORE.md)。
