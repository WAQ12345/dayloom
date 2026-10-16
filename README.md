<p align="center"><img src="assets/icon.png" width="112" alt="Dayloom icon"></p>
<h1 align="center">Dayloom</h1>
<p align="center">A local-first life organizer with AI on your terms.</p>
<p align="center">把日常留在本地，把 AI 留给你的选择。</p>

Dayloom 是一个 Android 个人生活记录工具：饮食、计划、想法和生活资料，存放在自己的手机里。无需账号、没有自建后端或云同步。界面目前以中文为主。

## 能做什么

- **饮食与饮水**：手填热量、代谢与活动消耗、每日净差和月历。
- **计划与想法**：今日计划、同档拖动排序、常用模板；独立想法支持置顶、归档和导出。
- **生活资料**：物品、购物清单、会员、固定支出，以及文字／链接／账号收藏。
- **按需 AI**：自备 DeepSeek Key，选择资料、预览、确认后才发送。饮食分析、想法整理和八字解读分别授权。
- **离线工具**：八字排盘、PDF／Markdown 文档导出和含用户照片的 ZIP 备份恢复。

本地优先不代表所有操作都离线：主动 AI 请求会把预览中的资料发给 DeepSeek；点击收藏链接会打开浏览器。相机、通知和文件访问按功能申请权限。

## 开发与构建

技术：Expo 57、React Native 0.86、TypeScript、SQLite。依赖版本以 package-lock.json 为准，不要直接升级主要版本。

准备 Node.js 22.13+（22.x）、npm 10、Python 3、JDK 17 和 Android SDK 36／Build Tools 36.0.0／NDK 27.1；设置 JAVA_HOME 与 ANDROID_HOME，确保 node、npm、python3 在 PATH 中。当前发布脚本面向 macOS/Linux shell，Android 优先；iOS 与 Web 未交付验收。

```sh
nvm use # 或自行准备 .nvmrc 指定的 Node 22
npm ci
npm run typecheck
npm run lint
npm test
npm run build:android
```

产物：`artifacts/release/dayloom.apk`。首次构建会在忽略目录 `artifacts/signing/` 创建自己的签名，并在 `artifacts/signing-backup/` 留副本；请另行安全备份，后续覆盖升级必须使用同一签名。仓库不包含作者签名和 API Key。

可选覆盖：`DAILY_NODE_DIR`、`DAILY_JAVA_HOME`、`DAILY_ANDROID_HOME`；需要代理时设置 `DAILY_HTTP_PROXY_PORT`。独立验收包使用 `DAYLOOM_ISOLATED_QA=1 npm run build:android`。正常包名 `app.dayloom.mobile`，验收包追加 `.qa`，均与原私人版分开。

## 数据与边界

- 数据保存在本机，卸载可能丢失；请使用应用内 ZIP 备份。PDF/Markdown 不能恢复数据库。
- **账号收藏目前未加密，ZIP 备份也包含明文账号资料。** 它不是密码管理器。DeepSeek Key 单独保存在 SecureStore，不进入普通备份。
- 饮食与每日计划仅当天可修改；想法、模板和生活资料跨天保留。
- 净差＝摄入－总消耗；总消耗＝基础代谢＋活动消耗。负值表示净消耗，正值表示净摄入。
- AI 输出不自动改写记录或生成任务。照片分析依赖供应商能力，手填始终可用。
- 八字仅作传统文化参考，计算范围与局限见 [引擎说明](src/domain/bazi/README.md)。

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交前请运行 `npm run typecheck`、`npm run lint` 和 `npm test`。

## 许可与致谢

项目代码采用 [MIT](LICENSE)，第三方代码、数据、品牌标志与素材遵循各自声明，见 [第三方说明](THIRD_PARTY_NOTICES.md)。Dayloom 尚未进行商标或同名项目核查；本仓库不表示获得第三方品牌背书。
