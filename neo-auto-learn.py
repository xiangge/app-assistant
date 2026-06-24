import uiautomator2 as u2
import time
import random
import sys


CONFIG = {
    "APP_PACKAGE": "com.nexgen.nsa",
    "APP_NAME": "neo",
    "LOOP_INTERVAL": 2,
    "MAX_RETRY": 3,
    "RANDOM_DELAY_MIN": 0.8,
    "RANDOM_DELAY_MAX": 2.5,
}

state = {
    "loop_count": 0,
    "start_time": time.time(),
    "is_running": True,
}


def main():
    print("=" * 50)
    print("neo 自动学习脚本 (电脑端)")
    print("=" * 50)

    d = connect_device()
    if not d:
        return

    print(f"设备信息: {d.info}")
    print(f"屏幕分辨率: {d.window_size()}")

    launch_neo_app(d)

    print("\n脚本开始运行，按 Ctrl+C 停止\n")

    try:
        while state["is_running"]:
            state["loop_count"] += 1
            try:
                handle_current_screen(d)
                random_sleep()
            except Exception as e:
                print(f"主循环异常: {e}")
                time.sleep(3)
                recover_from_error(d)
    except KeyboardInterrupt:
        print("\n用户手动停止脚本")

    elapsed = int((time.time() - state["start_time"]) / 60)
    print(f"脚本已停止，运行 {elapsed} 分钟，循环 {state['loop_count']} 次")


def connect_device():
    if len(sys.argv) > 1:
        device_addr = sys.argv[1]
        print(f"连接设备: {device_addr}")
    else:
        print("自动检测 USB 连接的设备...")

    try:
        d = u2.connect() if len(sys.argv) <= 1 else u2.connect(sys.argv[1])
        if d.info:
            print("设备连接成功!")
            return d
    except Exception as e:
        print(f"连接失败: {e}")
        print("\n请确认:")
        print("  1. 手机已通过 USB 连接电脑")
        print("  2. 手机已开启 USB 调试")
        print("  3. 手机上已允许此电脑的调试授权")
        print("  4. 电脑已安装 adb (brew install android-platform-tools)")
        return None


def launch_neo_app(d):
    print("启动 neo 应用...")
    d.app_start(CONFIG["APP_PACKAGE"])
    time.sleep(5)

    current = d.app_current()
    if current.get("package") == CONFIG["APP_PACKAGE"]:
        print("neo 已启动")
    else:
        print("启动失败，尝试再次启动...")
        d.app_start(CONFIG["APP_PACKAGE"])
        time.sleep(5)


def handle_current_screen(d):
    dismiss_popups(d)

    if is_on_home_page(d):
        enter_learning_module(d)
    elif is_on_lesson_page(d):
        handle_lesson_interaction(d)
    elif is_on_exercise_page(d):
        handle_exercise(d)
    elif is_on_result_page(d):
        handle_result_page(d)
    elif is_on_menu_page(d):
        handle_menu_page(d)
    else:
        handle_generic_screen(d)


def dismiss_popups(d):
    close_texts = ["关闭", "确定", "知道了", "以后再说", "跳过", "暂不升级", "不再提醒", "取消"]
    for txt in close_texts:
        btn = d(text=txt)
        if btn.exists(timeout=0.3):
            btn.click()
            print(f"  关闭弹窗: {txt}")
            time.sleep(0.5)

    if d(textContains="休息一下").exists(timeout=0.5):
        continue_btn = d(text="继续学习")
        if continue_btn.exists(timeout=0.5):
            continue_btn.click()
            print("  关闭休息提醒")
            time.sleep(1)


def is_on_home_page(d):
    return (d(textContains="学习").exists(timeout=0.5)
            or d(textContains="首页").exists(timeout=0.5)
            or d(textContains="我的课程").exists(timeout=0.5)
            or d(resourceIdMatches=".*home.*").exists(timeout=0.5)
            or d(resourceIdMatches=".*main.*").exists(timeout=0.5))


