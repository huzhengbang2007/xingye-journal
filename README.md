# 星野记 · Xingye Journal

本地加密的个人日程、大学课表、生活账本与日记。由 HOSHINO TEAM 维护，采用 [Apache-2.0](LICENSE) 开源许可。

[GitHub 源码](https://github.com/huzhengbang2007/xingye-journal) · [问题反馈](https://github.com/huzhengbang2007/xingye-journal/issues) · [隐私声明](https://huzhengbang2007.github.io/xingye-journal/privacy.html)

当前版本 **3.0.0-rc**，属于发布候选。Android 相机、系统锁屏、提醒、组件及机型兼容仍需真实设备验收。最新发布边界见 [发布说明](RELEASE-3.0.0-rc.md)。

## 功能

- 日程与课程表：日历、提醒、ICS / CSV / XLSX 文件导入，先预览再确认。
- 生活账本：账单文件导入、预算、分类统计与月度复盘。
- 加密日记：独立密码二次加密，支持加密备份与恢复。
- 设备配对：Android 离线记录，电脑运行并解锁后扫码确认同步。
- 可选 AI：自备 DeepSeek API Key，逐次确认调用；本地功能无需启用 AI。

Windows 使用 Tauri 原生窗口、Rust 加密引擎和 Node 服务；Android 使用 Java 与随包 WebView 页面。课表通过文件导入，不收集学校账号密码。

## 本地运行

需要 Node.js 22 或更新版本，在项目根目录运行：

```powershell
npm start
```

打开 `http://127.0.0.1:3210`，首次设置至少 10 字符的主密码。源码开发默认运行本机服务；Windows 完整安装包还包含原生窗口及加密引擎。Windows 也可双击 `start.cmd`。保管主密码和加密备份，密码无法找回。

开发检查：

```powershell
npm ci
npm run check
npm run format:check
npm test
```

浏览器检查：安装 Playwright Chromium 后运行 `npm run test:browser`、`npm run test:offline`、`npm run test:appearance`、`npm run test:import`。也可以通过 `CHROME_PATH` 指定现有浏览器。

## 构建与发布

- [Windows / Rust 构建说明](native/README.md)
- [Android 构建与使用](android-companion/README.md)
- [设备连接与同步](CONNECTIONS.md)
- [开源与应用市场发布清单](docs/DISTRIBUTION.md)
- [隐私说明](docs/PRIVACY.md)
- [参与开发](CONTRIBUTING.md) · [安全反馈](SECURITY.md) · [第三方组件与素材](THIRD-PARTY-NOTICES.md)

生成独立的公开源码仓库：`node scripts/prepare-open-source.mjs`；生成最大级别无损压缩包并校验：`python scripts/compress-open-source.py`。结果保存在 `outputs/open-source/`。这些命令不会上传文件。Windows 自签名身份和 Android 长期发布密钥不包含在源码中；贡献者使用自己的签名身份构建，不能覆盖安装官方签名版本。

## 数据与升级

Windows 数据在安装目录 `data/`，配对身份在 `certs/`。更新与卸载入口保留这些目录；直接删除整个安装目录会删除数据。旧调试 Android 与正式签名版本无法覆盖升级，先导出备份再迁移。不要把真实数据、API Key、`.signing/` 或个人文件提交到仓库。

旧版实现记录保存在 [历史文档](docs/history/IMPLEMENTATION-HISTORY.md)，其中的旧版本描述不代表当前发布状态。应用市场下载链接将在实际上架后补充。
