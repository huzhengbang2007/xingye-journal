# 项目目录与清理记录

整理日期：2026-10-24。

| 目录 | 用途 | 是否公开 |
| --- | --- | --- |
| `public/`、`lib/`、`server.mjs` | 界面与服务 | 是 |
| `native/` | Rust 引擎和 Windows 桌面壳 | 是，不含 target 构建缓存 |
| `android-companion/` | Android 源码及 Gradle Wrapper | 是，不含构建结果和本机签名 |
| `scripts/`、`tests/`、`examples/` | 构建、校验与示例 | 是；测试密钥标明仅供测试 |
| `docs/`、`fastlane/` | 隐私、发布资料与市场文案 | 是 |
| `data/`、`certs/`、`.signing/` | 用户数据、设备身份、长期签名私钥 | 否，保留本地 |
| `releases/3.0.0-rc/` | 当前签名候选安装包及验收记录 | 不进入源码；经筛选作为 Release 附件 |
| `archives/` | 已退役版本的本地压缩归档 | 否 |
| `tmp/`、`.tooling/`、`node_modules/` | 历史复核材料、开发环境与依赖 | 否 |
| `outputs/open-source/` | 独立公开源码仓库与压缩包 | 不进入开发仓库；单独推送其源码 |

## 本轮清理

旧版本 2.2.0–2.5.0 共 183 个文件、1,033,830,526 字节，以 LZMA2 preset 9 extreme 无损压缩为 `archives/legacy-releases-2.2-to-2.5.tar.xz`，大小 476,418,680 字节。校验全部文件 SHA-256 与压缩前内容一致后，删除这五个版本的原目录；归档 JSON 保留恢复路径和文件摘要。

移除 `native/target/debug` 及 release 下的 build、deps、.fingerprint、incremental 可重建缓存，共 2,542,897,755 字节。保留 release 可执行程序及调试符号；下一次 Rust 构建会重新生成依赖缓存。

合计释放 3,100,309,601 字节，约 3.10 GB。`tmp/` 与 `.tooling/` 仍包含历史复核副本和工具链，本轮未整体删除；数据、私钥和原开发仓库历史保持原状。

压缩使用当前工具支持的最高级别，不宣称数学意义上的最小体积。签名 EXE/APK 不做内容改写或二次封装，以保留有效签名。源码同时提供兼容性好的 DEFLATE 9 ZIP 与体积更小的 LZMA2 extreme TAR.XZ，并逐文件校验。
