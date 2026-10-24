# 第三方组件与素材

项目自有代码与文档使用 [Apache-2.0](LICENSE)。第三方代码保留原有许可；不得以项目许可证替代上游声明。

| 组件 | 用途 | 许可与保留位置 |
| --- | --- | --- |
| qrcode-generator 1.4.4 | 网页配对二维码 | MIT；完整声明在 `public/QRCODE-LICENSE.txt` |
| Node.js | Windows 内置运行时 | 上游多项许可；完整声明在 `scripts/packaging/NODE-LICENSE.txt`，安装时放入 `runtime/LICENSE.txt` |
| Tauri、Rust crates | 桌面窗口及本地加密 | 版本锁定在 `native/Cargo.lock`；各依赖许可以上游包为准，发布前导出完整依赖声明 |
| ZXing Android Embedded 4.3.0 | Android 扫码 | Apache-2.0；依赖在 `android-companion/app/build.gradle` |
| AndroidX Core 1.13.0 | Android 运行时兼容 | Apache-2.0；其传递依赖声明同样需随正式发行保留 |
| Gradle Wrapper | Android 可重复构建入口 | Apache-2.0；保留 wrapper 原有版权头 |
| Prettier | 开发时格式检查 | MIT；开发依赖，不随应用运行时分发 |
| Playwright Core | 开发时浏览器检查 | Apache-2.0；开发依赖，不随应用运行时分发 |

上表用于定位主要组件，尚不能替代 Android/Rust 全部传递依赖的完整许可报告。未完成报告前，不宣称已经完成所有发行合规检查。

## 图像来源

维护者于 2026-10-24 确认，项目头像、封面及插画来自此前 AI 生成的素材。涉及 `public/assets/`、Android `girl_avatar.png` 和桌面图标衍生版本。项目允许将这些素材随应用使用和分发，不主张对生成内容享有排他权利。第三方商标及潜在第三方权利不因该说明获得授权。

## 测试证书

`tests/fixtures/device-test-only.key` 及对应证书是公开、固定的测试夹具，不是发布身份，不得用于真实设备或生产签名。正式发布密钥保存在被忽略的 `.signing/` 中。
