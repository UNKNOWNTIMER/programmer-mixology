# 票据 Logo 与主机邮票接入

`apps/client/src/TicketDock.tsx` 导出 `TicketDock`、`OrderStampOverlay` 与 `TicketOrder`。工作台传入当前真实 `Recipe`、独立用户 `Target`、减少动画设置、管理入口回调；`onOpenOrder` 可将订单快照放到酒杯区 overlay。组件独立样式默认占用 390 × 175px 上限，窄于 220px 的父容器中只保留居中 Logo 和必要短状态。

`session-store.ts` 是 React `useSyncExternalStore` 内存状态，HostPanel、NetworkPanel 与工作台共享。关闭设置不结束会话；到期、退出和 WebView 重载清空 UI 会话。原生 GuestClient 持有远程 bearer token，UI store 只保存远程账户、角色和到期时间。密码及会话密钥不写浏览器持久存储。账户 ID 可以保存在原有设置中。

Logo 高亮需要真实 guest 会话、主机当前可用票和同一 `recipe_revision_id` 的审核 ServingSpec。存在 source_id 时还核对来源；生成 trial 始终拒绝自动匹配。`ticket_status` 返回主机时间、当前营业开关、可用张数和票据，支持本机 IPC 与固定证书指纹的 TLS guest adapter；设置面板也使用这个主机结果。UI 不通过客人时钟发放票；每次真实提交仍重新进入服务端事务验证。设置面板切换账户时清空旧清单，并丢弃旧身份的迟到刷新结果。

发出提交命令前，`ticket-state.ts` 同步保存 UUID、审核规格、目标和单份数量。目标后续编辑不会改写已保存请求。失败保留请求，不播放成功动画；同一配方重试沿用同一 UUID；另一份配方或损坏的保留请求需要先核查，不能静默丢弃。只有权威响应的请求 ID、规格 ID、配方版本和单位数量与原请求吻合时，才删除保留请求并播放缓出旋转。主机 SQLite 幂等约束仍是扣票的最终保证。持久化的保留订单包含目标和客人备注，但不包含凭据。

管理员会话每 6 秒读取真实主机订单，关闭设置后仍继续。邮票按钮支持 Enter、普通点击或拖动宽度 35% 以上；较小拖动取消。所有撕开路径仅调用 `open_stamp`：不会接单、扣票、改制作状态或删除订单。显示材料、SKU、步骤、客人、目标与预测的不可变订单快照，不从当前酒谱重算。

本次已实际运行：

```powershell
. ./product/scripts/enter-build-env.ps1
cargo +stable test --locked --manifest-path product/Cargo.toml -p pixelmix-lan-host -p pixelmix-recipe-engine
pnpm --dir product/apps/client exec tsc -b
pnpm --dir product/apps/client exec vitest run src/ticket-state.test.ts
node --check product/tests/native-ticket-dock.cjs
```

结果为 41 项 host Rust 测试、6 项 recipe_engine Rust 测试、8 项票据/会话 TypeScript 测试全部通过；TypeScript 编译与原生测试脚本语法检查通过。引擎输入数量上限从历史目录数量 101 改为安全上限 512，生成原料白名单不变。

`tests/native-ticket-dock.cjs` 必须串行接在 `native-host-contract.cjs` 后，仅接受 `evidence/native-test-data` 中的 debug 实例。脚本通过真实 WebView2 UI、Tauri IPC、SQLite、loopback TLS 验证暂停/恢复不会重发同日票、库存失败保留请求、原 UUID 重试单次扣票、仅确认后动画、设置关闭继续同步、邮票只读及凭据不持久化。它不应与其他 9223 测试同时运行。

主流水线已实际完成首轮 6 组全通过，结果保存在 `evidence/native-ticket-dock.json`，运行 ID 为 `b571ed50-5cc6-4e3d-99d8-efc7286f45d5`。随后审阅修复了有效会话重新打开设置时自动刷新清单，以及查询原请求时使用同样的响应匹配校验；TypeScript 编译和 8 项单元测试再次通过，原生脚本新增重新打开设置检查，应在最终构建后再次运行。390 × 844 窄屏实际检查由 UI 子任务完成：139px 票据栏内 82px Logo 居中，无残缺横排文字和 console 错误。Loopback 证据不等于两台真实设备局域网验收。
