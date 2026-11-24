# Claude KYC 浏览器扩展

纯 Manifest V3 扩展，用 Claude 网页 SK 和可选代理查询账号 KYC 状态。不需要安装器、本机程序、Go 运行时或本地端口。

[English](README.md)

![Claude KYC 扩展](docs/screenshot.png)

> 本项目是独立开源工具，与 Anthropic、Claude、Persona、Google、Microsoft 均无隶属关系。请仅用于你有权访问的账号和代理。

## 功能

- 纯扩展，无安装器、无 Native Messaging、无本地服务。
- 下载或克隆后直接加载文件夹。
- 组织 ID 可选；不填时自动读取组织列表。
- 刷新验证链接、重新验证均需手动触发。
- 验证链接仅接受 HTTPS，约 60 秒后失效。
- 支持 HTTP、HTTPS、SOCKS5、SOCKS5H 代理及认证。
- 支持 `{session}`、`{region}` 动态代理模板。
- 自动检查 GitHub Releases 版本更新。
- 无项目后端、无遥测、无统计。

## 系统要求

- Chrome 148+ 或同代 Chromium 浏览器
- Claude 网页 `sessionKey`，不是 Anthropic API Key
- 代理可选

代理认证使用 Chrome 148+ 的 `webRequestAuthProvider` 权限。

## 安装

1. 打开 [Releases](https://github.com/DouDOU-start/claude-kyc-extension/releases)。
2. 下载最新的 `claude-kyc-extension-vX.Y.Z.zip`。
3. 解压 ZIP。
4. 打开 `chrome://extensions` 或 `edge://extensions`。
5. 开启“开发者模式”。
6. 点击“加载已解压的扩展程序”，选择解压后的文件夹。

所选文件夹内必须直接包含 `manifest.json`。从源码使用则选择本仓库的 `extension` 文件夹。

Chrome 不能直接把 ZIP 拖进扩展页安装；先解压，再选择文件夹。整个项目没有安装程序。

## 使用

1. 点击工具栏中的 Claude KYC。
2. 填写代理；留空则使用浏览器当前网络。
3. 填写 Claude 网页 SK。
4. 可填写组织 ID；留空则自动读取组织。
5. 点击“查询 KYC”。
6. 点击“获取验证链接”取得 Persona 官方验证地址。
7. 在浏览器中完成验证后，回到扩展点击“刷新状态”。

### 代理格式

```text
http://主机:端口
https://主机:端口
socks5://主机:端口
socks5h://主机:端口
主机:端口
主机:端口:用户名:密码
```

扩展通过临时 PAC 只把 `claude.ai` 路由到代理。请求结束后会恢复浏览器代理设置；如果后台被中断，还会由清理定时器兜底。

## 实现方式

- 使用 `declarativeNetRequest` 为该次请求注入 `Cookie: sessionKey=...`。
- 不读取、不覆盖你现有的 Claude Cookie。
- 代理认证由 `chrome.webRequest.onAuthRequired` 提供给浏览器，只在请求期间保存在会话存储。
- 请求在扩展后台 Service Worker 中使用 Chromium 自身网络栈完成。

## 更新

推送 `v*` 标签时，GitHub Actions 会自动打包并发布 Release。

从 GitHub 侧载安装的扩展每天最多检查一次新版本，并在有新版本时显示下载按钮。Chrome 不允许普通侧载扩展静默替换自身文件。下载新 ZIP 覆盖旧目录后，在扩展卡片上点击“重新加载”即可。

如果上架 Chrome Web Store，扩展本体可由商店自动更新。

## 权限

| 权限 | 用途 |
| --- | --- |
| `proxy` | 查询期间临时将 `claude.ai` 路由到代理 |
| `webRequest` + `webRequestAuthProvider` | 提供可选代理认证 |
| `declarativeNetRequestWithHostAccess` | 为单次请求注入 SK，不修改浏览器 Cookie |
| `storage` | 保存代理及请求期间的临时认证信息 |
| `clipboardWrite` | 复制验证链接 |
| `host_permissions` | 访问 `claude.ai` 和 GitHub Releases API |

## 隐私与安全

- SK 只保存在当前扩展页面的 `sessionStorage`，关闭标签页即清除。
- 代理地址保存在扩展本地存储。
- 无项目服务器。
- SK 和代理不会发送到 GitHub。
- 验证链接仅接受 HTTPS，不自动打开。

详见 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 开发

没有构建步骤。直接在扩展管理页加载 `extension` 文件夹。

测试：

```sh
node --test tests/*.test.js
```

语法检查：

```sh
node --check extension/app.js
node --check extension/background.js
node --check extension/lib/api.js
node --check extension/lib/proxy.js
node --check extension/lib/release.js
```

## 目录结构

```text
extension/
  manifest.json       Manifest V3
  app.html            扩展页面
  app.js              界面逻辑
  background.js       代理认证与请求编排
  lib/
    api.js            Claude 请求流程
    kyc.js            解析、状态、校验
    proxy.js          代理解析与 PAC
    release.js        GitHub 更新检查
package.json           Node 测试脚本
tests/                 Node 测试
docs/                 截图、架构、发布说明
.github/workflows/    标签自动发布
```

## 限制

- 使用 Claude 网页接口，接口变化可能导致失效。
- 代理只作用于 `claude.ai` 且是临时的，但查询期间其他 `claude.ai` 标签可能短暂受影响。
- 浏览器验证、限流、401/403 会显示为错误，不会误报为验证成功。
- 本工具只查询状态并提供官方验证链接，不绕过实名验证。

## 自动发布

Release Workflow 会校验标签与 `extension/manifest.json` 版本一致，运行测试，生成 `claude-kyc-extension-vX.Y.Z.zip` 和 `SHA256SUMS.txt`，然后发布 GitHub Release。

```sh
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

详见 [docs/RELEASE.md](docs/RELEASE.md)。

## 贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全漏洞按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

[MIT](LICENSE)
