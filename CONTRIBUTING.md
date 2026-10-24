# 参与开发

需要 Node.js 22 或更新版本。先执行 `npm ci`，然后执行 `npm run check`、`npm run format:check` 和 `npm test`。浏览器检查需要 Playwright Chromium，或通过 `CHROME_PATH` 指定本机 Chrome/Edge。

运行 `npm start`，打开 `http://127.0.0.1:3210`。开发测试请设置独立的 `DATA_DIR`，不要使用自己的真实保险库。Rust 和 Android 构建分别参考 `native/README.md`、`android-companion/README.md`。

提交应说明触发问题、最终行为及验证结果。修改同步、备份、删除或加密逻辑时，需要覆盖冲突、失败及旧数据迁移。未经实机验证的功能请明确保留验证边界。

请勿提交个人账单、日记、账号、真实保险库、API Key、签名私钥或开发机器路径。公开测试密钥仅限 `tests/fixtures/device-test-only.key`。

提交贡献即表示你有权提供该贡献，并同意按本项目 Apache-2.0 许可分发。
