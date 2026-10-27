# PIXEL MIX 备份与恢复

当前存在两种独立 SQLite 备份。它们并不是包含所有文件的一键灾难恢复包。

## 数据范围

| 数据 | 当前数据库 / 文件 | 应用内备份入口 | 恢复能力 |
|---|---|---|---|
| 来源酒谱、个人设置、收藏、真实评价 | `pixelmix.sqlite` | 全局设置中的个人数据库备份 | 可在应用中选择兼容的个人数据库备份恢复 |
| 主机账户、SKU 库存、审核菜单、票据计划、票据、订单快照、事件 | `host.sqlite` | 管理员登录 → 主机备份 → 创建真实主机账本备份 | 提供离线示例工具，校验后仅复制到一个新文件；不在线覆盖 |
| TLS 主机公开证书与 DPAPI 加密私钥 | `host-identity/host-certificate.pem`、`host-identity/host-key.dpapi` | 不包含在上述两种数据库备份内 | 需保留原 Windows 用户及其 DPAPI 密钥；另一个用户/系统不能保证解密 |
| 正在运行的模型进程与已配置权重 | 用户选择的模型路径 | 不备份 | 退出应用停止进程；权重不捆绑、不下载 |

以应用诊断显示的 `data_dir` 为准，不根据安装目录猜测数据位置。测试构建使用隔离的 `native-test-data`；正常用户数据与测试数据不得混用。

## 个人数据库

在全局设置创建备份，成功后记录显示的完整路径。文件位于数据目录 `backups/pixelmix-时间.sqlite`。SQLite Online Backup 包含 WAL 中已经提交的数据，不能用运行时随意复制一个 `.sqlite` 主文件代替。

恢复只允许从应用备份目录选择符合命名规则的文件。程序检查 SQLite 完整性、应用标识、版本、70 份种子酒谱的真实 revision 和个人设置范围，再执行数据库恢复。恢复会回到备份时的个人状态；它不会恢复主机订单或票据，也不会改变 TLS 身份。恢复前先保存当前个人数据库备份。

## 主机账本

主管理员登录后，在「主机备份」创建备份。原生命令再次鉴权，目标路径固定为：

```text
<data_dir>/backups/host-<时间戳>/host.sqlite
```

客户端无法传入任意写入路径。结果明确返回 `scope=host_ledger_only`，同时显示校验后的订单数、outbox 事件数与文件路径。

主机备份使用 SQLite Online Backup，包含已经提交的 WAL 事务。校验包括应用标识 `0x504d4853`、schema version 1、完整表/索引/trigger 结构、`integrity_check`、`foreign_key_check`、host UUID。已有备份文件不能被覆盖。备份中包含个人账户标识、密码哈希、订单与可能的过敏原资料，应保存在自己控制的存储位置，不随公开安装包传播。

## 离线恢复到新文件

提供真实编译的 `product/packaging/installer/PIXEL_MIX_HostRecovery_0.1.0_x64.exe`，源码为 `product/crates/lan_host/examples/recover_host.rs`。它不包含任何自动替换正在使用数据库的逻辑。EXE已对隔离测试账本执行新文件恢复并重新打开验证，见 `evidence/host-recovery-release-smoke.log`，校验值见 `packaging/SHA256SUMS.txt`。

1. 在主机界面停止局域网服务，然后完全退出 PIXEL MIX。确认主机进程已结束。
2. 保留现有整个数据目录，以及准备使用的备份。不要删除原库及其 `-wal`、`-shm` 文件。
3. 选定一个**不存在的新文件路径**作为恢复输出；父目录必须已经存在。
4. 从仓库根目录运行以下 PowerShell 命令，并将两处路径替换为实际绝对路径：

```powershell
.\product\packaging\installer\PIXEL_MIX_HostRecovery_0.1.0_x64.exe --source 'C:\实际数据目录\backups\host-时间戳\host.sqlite' --destination 'C:\自己控制的恢复目录\host-recovered.sqlite' --application-stopped
```

也可从源码构建运行：

```powershell
. ./product/scripts/enter-build-env.ps1
cargo run --manifest-path product/Cargo.toml -p pixelmix-lan-host --example recover_host -- --source 'C:\实际数据目录\backups\host-时间戳\host.sqlite' --destination 'C:\自己控制的恢复目录\host-recovered.sqlite' --application-stopped
```

`--application-stopped` 是操作者确认，不会自动杀进程。工具检查源备份后以只读方式读取，通过 SQLite backup 创建新库，撤销恢复副本中的旧 session、未使用邀请与待审批配对，再关闭并重新打开校验。正常输出 `status=verified_new_copy`、`original_untouched=true`，并给出保留的订单与事件数量。原账户密码哈希保留，重新登录即可取得新会话。工具不会恢复 TLS 私钥，也不会恢复个人数据库。

同名输出已经存在、源与目标相同、外来数据库、错误 schema、相对路径均拒绝。失败时原库不变；可能留下未完成的新输出文件，不能将其当作成功恢复文件。

**新副本生成不等于已替换应用数据库。** 当前版本没有自动切换主机数据文件的 UI。需要将恢复副本投入使用时，继续保持应用关闭，先完整归档原数据目录（包括 WAL/SHM），再由维护者核对主机身份、账户、订单数和恢复时间，执行受控的文件切换。不要在没有确认备份和路径的情况下覆盖 `host.sqlite`。这一步仍需单独记录，不能把「生成新副本」写成「已完成生产数据恢复」。

## TLS 身份与整目录保留

`host-key.dpapi` 绑定原 Windows 用户保护环境。仅复制文件到其他 Windows 用户或另一台机器不能保证可解密；同名用户名不等于同一 DPAPI 身份。无法恢复原密钥时，需创建新主机 TLS 身份，由每个客人重新确认指纹并配对，不能静默接受证书变化。

同一用户保留旧身份时，证书仍需覆盖当前主机 IP。IP 改变且不在证书 SAN 内，程序在监听前拒绝启动；不要关闭证书检查。自动证书轮换尚未实现。

若要保留最完整的本机现场，先退出应用后完整复制 `data_dir` 到受控位置，包含两个数据库、存在的 WAL/SHM、TLS 身份与备份文件。该离线文件副本仍需分别校验和恢复演练；本版本没有跨多个数据库与 DPAPI 身份的统一自动恢复事务。

## 已运行验证与边界

- Rust 测试确认：有已提交订单和 outbox 的主机 WAL 备份重新打开后，订单 ID 与扣票数一致。
- 离线恢复示例的 2 个测试确认：创建并重新校验新副本；撤销旧 session；原库仍可使用原 session；拒绝覆盖原库/现有目标；拒绝外来与相对路径。
- `product/evidence/host-recovery-example-tests.log` 保存实际输出。
- 真实 Tauri 主机备份按钮及隔离主机订单测试以 `product/evidence/native-host-contract.json` 的当前记录为准。
- 未把物理断电、磁盘损坏、跨 Windows 用户 DPAPI 迁移或跨平台恢复标为已验证；未提供无风险自动全量恢复保证。
