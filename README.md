# app-assistant

neo App 自动学习脚本 - 基于 UI 自动化的安卓端学习助手。 本助手采用vibe coding，基于 trea + GLM，CC+DeepSeek 和 Codex。

双版本：**Python 版(experimental)**（电脑端控制，USB/WiFi 连接）和 **JavaScript 版(In use)**（手机端独立运行，AutoJS/AutoX）。当前主要维护的是 `neo-auto-learn.js`。

---

## 功能

自动在 neo App（`com.nexgen.nsa`）中模拟用户操作，完成课程学习全流程：

- 识别并关闭弹窗、休息提醒
- 首页自动找到并进入学习模块
- 课时页面自动播放并进入下一课
- 练习页面（选择/判断/口语/填空）自动答题并提交
- 结果页面自动继续下一轮
- 随机延迟模拟真人操作节奏

---

## 目录

```
app-assistant/
├── README.md
├── requirements.txt       # Python 依赖
├── neo-auto-learn.py      # Python 版，电脑端运行
└── neo-auto-learn.js      # JS 版，AutoJS 手机端运行
```

---

## Python 版(experimental)：用法

### 环境准备

```bash
# 1. 安装依赖
pip install -r requirements.txt   # uiautomator2>=3.0.0

# 2. 手机 USB 连接电脑，开启 USB 调试
# 3. 手机上允许此电脑的调试授权
# 4. 首次运行需安装 agent 到手机
python -m uiautomator2 init
```

### 运行

```bash
# USB 连接（自动检测）
python neo-auto-learn.py

# WiFi 连接（指定设备 IP）
python neo-auto-learn.py 192.168.1.100

# 调试模式：打印当前界面控件树，帮助定位问题
python neo-auto-learn.py --debug
```

### 停止

按 `Ctrl+C`，脚本会输出本次运行时长和循环次数。

---

## JavaScript 版(In use)：用法

### 环境准备

1. 手机安装 **AutoJS/AutoX**（或同类自动化框架）
   - AutoX.js GitHub: https://github.com/autox-community/AutoX
   - AutoX.js APK 下载页: https://github.com/autox-community/AutoX/releases
2. 打开无障碍权限
3. 允许悬浮窗权限（脚本会显示停止按钮）
4. 将 `neo-auto-learn.js` 导入 AutoJS/AutoX 运行

### 特性

- 顶部悬浮面板显示运行状态和循环次数
- 点击「停止」按钮随时终止
- 包名不匹配时自动重试启动
- 从任意已知页面开始时，会按当前页面继续下一步

### JS 版当前流程

脚本按状态机识别当前界面，不依赖必须从首页开始：

1. `neo-01` level 页：在 `C1 Bridge`、`C1`、`B2+`、`B2` 中随机选一个。
2. `neo-02` Unit 列表页：在 Unit 1-4 中随机选一个，点击卡片中心。
3. `neo-03` topic 列表页：在前四个 subject 中随机选一个。
4. `neo-04` Step 弹窗：选择 `Step 1 Preview`。
5. `neo-05` Preview 页：点击 `GO`。
6. `neo-06` 继续/退出覆盖层：只点击中部继续/播放按钮，不碰底部循环/Home。
7. `neo-07` 练习页：随机选择 `True/False` 或可见字符串选项。
8. `neo-08` 结果页：点击右侧小房子 Home，回到 level 页开始下一轮。

### JS 版答题规则

- `True/False`：随机点击一个。
- 字符串选项：随机点击一个可见答案卡片。
- 图片选项：随机点击一个可见图片选项。
- 普通单选/多选：随机点击可见选项并尝试提交。
- 完形填空：
  - 连续下划线算一个空，例如 `___` 是 1 个空。
  - `_ word _` 是 2 个空。
  - 有几个空，就在同一次处理循环里按顺序点击前几个选项。
  - 完形填空点击是单击，选项之间留等待时间，避免被识别成双击。

### JS 版防误触策略

- 不在 `MainActivity` 未知状态下随机点底部按钮，避免点到左侧循环按钮。
- 不在通用逻辑里点击 `X/关闭/返回`，避免退出学习流程。
- 左上角 `X/close` 不作为弹窗关闭处理。
- Home 按钮只在结果/完成页处理，优先点击右侧小房子区域。
- 继续按钮只点击明确的“继续”文字或屏幕中部播放按钮，不点击底部候选。

---

## 配置

Python 版 `CONFIG`:

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `APP_PACKAGE` | `com.nexgen.nsa` | 目标应用包名 |
| `APP_NAME` | `neo` | 应用名称 |
| `LOOP_INTERVAL` | 2 秒 | 基础循环间隔 |
| `RANDOM_DELAY_MIN` | 0.8 秒 | 随机延迟下限 |
| `RANDOM_DELAY_MAX` | 2.5 秒 | 随机延迟上限 |
| `MAX_RETRY` | 3 | 失败重试次数 |

JS 版 `CONFIG`:

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `APP_PACKAGE` | `com.nexgen.nsa` | 目标应用包名 |
| `APP_NAME` | `neo` | 应用名称 |
| `TARGET_POINTS` | `6000` | 目标积分，占位配置 |
| `LOOP_INTERVAL` | `2000` | 保留配置，当前主循环主要用页面等待和随机短延迟 |
| `SWIPE_DURATION` | `500` | 滑动时长 |
| `MAX_RETRY` | `3` | 保留配置 |
| `RANDOM_DELAY_MIN` | `5` | 每轮随机延迟下限，毫秒 |
| `RANDOM_DELAY_MAX` | `35` | 每轮随机延迟上限，毫秒 |

---

## 运行逻辑

```
启动 neo → 主循环 ──→ 关闭弹窗 ──→ 识别当前页面
                  │                    │
                  │    ┌───────────────┴───────────────┐
                  │    ▼                               ▼
                  │  首页         课时页       练习页    结果页
                  │  点入口      播放→下页   随机选题    下一课
                  │                                   │
                  └───────────────────────────────────┘
                        循环继续
```

各页面识别依据：

- **首页** — "学习""首页""我的课程"等文本或 `home`/`main` 资源 ID
- **课时页** — "播放""下一课"或 `video`/`player` 资源 ID
- **练习页** — RadioButton/CheckBox 控件或 "选择""答案""提交" 文本
- **结果页** — "完成""得分""正确""恭喜" 文本

JS 版额外识别：

- **Level 页** - `ProMenuActivity/Menu` 且没有 Unit/topic 标记。
- **Unit 列表页** - `Unit 1-4` 或 `Certification Test`。
- **Topic 页** - `Mastery Test`、`Dictations`、`Focus Exercises` 或已知 topic 文本。
- **Step 弹窗** - `BottomSheet` 或 `Select Step + Step 1`。
- **结果页** - 得分文本，或 `neo-08` 这类顶部大数字分数页。

---

## 注意

- 脚本当前**随机选择答案**，不判断正确性，用于帮助点击，解放双手，需要自己答题保证准确率
- 如需智能答题，可后续引入语义分析或 LLM 能力
- 确保手机屏幕常亮、勿锁屏
- 部分华为/小米手机需额外关闭「纯净模式」或开启「后台弹出界面」权限
- AutoJS 的 `click()` 坐标和系统 `input tap` 坐标可能不同；JS 版对关键按钮尽量避免混用坐标系， 推荐AutoX.js
- 如果 neo UI 或屏幕比例变化，优先用截图确认按钮位置，再调整 `neo-auto-learn.js` 中对应的比例坐标。
