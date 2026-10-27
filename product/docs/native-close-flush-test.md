# 系统关闭即时持久化回归

新增脚本 `product/tests/native-close-flush.cjs`，只连接环回 CDP 9223，且 `diagnostics.data_dir` 必须精确等于当前项目的 `product/evidence/native-test-data/final-300`。任何普通安装版目录都会被拒绝，不会操作其界面或关闭窗口。

本脚本不负责启动进程。由主测试脚本串行执行以下两个阶段，中间必须等待所属 debug 进程实际退出，然后以相同隔离 SQLite / WebView2 配置重新启动：

```powershell
node product/tests/native-close-flush.cjs write
# 父脚本检查退出码，等待原 debug 进程退出；再启动同一隔离 debug 可执行文件。
node product/tests/native-close-flush.cjs read
```

`write` 保存完整原状态，准备已落 SQLite 的内格罗尼基线，通过真实收藏按钮和香气轴键盘交互修改状态，在从第一项交互开始计时的 350ms 内调用 `plugin:window|close`。该调用触发原生 `closeRequested`，不调用自定义关闭按钮，也不直接调用 destroy。页面内有硬性计时断言，超时不会被记录为关闭刷新通过。脚本等待真实主 WebView 关闭，只记录 `awaiting_restart`，不会提前声称整体验证成功。

`read` 要求新的文档时间原点与前一阶段不同，通过 Rust `ui_state_get` 读取重启后的实际 SQLite，验证收藏和七维目标保留、五味未变且合计 10000、评价与草稿未被改动。之后恢复完整原状态，重新载入页面并再次核验恢复。即使持久化断言失败，只要隔离程序可读，也会尝试恢复原状态。

临时检查点位于 `evidence/native-test-data/final-300/TEST-close-flush.json`，包括原状态、预期状态、关闭时序与恢复标记。未完成的检查点阻止新的 write 覆盖，避免丢失恢复依据；重新启动后运行 read 可以先完成校验与恢复。最终报告为 `evidence/native-close-flush.json`，失败信息为 `evidence/native-close-flush-failure.json`。检查点只含隔离测试数据，不是生产备份。

“进程确实退出并重启”由父脚本的进程句柄确认；本脚本确认主 WebView 关闭、新文档和持久化内容，不把单纯页面 reload 表述为进程重启。本测试也不模拟断电。

最终主任务已通过 `scripts/test-native.ps1` 串行实际运行：从开始交互到系统关闭调用 **33.6ms**，父脚本确认旧进程退出后启动新进程，全部持久化与恢复断言通过；报告 `evidence/native-close-flush.json` 为 `passed`。这不是硬件断电试验。