def enter_learning_module(d):
    print("[首页] 尝试进入学习模块")

    entry_texts = ["继续学习", "开始学习", "AI练习", "自主练习", "我的课程", "课件"]
    for txt in entry_texts:
        btn = d(textContains=txt)
        if btn.exists(timeout=1):
            btn.click()
            print(f"  点击入口: {txt}")
            time.sleep(2)
            return

    course = d(className="android.widget.ImageView").clickable(True)
    if course.exists(timeout=1):
        course.click()
        print("  点击课程项")
        time.sleep(2)
        return

    print("  未找到入口，尝试滑动")
    swipe_up(d)
    time.sleep(2)


def is_on_lesson_page(d):
    return (d(textContains="课时").exists(timeout=0.5)
            or d(textContains="播放").exists(timeout=0.5)
            or d(textContains="下一课").exists(timeout=0.5)
            or d(resourceIdMatches=".*video.*").exists(timeout=0.5)
            or d(resourceIdMatches=".*player.*").exists(timeout=0.5))


def handle_lesson_interaction(d):
    print("[课时页] 处理课时交互")

    try_auto_play(d)

    next_texts = ["下一课", "下一步", "下一题", "下一个"]
    for txt in next_texts:
        btn = d(textContains=txt)
        if btn.exists(timeout=0.5):
            btn.click()
            print(f"  点击: {txt}")
            time.sleep(1.5)
            return

    if d(textContains="暂停").exists(timeout=0.5):
        print("  视频播放中，等待...")
        time.sleep(5)
        return

    swipe_up(d)
    time.sleep(1.5)


def try_auto_play(d):
    play_btn = d(textContains="播放")
    if play_btn.exists(timeout=0.5):
        if not d(textContains="暂停").exists(timeout=0.3):
            play_btn.click()
            print("  点击播放")
            time.sleep(1)


def is_on_exercise_page(d):
    return (d(textContains="选择").exists(timeout=0.5)
            or d(textContains="答案").exists(timeout=0.5)
            or d(textContains="提交").exists(timeout=0.5)
            or d(className="android.widget.RadioButton").exists(timeout=0.5)
            or d(className="android.widget.CheckBox").exists(timeout=0.5))


def handle_exercise(d):
    print("[练习页] 处理练习题")

    if click_random_option(d):
        time.sleep(1)
        submit_answer(d)
        time.sleep(2)
        return

    if d(textContains="跟读").exists(timeout=0.5) or d(textContains="录音").exists(timeout=0.5):
        handle_speaking_exercise(d)
        return

    if d(className="android.widget.EditText").exists(timeout=0.5):
        handle_fill_blank(d)
        return

    swipe_up(d)
    time.sleep(1.5)


def click_random_option(d):
    options = []

    radios = d(className="android.widget.RadioButton")
    for i in range(radios.count):
        options.append(radios[i])

    checkboxes = d(className="android.widget.CheckBox")
    for i in range(checkboxes.count):
        options.append(checkboxes[i])

    text_opts = d(textMatches="[A-F][.．]")
    for i in range(text_opts.count):
        options.append(text_opts[i])

    if not options:
        views = d(className="android.view.View").clickable(True)
        for i in range(views.count):
            v = views[i]
            try:
                info = v.info
                bounds = info.get("bounds", {})
                w = bounds.get("right", 0) - bounds.get("left", 0)
                h = bounds.get("bottom", 0) - bounds.get("top", 0)
                if w > 100 and 30 < h < 200:
                    options.append(v)
            except Exception:
                pass

    if options:
        idx = random.randint(0, min(len(options) - 1, 3))
        options[idx].click()
        print(f"  选择选项 #{idx}")
        return True

    return False


