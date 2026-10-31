# ASC Studio

[English](README.md) | 中文

在 [DeepSeek Harness](https://deepseek.com/harness/) 侧边栏编辑 App Store Connect 上架文案及图片。

## 功能

- 编辑多语言名称、副标题、描述、关键词、更新说明和推广文本。
- 提供字数统计和同步前对比，检查 ASC 中的文案是否已被他人修改。
- 管理截图、产品页头图和搜索结果图。
- 通过设备布局预览产品页和搜索页。
- 让 DSH Agent 起草文案、翻译内容，或根据 Git 改动整理更新说明。
- 支持简体中文和英文界面。

## 安装

需要 **macOS** 和 DSH **>=0.2.1-rc.5、<0.3.0**。已在 macOS 的 DSH 0.2.1-rc.5 桌面端及 Web 模式中验证。

在 DSH 的 **插件 → 添加插件** 中安装：

```text
dsh-asc-studio
```

打开 **App Store** 面板，使用 App Store Connect API 的 Issuer ID、Key ID 和 `.p8` 文件连接账号。

插件用于编辑已有版本和语言。新建版本、添加语言和提交审核仍在 App Store Connect 中完成。

## Agent 协作

在 DSH 打开项目后，可以这样提出要求：

> 根据 Git 中 v1.2.0 以来的改动生成更新说明，填入当前 App Store 版本的中文和英文草稿。

Agent 负责起草，文案由你在面板中核对并同步。

## 数据与隐私

API 私钥保存在 macOS 钥匙串中。本机预览图片可在设置中清理；卸载前使用插件内的清理功能，可删除本机数据和凭据。

DSH 可能保留 Agent 会话记录。使用云端模型时，Agent 读取的文案和项目内容会发送给所选模型服务商。插件不会向 Agent 工具提供私钥。

## 开发

使用 Node.js 24，执行：

```sh
npm ci
npm run check
```

本地开发时，在 DSH 插件管理中安装仓库的绝对路径。

## 许可证

[MIT](LICENSE)。这是独立社区插件，与 Apple、DeepSeek 无隶属关系。
