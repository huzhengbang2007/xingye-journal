# 开源与应用市场发布清单

核对日期：2026-10-24。本文记录发布资料与验收缺项；尚未提交应用市场审核，未上架。

## GitHub

- GitHub 目标：[huzhengbang2007/xingye-journal](https://github.com/huzhengbang2007/xingye-journal)，公开仓库。
- 只推送独立整理后的源码仓库，避免带入旧历史中的个人信息和构建产物。原开发仓库不改写历史。
- 许可证：Apache-2.0。源码包含 LICENSE、NOTICE、第三方声明、贡献指南和隐私说明。
- 独立源码目录及 `.zip`、`.tar.xz`、SHA-256 清单由 `node scripts/prepare-open-source.mjs` 生成到 `outputs/open-source/`；脚本不会创建远程仓库或上传文件。
- 支持入口为仓库 Issues；[隐私声明网页](https://huzhengbang2007.github.io/xingye-journal/privacy.html) 已公开。
- 安装包仍为 RC，只可作为预发布。Windows installer revision 2 支持 `/quiet /norestart`，文件名以 `-setup-r2.exe` 结尾；原向导版安装包保持原样。新版的本地验收记录随 `INSTALLER-VERIFICATION.json` 保存，参数和返回码见 [安装器说明](INSTALLER.md)。Android 最新修复仍在 `releases/3.0.0-rc/android-scanner-fix/`。
- r2 安装包从干净源码提交构建，原生程序复用既有 3.0.0-rc 二进制并重新签名；不是本轮重新编译 Rust。构建提交和文件哈希以各包的签名 BUILD-INFO 为准。旧安装包的历史源码对应关系不随此次变更改写。

## 推荐首批渠道

| 渠道 | 当前可准备内容 | 提交前缺项 |
| --- | --- | --- |
| Microsoft Store（Windows） | 开发者账号已注册；中文介绍、公开隐私声明、静默安装器及返回码文档已准备 | 当前 EXE 仍是自签名；正式 EXE 上架需可信 CA 发行签名。MSIX 可由商店签名，但尚缺后台产品标识及数据目录迁移实现与验证 |
| F-Droid（Android） | Apache 许可、源码构建入口、中英文 fastlane 描述 | 公开源码 URL、版本 tag、完整自由依赖审查、构建配方验证、图标截图；可选 DeepSeek 服务由审核方判断是否需要 NonFreeNet 标记 |
| 酷安（Android） | 中文文案、包名、权限说明、隐私资料、RC APK 定位 | 开发者登录、当前平台准入核验、支持和隐私网址、实机截图、正式版本验收及平台要求的主体材料 |

这里的“准备”不代表市场已经受理。开发者身份、协议、费用及审核声明必须由真实主体完成，不能代填未知信息。

Microsoft 官方 EXE/MSI 要求：安装器及其所有 PE 文件链到 Microsoft 信任根中的 CA，提供固定版本 HTTPS 下载直链，支持静默安装。MSIX 可由商店托管和签名，但必须另外实现和验证打包、身份与数据迁移。

F-Droid 从公开自由源码构建，要求自由依赖及对应版本 tag。现有强制 HOSHINO TEAM 签名的 PowerShell 发行脚本不是 F-Droid 构建入口；审核应使用 Gradle 的 unsigned release 路径，由 F-Droid 签名。

酷安开发者门户本轮无法从公开访问工具读取，未据此声称当前准入要求已核实。

## 上架文案（中文）

名称：星野记

一句话介绍：本地加密的日程、大学课表与生活账本，支持扫码配对电脑和手机。

完整介绍：星野记把个人日程、课程表、记账和日记放在自己的设备里。支持 ICS、CSV、XLSX 导入与预览，提供日程提醒、每周课表、预算统计和月度复盘。日记使用独立密码加密，用户可导出加密备份。电脑与 Android 设备经扫码确认后同步；电脑关闭或锁定时仍可在手机离线记录。可选 DeepSeek 规划与复盘需要用户自备 API Key 并逐次确认，不启用 AI 也可使用本地功能。当前 3.0.0-rc 为发布候选版本，手机系统相机、锁屏、提醒及桌面组件仍需真实设备验收。

关键词：日程、课程表、记账、日记、本地加密、离线、备份。

## 截图与正式发布门槛

已用独立的示例保险库拍摄四张当前网页移动布局预览，保存在 `fastlane/metadata/android/en-US/images/phoneScreenshots/`，包含概览、日程、账本、锁定的日记，分辨率 864×1728；同时提供图标。这些是浏览器渲染预览，不能冒充 Android 实机截图。正式市场截图仍需验证平台要求并补拍实机画面。可运行 `node scripts/store-screenshots.mjs` 重新生成。不得使用真实账单、二维码配对凭证、日记、API Key 或未核实的旧版截图。`artifacts/` 中其他截图属于验证材料。

正式提交前完成：Android 实机扫码和锁屏、权限拒绝、日历提醒、组件、省电；Windows 安装、覆盖升级、卸载保留数据；同步冲突、备份恢复；全部第三方传递依赖许可声明；公开联系方式、隐私 URL、年龄分级和平台数据安全表单。

## 官方参考

- [Microsoft Store EXE/MSI 安装包要求](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements)
- [F-Droid 提交指南](https://f-droid.org/docs/Submitting_to_F-Droid_Quick_Start_Guide/)
- [F-Droid 收录政策](https://f-droid.org/docs/Inclusion_Policy/)
- [酷安开发者门户](https://developer.coolapk.com/)
