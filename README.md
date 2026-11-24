# Claude KYC 浏览器扩展

[简体中文](README.md) | [English](README.en.md)

在 Chrome 侧边栏中通过 Claude 网页 SK 和代理查询 KYC 状态。

![Claude KYC 扩展](docs/screenshot.png)

> 本项目与 Anthropic、Claude、Persona 无隶属关系。请仅用于你有权访问的账号。

## 功能

- 无安装器、无本机程序、无后端服务
- Chrome Side Panel，验证期间保持打开
- 单个查询和批量查询，批量并发固定为 1
- 自动读取 Claude 组织，多组织时手动选择
- 获取验证链接、刷新状态、重新验证
- 批量结果表格，支持导出 `.xlsx`
- HTTP / SOCKS5 代理及认证
- 支持 `{session}`、`{region}` 代理模板
- 每日检查 GitHub Release 更新

## 环境

- Chrome 148+ 或其他同代 Chromium 浏览器
- Claude 网页 `sessionKey`，不是 Anthropic API Key
- 代理可选

## 安装

1. 从 [Releases](https://github.com/DouDOU-start/claude-kyc-extension/releases) 下载最新 ZIP 并解压。
2. 打开 `chrome://extensions`，启用开发者模式。
3. 点击“加载已解压的扩展程序”，选择解压后的文件夹。

从源码使用时，直接选择本仓库的 `extension` 文件夹。Chrome 不支持直接拖 ZIP 安装。

## 使用

点击工具栏图标打开侧边栏，填写代理和 SK。

**单个查询**

1. 点击“查询 KYC”。
2. 需要验证时点击“获取验证链接”。
3. 在浏览器完成 Persona 验证后，点击“刷新状态”。

**批量查询**

1. 切换到“批量查询”，每行填写一个 SK。
2. 点击“开始验证”，结果会实时写入表格。
3. 点击“导出 Excel”下载结果。

批量模式只查询状态，不生成验证链接；导出的 SK 已脱敏。

## 代理格式

```text
http://host:port
socks5://host:port
host:port
host:port:username:secret
```

支持带用户名和密码的 HTTP / SOCKS5 代理。请求期间代理仅作用于 `claude.ai`，结束后自动恢复。

## 更新

GitHub 侧载版每天检查一次新版本，并显示下载入口。Chrome 不允许侧载扩展静默更新，下载后覆盖目录并在扩展页点击“重新加载”。

上架 Chrome Web Store 后可获得商店自动更新。

## 权限

- `proxy`：查询期间路由 Claude 请求。
- `webRequest` / `webRequestAuthProvider`：提供可选代理认证。
- `declarativeNetRequestWithHostAccess`：为单次请求注入 SK，不修改浏览器 Cookie。
- `sidePanel` / `storage` / `clipboardWrite`：侧边栏、状态保存和复制验证链接。
- `host_permissions`：仅访问 `claude.ai` 和 GitHub Releases API。

## 隐私与安全

- SK 只保存在侧边栏内存，关闭侧边栏即清除。
- 不读取或覆盖已有的 Claude Cookie。
- 无遥测、无统计、无项目服务器。
- 验证链接仅接受 HTTPS，不自动打开。

详见 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 开发

无构建步骤。加载 `extension` 文件夹，修改后在扩展页点击“重新加载”。

```sh
node --test tests/*.test.js
```

发布由 GitHub Actions 完成：推送与 `extension/manifest.json` 版本一致的 `v*` 标签，自动打包 ZIP、生成 `SHA256SUMS.txt` 并创建 Release。

## 许可证

[MIT](LICENSE)
