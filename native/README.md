# 3.0.0-rc 原生桌面

原生桌面与 Rust 加密引擎已纳入标准 Windows 签名安装包。启动器内嵌发布公钥，先验证官方 Node 哈希、签名清单与载荷，再启动本机服务；服务异常退出会显示提示并保留诊断日志。scripts/build-native.ps1 完成 Rust 构建后调用标准签名打包流程。以下为早期迁移记录。

# Rust 原生迁移预览（2.4.0）

已迁移两层：RustCrypto 加密引擎、Tauri Windows 原生窗口。日程 API、导入、规划、同步及持久化调度仍运行于现有 Node 兼容服务；Android 仍为 Java + 本机 WebView。此版本不是全量 Rust 重写，也没有因此获得独立安全审计结论。

## 2.4 新增

- 女生头像作为原生程序图标；每日课表可打开独立小窗口，主应用关闭后只要课表窗口仍在，服务会继续运行。
- 页面使用渐变背景、横向切换动画、固定平板胶囊栏；移动端关闭缩放；时区标签明确为北京时间。
- Android 支持每日课表桌面小组件，需主动开启。缓存由 Android Keystore 加密，锁定主应用后仍可用于桌面展示；不包含日记或账单。桌面系统决定实际刷新时机。

## 已实现

- `vault`：禁止应用自身 unsafe 代码；使用现成 AES-256-GCM、scrypt、PBKDF2 库，保持 v1 电脑保险库和 v2 手机备份兼容。关键输入缓冲在释放时擦除；Node 内存、JSON 中间对象、第三方库内部副本没有完全清零保证。
- `desktop`：自定义可拖动标题栏、窗口控制、实际 Windows Acrylic 桌面背景合成；跟随页面深浅色调整原生着色。没有截取或上传桌面图片。系统关闭透明效果或不支持时使用页面材质降级；不是光学折射模拟。
- 原生壳只启动随包 Node、固定脚本和 Rust 引擎。只连接自己启动的服务，从子进程标准输出读取已绑定端口；网页原生权限仅限当前来源的窗口控制。教务与 DeepSeek 密钥管理 HTTPS 链接交给系统浏览器，其余外部窗口不加载。
- 密码和加密密钥经标准输入传入 Rust 引擎，不放在启动参数或临时明文文件中。引擎明确配置后失败会中止操作，不静默回退。
- 相同实际数据目录只允许一个写入服务（包括原生壳与旧启动器）。通过操作系统释放的本机端口租约防止双开覆盖；保护端口碰撞时拒绝启动。原生页面使用按目录稳定分配的端口，保留本机外观偏好。
- 关闭原生壳会停止自己启动的服务；父进程崩溃时标准输入断开也会停止服务。

## 编译与验证

需要 Rust stable、Windows MSVC C++ 工具、WebView2 运行时和 Node 22+。项目根执行：

```powershell
cargo test --manifest-path native/Cargo.toml -p xingye-vault --locked
cargo build --manifest-path native/Cargo.toml --workspace --release --locked
$env:XINGYE_TEST_VAULT_HELPER = (Resolve-Path native/target/release/xingye-vault.exe).Path
node --test tests/native-vault.test.mjs
```

`scripts/build-native.ps1` 会执行验证并生成独立、带版本号的便携预览目录，包括原生程序、Rust 加密引擎、兼容服务、Node 和页面。不会覆盖旧包，也不会复制真实数据、证书或密钥。目录内双击 `xingye-desktop.exe` 运行；所有文件需一起保留。

如需在开发时打开原生窗口，先构建两个 debug 程序，设置 `XINGYE_NODE` 为 node.exe 绝对路径，再执行 `cargo run --manifest-path native/Cargo.toml -p xingye-desktop`。`--check-window` 仅用于创建隐藏窗口检查，必须指定独立的 `DATA_DIR`。

## 使用边界与迁移

1. 便携预览默认使用包内新建的 `data`，不会自动打开工程或已安装版本的数据。使用旧记录前，先在旧版本导出加密备份，再在新版本恢复。不要删除原始 data 或覆盖唯一备份。
2. 原生预览的网页界面仍只监听本机；同一随包 Node 服务已提供独立设备配对通道，可通过「连接设备」扫码连接手机和平板。身份准备与服务退出跟随该服务生命周期；原生壳的实际窗口操作仍需单独实机检查。
3. Android 只提供应用内玻璃材质、主题、安全区域和标准日历/闹钟/设置入口；没有实现手机桌面壁纸实时映射、HyperOS 私有互联协议或任意跨应用内容反射。
4. 引擎将加密前 JSON 限制为 32 MiB，标准输入输出限制为 64 MiB。已有超大保险库应继续使用旧引擎；测试只使用合成数据。
5. 尚未对用户设备进行视觉、性能、缩放手势、证书安装或小米后台提醒实测；预览程序未进行商业代码签名。

后续全量迁移按协议逐层替换：先把会话认证、持久化写入、版本冲突与同步 API 移入 Rust 服务，保留现有测试作为兼容门禁；再替换导入、规划与报告。任何库格式或 KDF 调整都需要独立版本、旧备份恢复和回滚验证，不通过直接改扩展名或删除旧库完成迁移。

原生效果与能力边界参考：[Tauri 窗口配置](https://v2.tauri.app/reference/config/)、[Tauri 权限能力](https://v2.tauri.app/reference/acl/capability/)、[Android 跨窗口模糊](https://source.android.com/docs/core/display/window-blurs)。
