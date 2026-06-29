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
    print("neo auto-learning script (desktop controller)")
    print("=" * 50)

    d = connect_device()
    if not d:
        return

    print(f"Device info: {d.info}")
    print(f"Screen size: {d.window_size()}")

    launch_neo_app(d)

    print("\nScript started. Press Ctrl+C to stop.\n")

    try:
        while state["is_running"]:
            state["loop_count"] += 1
            try:
                handle_current_screen(d)
                random_sleep()
            except Exception as e:
                print(f"Main loop exception: {e}")
                time.sleep(3)
                recover_from_error(d)
    except KeyboardInterrupt:
        print("\nScript stopped by user")

    elapsed = int((time.time() - state["start_time"]) / 60)
    print(f"Script stopped after {elapsed} minutes and {state['loop_count']} loops")


def connect_device():
    if len(sys.argv) > 1:
        device_addr = sys.argv[1]
        print(f"Connecting to device: {device_addr}")
    else:
        print("Auto-detecting USB-connected device...")

    try:
        d = u2.connect() if len(sys.argv) <= 1 else u2.connect(sys.argv[1])
        if d.info:
            print("Device connected")
            return d
    except Exception as e:
        print(f"Connection failed: {e}")
        print("\nPlease confirm:")
        print("  1. The phone is connected to the computer over USB")
        print("  2. USB debugging is enabled on the phone")
        print("  3. Debugging authorization was accepted on the phone")
        print("  4. adb is installed on the computer (brew install android-platform-tools)")
        return None


def launch_neo_app(d):
    print("Launching neo app...")
    d.app_start(CONFIG["APP_PACKAGE"])
    time.sleep(5)

    current = d.app_current()
    if current.get("package") == CONFIG["APP_PACKAGE"]:
        print("neo launched")
    else:
        print("Launch failed; retrying...")
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
            print(f"  Closed popup: {txt}")
            time.sleep(0.5)

    if d(textContains="休息一下").exists(timeout=0.5):
        continue_btn = d(text="继续学习")
        if continue_btn.exists(timeout=0.5):
            continue_btn.click()
            print("  Closed break reminder")
            time.sleep(1)


def is_on_home_page(d):
    return (d(textContains="学习").exists(timeout=0.5)
            or d(textContains="首页").exists(timeout=0.5)
            or d(textContains="我的课程").exists(timeout=0.5)
            or d(resourceIdMatches=".*home.*").exists(timeout=0.5)
            or d(resourceIdMatches=".*main.*").exists(timeout=0.5))


def enter_learning_module(d):
    print("[Home] Trying to enter learning module")

    entry_texts = ["继续学习", "开始学习", "AI练习", "自主练习", "我的课程", "课件"]
    for txt in entry_texts:
        btn = d(textContains=txt)
        if btn.exists(timeout=1):
            btn.click()
            print(f"  Tapped entry: {txt}")
            time.sleep(2)
            return

    course = d(className="android.widget.ImageView").clickable(True)
    if course.exists(timeout=1):
        course.click()
        print("  Tapped course item")
        time.sleep(2)
        return

    print("  Entry not found; trying swipe")
    swipe_up(d)
    time.sleep(2)


def is_on_lesson_page(d):
    return (d(textContains="课时").exists(timeout=0.5)
            or d(textContains="播放").exists(timeout=0.5)
            or d(textContains="下一课").exists(timeout=0.5)
            or d(resourceIdMatches=".*video.*").exists(timeout=0.5)
            or d(resourceIdMatches=".*player.*").exists(timeout=0.5))


def handle_lesson_interaction(d):
    print("[Lesson] Handling lesson interaction")

    try_auto_play(d)

    next_texts = ["下一课", "下一步", "下一题", "下一个"]
    for txt in next_texts:
        btn = d(textContains=txt)
        if btn.exists(timeout=0.5):
            btn.click()
            print(f"  Tapped: {txt}")
            time.sleep(1.5)
            return

    if d(textContains="暂停").exists(timeout=0.5):
        print("  Video is playing; waiting...")
        time.sleep(5)
        return

    swipe_up(d)
    time.sleep(1.5)


def try_auto_play(d):
    play_btn = d(textContains="播放")
    if play_btn.exists(timeout=0.5):
        if not d(textContains="暂停").exists(timeout=0.3):
            play_btn.click()
            print("  Tapped play")
            time.sleep(1)


def is_on_exercise_page(d):
    return (d(textContains="选择").exists(timeout=0.5)
            or d(textContains="答案").exists(timeout=0.5)
            or d(textContains="提交").exists(timeout=0.5)
            or d(className="android.widget.RadioButton").exists(timeout=0.5)
            or d(className="android.widget.CheckBox").exists(timeout=0.5))


