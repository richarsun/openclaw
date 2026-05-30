# 企微本机连接器运行手册

## 规则归类

这是一个运行治理需求，不是单纯的功能开发需求。

在产品和工程视角下，它同时属于：

- 非功能性需求：关注可运维性、可观测性、可靠性和可恢复性。
- 连接器生命周期管理：管理企微回调入口、OpenClaw gateway 和本机连接器之间的启动、停止、状态探测和诊断。
- 运行手册需求：把临时排障步骤沉淀成可复现、可审计、可交接的 runbook。
- 开发环境治理规则：禁止用隐式后台计划任务替代明确的开发入口。

## 对应规范

在开发领域，这对应运维就绪和可观测性规范：

- 显式入口：启动、停止、状态检查和诊断必须有明确命令。
- 可复现：同一套步骤可以在本机重复执行，不依赖操作者记忆。
- 可回滚：临时连接器必须能明确停止，不能自恢复成不可控后台进程。
- 可观察：状态命令必须能说明失败点在 gateway、企微配置、公网回调入口还是连接器。
- 最小惊扰：开发机不得周期性弹窗，不得偷偷注册计划任务。

在开发管理领域，这对应变更管理和运行手册规范：

- 临时救火方案不能沉淀为隐式长期机制。
- 长期能力必须通过 issue、分支、PR、验证和验收闭环推进。
- 本机路径、服务器地址、密钥路径和凭证不得写入仓库文档。
- 任何自动启动、常驻守护、计划任务或系统服务都必须有启用、禁用、查看状态和卸载说明。

## 正规启动方式

企微链路分两段启动。

第一段是 OpenClaw gateway。这是主服务，应该显式启动：

```powershell
pnpm openclaw gateway --port 18789
```

如果使用已经构建好的 `dist` 产物，也可以在仓库根目录运行：

```powershell
node dist\index.js gateway --port 18789
```

第二段是企微本机连接器。它负责把企微公网回调入口转发到本机 gateway。

在 issue #17 完成前，允许使用本机 `_local` 下的临时脚本手动启动连接器：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\_local\inventory\start-wecom-reverse-tunnel.ps1
```

这个脚本只允许手动执行，禁止注册为周期性计划任务。脚本里的真实服务器、端口、密钥路径等本机配置必须留在 `_local`，不得提交到 Git。

## 正规停止方式

停止时按相反顺序处理。

先停止企微本机连接器，再停止 gateway。

在 issue #17 完成前，如果本机连接器是通过临时 SSH 反向隧道启动的，可以用进程查询确认是否存在：

```powershell
Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'ssh.exe' -and
    $_.CommandLine -like '*127.0.0.1:18789*'
  } |
  Select-Object ProcessId,Name,CommandLine
```

确认只匹配企微本机连接器后，再停止对应进程：

```powershell
Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'ssh.exe' -and
    $_.CommandLine -like '*127.0.0.1:18789*'
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId }
```

停止 gateway 时，优先关闭运行 gateway 的终端会话。不要用计划任务或后台脚本反复拉起 gateway。

## 状态检查

启动 gateway 后，先检查通道状态：

```powershell
pnpm openclaw channels status --probe
```

如果全局 CLI 或 `pnpm` 环境不可用，可以使用构建产物：

```powershell
node dist\index.js channels status --probe
```

判断顺序：

1. gateway 是否正在监听本机端口。
2. 企微通道是否 enabled、configured、running。
3. 企微公网回调入口是否能到达本机 gateway。
4. Codex/OpenAI 鉴权配置是否可用。

## 明确禁止

以下做法禁止作为长期方案：

- 每隔几分钟运行一次 PowerShell 计划任务检查连接器。
- 在用户不知情的情况下注册 Run、RunOnce、计划任务或系统服务。
- 使用会弹窗的后台任务维持开发环境。
- 把本机真实服务器地址、密钥路径、Token、Secret 写入仓库。
- 在没有 stop/status/diagnose 能力时，把临时脚本包装成正式功能。

## 后续落地

正式能力通过 GitHub issue 推进：

- issue #17：企微本机连接器生命周期管理。

验收目标是提供稳定的 `start`、`stop`、`status`、`diagnose` 能力。完成前，企微本机连接器只允许按本手册手动启动和手动停止。
