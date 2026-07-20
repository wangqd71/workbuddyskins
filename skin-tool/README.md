# WorkBuddy 换肤工具

这是一个不修改 WorkBuddy 安装包的外部换肤器。主题为「初音未来 / MIKU MODE 01」，v1.8.2 已按本机 WorkBuddy 5.2.5 完成全页面及深色/浅色双模式适配：包含首页、侧栏、任务会话、项目、专家/技能/连接器、自动化、本地助理、用户菜单、设置弹窗和常见浮层，并为新建任务页与聊天区配置互不重复的专用背景。任务执行时，聊天背景右侧会自动播放中心与地面基线锁定的慢速 Q 版轻摆动作；首次任务的“正在准备执行”页会显示独立的初音舞台动画；新建任务输入器右上角的 BuddyCats 机器人也会替换为本地 Q 版初音角色。

完整图文说明见 `WorkBuddy初音换肤工具_使用手册_v1.2.docx`；聊天中快速转发可使用 `使用说明.txt`。

## 使用

1. 解压整个压缩包，不要只拖出其中一个文件。
2. 双击 `打开换肤工具.cmd`。
3. 点击「应用初音皮肤」。如果 WorkBuddy 正在运行，工具会先提示再重启。
4. 想回到原界面时，点击「恢复原始界面」。

「检查皮肤」会验证注入标记、侧栏和当前页面，并把当前效果保存为 `workbuddy-miku-preview.png`。

## 深色 / 浅色模式

- 打开 WorkBuddy 左下角用户菜单，在「外观」中选择「浅色」或「深色」。
- 皮肤会跟随你的选择切换，不需要重新运行换肤工具。
- 选择会在页面跳转、自动化页面和应用重启后保留。
- 点击「恢复原始界面」时，皮肤自己的外观偏好也会一并清除。

## v1.8.2 全页面覆盖

- 项目页：标题区、搜索框、项目卡片和模板卡片。
- 专家中心：顶部标签、精选场景、分类标签、专家卡片和召唤按钮。
- 自动化：标签切换、搜索、操作按钮、任务分组和任务行。
- 任务与本地助理：消息内容、代码块、产物卡片、输入器、详情侧栏。
- 聊天人物背景：深色和浅色使用各自素材，人物固定在右侧，并用渐变遮罩保护正文可读性。
- 新建任务背景：使用无人物的未来音乐城市/展台场景，与任务聊天页立绘区分；深色和浅色分别适配。
- 执行中动画：检测任务的执行中、生成中、停止按钮及忙碌状态；运行时播放原创八帧轻摆动作，结束后自动隐藏。
- 准备执行舞台：用八帧初音舞蹈替换中央机器人，增加音符、舞台光圈、青粉进度条和深浅色背景。
- 首页宠物槽：将远程 BuddyCats 小机器人替换为本地 48 帧 Q 版轻摆；一轮约 3.36 秒，人物透明轮廓中心和地面基线逐帧锁定，隐藏脸部音符徽章并保留活动恢复热区。
- 动效无障碍：系统启用“减少动态效果”时停在静态首帧；窄窗口自动隐藏，避免遮挡正文和输入器。
- 全局浮层：用户菜单、设置、下拉菜单、弹窗、提示与更新通知。
- 双模式：深色与浅色分别适配背景、正文、任务列表、表单、弹窗和菜单对比度。
- 同源 iframe 会自动继承主题；受浏览器安全限制的跨域 iframe 保持原样。

## 原理与边界

- 通过仅监听 `127.0.0.1` 的 Chromium DevTools Protocol 注入 CSS。
- 不修改 `WorkBuddy.exe`、`resources/app.asar`、账号数据或聊天记录。
- 皮肤运行时会有一个隐藏的 Node.js 注入进程；恢复原界面后会停止。
- 不要求额外安装 Node.js：如果系统没有 Node.js 22，工具会从本机 WorkBuddy 安装目录提取它自带的运行时。
- WorkBuddy 更新后如果页面类名变化，可在 `assets/miku/theme.css` 中继续适配。
- CDP 本身没有同一 Windows 用户内的访问认证。启用皮肤时，只运行你信任的本机软件；不用时可恢复原界面以关闭调试端口。

## 命令行

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\workbuddy-skin.ps1 -Action Apply -RestartExisting
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\workbuddy-skin.ps1 -Action Verify -ScreenshotPath .\workbuddy-miku-preview.png
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\workbuddy-skin.ps1 -Action Restore
```

## 测试

```powershell
powershell -NoProfile -File .\tests\run-tests.ps1
```

## 角色与动作素材说明

- 执行动画是为本工具重新生成并透明化的八帧素材，不包含或修改第三方 GIF。
- 动作调研参考了 [Nim-Ations 的 “Miku vibing”](https://www.newgrounds.com/art/view/nim-ations/miku-vibing) 所采用的轻摆节奏；该页面原文件为 CC BY-NC-ND 3.0，因此没有放入发布包。
- 初音未来角色二次创作请遵守 [ピアプロ角色使用指南](https://piapro.jp/license/character_guideline)。本工具定位为朋友间非商业本地体验；公开发布或商业使用前应重新核对角色、参考图与生成素材的授权。