def handle_exercise(d):
    print("[Exercise] Handling exercise")

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
        print(f"  Selected option #{idx}")
        return True

    return False


def handle_speaking_exercise(d):
    print("  Handling speaking exercise")

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
    print("  Handling fill-in-the-blank exercise")

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
            print(f"  Tapped: {txt}")
            time.sleep(1.5)
            return


def is_on_result_page(d):
    return (d(textContains="完成").exists(timeout=0.5)
            or d(textContains="得分").exists(timeout=0.5)
            or d(textContains="正确").exists(timeout=0.5)
            or d(textContains="恭喜").exists(timeout=0.5))


def handle_result_page(d):
    print("[Result] Continue to next lesson")

    continue_texts = ["继续", "下一课", "继续学习", "下一步"]
    for txt in continue_texts:
        btn = d(textContains=txt)
        if btn.exists(timeout=0.5):
            btn.click()
            print(f"  Tapped: {txt}")
            time.sleep(2)
            return

    d.press("back")
    time.sleep(2)


def is_on_menu_page(d):
    """Unit list page: ProMenuActivity or a selection page containing Unit text."""
    return (d(textContains="Unit").exists(timeout=0.5)
            or d(textContains="Certification").exists(timeout=0.5)
            or "Menu" in d.app_current().get("activity", ""))


def handle_menu_page(d):
    print("[Unit list] Selecting a Unit")

    # Try tapping text that contains Unit.
    units = d(textContains="Unit")
    for i in range(min(units.count, 8)):
        try:
            el = units[i]
            txt = el.get_text()
            print(f"  Trying tap: {txt}")
            el.click()
            time.sleep(2)
            if "Menu" not in d.app_current().get("activity", ""):
                print(f"  Entered successfully: {txt}")
                return
        except Exception as e:
            print(f"  Tap failed: {e}")

    # If Unit text is not clickable, try the clickable parent/container.
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
                print(f"  Trying container tap: {text}")
                v.click()
                time.sleep(2)
                if "Menu" not in d.app_current().get("activity", ""):
                    print("  Entered successfully")
                    return
        except Exception:
            pass

    print("  Could not enter; trying swipe")
    swipe_up(d)
    time.sleep(2)


def handle_generic_screen(d):
    current = d.app_current()
    print(f"[Generic] Current screen: {current.get('activity', 'unknown')}")

    if d(textContains="积分").exists(timeout=0.5):
        point_el = d(textMatches=r"\d+")
        if point_el.exists(timeout=0.5):
            print(f"  Points info: {point_el.get_text()}")

    buttons = d(className="android.widget.Button").clickable(True)
    for i in range(buttons.count):
        btn = buttons[i]
        try:
            txt = btn.get_text()
            if txt and any(k in txt for k in ["学习", "继续", "开始", "下一", "播放"]):
                btn.click()
                print(f"  Tapped button: {txt}")
                time.sleep(2)
                return
        except Exception:
            pass

    if state["loop_count"] % 5 == 0:
        print("  Periodic back action")
        d.press("back")
        time.sleep(2)


def recover_from_error(d):
    print("Trying error recovery...")

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
    print("Current screen debug info")
    print("=" * 50)

    current = d.app_current()
    print(f"Package: {current.get('package')}")
    print(f"Activity: {current.get('activity')}")

    xml = d.dump_hierarchy()
    print(f"\nUI tree length: {len(xml)} characters")

    print("\n--- All text elements ---")
    texts = d(className="android.widget.TextView")
    for i in range(min(texts.count, 30)):
        try:
            t = texts[i]
            info = t.info
            print(f"  [{i}] text={info.get('text', '')} "
                  f"resourceId={info.get('resourceId', '')} "
                  f"bounds={info.get('bounds', '')}")
        except Exception as e:
            print(f"  [{i}] Read failed: {e}")

    print("\n--- All buttons ---")
    buttons = d(className="android.widget.Button")
    for i in range(min(buttons.count, 15)):
        try:
            b = buttons[i]
            info = b.info
            print(f"  [{i}] text={info.get('text', '')} "
                  f"resourceId={info.get('resourceId', '')} "
                  f"bounds={info.get('bounds', '')}")
        except Exception as e:
            print(f"  [{i}] Read failed: {e}")

    print("\n--- All clickable Views ---")
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
            print(f"  [{i}] Read failed: {e}")

    print("=" * 50 + "\n")


if __name__ == "__main__":
    if "--debug" in sys.argv:
        d = u2.connect()
        print("Device connected. Starting debug...")
        launch_neo_app(d)
        time.sleep(3)
        debug_current_screen(d)
    else:
        main()