def handle_speaking_exercise(d):
    print("  处理口语练习")

    mic_btn = d(resourceIdMatches=".*mic.*")
    if not mic_btn.exists(timeout=1):
        mic_btn = d(textContains="录音")
    if not mic_btn.exists(timeout=0.5):
        mic_btn = d(descContains="录音")

    if mic_btn.exists(timeout=0.5):
        mic_btn.click()
        time.sleep(3 + random.random() * 2)

        stop_btn = d(textContains="停止")
        if stop_btn.exists(timeout=0.5):
            stop_btn.click()
        else:
            mic_btn.click()
        time.sleep(1.5)

    submit_btn = d(textContains="提交")
    if not submit_btn.exists(timeout=0.5):
        submit_btn = d(textContains="下一题")
    if submit_btn.exists(timeout=0.5):
        submit_btn.click()
        time.sleep(1.5)


def handle_fill_blank(d):
    print("  处理填空题")

    edit = d(className="android.widget.EditText")
    if edit.exists(timeout=1):
        edit.click()
        time.sleep(0.5)
        edit.set_text("answer")
        time.sleep(1)

    submit_btn = d(textContains="提交")
    if not submit_btn.exists(timeout=0.5):
        submit_btn = d(textContains="确定")
    if not submit_btn.exists(timeout=0.5):
        submit_btn = d(textContains="下一题")
    if submit_btn.exists(timeout=0.5):
        submit_btn.click()
        time.sleep(1.5)


def submit_answer(d):
    submit_texts = ["提交", "确认", "确定", "下一题"]
    for txt in submit_texts:
        btn = d(textContains=txt)
        if btn.exists(timeout=0.5):
            btn.click()
            print(f"  点击: {txt}")
            time.sleep(1.5)
            return


def is_on_result_page(d):
    return (d(textContains="完成").exists(timeout=0.5)
            or d(textContains="得分").exists(timeout=0.5)
            or d(textContains="正确").exists(timeout=0.5)
            or d(textContains="恭喜").exists(timeout=0.5))


def handle_result_page(d):
    print("[结果页] 继续下一课")

    continue_texts = ["继续", "下一课", "继续学习", "下一步"]
    for txt in continue_texts:
        btn = d(textContains=txt)
        if btn.exists(timeout=0.5):
            btn.click()
            print(f"  点击: {txt}")
            time.sleep(2)
            return

    d.press("back")
    time.sleep(2)


def is_on_menu_page(d):
    """单元列表页: ProMenuActivity / 包含 Unit 文字的选择页"""
    return (d(textContains="Unit").exists(timeout=0.5)
            or d(textContains="Certification").exists(timeout=0.5)
            or "Menu" in d.app_current().get("activity", ""))


def handle_menu_page(d):
    print("[单元列表] 选择 Unit 进入")

    # 尝试点击包含 Unit 的文字
    units = d(textContains="Unit")
    for i in range(min(units.count, 8)):
        try:
            el = units[i]
            txt = el.get_text()
            print(f"  尝试点击: {txt}")
            el.click()
            time.sleep(2)
            if "Menu" not in d.app_current().get("activity", ""):
                print(f"  进入成功: {txt}")
                return
        except Exception as e:
            print(f"  点击失败: {e}")

    # Unit 文字不可点击时尝试父级可点击容器
    clickable = d(className="android.view.View").clickable(True)
    if clickable.count == 0:
        clickable = d(className="android.view.ViewGroup").clickable(True)
    if clickable.count == 0:
        clickable = d(className="android.widget.LinearLayout").clickable(True)

    for i in range(min(clickable.count, 10)):
        try:
            v = clickable[i]
            info = v.info
            text = info.get("text", "") or info.get("contentDescription", "")
            if "Unit" in text or text:
                print(f"  尝试点击容器: {text}")
                v.click()
                time.sleep(2)
                if "Menu" not in d.app_current().get("activity", ""):
                    print("  进入成功")
                    return
        except Exception:
            pass

    print("  未成功进入，尝试滑动")
    swipe_up(d)
    time.sleep(2)


