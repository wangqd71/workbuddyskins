# 选择器与故障排查

## 稳定选择器策略

优先级从高到低：

1. 语义类名、ARIA、role 和稳定页面根类；
2. CSS Modules 类名前缀，如 `[class*="_topRightSlotStandalone_"]`；
3. DOM 关系和可见文本；
4. 完整哈希类名，仅用于一次性诊断。

WorkBuddy 5.2.5 中已验证的入口包括：

- 首页：`.wb-home-page`、`[class*="_container_pf4c4_"]`；
- 首页宠物槽：`[class*="_topRightSlotStandalone_"]`；
- BuddyCats 图片：`img[src*="BuddyCats"]` 或 `img[src*="xiangsu-miao"]`；
- 活动恢复按钮：`button[aria-label="恢复活动"]`；
- 聊天背景：`.main-content--chat > .chat-container`；
- 右侧产物预览：`.sidebar-next[data-view="artifacts"]`、`.detail-main__body`、`[class*="_mediaPreviewHeader_"]`、`.sc-editor`、`.sc-block-simple_table_cell`；
- 首次准备页：`.workspace-preparing`、`.workspace-preparing__icon`；
- 通用弹窗与设置：语义根类加 `[role="dialog"]`。

版本升级后必须重新审计，不要认为这些选择器永久稳定。

## 右侧产物预览断层

症状：详情面板外框已经套用主题，但 Markdown/Word 预览仍显示原生纯黑或纯白背景，顶部标签、文件标题或表格颜色也与主界面脱节。

处理：

1. 以 `.sidebar-next[data-view="artifacts"]` 为作用域，避免影响概览、项目等其他详情页；
2. 分层检查 `.detail-main__body`、`[class*="_mediaPreviewHeader_"]`、`.sc-editor` 和 `.sc-block-simple_table_cell` 的计算背景；
3. 不只覆盖外层 `.detail-panel-container`，编辑器和表格通常包含自己的不透明背景；
4. 为深色和浅色分别定义标签、标题、操作按钮、正文、引用、代码和表格颜色；
5. 对正文容器保持 `filter: none`、`text-shadow: none`，避免长文和表格字体发虚；
6. 在实际产物页截图，并确认 `.sc-editor` 的可见宽度大于零后再判定验证通过。

## 字体模糊

症状：侧栏任务标题、时间或正文整体发虚。

排查：

- 查找父容器上的 `filter`、`transform: scale(...)`、非整数平移、`backdrop-filter` 和低透明度；
- 不要对包含文字的容器使用模糊或亮度滤镜；
- 把光效移到绝对定位伪元素；
- 让正文层保持独立 z-index 和正常合成；
- 在 100% 与系统缩放下重新截图。

## 按钮遮挡

症状：装饰标签、角色或徽章覆盖窗口按钮、输入器或角色脸部。

处理：

- 先记录装饰槽和按钮的 `getBoundingClientRect()`；
- 不要随意给已绝对定位的槽增加 `position: relative`，它可能改变包含块并拉伸槽宽；
- 让人物伪元素 `pointer-events: none`；
- 保留按钮功能，可把视觉隐藏并将热区移动到人物外缘；
- 在原窗口尺寸和窄窗口分别检查。

## 动画不显示

逐项检查：

1. `getComputedStyle(document.documentElement).getPropertyValue('--asset-var')` 是否非空；
2. MIME 是否与图片格式一致；
3. Data URI 是否过大。约 5.7 MiB 的单个动画可能被 Chromium 丢弃；将原始文件压到约 1.5 MiB 以下并重新验证；
4. 动画 WebP 是否含 RGBA、多个帧和循环标记；
5. CSS 是否使用 `background-size: contain`、正确位置和可见尺寸；
6. 守护注入器是否已重启并读取新文件。

## 人物乱跳或漂移

不要只按图片画布对齐，也不要只使用单脚中心：单脚抬起会让锚点变化。

对每一帧：

1. 从 alpha 通道取得非透明轮廓；
2. 计算轮廓左右边界中点；
3. 计算轮廓最低点；
4. 整数平移到统一中心和统一最低点；
5. 插帧后再次执行同样对齐；
6. 用所有解码帧统计中心跨度和底部跨度。目标通常为中心不超过 1–2 像素、底部为 0–1 像素。

## 动画过快或“鬼畜”

- 减少关键动作，而不是盲目增加姿势；
- 使用站立、左摆、回正、右摆四步循环；
- 使用 smoothstep 缓动；
- 让循环保持约 3–4 秒；
- 小角色避免跳跃、大幅挥手和连续改变面部朝向。

## 减少动态效果

动画图片本身无法用 CSS `animation: none` 停止。额外注入静态 PNG 变量，在 `@media (prefers-reduced-motion: reduce)` 中切换 `background-image`，并设置静态 sprite 的尺寸和首帧位置。
