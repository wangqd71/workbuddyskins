# WorkBuddy 皮肤开发流程

## 1. 基线与授权边界

- 将用户要求分成：页面覆盖、视觉素材、交互保留、动画、发布与文档。
- 默认只修改用户指定的皮肤项目和本机 WorkBuddy 进程。
- 允许读取安装位置和版本；禁止改写 `WorkBuddy.exe`、`resources/app.asar`、账号数据和聊天记录。
- 记录当前外观模式、窗口尺寸、页面和已有版本，保留用户未发送的输入。

## 2. 启动与审计

使用仅监听回环地址的调试参数启动 WorkBuddy：

```powershell
WorkBuddy.exe --remote-debugging-address=127.0.0.1 --remote-debugging-port=9345
```

先枚举 `http://127.0.0.1:9345/json/list`，选择 WorkBuddy 主页面 target。使用审计脚本：

```powershell
node scripts/audit-workbuddy.mjs --port 9345 --action snapshot --out audit/home.json
node scripts/audit-workbuddy.mjs --port 9345 --action computed --selector '.target'
node scripts/audit-workbuddy.mjs --port 9345 --action screenshot --out audit/home.png
```

审计每个主要页面的：根容器、背景容器、主要表面、文本、输入器、按钮、弹窗、iframe、等待态和活动态。页面切换后重新审计；不要把一次页面的哈希类名假设为全局稳定。

## 3. 注入器结构

推荐结构：

```text
project/
├── assets/theme/theme.css
├── assets/theme/*.png|jpg|webp
├── scripts/injector.mjs
├── scripts/controller.ps1
├── tests/run-tests.ps1
├── README.md
├── 使用说明.txt
├── 版本信息.txt
└── build-release.ps1
```

注入器应当：

1. 读取本地 CSS 与图片并转换为正确 MIME 的 Data URI。
2. 在根元素写入皮肤标记与外观标记。
3. 使用固定 style id，重复应用时替换而不是叠加。
4. 观察路由、DOM、iframe 和深浅色变化并重新应用。
5. 提供 `--watch`、`--verify`、`--remove`。
6. 退出或恢复时停止守护进程并清除皮肤偏好。

MIME 至少处理：`.png -> image/png`、`.jpg/.jpeg -> image/jpeg`、`.webp -> image/webp`。

## 4. CSS 设计

- 所有规则以 `html[data-workbuddy-skin="..."]` 开头。
- 使用变量集中管理背景、主色、表面、线条、正文和弱化文字。
- 通过 `data-workbuddy-color-mode="dark|light"` 明确覆盖深浅色。
- 背景使用伪元素和渐变遮罩保护正文可读性。
- 装饰层默认 `pointer-events: none`。
- 对原按钮只改变视觉或移动热区；不要删除其点击逻辑。
- 同源 iframe 继承主题；跨域 iframe 接受浏览器安全边界。

## 5. 动画

小型 UI 角色优先采用：

- 3–4 个简单关键动作；
- 3–4 秒一个循环；
- 缓入缓出插帧；
- 透明 WebP；
- 轮廓中心与最低点逐帧对齐；
- 静态 PNG 作为减少动态效果降级。

示例：

```powershell
python scripts/build-anchored-animation.py `
  --input assets/theme/sprite.png `
  --output assets/theme/mascot.webp `
  --columns 4 --rows 2 --sequence 0,1,3,4 `
  --inbetweens 11 --duration 70 --width 320 --quality 76
```

在实际页面中间隔四分之一周期截图。除姿态外，角色中心和地面基线应保持稳定。

## 6. 验证矩阵

至少检查：

| 范围 | 检查项 |
|---|---|
| 结构 | 注入标记、style、装饰层、主导航、当前页面 |
| 外观 | 深色、浅色、页面跳转和重启保留 |
| 文本 | 无模糊、正文和时间信息对比度足够 |
| 控件 | 搜索、分享、历史、发送、活动按钮无覆盖 |
| 动画 | 可见、循环、位置锁定、结束态隐藏 |
| 无障碍 | 减少动态效果显示静态首帧 |
| 响应式 | 窄窗口隐藏或缩小人物，不遮正文 |
| 安全 | 仅回环 CDP、不修改安装包、可恢复 |

## 7. 发布

更新版本号和变更说明，运行测试和发布脚本，验证 ZIP 必需文件、禁止文件和 SHA256。重新应用皮肤，确认守护进程使用新资源而不是只在当前页面临时注入。
