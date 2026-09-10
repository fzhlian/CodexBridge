# 中文写作技能套件

包含两个可独立自动触发的 OpenAI Agent Skill：

- `official-document-writing`：党政机关公文起草、修改、审核和格式规范。
- `natural-writing`：中文自然化改写，降低模板化、机械化和过度标准化表达。

## 设计原则

两个 Skill 不做简单叠加。公文任务中，`official-document-writing` 对文种、行文关系、事实边界和规范性拥有优先级；如果用户同时要求“去 AI 味”，`natural-writing` 只处理不影响规范性的表达层问题。

## Codex / ChatGPT Desktop 安装

本仓库提供 repo marketplace：`.agents/plugins/marketplace.json`。

在支持插件市场的 Codex CLI 中，可将该仓库作为 marketplace 来源。当前开发分支测试命令：

```bash
codex plugin marketplace add fzhlian/CodexBridge --ref feat/chinese-writing-skills
```

随后重启 ChatGPT Desktop / 刷新插件来源，在 Plugins Directory 中确认 `中文写作技能套件` 已安装并启用。合并到 `main` 后建议改为：

```bash
codex plugin marketplace add fzhlian/CodexBridge --ref main
```

仓库内 `.codex/config.toml` 已对本项目设置：

```toml
[plugins."chinese-writing-suite@fzhlian-writing-skills"]
enabled = true
```

Skill 被安装并启用后，是否被自动考虑主要取决于每个 `SKILL.md` 的 `description` 与当前任务是否匹配；无需每次显式点名 Skill。

## ChatGPT Web / Mobile 的限制

截至 2026-09，OpenAI 官方说明：个人 Skills 的创建/管理主要面向 Business、Enterprise、Healthcare、Edu；本地/仓库 marketplace 主要由 ChatGPT Desktop 与 Codex 本地客户端读取。Plus 账号在 Web / Mobile 上不能据此假定私有 Skill 会自动同步并调用。

若希望普通 ChatGPT Web / Mobile 聊天也自动调用同一套私有 Skill，需要账号后续获得相应 Personal Skills/本地插件能力，或把插件发布到可供该账号安装的插件目录/工作区。公开插件发布到通用 Plugin Directory 后，可由 ChatGPT 与 Codex 共用，但需要按 OpenAI 发布流程提交和审核。

## 依据维护

- 公文规范参考见 `skills/official-document-writing/references/official-document-sources.md`。
- 自然化写作研究依据与适用边界见 `skills/natural-writing/references/natural-writing-sources.md`。
- 公文国家标准升级、条例修订或 OpenAI Skill/Plugin 规范变化时，应同步升级该插件版本。
