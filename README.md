# app-assistant

neo App 自动学习脚本 —— 基于 UI 自动化的安卓端学习助手。

双版本：**Python 版**（电脑端控制，USB/WiFi 连接）和 **JavaScript 版**（手机端独立运行，AutoJS）。

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

## Python 版：用法

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

## JavaScript 版：用法

### 环境准备

1. 手机安装 **AutoJS**（或同类自动化框架）
2. 将 `neo-auto-learn.js` 导入 AutoJS 运行

### 特性

- 顶部悬浮面板显示运行状态和循环次数
- 点击「停止」按钮随时终止
- 包名不匹配时自动重试启动

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

---

## 注意

- 脚本当前**随机选择答案**，不判断正确性，用于刷完成量
- 如需智能答题，可后续引入语义分析或 LLM 能力
- 确保手机屏幕常亮、勿锁屏
- 部分华为/小米手机需额外关闭「纯净模式」或开启「后台弹出界面」权限
