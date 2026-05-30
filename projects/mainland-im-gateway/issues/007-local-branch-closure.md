# 收口本地 OpenAI Codex 默认模型分支

## 背景

本记录对应 richarsun/openclaw#21，用于收口本机 `feat/openai-codex-gpt54-defaults` 分支长期 ahead 的 6 个提交。

核对时发现该本地功能分支相对当前 `richarsun/main` 还有一个已推送到远端功能分支的前置提交 `8845cb90fab`。该提交不属于本地 ahead 6 的验收范围，但它的 OpenAI Codex GPT-5.4 默认模型意图已被当前主线 provider 架构覆盖。

## 提交去向

| 提交 | 标题 | 去向 | 依据 |
| --- | --- | --- | --- |
| `42d1c9437b` | 修复 Windows 计划任务路径解析 | 已由当前主线覆盖 | 当前 `src/daemon/schtasks.ts` 已使用 `parseCmdScriptCommandLine`，并已有 Windows 反斜杠路径和 UNC 路径测试。 |
| `035133b240` | 修复 Windows ACL 当前用户识别 | 已由当前主线覆盖 | 当前 `src/security/windows-acl.ts` 使用 `icacls /sid` 与 `whoami /user` 解析当前用户 SID，避免依赖可能乱码的域名文本。 |
| `bd0204658b` | 修复 Codex 默认模型和工作区错误处理 | 拆分处理 | GPT-5.4 默认模型已由当前主线 provider 架构覆盖；GPT-5.5 默认模型变更需要独立按 provider 架构评审。本次仅补入仍缺失的 Codex 工作区停用错误提示。 |
| `95a26ef673` | 冻结本机仓库协作规则 | 不进入 PR | 该提交包含本机全局规则路径和本机协作约束，属于操作者环境规则，不适合作为上游仓库项目规则。 |
| `734338a94d` | 新增大陆 IM 接入层项目规划 | 进入本 PR | 该提交是项目治理文档，不触碰运行链路、凭证或客户消息链路。 |
| `55df5e4855` | 文档：规范企微本机连接器运行手册 | 进入本 PR | 该提交沉淀手动启动、停止、状态检查和禁止事项，且明确禁止写入真实服务器、密钥路径、Token 或 Secret。 |

## 本次 PR 范围

- 新增大陆 IM 接入层项目说明与 6 个后续 issue 草案。
- 新增企微本机连接器运行手册。
- 在当前主线错误处理路径中识别 `deactivated_workspace`、`deactivated workspace` 和 `workspace is deactivated`，并改写为可操作提示。
- 保留旧 Windows 修复与本机 AGENTS 规则的审计结论，不重复搬运已覆盖或不适合上游的旧补丁。

## 验收方式

- `git diff --check`
- `pnpm --version`
- 针对错误处理变更运行 `pnpm test -- src/agents/pi-embedded-helpers.formatassistanterrortext.test.ts src/agents/pi-embedded-helpers.sanitizeuserfacingtext.test.ts`