def handle_generic_screen(d):
    current = d.app_current()
    print(f"[通用] 当前界面: {current.get('activity', 'unknown')}")

    if d(textContains="积分").exists(timeout=0.5):
        point_el = d(textMatches=r"\d+")
        if point_el.exists(timeout=0.5):
            print(f"  积分信息: {point_el.get_text()}")

    buttons = d(className="android.widget.Button").clickable(True)
    for i in range(buttons.count):
        btn = buttons[i]
        try:
            txt = btn.get_text()
            if txt and any(k in txt for k in ["学习", "继续", "开始", "下一", "播放"]):
                btn.click()
                print(f"  点击按钮: {txt}")
                time.sleep(2)
                return
        except Exception:
            pass

    if state["loop_count"] % 5 == 0:
        print("  定期返回")
        d.press("back")
        time.sleep(2)


def recover_from_error(d):
    print("尝试错误恢复...")

    current = d.app_current()
    if current.get("package") != CONFIG["APP_PACKAGE"]:
        launch_neo_app(d)
        return

    d.press("back")
    time.sleep(2)
    dismiss_popups(d)


def swipe_up(d):
    w, h = d.window_size()
    x = w // 2 + random.randint(-30, 30)
    y1 = int(h * 0.7) + random.randint(-20, 20)
    y2 = int(h * 0.3) + random.randint(-20, 20)
    d.swipe(x, y1, x, y2, duration=0.5)


def swipe_down(d):
    w, h = d.window_size()
    x = w // 2 + random.randint(-30, 30)
    y1 = int(h * 0.3) + random.randint(-20, 20)
    y2 = int(h * 0.7) + random.randint(-20, 20)
    d.swipe(x, y1, x, y2, duration=0.5)


def random_sleep():
    delay = random.uniform(CONFIG["RANDOM_DELAY_MIN"], CONFIG["RANDOM_DELAY_MAX"])
    time.sleep(delay)


def debug_current_screen(d):
    print("\n" + "=" * 50)
    print("当前界面调试信息")
    print("=" * 50)

    current = d.app_current()
    print(f"包名: {current.get('package')}")
    print(f"Activity: {current.get('activity')}")

    xml = d.dump_hierarchy()
    print(f"\n控件树长度: {len(xml)} 字符")

    print("\n--- 所有文本元素 ---")
    texts = d(className="android.widget.TextView")
    for i in range(min(texts.count, 30)):
        try:
            t = texts[i]
            info = t.info
            print(f"  [{i}] text={info.get('text', '')} "
                  f"resourceId={info.get('resourceId', '')} "
                  f"bounds={info.get('bounds', '')}")
        except Exception as e:
            print(f"  [{i}] 读取失败: {e}")

    print("\n--- 所有按钮 ---")
    buttons = d(className="android.widget.Button")
    for i in range(min(buttons.count, 15)):
        try:
            b = buttons[i]
            info = b.info
            print(f"  [{i}] text={info.get('text', '')} "
                  f"resourceId={info.get('resourceId', '')} "
                  f"bounds={info.get('bounds', '')}")
        except Exception as e:
            print(f"  [{i}] 读取失败: {e}")

    print("\n--- 所有可点击 View ---")
    views = d(className="android.view.View").clickable(True)
    for i in range(min(views.count, 15)):
        try:
            v = views[i]
            info = v.info
            print(f"  [{i}] text={info.get('text', '')} "
                  f"desc={info.get('contentDescription', '')} "
                  f"resourceId={info.get('resourceId', '')} "
                  f"bounds={info.get('bounds', '')}")
        except Exception as e:
            print(f"  [{i}] 读取失败: {e}")

    print("=" * 50 + "\n")


if __name__ == "__main__":
    if "--debug" in sys.argv:
        d = u2.connect()
        print("已连接设备，开始调试...")
        launch_neo_app(d)
        time.sleep(3)
        debug_current_screen(d)
    else:
        main()
