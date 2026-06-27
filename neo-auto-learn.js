var CONFIG = {
    APP_PACKAGE: "com.nexgen.nsa",
    APP_NAME: "neo",
    TARGET_POINTS: 6000,
    LOOP_INTERVAL: 2000,
    SWIPE_DURATION: 500,
    MAX_RETRY: 3,
    RANDOM_DELAY_MIN: 5,
    RANDOM_DELAY_MAX: 35,
    WAKE_TOUCH_LOOPS: 0,
    ACCESSIBILITY_SHORTCUT_LOOPS: 25,
    STUCK_SCREEN_LOOPS: 32,
    LEVEL_FAIL_RESTARTS: 3,
    HARD_RESTART_COOLDOWN_LOOPS: 45,
    AUTO_SERVICE_REFRESH_LOOPS: 60,
    RESTART_AFTER_RESULT: true,
};

var state = {
    isRunning: true,
    loopCount: 0,
    startTime: Date.now(),
    lastActionTime: 0,
    topicIndex: 0,       // 当前处理到第几个 topic
    samePageCount: 0,    // 同一页面连续循环次数（用于死循环检测）
    sameScreenCount: 0,  // 同一屏幕内容连续循环次数
    lastActivity: "",    // 上一次的 Activity
    lastScreenSignature: "",
    lastWakeLoop: 0,
    lastAccessibilityShortcutLoop: -999,
    lastRecoveryLoop: 0,
    lastHardRestartLoop: -999,
    lastAutoRefreshLoop: -999,
    levelFailCount: 0,
    targetCourse: "",    // 本轮随机 level
    targetUnit: 0,        // 本轮随机 Unit
    targetTopicName: "",  // 从 Unit<x> <topic> 解析出的 topic 名
};

// 轮询等待：每 step ms 检查条件，满足立即返回，超时返回 false
function waitUntil(checkFn, maxMs, step) {
    step = step || 120;
    for (var elapsed = 0; elapsed < maxMs; elapsed += step) {
        if (checkFn()) return true;
        sleep(step);
    }
    return false;
}

// 等待 Activity 改变（离开指定 Activity）
function waitActivityGone(oldAct, maxMs) {
    maxMs = maxMs || 3000;
    return waitUntil(function () {
        var a = currentActivity();
        return a != oldAct || a.indexOf("ComposeDialog") >= 0 || a.indexOf("AutoX") >= 0;
    }, maxMs);
}

// 等待 Activity 变为包含某个关键词
function waitActivityContains(keyword, maxMs) {
    maxMs = maxMs || 3000;
    return waitUntil(function () {
        return currentActivity().indexOf(keyword) >= 0;
    }, maxMs);
}

function main() {
    // 1. 请求无障碍权限并启用服务（比 auto.waitFor() 更可靠）
    auto();
    log("无障碍服务已启用");

    // 2. 请求悬浮窗权限（控制面板需要）
    if (!floaty.checkPermission()) {
        toast("请授予悬浮窗权限");
        floaty.requestPermission();
        sleep(2000);
    }

    // ★ 删掉 requestScreenCapture(false) —— 本脚本只用 text().findOne()，
    // 走的是无障碍服务，不需要截屏。截屏权限弹窗会导致脚本卡死。

    // 3. 显示控制面板
    showControlPanel();

    // 4. 启动 neo 前先确认无障碍服务仍存活
    log("当前无障碍服务状态: " + auto.service);
    if (!auto.service) {
        toast("无障碍服务未连接，请确认已开启 AutoX 无障碍权限");
        sleep(3000);
        auto();
    }

    // 5. 启动 neo
    launchNeoApp();

    // 6. 主循环——每隔一定时间检查无障碍服务是否存活
    while (state.isRunning) {
        try {
            // 无障碍服务断开时自动重连
            if (!auto.service) {
                log("无障碍服务断开，尝试重连...");
                auto();
                sleep(2000);
            }
            refreshAutoServiceIfNeeded();

            state.loopCount++;
            handleCurrentScreen();
            randomSleep();
        } catch (e) {
            log("主循环异常: " + e.message);
            sleep(3000);
            recoverFromError();
        }
    }

    toast("脚本已停止");
}

function showControlPanel() {
    var window = floaty.window(
        <vertical padding="8">
            <text id="status" textSize="12sp" textColor="#ffffff" bg="#88000000" padding="4">运行中...</text>
            <button id="btnStop" textSize="10sp" text="停止" w="60" h="30"/>
        </vertical>
    );

    window.btnStop.click(function () {
        state.isRunning = false;
        window.close();
    });

    threads.start(function () {
        while (state.isRunning) {
            ui.run(function () {
                var elapsed = Math.floor((Date.now() - state.startTime) / 60000);
                window.status.setText("运行:" + elapsed + "分 循环:" + state.loopCount);
            });
            sleep(5000);
        }
    });
}

function launchNeoApp() {
    log("启动 neo 应用...");

    if (currentPackage() != CONFIG.APP_PACKAGE) {
        // 直接用包名启动（比 app.launchApp 按名称更可靠）
        app.launch(CONFIG.APP_PACKAGE);
        waitUntil(function () {
            return currentPackage() == CONFIG.APP_PACKAGE;
        }, 1800, 100);
    }

    // 检查是否启动成功
    var pkg = currentPackage();
    log("当前前台包名: " + pkg);

    if (pkg == CONFIG.APP_PACKAGE) {
        log("neo 已启动成功");
    } else {
        // 重试一次
        log("首次启动未成功，重试...");
        app.launch(CONFIG.APP_PACKAGE);
        waitUntil(function () {
            return currentPackage() == CONFIG.APP_PACKAGE;
        }, 2500, 120);
        pkg = currentPackage();
        if (pkg == CONFIG.APP_PACKAGE) {
            log("重试成功");
        } else {
            log("启动失败，当前包名: " + pkg + "，请手动打开 neo");
            sleep(2000);
        }
    }
}

function handleCurrentScreen() {
    dismissPopups();

    // 跟踪同一页面连续循环次数
    var act = currentActivity();
    if (act == state.lastActivity) {
        state.samePageCount++;
    } else {
        state.samePageCount = 0;
        state.lastActivity = act;
    }

    updateScreenSignature(act);
    if (CONFIG.WAKE_TOUCH_LOOPS > 0
        && state.sameScreenCount >= CONFIG.WAKE_TOUCH_LOOPS
        && state.loopCount - state.lastWakeLoop >= CONFIG.WAKE_TOUCH_LOOPS) {
        gentleWakeTouch();
    }
    if (state.sameScreenCount >= CONFIG.ACCESSIBILITY_SHORTCUT_LOOPS
        && state.loopCount - state.lastAccessibilityShortcutLoop >= CONFIG.ACCESSIBILITY_SHORTCUT_LOOPS) {
        tapAccessibilityShortcut();
        return;
    }
    if (state.sameScreenCount >= CONFIG.STUCK_SCREEN_LOOPS
        && state.loopCount - state.lastRecoveryLoop >= CONFIG.STUCK_SCREEN_LOOPS) {
        if (recoverStuckScreen()) return;
    }

    // AutoX 系统弹窗（继续/退出）
    if (act.indexOf("ComposeDialog") >= 0 || act.indexOf("AutoX") >= 0) {
        handleAutoXDialog();
        return;
    }

    // neo-06: 学习开始后的继续/退出覆盖层，必须优先点继续，避免通用逻辑误点退出。
    if (isOnResumeOverlay()) {
        handleResumeOverlay();
        return;
    }

    // 得分页优先处理，避免被“继续”抢先点击
    if (isOnResultPage()) {
        handleResultPage();
        return;
    }

    // 学习过程中出现“继续”就直接点
    if (clickContinueIfExists()) {
        return;
    }

    // loading 中直接等
    if (isOnLoadingPage()) {
        log("加载中，等待...");
        sleep(800);
        return;
    }

    // 步骤弹窗（BottomSheetDialog）优先处理
    if (isOnStepSheet()) {
        handleStepSheet();
        return;
    }

    // neo-01 level页有时回到 MainActivity，不能只按 Activity=Menu 判断。
    if (isOnLevelPage()) {
        handleLevelPage();
        return;
    }

    // MainActivity 的子页面（Preview/GO、学习中、完成）
    if (act == "com.nexgen.nsa.MainActivity") {
        if (isOnResultPage()) {
            handleResultPage();
            return;
        }
        // Preview页：有Preview文字或GO按钮（优先，避免误判成完成页）
        if (isOnPreviewPage()) {
            handlePreviewPage();
            return;
        }
        // 完成页：一旦出现就优先回Home，避免被练习页/兜底逻辑误判后点到重播或X。
        if (isOnCompletePage()) {
            handleCompletePage();
            return;
        }
        // 练习/选择页：优先处理，避免被标题 The Secret Code 误判成完成页
        if (isOnExercisePage()) {
            handleExercise();
            return;
        }
        // MainActivity 未知状态不点底部兜底/随机按钮，避免误点neo-08左侧循环按钮。
        if (clickMidScreenContinueIcon()) {
            return;
        }
        log("  MainActivity未知状态，等待下一轮重新识别");
        sleep(500);
        return;
    }

    if (isOnLevelPage()) {
        handleLevelPage();
        return;
    }

    if (isOnUnitListPage()) {
        handleMenuPage();
        return;
    }

    if (isOnTopicPage()) {
        handleTopicPage();
        return;
    }

    if (isOnHomePage()) {
        enterLearningModule();
        return;
    }

    if (isOnMenuPage()) {
        handleMenuPage();
        return;
    }

    if (isOnLessonPage()) {
        handleLessonInteraction();
        return;
    }

    if (isOnExercisePage()) {
        handleExercise();
        return;
    }

    if (isOnResultPage()) {
        handleResultPage();
        return;
    }

    handleGenericScreen();
}

function updateScreenSignature(act) {
    var signature = getScreenSignature(act);
    if (signature == state.lastScreenSignature) {
        state.sameScreenCount++;
    } else {
        state.sameScreenCount = 0;
        state.lastScreenSignature = signature;
    }
}

function getScreenSignature(act) {
    var parts = [act];
    var nodes = className("android.widget.TextView").find();
    for (var i = 0; i < Math.min(nodes.length, 10); i++) {
        var t = (nodes[i].text() || "").replace(/\s+/g, " ").trim();
        if (!t) continue;
        var b = nodes[i].bounds();
        parts.push(t + "@" + Math.floor(b.left / 20) + "," + Math.floor(b.top / 20));
    }
    return parts.join("|");
}

function resetLoopTarget(reason) {
    state.targetCourse = "";
    state.targetUnit = 0;
    state.targetTopicName = "";
    state.topicIndex = 0;
    state.samePageCount = 0;
    state.sameScreenCount = 0;
    state.levelFailCount = 0;
    state.lastScreenSignature = "";
    log("重置本轮目标: " + reason);
}

function refreshAutoServiceIfNeeded() {
    if (state.loopCount - state.lastAutoRefreshLoop < CONFIG.AUTO_SERVICE_REFRESH_LOOPS) return;
    state.lastAutoRefreshLoop = state.loopCount;

    try {
        auto();
        log("定期刷新AutoX无障碍连接");
    } catch (e) {
        log("刷新AutoX无障碍连接失败: " + e.message);
    }
}

function hardRestartNeo(reason, force) {
    if (!force && state.loopCount - state.lastHardRestartLoop < CONFIG.HARD_RESTART_COOLDOWN_LOOPS) {
        log("跳过硬重启，冷却中: " + reason);
        resetLoopTarget("硬重启冷却中，先重置目标");
        return;
    }

    state.lastHardRestartLoop = state.loopCount;
    log("硬重启NEO: " + reason);
    resetLoopTarget("硬重启前清空状态");

    try {
        shell("am force-stop " + CONFIG.APP_PACKAGE, true);
        sleep(800);
    } catch (e) {
        log("  force-stop失败，继续尝试启动: " + e.message);
    }

    app.launch(CONFIG.APP_PACKAGE);
    waitUntil(function () {
        return currentPackage() == CONFIG.APP_PACKAGE;
    }, 3000, 150);
    sleep(1200);
}

function gentleWakeTouch() {
    state.lastWakeLoop = state.loopCount;

    var x = Math.floor(device.width * 0.50);
    var y = Math.floor(device.height * 0.09);

    log("同屏较久，轻触唤醒 @(" + x + "," + y + ")");
    press(x, y, 35);
    try {
        shell("input tap " + x + " " + y, true);
    } catch (e) {
        log("  系统tap唤醒失败，已用press兜底: " + e.message);
    }
    sleep(180);
}

function tapAccessibilityShortcut() {
    state.lastAccessibilityShortcutLoop = state.loopCount;

    // Android 无障碍快捷按钮通常贴在屏幕右下角边缘。这里刻意避开 NEO 的右下 Home
    // 按钮区域（约 x=75%, y=87%），点更靠右的系统悬浮按钮。
    var points = [
        { x: 0.965, y: 0.875 },
        { x: 0.965, y: 0.820 },
        { x: 0.940, y: 0.900 },
    ];

    log("同屏卡住，尝试点击右下无障碍快捷按钮");
    for (var i = 0; i < points.length; i++) {
        var x = Math.floor(device.width * points[i].x);
        var y = Math.floor(device.height * points[i].y);
        press(x, y, 45);
        try {
            shell("input tap " + x + " " + y, true);
        } catch (e) {
            log("  无障碍快捷按钮系统tap失败: " + e.message);
        }
        sleep(220);
    }

    // 不清空 sameScreenCount。这个按钮现在只作为一次尝试；
    // 如果页面仍不变化，下一阶段必须继续进入硬恢复，不能重新计数空转。
}

function recoverStuckScreen() {
    state.lastRecoveryLoop = state.loopCount;
    log("检测到同一屏幕连续 " + state.sameScreenCount + " 轮，执行安全恢复: " + currentActivity());

    if (!currentPackage().equals(CONFIG.APP_PACKAGE)) {
        launchNeoApp();
        return true;
    }

    if (isOnResumeOverlay()) {
        handleResumeOverlay();
        state.sameScreenCount = 0;
        return true;
    }

    if (isOnResultPage()) {
        handleResultPage();
        state.sameScreenCount = 0;
        return true;
    }

    if (isOnCompletePage()) {
        handleCompletePage();
        state.sameScreenCount = 0;
        return true;
    }

    if (isOnPreviewPage()) {
        handlePreviewPage();
        state.sameScreenCount = 0;
        return true;
    }

    if (isOnLevelPage()) {
        hardRestartNeo("卡在neo-01 level页，点击level无效");
        return true;
    }

    if (isOnUnitListPage() || isOnTopicPage()) {
        hardRestartNeo("卡在选择流程，重启后从level重新开始");
        return true;
    }

    if (clickContinueIfExists()) {
        state.sameScreenCount = 0;
        return true;
    }

    if (clickMidScreenContinueIcon()) {
        state.sameScreenCount = 0;
        return true;
    }

    hardRestartNeo("未知卡屏");
    return true;
}

function handleAutoXDialog() {
    var resumeBtn = id("com.nexgen.nsa:id/buttonResume").findOne(200)
        || idContains("buttonResume").findOne(200);
    if (resumeBtn) {
        clickNode(resumeBtn);
        log("  处理AutoX弹窗: 点击继续icon buttonResume");
        sleep(500);
        return;
    }

    var cont = text("继续").findOne(300)
        || textContains("继续").findOne(300)
        || id("com.nexgen.nsa:id/textViewResumePause").findOne(300)
        || idContains("textViewResumePause").findOne(300)
        || descContains("继续").findOne(300);

    if (cont) {
        var b = cont.bounds();
        click(Math.floor((b.left + b.right) / 2), Math.max(0, b.top - 120));
        log("  处理AutoX弹窗: 根据继续文字点击上方icon");
        sleep(500);
        return;
    }

    var btns = className("android.widget.TextView").find();
    var candidates = [];
    for (var i = 0; i < btns.length; i++) {
        var s = btns[i].text() || "";
        if (s.indexOf("退出") >= 0 || s.indexOf("Exit") >= 0 || s.indexOf("取消") >= 0) continue;
        var b = btns[i].bounds();
        if (b.top >= device.height * 0.55) candidates.push(btns[i]);
    }

    if (candidates.length > 0) {
        candidates.sort(function (a, b) {
            return a.bounds().top - b.bounds().top;
        });
        clickNode(candidates[0]);
        log("  处理AutoX弹窗: 点击上方非退出按钮");
    } else {
        log("  处理AutoX弹窗: 无按钮文本，等待下一轮，不自动返回");
    }
    sleep(500);
}

function isOnResumeOverlay() {
    return (textContains("继续").exists()
            && (textContains("退出").exists()
            || textContains("The Secret Code").exists()
            || textContains("Preview").exists()
            || textContains("The Crime").exists()))
        || (textContains("继续").exists() && hasCenterResumeLikeButton());
}

function handleResumeOverlay() {
    log("处理neo继续/退出覆盖层，点击继续");

    var cont = text("继续").findOne(300)
        || textContains("继续").findOne(300)
        || desc("继续").findOne(300)
        || descContains("继续").findOne(300);

    if (cont) {
        var b = cont.bounds();
        var cx = Math.floor((b.left + b.right) / 2);
        var cy = Math.floor((b.top + b.bottom) / 2);
        if (cy < device.height * 0.60) {
            click(cx, cy);
            sleep(50);
            press(cx, cy, 80);
            log("  点击继续文字 @(" + cx + "," + cy + ")");
            sleep(250);
            if (!isOnResumeOverlay()) return;
        }
    }

    // neo-06 上方蓝色播放圆按钮是继续；下面蓝色X是退出，绝对不能点。
    var absoluteY = Math.floor(device.width * 1.57);
    var points = [];
    if (absoluteY < device.height * 0.55) {
        points.push({ px: Math.floor(device.width * 0.50), py: absoluteY, label: "width-based" });
    }
    points = points.concat([
        { x: 0.50, y: 0.400 },
        { x: 0.50, y: 0.385 },
        { x: 0.50, y: 0.415 },
        { x: 0.50, y: 0.365 },
        { x: 0.50, y: 0.435 },
    ]);
    for (var i = 0; i < points.length; i++) {
        var tapped;
        if (points[i].px !== undefined) {
            tapped = { x: points[i].px, y: points[i].py };
            click(tapped.x, tapped.y);
        } else {
            tapped = tapOnceByRatio(points[i].x, points[i].y);
        }
        sleep(50);
        press(tapped.x, tapped.y, 80);
        log("  点击上方继续播放按钮 @(" + tapped.x + "," + tapped.y + ")");
        sleep(120);
        if (!isOnResumeOverlay()) return;
    }
    sleep(250);
}

function dismissPopups() {
    var closeButtons = [
        text("关闭").findOne(80),
        text("确定").findOne(80),
        text("知道了").findOne(80),
        text("以后再说").findOne(80),
        text("跳过").findOne(80),
        text("暂不升级").findOne(80),
        desc("关闭").findOne(80),
        idContains("close").findOne(80),
        idContains("iv_close").findOne(80),
        idContains("btn_close").findOne(80),
    ];

    for (var i = 0; i < closeButtons.length; i++) {
        var btn = closeButtons[i];
        if (btn) {
            if (isProtectedCloseButton(btn)) {
                log("跳过主页面关闭/X按钮: " + (btn.text() || btn.desc() || btn.id()));
                continue;
            }
            btn.click();
            log("关闭弹窗: " + (btn.text() || btn.desc() || btn.id()));
            sleep(250);
        }
    }

    if (textContains("休息一下").exists() || textContains("已学习").exists()) {
        var continueBtn = text("继续学习").findOne(120) || text("继续").findOne(120);
        if (continueBtn) {
            continueBtn.click();
            sleep(250);
        }
    }
}

function isProtectedCloseButton(btn) {
    var act = currentActivity();
    if (act != "com.nexgen.nsa.MainActivity" && act.indexOf("Menu") < 0) return false;

    var label = btn.text() || btn.desc() || btn.id() || "";
    var isCloseLike = label.indexOf("关闭") >= 0
        || label.indexOf("close") >= 0
        || label.indexOf("Close") >= 0
        || label == "X"
        || label == "×"
        || label == "✗"
        || label == "✘";
    if (!isCloseLike) return false;

    var b = btn.bounds();
    var cx = Math.floor((b.left + b.right) / 2);
    var cy = Math.floor((b.top + b.bottom) / 2);

    // neo学习页/结果页的左上X是页面退出，不是弹窗关闭。
    if (cx < device.width * 0.25 && cy < device.height * 0.18) return true;

    // MainActivity里任何close类按钮都保守跳过，避免退出学习流程。
    return act == "com.nexgen.nsa.MainActivity";
}

function clickNode(node) {
    var b = node.bounds();
    var cx = Math.floor((b.left + b.right) / 2);
    var cy = Math.floor((b.top + b.bottom) / 2);

    // 优先坐标+shell双戳，比 .click() 无障碍Action更可靠
    click(cx, cy);
    sleep(50);
    shell("input tap " + cx + " " + cy, true);
}

function tapByRatio(xRatio, yRatio) {
    var x = Math.floor(device.width * xRatio);
    var y = Math.floor(device.height * yRatio);
    click(x, y);
    sleep(50);
    shell("input tap " + x + " " + y, true);
    return { x: x, y: y };
}

function tapOnceByRatio(xRatio, yRatio) {
    var x = Math.floor(device.width * xRatio);
    var y = Math.floor(device.height * yRatio);
    click(x, y);
    return { x: x, y: y };
}

function clickNodeOnce(node) {
    var b = node.bounds();
    var cx = Math.floor((b.left + b.right) / 2);
    var cy = Math.floor((b.top + b.bottom) / 2);
    click(cx, cy);
    sleep(50);
    press(cx, cy, 80);
    return { x: cx, y: cy };
}

function toArr(collection) {
    var arr = [];
    if (!collection) return arr;
    for (var i = 0; i < collection.length; i++) {
        arr.push(collection[i]);
    }
    return arr;
}

function findBottomContinueButton() {
    var candidates = [];
    var buttons = className("android.widget.Button").find();
    for (var i = 0; i < buttons.length; i++) candidates.push(buttons[i]);

    var textViews = className("android.widget.TextView").find();
    for (var t = 0; t < textViews.length; t++) candidates.push(textViews[t]);

    var imageButtons = className("android.widget.ImageButton").find();
    for (var ib = 0; ib < imageButtons.length; ib++) candidates.push(imageButtons[ib]);

    var imageViews = className("android.widget.ImageView").clickable(true).find();
    for (var iv = 0; iv < imageViews.length; iv++) candidates.push(imageViews[iv]);

    var views = className("android.view.View").clickable(true).find();
    for (var j = 0; j < views.length; j++) candidates.push(views[j]);

    var groups = className("android.view.ViewGroup").clickable(true).find();
    for (var g = 0; g < groups.length; g++) candidates.push(groups[g]);

    var matched = [];
    for (var k = 0; k < candidates.length; k++) {
        var b = candidates[k].bounds();
        var cx = Math.floor((b.left + b.right) / 2);
        var cy = Math.floor((b.top + b.bottom) / 2);
        if (cy >= device.height * 0.62 && cy <= device.height * 0.94
            && cx >= device.width * 0.12 && cx <= device.width * 0.88
            && b.width() >= 50 && b.height() >= 35) {
            matched.push(candidates[k]);
        }
    }

    if (matched.length == 0) return null;
    matched.sort(function (a, b) {
        var ab = a.bounds();
        var bb = b.bounds();
        var acx = Math.floor((ab.left + ab.right) / 2);
        var bcx = Math.floor((bb.left + bb.right) / 2);
        var ad = Math.abs(acx - device.width / 2) + Math.abs(ab.top - device.height * 0.78);
        var bd = Math.abs(bcx - device.width / 2) + Math.abs(bb.top - device.height * 0.78);
        return ad - bd;
    });
    return matched[0];
}

function clickContinueIfExists(useBottomFallback) {
    // 1. 精确匹配 "继续" 文字
    var cont = text("继续").findOne(200)
        || textContains("继续").findOne(200)
        || desc("继续").findOne(200)
        || descContains("继续").findOne(200)
        || idContains("continue").findOne(200)
        || idContains("next").findOne(200);

    if (cont) {
        var tapped = clickNodeOnce(cont);
        log("点击继续 @(" + tapped.x + "," + tapped.y + ")");
        return true;
    }

    if (clickMidScreenContinueIcon()) return true;

    if (useBottomFallback !== true) return false;

    // 2. 只有调用方明确允许时，才找底部候选元素。
    // level/menu/topic 页底部常有 A2+/返回/导航，不能在全局流程里误当成继续按钮。
    var bottomBtn = findBottomContinueButton();
    if (bottomBtn) {
        clickNode(bottomBtn);
        log("点击底部: " + (bottomBtn.text() || bottomBtn.desc() || bottomBtn.className()));
        return true;
    }

    // 3. 纯坐标兜底：扫描底部 20% 区域，戳任意内容
    var allViews = [].concat(
        toArr(className("android.widget.TextView").find()),
        toArr(className("android.widget.Button").find()),
        toArr(className("android.view.View").clickable(true).find()),
        toArr(className("android.widget.ImageView").clickable(true).find())
    );
    for (var j = 0; j < allViews.length; j++) {
        var b = allViews[j].bounds();
        var cy = Math.floor((b.top + b.bottom) / 2);
        if (cy > device.height * 0.78 && b.width() > 80 && b.height() > 30) {
            var txt = allViews[j].text() || allViews[j].desc() || "";
            // 跳过退出/取消类
            if (txt.indexOf("退出") >= 0 || txt.indexOf("取消") >= 0) continue;
            clickNode(allViews[j]);
            log("底部兜底戳: " + (txt || allViews[j].className()));
            return true;
        }
    }

    return false;
}

function clickMidScreenContinueIcon() {
    if (!textContains("The Secret Code").exists()
        && !textContains("The Crime").exists()
        && !textContains("Preview").exists()
        && !textContains("继续").exists()) {
        return false;
    }

    var candidates = [].concat(
        toArr(descContains("继续").find()),
        toArr(descContains("play").find()),
        toArr(descContains("Play").find()),
        toArr(idContains("play").find()),
        toArr(idContains("resume").find()),
        toArr(className("android.widget.ImageButton").clickable(true).find()),
        toArr(className("android.widget.ImageView").clickable(true).find())
    );

    for (var i = 0; i < candidates.length; i++) {
        var b = candidates[i].bounds();
        var cx = Math.floor((b.left + b.right) / 2);
        var cy = Math.floor((b.top + b.bottom) / 2);
        if (cx >= device.width * 0.35 && cx <= device.width * 0.65
            && cy >= device.height * 0.25 && cy <= device.height * 0.48
            && b.width() >= 40 && b.height() >= 40) {
            click(cx, cy);
            sleep(50);
            press(cx, cy, 80);
            log("点击中部继续/播放图标 @(" + cx + "," + cy + ")");
            return true;
        }
    }

    // neo-06样式的安全坐标兜底，只点中部播放按钮，不点底部循环/Home。
    if (textContains("继续").exists()) {
        var absoluteY = Math.floor(device.width * 1.57);
        var points = [];
        if (absoluteY < device.height * 0.55) {
            points.push({ px: Math.floor(device.width * 0.50), py: absoluteY });
        }
        points = points.concat([
            { x: 0.50, y: 0.400 },
            { x: 0.50, y: 0.385 },
            { x: 0.50, y: 0.415 },
            { x: 0.50, y: 0.365 },
            { x: 0.50, y: 0.435 },
        ]);
        for (var p = 0; p < points.length; p++) {
            var tapped;
            if (points[p].px !== undefined) {
                tapped = { x: points[p].px, y: points[p].py };
                click(tapped.x, tapped.y);
            } else {
                tapped = tapOnceByRatio(points[p].x, points[p].y);
            }
            sleep(50);
            press(tapped.x, tapped.y, 80);
            log("按中部坐标点击继续/播放 @(" + tapped.x + "," + tapped.y + ")");
            return true;
        }
    }

    return false;
}

function hasCenterResumeLikeButton() {
    var imgs = [].concat(
        toArr(className("android.widget.ImageButton").clickable(true).find()),
        toArr(className("android.widget.ImageView").clickable(true).find()),
        toArr(idContains("play").find()),
        toArr(idContains("resume").find())
    );

    for (var i = 0; i < imgs.length; i++) {
        var b = imgs[i].bounds();
        var cx = Math.floor((b.left + b.right) / 2);
        var cy = Math.floor((b.top + b.bottom) / 2);
        if (cx >= device.width * 0.35 && cx <= device.width * 0.65
            && cy >= device.height * 0.25 && cy <= device.height * 0.48
            && b.width() >= 40 && b.height() >= 40) {
            return true;
        }
    }
    return false;
}

function isOnHomePage() {
    if (isOnNeoScorePage()) return false;
    return textContains("学习").exists()
        || textContains("首页").exists()
        || textContains("我的课程").exists()
        || idContains("home").exists()
        || idContains("main").exists();
}

function findCourseNode(courseName) {
    // 优先精确匹配，避免 "C1" 匹配到 "C1 Bridge"
    var node = null;
    if (courseName == "C1 Bridge" || courseName == "B2+") {
        node = text(courseName).findOne(180);
    }
    if (!node && courseName == "C1") {
        // 精确匹配单独的 "C1"，不匹配 "C1 Bridge"
        node = textMatches("^\\s*C1\\s*$").findOne(180);
    }
    if (!node && courseName == "B2") {
        // 精确匹配单独的 "B2"，不匹配 "B2+"
        node = textMatches("^\\s*B2\\s*$").findOne(180);
    }
    if (!node) {
        node = text(courseName).findOne(180)
            || textContains(courseName).findOne(180);
    }
    return node;
}

// 严格检查：node对应的文字是否是已知的四个level之一
function getCourseNameFromNode(node) {
    var txt = (node.text() || "").trim();
    var known = ["C1 Bridge", "C1", "B2+", "B2"];
    for (var i = 0; i < known.length; i++) {
        if (txt == known[i]) return known[i];
    }
    // "C1" 必须精确匹配，不能是 "C1 Bridge" 之类
    if (txt == "C1" || /^C1$/.test(txt)) return "C1";
    if (txt == "B2" || /^B2$/.test(txt)) return "B2";
    return null;
}

function findVisibleLevelNodes() {
    var known = ["C1 Bridge", "C1", "B2+", "B2"];
    var nodes = [];

    for (var i = 0; i < known.length; i++) {
        var node = text(known[i]).findOne(100);
        if (!node && (known[i] == "C1" || known[i] == "B2")) {
            node = textMatches("^\\s*" + known[i] + "\\s*$").findOne(100);
        }
        if (node) {
            var b = node.bounds();
            if (b.width() > 20 && b.height() > 15) {
                nodes.push({ name: known[i], node: node });
            }
        }
    }
    return nodes;
}

function ensureLearningTarget() {
    var courses = ["C1 Bridge", "C1", "B2+", "B2"];
    var isNewTarget = !state.targetCourse;
    if (!state.targetCourse) {
        state.targetCourse = courses[Math.floor(Math.random() * courses.length)];
    }
    if (!state.targetUnit || state.targetUnit < 1 || state.targetUnit > 4) {
        state.targetUnit = random(1, 4);
    }
    if (isNewTarget || state.topicIndex < 0 || state.topicIndex === undefined || state.topicIndex === null) {
        state.topicIndex = Math.floor(Math.random() * 4);
    }
}

function getLevelTapPoint(courseName) {
    var points = {
        "C1 Bridge": { x: 0.50, y: 0.155 },
        "C1": { x: 0.50, y: 0.285 },
        "B2+": { x: 0.50, y: 0.415 },
        "B2": { x: 0.50, y: 0.545 },
    };
    return points[courseName] || points["C1 Bridge"];
}

function isOnLevelPage() {
    var hasLevelChoices = findVisibleLevelNodes().length >= 2;
    var isMenuLike = currentActivity().indexOf("Menu") >= 0 || hasLevelChoices;
    return isMenuLike
        && hasLevelChoices
        && !textContains("Unit").exists()
        && !textContains("Certification").exists()
        && !textContains("Mastery Test").exists()
        && !textContains("Dictations").exists()
        && !textContains("Focus Exercises").exists()
        && !textContains("The Secret Code").exists();
}

function handleLevelPage() {
    ensureLearningTarget();

    var nodes = findVisibleLevelNodes();

    var target = null;
    if (state.targetCourse) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].name == state.targetCourse) {
                target = nodes[i];
                break;
            }
        }
    }

    if (!target) {
        if (nodes.length > 0) {
            var idx = Math.floor(Math.random() * nodes.length);
            target = nodes[idx];
            state.targetCourse = target.name;
        }
    }

    log("Level: " + state.targetCourse + " / Unit" + state.targetUnit + " / topic#" + state.topicIndex);
    if (target) {
        clickNode(target.node);
    } else {
        var p = getLevelTapPoint(state.targetCourse);
        var tapped = tapByRatio(p.x, p.y);
        log("  level文字节点不可见，按截图坐标点击 " + state.targetCourse + " @(" + tapped.x + "," + tapped.y + ")");
    }
    var moved = waitUntil(function () {
        return textContains("Unit").exists() || textContains("Certification").exists();
    }, 1200);
    if (!moved) {
        var fallback = getLevelTapPoint(state.targetCourse);
        var tapped2 = tapByRatio(fallback.x, fallback.y);
        log("  level点击后未进入Unit，补点坐标 " + state.targetCourse + " @(" + tapped2.x + "," + tapped2.y + ")");
        moved = waitUntil(function () {
            return textContains("Unit").exists() || textContains("Certification").exists();
        }, 1200);
    }
    if (moved) {
        state.levelFailCount = 0;
        state.sameScreenCount = 0;
        return;
    }

    state.levelFailCount++;
    log("  level连续点击失败 " + state.levelFailCount + "/" + CONFIG.LEVEL_FAIL_RESTARTS);
    state.targetCourse = "";
    if (state.levelFailCount == 2) {
        tapAccessibilityShortcut();
    }
    if (state.levelFailCount >= CONFIG.LEVEL_FAIL_RESTARTS) {
        hardRestartNeo("neo-01连续点击level无效");
    }
}

function enterLearningModule() {
    log("在首页，随机选择level");

    ensureLearningTarget();
    log("本轮目标: " + state.targetCourse + " / Unit " + state.targetUnit + " / subject前四随机#" + state.topicIndex);

    var course = findCourseNode(state.targetCourse);
    if (course) {
        clickNode(course);
        waitUntil(function () {
            return currentActivity().indexOf("Menu") < 0 || textContains("Unit").exists();
        }, 1200);
        log("点击课程: " + state.targetCourse);
        return;
    }

    var learningEntries = [
        textContains("我的课程").findOne(120),
        textContains("课件").findOne(120),
        textContains("开始学习").findOne(120),
        textContains("AI练习").findOne(120),
        textContains("自主练习").findOne(120),
    ];

    for (var i = 0; i < learningEntries.length; i++) {
        var entry = learningEntries[i];
        if (entry) {
            clickNode(entry);
            sleep(300);
            log("点击学习入口: " + (entry.text() || entry.id()));
            return;
        }
    }

    log("未找到目标课程，滑动查找");
    swipeUp();
    sleep(700);
}

function isOnLessonPage() {
    return textContains("课时").exists()
        || textContains("播放").exists()
        || textContains("下一课").exists()
        || idContains("video").exists()
        || idContains("player").exists();
}

function handleLessonInteraction() {
    log("处理课时页面");

    tryAutoPlay();

    var nextBtn = textContains("下一课").findOne(1000)
        || textContains("下一步").findOne(1000)
        || textContains("下一题").findOne(1000)
        || idContains("next").findOne(1000);

    if (nextBtn) {
        nextBtn.click();
        sleep(1500);
        return;
    }

    if (isVideoPlaying()) {
        log("视频播放中，等待...");
        sleep(5000);
        return;
    }

    swipeUp();
    sleep(1500);
}

function tryAutoPlay() {
    var playBtn = textContains("播放").findOne(1000)
        || idContains("play").findOne(1000)
        || descContains("播放").findOne(1000);

    if (playBtn && !isVideoPlaying()) {
        playBtn.click();
        sleep(1000);
        log("点击了播放按钮");
    }
}

function isVideoPlaying() {
    var pauseBtn = textContains("暂停").findOne(500)
        || idContains("pause").findOne(500);

    return pauseBtn != null;
}

function hasTrueFalseButtons() {
    var buttons = className("android.widget.Button").find();
    for (var i = 0; i < buttons.length; i++) {
        var s = buttons[i].text();
        if (/^\s*(True|False|TRUE|FALSE|true|false)\s*[:：]?$/.test(s)) return true;
    }
    return false;
}

function isAnswerText(s) {
    if (!s || s.length < 1) return false;
    if (s == "") return false;
    if (s.indexOf("The Secret Code") >= 0 || s.indexOf("The Crime") >= 0) return false;
    if (s.indexOf("Preview") >= 0 || s.indexOf("继续") >= 0 || s.indexOf("退出") >= 0) return false;
    if (s.indexOf("提交") >= 0 || s.indexOf("确定") >= 0 || s.indexOf("下一") >= 0) return false;
    if (s.indexOf("Product") >= 0 || s.indexOf("Unit") >= 0) return false;
    return true;
}

function collectVisibleAnswerChoices() {
    var options = [];
    var seen = {};
    var texts = className("android.widget.TextView").find();

    for (var i = 0; i < texts.length; i++) {
        var t = texts[i];
        var s = (t.text() || "").replace(/^\s+|\s+$/g, "");
        if (!isAnswerText(s)) continue;

        var p = t.parent();
        var node = (p && p.clickable()) ? p : t;
        var b = node.bounds();
        var textBounds = t.bounds();

        if (b.top < device.height * 0.25 || b.bottom > device.height * 0.82) continue;
        if (b.width() < device.width * 0.22 || b.height() < 35 || b.height() > 180) continue;
        if (textBounds.top < device.height * 0.28 || textBounds.top > device.height * 0.80) continue;

        var key = Math.floor(b.left) + "," + Math.floor(b.top) + "," + Math.floor(b.right) + "," + Math.floor(b.bottom);
        if (seen[key]) continue;
        seen[key] = true;
        options.push({ node: node, text: s });
    }

    return options;
}

function hasVisibleAnswerChoices() {
    return collectVisibleAnswerChoices().length >= 2;
}

function collectClickableTextChoices() {
    var options = [];
    var seen = {};
    var texts = className("android.widget.TextView").find();
    for (var i = 0; i < texts.length; i++) {
        var s = texts[i].text();
        if (!s || s.length < 2) continue;
        if (s == "" || s.indexOf("Product") >= 0) continue;
        var p = texts[i].parent();
        var b = (p && p.clickable()) ? p.bounds() : texts[i].bounds();
        if (b.top < device.height * 0.2 || b.bottom > device.height * 0.88) continue;
        if (b.width() < device.width * 0.4 || b.height() < 40 || b.height() > 280) continue;
        var key = b.left + "," + b.top + "," + b.right + "," + b.bottom;
        if (seen[key]) continue;
        seen[key] = true;
        // 优先存 clickable 父级，fallback 到文字本身
        options.push(p && p.clickable() ? p : texts[i]);
    }
    return options;
}

// 收集纯文字标签选项（父级不可点击，靠坐标戳）
function collectTextLabelChoices() {
    var options = [];
    var seen = {};
    var texts = className("android.widget.TextView").find();
    for (var i = 0; i < texts.length; i++) {
        var s = texts[i].text();
        if (!s || s.length < 2) continue;
        if (s == "" || s.indexOf("Product") >= 0 || s.indexOf("Secret") >= 0) continue;
        var p = texts[i].parent();
        // 只收集父级不可点击的文字（clickable 的已经在上面处理了）
        if (p && p.clickable()) continue;
        var b = texts[i].bounds();
        if (b.top < device.height * 0.25 || b.top > device.height * 0.82) continue;
        if (b.width() < 60 || b.height() < 30 || b.height() > 200) continue;
        var key = b.left + "," + b.top + "," + b.right + "," + b.bottom;
        if (seen[key]) continue;
        seen[key] = true;
        options.push(texts[i]);
    }
    return options;
}

function hasClickableTextChoices() {
    return collectClickableTextChoices().length >= 2;
}

function clickTextLabelChoice() {
    var options = collectTextLabelChoices();
    if (options.length == 0) return false;

    var idx = Math.floor(Math.random() * options.length);
    var opt = options[idx];
    var b = opt.bounds();
    var cx = Math.floor((b.left + b.right) / 2);
    var cy = Math.floor((b.top + b.bottom) / 2);

    log("随机戳文字Label '" + opt.text() + "' @(" + cx + "," + cy + ")");
    click(cx, cy);
    sleep(100);
    shell("input tap " + cx + " " + cy, true);
    return true;
}

function clickClickableTextChoice() {
    var options = collectClickableTextChoices();
    if (options.length == 0) return false;

    var idx = Math.floor(Math.random() * options.length);
    var opt = options[idx];
    var b = opt.bounds();
    var cx = Math.floor((b.left + b.right) / 2);
    var cy = Math.floor((b.top + b.bottom) / 2);

    log("选项 #" + idx + "/" + options.length + " @(" + cx + "," + cy + ")");
    // 坐标 + shell 双戳，确保命中
    click(cx, cy);
    sleep(80);
    shell("input tap " + cx + " " + cy, true);
    return true;
}

function clickVisibleAnswerChoice() {
    var options = collectVisibleAnswerChoices();
    if (options.length < 2) return false;

    var idx = Math.floor(Math.random() * options.length);
    var opt = options[idx];
    var b = opt.node.bounds();
    var cx = Math.floor((b.left + b.right) / 2);
    var cy = Math.floor((b.top + b.bottom) / 2);

    log("随机点击可见答案: " + opt.text + " #" + idx + "/" + options.length + " @(" + cx + "," + cy + ")");
    click(cx, cy);
    sleep(50);
    shell("input tap " + cx + " " + cy, true);
    return true;
}

function collectOrderedAnswerOptions() {
    var options = [];
    var seen = {};

    function addNode(node, label) {
        if (!node) return;
        var b = node.bounds();
        if (b.top < device.height * 0.20 || b.bottom > device.height * 0.90) return;
        if (b.width() < 40 || b.height() < 25) return;
        var key = Math.floor(b.left) + "," + Math.floor(b.top) + "," + Math.floor(b.right) + "," + Math.floor(b.bottom);
        if (seen[key]) return;
        seen[key] = true;
        options.push({ node: node, text: label || "", top: b.top, left: b.left });
    }

    var visible = collectVisibleAnswerChoices();
    for (var i = 0; i < visible.length; i++) {
        addNode(visible[i].node, visible[i].text);
    }

    var clickable = collectClickableTextChoices();
    for (var c = 0; c < clickable.length; c++) {
        addNode(clickable[c], clickable[c].text ? clickable[c].text() : "");
    }

    var labels = collectTextLabelChoices();
    for (var l = 0; l < labels.length; l++) {
        addNode(labels[l], labels[l].text ? labels[l].text() : "");
    }

    var radios = className("android.widget.RadioButton").find();
    for (var r = 0; r < radios.length; r++) addNode(radios[r], radios[r].text ? radios[r].text() : "");

    var checks = className("android.widget.CheckBox").find();
    for (var k = 0; k < checks.length; k++) addNode(checks[k], checks[k].text ? checks[k].text() : "");

    options.sort(function (a, b) {
        if (Math.abs(a.top - b.top) > 20) return a.top - b.top;
        return a.left - b.left;
    });
    return options;
}

function clickOrderedOption(index) {
    var options = collectOrderedAnswerOptions();
    if (options.length == 0) return false;

    var opt = options[index % options.length];
    var b = opt.node.bounds();
    var cx = Math.floor((b.left + b.right) / 2);
    var cy = Math.floor((b.top + b.bottom) / 2);
    log("按顺序点击选项 #" + index + "/" + options.length + " '" + opt.text + "' @(" + cx + "," + cy + ")");
    click(cx, cy);
    return true;
}

function isOnExercisePage() {
    return textContains("选择").exists()
        || textContains("答案").exists()
        || textContains("提交").exists()
        || textContains("A").exists()
        || textContains("B").exists()
        || textMatches("^\\s*(True|False|TRUE|FALSE|true|false)\\s*$").exists()
        || hasBlankSlots()
        || hasVisibleAnswerChoices()
        || hasMiddleImageOptions()
        || hasTrueFalseButtons()
        || hasClickableTextChoices()
        || hasTextLabelChoices()
        || className("android.widget.RadioButton").exists()
        || className("android.widget.CheckBox").exists();
}

function hasTextLabelChoices() {
    return collectTextLabelChoices().length >= 2;
}

function countVisibleBlankSlots() {
    var count = 0;
    var seen = {};
    var texts = className("android.widget.TextView").find();

    for (var i = 0; i < texts.length; i++) {
        var t = texts[i];
        var s = t.text() || "";
        if (s.indexOf("_") < 0) continue;

        var b = t.bounds();
        if (b.top < device.height * 0.12 || b.bottom > device.height * 0.82) continue;
        if (b.width() < 20 || b.height() < 10) continue;

        var key = s + "@" + Math.floor(b.left) + "," + Math.floor(b.top);
        if (seen[key]) continue;
        seen[key] = true;

        var matches = s.match(/_+/g);
        if (matches) count += matches.length;
    }

    return Math.min(count, 8);
}

function hasBlankSlots() {
    return countVisibleBlankSlots() > 0;
}

function clickOrderedForBlankSlots() {
    var blanks = countVisibleBlankSlots();
    if (blanks <= 0) return false;

    log("检测到完形填空下划线槽位: " + blanks + " 个，本轮连续按顺序点击前 " + blanks + " 个选项");
    for (var i = 0; i < blanks; i++) {
        if (!clickOrderedOption(i)) {
            log("  第" + (i + 1) + "次顺序选择失败，停止");
            break;
        }
        sleep(450);
    }

    sleep(500);
    submitAnswer();
    sleep(250);
    return true;
}

function handleExercise() {
    log("处理练习页面");

    // 1. 只点明确的"继续"文字；练习页底部常有重播按钮，不能启用底部兜底。
    if (clickContinueIfExists(false)) return;

    // 2. 完形填空：连续下划线算一个空；有几个空，就按顺序点击前几个选项。
    if (clickOrderedForBlankSlots()) return;

    // 3. True/False
    if (clickTrueFalseOption()) { sleep(180); return; }

    // 4. neo-07 这类大卡片答案：True/False 或任意字符串，看到就随机选。
    if (clickVisibleAnswerChoice()) { sleep(180); submitAnswer(); sleep(120); return; }

    // 5. 中间区域图片选项：没有文字选项时，随机点图片。
    if (clickImageOption()) { sleep(180); submitAnswer(); sleep(120); return; }

    // 6. 纯文本选项（有clickable父级，最常见）
    if (clickClickableTextChoice()) { sleep(180); submitAnswer(); sleep(120); return; }

    // 7. 纯文字标签（无clickable父级，坐标戳）
    if (clickTextLabelChoice()) { sleep(180); submitAnswer(); sleep(120); return; }

    // 8. ABCD/RadioButton/CheckBox 等标准控件
    if (clickRandomOption()) { sleep(180); submitAnswer(); sleep(120); return; }

    // 9. 口语/填空 特殊题型
    if (textContains("跟读").exists() || textContains("录音").exists() || textContains("说话").exists()) {
        handleSpeakingExercise(); return;
    }
    if (textContains("填空").exists() || className("android.widget.EditText").exists()) {
        handleFillBlank(); return;
    }

    // 10. 无匹配 → 滑动
    swipeUp();
    sleep(350);
}

function clickTrueFalseOption() {
    var options = [];
    var buttons = className("android.widget.Button").find();

    for (var i = 0; i < buttons.length; i++) {
        var s = buttons[i].text();
        var bb = buttons[i].bounds();
        if (/^\s*(True|False|TRUE|FALSE|true|false)\s*[:：]?$/.test(s)
            && bb.top > device.height * 0.25 && bb.bottom < device.height * 0.82) {
            options.push(buttons[i]);
        }
    }

    if (options.length == 0) {
        var texts = textMatches("^\\s*(True|False|TRUE|FALSE|true|false)\\s*[:：]?$").find();
        for (var j = 0; j < texts.length; j++) {
            var tb = texts[j].bounds();
            if (tb.top > device.height * 0.25 && tb.bottom < device.height * 0.82) {
                options.push(texts[j]);
            }
        }
    }

    if (options.length == 0) {
        if (textContains("The Secret Code").exists() && textContains("The Crime").exists()) {
            var useTrue = Math.random() < 0.5;
            var tapped = tapByRatio(useTrue ? 0.26 : 0.74, 0.335);
            log("True/False文字节点不可见，按截图坐标随机点击 " + (useTrue ? "True" : "False") + " @(" + tapped.x + "," + tapped.y + ")");
            return true;
        }
        return false;
    }

    var idx = Math.floor(Math.random() * options.length);
    var opt = options[idx];
    var parent = opt.parent();
    var node = (parent && parent.bounds().width() > opt.bounds().width() * 1.5) ? parent : opt;
    var b = node.bounds();
    var cx = Math.floor((b.left + b.right) / 2);
    var cy = Math.floor((b.top + b.bottom) / 2);
    click(cx, cy);
    sleep(50);
    shell("input tap " + cx + " " + cy, true);
    log("随机点击True/False: " + (opt.text() || idx) + " @(" + cx + "," + cy + ")");
    return true;
}

function clickImageOption() {
    var options = collectMiddleImageOptions();
    if (options.length < 2) return false;

    var idx = Math.floor(Math.random() * options.length);
    var opt = options[idx];
    var b = opt.bounds();
    var x = Math.floor((b.left + b.right) / 2);
    var y = Math.floor((b.top + b.bottom) / 2);
    click(x, y);
    log("随机点击中间图片选项 #" + idx + "/" + options.length + " @(" + x + "," + y + ") " + (opt.desc() || ""));
    return true;
}

function hasMiddleImageOptions() {
    return collectMiddleImageOptions().length >= 2;
}

function collectMiddleImageOptions() {
    var options = [];
    // 收集所有图片选项：clickable ImageView + clickable ImageButton + 带描述的ImageView
    var imgs = [].concat(
        toArr(className("android.widget.ImageView").clickable(true).find()),
        toArr(className("android.widget.ImageButton").clickable(true).find()),
        toArr(className("android.widget.ImageView").find()),
        toArr(className("android.view.View").clickable(true).find()),
        toArr(className("android.widget.FrameLayout").clickable(true).find()),
        toArr(className("android.widget.LinearLayout").clickable(true).find()),
        toArr(className("android.widget.RelativeLayout").clickable(true).find())
    );
    // 也收集有 contentDescription 的非 clickable ImageView（纯图片选项常靠 desc 标识）
    var descImgs = className("android.widget.ImageView").find();
    for (var d = 0; d < descImgs.length; d++) {
        if (descImgs[d].desc() && descImgs[d].desc().length > 0) {
            imgs.push(descImgs[d]);
        }
    }

    var seen = {};
    for (var i = 0; i < imgs.length; i++) {
        var b = imgs[i].bounds();
        // 图片选项可能在上方四分之一到中部；过滤状态栏、底部重播/Home、太小图标。
        if (b.top < device.height * 0.08 || b.bottom > device.height * 0.78) continue;
        if (b.width() < 60 || b.height() < 60) continue;
        if (b.width() > device.width * 0.45 || b.height() > device.height * 0.35) continue;
        var cx = Math.floor((b.left + b.right) / 2);
        if (cx < device.width * 0.08 || cx > device.width * 0.92) continue;
        var cy = Math.floor((b.top + b.bottom) / 2);
        if (cy < device.height * 0.12 || cy > device.height * 0.70) continue;
        var key = Math.floor(b.left) + "," + Math.floor(b.top) + "," + Math.floor(b.right) + "," + Math.floor(b.bottom);
        if (seen[key]) continue;
        seen[key] = true;
        options.push(imgs[i]);
    }

    return options;
}

function clickRandomOption() {
    var options = [];
    var seenKeys = {};

    function addOpt(node, tag) {
        var b = node.bounds();
        var key = Math.floor(b.left) + "," + Math.floor(b.top) + "," + Math.floor(b.right) + "," + Math.floor(b.bottom);
        if (seenKeys[key]) return;
        seenKeys[key] = true;
        options.push(node);
    }

    // 1. RadioButton / CheckBox
    var radios = className("android.widget.RadioButton").find();
    for (var i = 0; i < radios.length; i++) addOpt(radios[i], "radio");
    var checks = className("android.widget.CheckBox").find();
    for (var i = 0; i < checks.length; i++) addOpt(checks[i], "check");

    // 2. A/B/C/D 文本选项（扩展匹配: "A.", "A)", "(A)", "A、", "A ", "A:"）
    var abcdPatterns = [
        "^[A-F][.．)、:：]",
        "^\\s*[A-F]\\s*$",
        "^\\([A-F]\\)",
        "^[A-F]、"
    ];
    for (var p = 0; p < abcdPatterns.length; p++) {
        var matches = textMatches(abcdPatterns[p]).find();
        for (var m = 0; m < matches.length; m++) addOpt(matches[m], "ABCD");
    }

    // 3. True/False 按钮
    var btns = className("android.widget.Button").find();
    for (var b = 0; b < btns.length; b++) {
        var s = btns[b].text();
        if (/^\s*(True|False|TRUE|FALSE|true|false)\s*[:：]?$/.test(s)) addOpt(btns[b], "TF-btn");
    }
    // True/False 文本
    var tfTexts = textMatches("^\\s*(True|False|TRUE|FALSE|true|false|T|F)\\s*[:：]?$").find();
    for (var t = 0; t < tfTexts.length; t++) addOpt(tfTexts[t], "TF-text");

    // 4. clickable View 选项中在屏幕中间的
    var views = className("android.view.View").clickable(true).find();
    for (var v = 0; v < views.length; v++) {
        var vb = views[v].bounds();
        if (vb.top < device.height * 0.2 || vb.bottom > device.height * 0.88) continue;
        if (vb.width() < 80 || vb.height() < 40 || vb.height() > 300) continue;
        addOpt(views[v], "view");
    }

    // 5. 纯文本选项（有 clickable 父级，中间区域）
    var texts = className("android.widget.TextView").find();
    for (var ct = 0; ct < texts.length; ct++) {
        var txt = texts[ct].text();
        if (!txt || txt.length < 2) continue;
        if (txt == "" || txt.indexOf("Product") >= 0) continue;
        var parent = texts[ct].parent();
        var pb = (parent && parent.clickable()) ? parent.bounds() : texts[ct].bounds();
        if (pb.top < device.height * 0.22 || pb.bottom > device.height * 0.85) continue;
        if (pb.width() < device.width * 0.4 || pb.height() < 40 || pb.height() > 280) continue;
        addOpt(parent && parent.clickable() ? parent : texts[ct], "text");
    }

    if (options.length === 0) {
        var clickableViews = className("android.view.View").clickable(true).find();
        for (var i = 0; i < clickableViews.length; i++) {
            var view = clickableViews[i];
            var bounds = view.bounds();
            if (bounds.width() > 100 && bounds.height() > 30 && bounds.height() < 200) {
                options.push(view);
            }
        }
    }

    if (options.length > 0) {
        var randomIndex = Math.floor(Math.random() * Math.min(options.length, 4));
        var opt = options[randomIndex];
        var b = opt.bounds();
        var cx = Math.floor((b.left + b.right) / 2);
        var cy = Math.floor((b.top + b.bottom) / 2);
        log("选择了选项 " + randomIndex + "/" + options.length + " @(" + cx + "," + cy + ")");
        click(cx, cy);
        sleep(80);
        shell("input tap " + cx + " " + cy, true);
        return true;
    }

    return false;
}

function handleSpeakingExercise() {
    log("处理口语练习");

    var micBtn = idContains("mic").findOne(1000)
        || idContains("record").findOne(1000)
        || descContains("录音").findOne(1000)
        || textContains("开始录音").findOne(1000)
        || textContains("按住说话").findOne(1000);

    if (micBtn) {
        micBtn.click();
        sleep(3000 + Math.random() * 2000);

        var stopBtn = textContains("停止").findOne(500)
            || idContains("stop").findOne(500);
        if (stopBtn) {
            stopBtn.click();
        } else {
            micBtn.click();
        }
        sleep(1500);
    }

    var submitBtn = textContains("提交").findOne(1000)
        || textContains("完成").findOne(1000)
        || textContains("下一题").findOne(1000);
    if (submitBtn) {
        submitBtn.click();
        sleep(1500);
    }
}

function handleFillBlank() {
    log("处理填空题");

    var editText = className("android.widget.EditText").findOne(2000);
    if (editText) {
        editText.click();
        sleep(500);
        editText.setText("answer");
        sleep(1000);
    }

    var submitBtn = textContains("提交").findOne(1000)
        || textContains("确定").findOne(1000)
        || textContains("下一题").findOne(1000);
    if (submitBtn) {
        submitBtn.click();
        sleep(1500);
    }
}

function submitAnswer() {
    var submitBtn = textContains("提交").findOne(180)
        || textContains("确认").findOne(180)
        || textContains("确定").findOne(180)
        || textContains("下一题").findOne(180)
        || idContains("submit").findOne(180);

    if (submitBtn) {
        submitBtn.click();
        log("提交答案");
        sleep(500);
    }
}

function isOnResultPage() {
    return textContains("得分").exists()
        || textContains("Score").exists()
        || textContains("score").exists()
        || textContains("成绩").exists()
        || isOnNeoScorePage();
}

function isOnNeoScorePage() {
    if (currentActivity() != "com.nexgen.nsa.MainActivity") return false;
    if (textContains("Preview").exists() || text("GO").exists()) return false;
    if (textMatches("^\\s*(True|False|TRUE|FALSE|true|false)\\s*$").exists()) return false;

    var nums = textMatches("^\\s*\\d{2,4}\\s*$").find();
    for (var i = 0; i < nums.length; i++) {
        var b = nums[i].bounds();
        if (b.top >= device.height * 0.08 && b.bottom <= device.height * 0.38
            && b.width() >= device.width * 0.15 && b.height() >= 60) {
            return true;
        }
    }
    // neo-08 这类结果页至少有左上关闭X，没有题目选项；有时分数数字不是TextView。
    return hasTopLeftCloseButton() && !hasVisibleAnswerChoices() && !hasClickableTextChoices();
}

function hasTopLeftCloseButton() {
    var closeNodes = [].concat(
        toArr(text("✗").find()),
        toArr(text("×").find()),
        toArr(text("X").find()),
        toArr(text("✘").find()),
        toArr(descContains("close").find()),
        toArr(idContains("close").find())
    );

    for (var i = 0; i < closeNodes.length; i++) {
        var b = closeNodes[i].bounds();
        var cx = Math.floor((b.left + b.right) / 2);
        var cy = Math.floor((b.top + b.bottom) / 2);
        if (cx < device.width * 0.25 && cy < device.height * 0.18) return true;
    }
    return false;
}

function findBottomRightHomeButton() {
    var exact = id("com.nexgen.nsa:id/image_button_home").findOne(300)
        || idContains("image_button_home").findOne(300);
    if (exact) return exact;

    var candidates = [];
    var selectors = [
        desc("Home").findOne(200),
        desc("home").findOne(200),
        desc("首页").findOne(200),
        text("Home").findOne(200),
        text("首页").findOne(200),
    ];

    for (var i = 0; i < selectors.length; i++) {
        if (selectors[i]) candidates.push(selectors[i]);
    }

    for (var j = 0; j < candidates.length; j++) {
        var b = candidates[j].bounds();
        var cx = Math.floor((b.left + b.right) / 2);
        var cy = Math.floor((b.top + b.bottom) / 2);
        if (cx >= device.width * 0.65 && cy >= device.height * 0.72 && cy <= device.height * 0.93) {
            return candidates[j];
        }
    }

    return null;
}

function tapBottomRightHome() {
    // neo-08 小房子按钮中心约 x=75%, y=87%。这里扫右下 Home 圆形按钮区域，
    // 避免设备坐标系、导航栏高度或截图缩放差异导致单点点不中。
    var absoluteX = Math.floor(device.width * 0.75);
    var absoluteY = Math.floor(device.width * 1.885);
    if (absoluteY < device.height * 0.98) {
        click(absoluteX, absoluteY);
        sleep(60);
        press(absoluteX, absoluteY, 80);
        sleep(120);
        if (isOnLevelPage() || isOnUnitListPage() || isOnTopicPage() || currentActivity().indexOf("Menu") >= 0) {
            log("  Home命中 absolute @(" + absoluteX + "," + absoluteY + ")");
            return;
        }
    }

    var xRatios = [0.74, 0.76, 0.78];
    var yRatios = [0.85, 0.87, 0.89];
    log("  尝试点击Home区域 device=" + device.width + "x" + device.height);
    for (var yi = 0; yi < yRatios.length; yi++) {
        for (var xi = 0; xi < xRatios.length; xi++) {
            var x = Math.floor(device.width * xRatios[xi]);
            var y = Math.floor(device.height * yRatios[yi]);
            click(x, y);
            sleep(50);
            press(x, y, 80);
            sleep(120);
            if (isOnLevelPage() || isOnUnitListPage() || isOnTopicPage() || currentActivity().indexOf("Menu") >= 0) {
                log("  Home命中 @(" + x + "," + y + ") ratio=(" + xRatios[xi] + "," + yRatios[yi] + ")");
                return;
            }
        }
    }
    log("  Home区域扫点仍未命中");
}

function handleResultPage() {
    log("处理得分页面");

    if (CONFIG.RESTART_AFTER_RESULT) {
        hardRestartNeo("完成一轮后重启，避免长时间运行触摸/无障碍失效", true);
        return;
    }

    tapBottomRightHome();

    state.targetCourse = "";
    state.targetUnit = random(1, 4);
    state.targetTopicName = "";
    state.topicIndex = 0;
    state.samePageCount = 0;
    log("已回Home，重置下一轮随机目标");
    waitUntil(function () {
        return !isOnResultPage()
            && (isOnLevelPage() || isOnUnitListPage() || currentActivity().indexOf("Menu") >= 0);
    }, 2000);
}

// ============================================================
// 单元列表页（ProMenuActivity / Unit 选择页）
// C1 Bridge、C2 Bridge 等课程的 Unit 列表
// ============================================================
function isOnMenuPage() {
    // 包含 "Unit" 文字 或 命中 ProMenuActivity
    return textContains("Unit").exists()
        || textContains("Certification").exists()
        || currentActivity().indexOf("Menu") >= 0;
}

function isOnUnitListPage() {
    if (currentActivity().indexOf("Menu") < 0) return false;
    if (textContains("Certification").exists()) return true;
    return textMatches("^\\s*Unit\\s*[1-4]\\b.*").exists()
        && !textContains("Mastery Test").exists()
        && !textContains("Dictations").exists()
        && !textContains("Focus Exercises").exists();
}

function isOnLoadingPage() {
    var act = currentActivity();
    return act.indexOf("ProgressDialog") >= 0
        || act.indexOf("Loading") >= 0;
}

function parseTopicNameFromUnitText(s) {
    var m = (s || "").match(/Unit\s*\d+\s*(?:-|\s+)\s*(.+)/);
    return m ? m[1].replace(/^\s+|\s+$/g, "") : "";
}

function getUnitTapPoint(unitNum) {
    var yPoints = [0, 0.302, 0.408, 0.518, 0.625];
    var y = yPoints[unitNum] || yPoints[1];
    return { x: 0.50, y: y };
}

function getTopicTapPoint(topicIndex) {
    var yPoints = [0.400, 0.503, 0.602, 0.705];
    var idx = topicIndex % yPoints.length;
    return { x: 0.50, y: yPoints[idx] };
}

function findTopicNameNearUnit(unitNode) {
    if (!unitNode) return "";

    var ub = unitNode.bounds();
    var unitCx = Math.floor((ub.left + ub.right) / 2);
    var allText = className("android.widget.TextView").find();
    var best = null;
    var bestDistance = 999999;

    for (var i = 0; i < allText.length; i++) {
        var t = allText[i];
        var s = t.text();
        if (!s) continue;
        if (s.indexOf("Unit") >= 0) continue;
        if (s.indexOf("Certification") >= 0) continue;
        if (s.indexOf("Mastery Test") >= 0) continue;
        if (s.indexOf("Dictations") >= 0 || s.indexOf("Focus Exercises") >= 0) continue;

        var b = t.bounds();
        var cx = Math.floor((b.left + b.right) / 2);
        var nearX = Math.abs(cx - unitCx) <= 160;
        var nearBelow = b.top >= ub.top && b.top <= ub.bottom + 140;
        if (!nearX || !nearBelow) continue;

        var distance = Math.abs(cx - unitCx) + Math.abs(b.top - ub.top);
        if (distance < bestDistance) {
            best = s;
            bestDistance = distance;
        }
    }

    return best || "";
}

function handleMenuPage() {
    log("=== 处理单元列表页 ===");

    ensureLearningTarget();

    if (!state.targetUnit || state.targetUnit < 1 || state.targetUnit > 4) {
        state.targetUnit = random(1, 4);
    }

    toast("Menu页面，随机戳Unit" + state.targetUnit);

    var target = textContains("Unit " + state.targetUnit).findOne(180)
        || textContains("Unit" + state.targetUnit).findOne(180);

    if (!target) {
        var units = textMatches("^Unit\\s*[1-4]").find();
        if (units.length > 0) {
            target = units[Math.floor(Math.random() * Math.min(units.length, 4))];
            var m = target.text().match(/Unit\s*(\d+)/);
            if (m) state.targetUnit = parseInt(m[1]);
        }
    }

    if (target) {
        var txt = target.text();
        state.targetTopicName = parseTopicNameFromUnitText(txt) || findTopicNameNearUnit(target);
        log("  目标文字: " + txt + " topic=" + state.targetTopicName);
    }

    var unitPoint = getUnitTapPoint(state.targetUnit);
    var tapped = tapOnceByRatio(unitPoint.x, unitPoint.y);
    log("  单击Unit" + state.targetUnit + "卡片中心 @(" + tapped.x + "," + tapped.y + ")");
    toast("已戳 Unit" + state.targetUnit);

    var moved = waitUntil(function () {
        var a = currentActivity();
        if (a.indexOf("BottomSheet") >= 0) return true;
        if (a.indexOf("Menu") < 0) return true;
        if (isOnTopicPage()) return true;
        if (!isOnUnitListPage()) return true;
        return false;
    }, 1500);

    var act = currentActivity();
    log("  点击后Activity: " + act + (moved ? " (已跳转)" : ""));

    if (moved) {
        if (act.indexOf("ProgressDialog") >= 0) {
            log("  等待loading...");
            waitActivityGone("android.app.ProgressDialog", 1800);
        }
        return;
    }

    log("  单击无效，再单击一次Unit卡片中心");
    tapped = tapOnceByRatio(unitPoint.x, unitPoint.y);

    moved = waitUntil(function () {
        var a = currentActivity();
        if (a.indexOf("BottomSheet") >= 0) return true;
        if (a.indexOf("Menu") < 0) return true;
        if (isOnTopicPage()) return true;
        if (!isOnUnitListPage()) return true;
        return false;
    }, 1500);

    if (moved) {
        log("  ★ 第二次单击成功");
        if (currentActivity().indexOf("ProgressDialog") >= 0) {
            waitActivityGone("android.app.ProgressDialog", 1800);
        }
        return;
    }

    log("  Unit卡片点击无效，停留等待下一轮重试");
    sleep(300);
}

// ============================================================
// Unit 子课程列表页（ProMenuActivity + 含 Mastery Test/Dictations 等）
// 点进 Unit 后的 topic 选择页
// ============================================================
function isOnTopicPage() {
    if (currentActivity().indexOf("Menu") < 0) return false;
    if (isOnUnitListPage()) return false;
    return hasTopicSubjectText()
        || textContains("Mastery Test").exists()
        || textContains("Dictations").exists()
        || textContains("Focus Exercises").exists();
}

function hasTopicSubjectText() {
    return textContains("Secret Code").exists()
        || textContains("Life Choice").exists()
        || textContains("Life Choices").exists()
        || textContains("The Crime").exists();
}

function isTopicSubjectName(s) {
    return s.indexOf("Secret Code") >= 0
        || s.indexOf("Life Choice") >= 0
        || s.indexOf("Life Choices") >= 0
        || s.indexOf("The Crime") >= 0;
}

function normalizeTopicText(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function fuzzyTopicMatch(textValue, topicName) {
    var a = normalizeTopicText(textValue);
    var b = normalizeTopicText(topicName);
    if (!a || !b) return false;
    return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
}

function collectSubjectNodes() {
    var preferred = [];
    var namedTopics = [];
    var fallback = [];
    var genericClickable = [];
    var seen = {};
    var allText = className("android.widget.TextView").find();

    for (var i = 0; i < allText.length; i++) {
        var t = allText[i];
        var s = t.text();
        if (!s) continue;
        var unitSubjectMatch = s.match(/Unit\s*(\d+)\s*(?:-|\s+)\s*(.+)/);
        var isKnownTopic = isTopicSubjectName(s);
        var matchesTargetTopic = state.targetTopicName && fuzzyTopicMatch(s, state.targetTopicName);
        if (!unitSubjectMatch && s.indexOf("Unit") >= 0) continue;
        if (s.indexOf("Mastery Test") >= 0) continue;
        if (s.indexOf("Dictations") >= 0 || s.indexOf("Focus Exercises") >= 0) continue;
        if (s == "Topic" || s == "Topics" || s == "Subject" || s == "Subjects") continue;

        var b = t.bounds();
        if (b.top < device.height * 0.15 || b.bottom > device.height * 0.9) continue;
        if (b.width() < 40 || b.height() < 15) continue;

        var key = s + "@" + b.top;
        if (seen[key]) continue;
        seen[key] = true;

        if (unitSubjectMatch && parseInt(unitSubjectMatch[1]) == state.targetUnit) {
            preferred.push(t);
        } else if (matchesTargetTopic) {
            namedTopics.push(t);
        } else if (!unitSubjectMatch) {
            fallback.push(t);
        }
    }

    if (preferred.length == 0 && namedTopics.length == 0 && fallback.length == 0) {
        var views = className("android.view.View").clickable(true).find();
        for (var v = 0; v < views.length; v++) {
            var vb = views[v].bounds();
            if (vb.top < device.height * 0.15 || vb.bottom > device.height * 0.9) continue;
            if (vb.width() < device.width * 0.4 || vb.height() < 50 || vb.height() > 260) continue;
            genericClickable.push(views[v]);
        }
    }

    var nodes = (state.targetTopicName && namedTopics.length > 0) ? namedTopics
        : (preferred.length > 0 ? preferred : (fallback.length > 0 ? fallback : genericClickable));
    nodes.sort(function (a, b) {
        return a.bounds().top - b.bounds().top;
    });

    return nodes.slice(0, 4);
}

function getSubjectText(node) {
    var s = node.text() || "subject";
    var m = s.match(/Unit\s*\d+\s*(?:-|\s+)\s*(.+)/);
    return m ? m[1] : s;
}

function handleTopicPage() {
    ensureLearningTarget();

    log("处理subject列表页，当前随机subjectIndex=" + state.topicIndex);
    toast("Subject #" + state.topicIndex);

    var subjects = collectSubjectNodes();
    log("  找到前四subject候选 " + subjects.length + " 个");

    if (subjects.length == 0) {
        var topicPoint = getTopicTapPoint(state.topicIndex);
        var tapped = tapByRatio(topicPoint.x, topicPoint.y);
        log("  找不到subject文字节点，按截图坐标点击subject#" + state.topicIndex + " @(" + tapped.x + "," + tapped.y + ")");
        waitUntil(function () {
            var a = currentActivity();
            return a.indexOf("Menu") < 0 || a.indexOf("BottomSheet") >= 0;
        }, 1200);
        return;
    }

    var idx = state.topicIndex % Math.min(subjects.length, 4);
    var el = subjects[idx];
    var subjectText = getSubjectText(el);
    var b = el.bounds();
    var cx = Math.floor((b.left + b.right) / 2);
    var cy = Math.floor((b.top + b.bottom) / 2);

    log("  戳 Unit" + state.targetUnit + " - " + subjectText + " @(" + cx + "," + cy + ")");

    clickNode(el);

    // 轮询等待离开Menu或进入BottomSheet
    var moved = waitUntil(function () {
        var a = currentActivity();
        return a.indexOf("Menu") < 0 || a.indexOf("BottomSheet") >= 0;
    }, 1000);

    if (moved) { log("  ★ 进入成功"); return; }

    log("  click无效，试 shell input tap");
    shell("input tap " + cx + " " + cy, true);

    moved = waitUntil(function () {
        var a = currentActivity();
        return a.indexOf("Menu") < 0 || a.indexOf("BottomSheet") >= 0;
    }, 1000);

    if (moved) { log("  ★ shell进入成功"); return; }

    log("  shell无效，试 press");
    press(cx, cy, 200);

    moved = waitUntil(function () {
        var a = currentActivity();
        return a.indexOf("Menu") < 0 || a.indexOf("BottomSheet") >= 0;
    }, 1000);

    if (moved) { log("  ★ press进入成功"); return; }

    log("  全部失败，滑动");
    swipeUp();
    sleep(700);
}

// ============================================================
// 步骤选择弹窗（BottomSheetDialog）
// 点 topic 后弹出的 Step 1 Preview / Step 2 ... 选择
// ============================================================
function isOnStepSheet() {
    return currentActivity().indexOf("BottomSheet") >= 0
        || currentActivity().indexOf("bottomsheet") >= 0
        || (textContains("Select Step").exists() && textContains("Step 1").exists());
}

function findFirstStepSheetOption() {
    var candidates = [];
    var texts = className("android.widget.TextView").find();
    for (var i = 0; i < texts.length; i++) {
        var s = texts[i].text();
        if (!s) continue;
        if (s.indexOf("Select Step") >= 0) continue;
        if (s.indexOf("Step 1") >= 0 || s.indexOf("Preview") >= 0 || s.indexOf("Practice") >= 0) {
            candidates.push(texts[i]);
        }
    }

    if (candidates.length == 0) {
        var views = className("android.view.View").clickable(true).find();
        for (var j = 0; j < views.length; j++) {
            var b = views[j].bounds();
            if (b.top < device.height * 0.35 || b.bottom > device.height * 0.95) continue;
            if (b.width() < device.width * 0.4 || b.height() < 40 || b.height() > 220) continue;
            candidates.push(views[j]);
        }
    }

    if (candidates.length == 0) return null;
    candidates.sort(function (a, b) {
        return a.bounds().top - b.bounds().top;
    });
    return candidates[0];
}

function handleStepSheet() {
    log("处理步骤弹窗");
    toast("步骤弹窗→Step1Preview");

    // 直接找 "Step 1 Preview" 文字
    var target = text("Step 1 Preview").findOne(180);
    if (!target) {
        target = textContains("Preview").findOne(180);
    }
    if (!target) {
        target = findFirstStepSheetOption();
    }
    if (!target) {
        var tapped = tapByRatio(0.50, 0.530);
        log("  找不到Step文字节点，按截图坐标点击Step1 @(" + tapped.x + "," + tapped.y + ")");
        sleep(300);
        return;
    }

    log("  找到: " + (target.text() || target.desc() || target.id()));
    clickNode(target);

    sleep(300);
    log("  点击后Activity: " + currentActivity());
}

// ============================================================
// MainActivity - Preview 页（含 "Preview" 文字、"GO" 按钮）
// ============================================================
function isOnPreviewPage() {
    return textContains("Preview").exists()
        || text("GO").exists();
}

function handlePreviewPage() {
    log("处理Preview/GO页");

    // 重置停滞计数——说明页面在变化
    state.samePageCount = 0;

    // GO 按钮出现就点
    var goBtn = text("GO").findOne(180);
    if (goBtn) {
        toast("点击GO");
        clickNode(goBtn);
        log("  点击GO");
        // 轮询等AutoX弹窗或Activity变化
        waitUntil(function () {
            var a = currentActivity();
            return a.indexOf("ComposeDialog") >= 0 || a.indexOf("AutoX") >= 0 || a.indexOf("MainActivity") < 0;
        }, 900);
        // 处理AutoX弹窗
        var act2 = currentActivity();
        if (act2.indexOf("ComposeDialog") >= 0 || act2.indexOf("AutoX") >= 0) {
            var cont = text("继续").findOne(300);
            if (cont) { cont.click(); log("  处理AutoX弹窗"); }
        }
        return;
    }

    // 还没有GO，短轮询等待下载完成；如果仍不可见，用截图坐标兜底。
    log("  等待下载/GO...");
    var found = false;
    for (var i = 0; i < 6; i++) {
        sleep(200);
        if (text("GO").exists()) { found = true; break; }
    }
    if (found) {
        log("  GO已出现");
        return;
    }

    if (textContains("Preview").exists()) {
        var tapped = tapByRatio(0.50, 0.885);
        log("  GO文字节点不可见，按截图坐标点击GO @(" + tapped.x + "," + tapped.y + ")");
    }
}

// ============================================================
// MainActivity - 完成页（有  但无 Preview 无 GO）
// ============================================================
function isOnCompletePage() {
    // 排除 Preview/GO；完成页必须优先于练习页判断，避免 neo-08 被误判成练习页。
    if (textContains("Preview").exists() || text("GO").exists()) return false;
    return text("✗").exists()
        || text("×").exists()
        || text("X").exists()
        || text("✘").exists()
        || descContains("close").exists()
        || textContains("关闭").exists();
}

function handleCompletePage() {
    log("处理完成页");
    toast("完成，重新开始");

    if (CONFIG.RESTART_AFTER_RESULT) {
        hardRestartNeo("完成页后重启，避免长时间运行触摸/无障碍失效", true);
        return;
    }

    tapBottomRightHome();

    state.targetCourse = "";
    state.targetUnit = random(1, 4);
    state.targetTopicName = "";
    state.topicIndex = 0;
    state.samePageCount = 0;
    log("  已请求回Home，下一轮从level重新开始");

    waitUntil(function () {
        var a = currentActivity();
        return !isOnResultPage() && (a.indexOf("Menu") >= 0 || isOnLevelPage() || isOnUnitListPage());
    }, 1000);
}

function handleGenericScreen() {
    log("处理通用界面: " + currentActivity());

    // 1. 找 GO / Start 按钮（下载完成后的入口）
    var goBtn = text("GO").findOne(500) || text("Go").findOne(500)
             || text("START").findOne(500) || text("Start").findOne(500)
             || textContains("开始").findOne(500);
    if (goBtn) {
        var b = goBtn.bounds();
        click(Math.floor((b.left + b.right) / 2), Math.floor((b.top + b.bottom) / 2));
        log("  点击GO/Start");
        sleep(900);
        return;
    }

    // 2. 找提交按钮（可能在答题页）
    var submit = text("提交").findOne(500) || textContains("Submit").findOne(500);
    if (submit) {
        submit.click();
        log("  点击提交");
        sleep(700);
        return;
    }

    // 3. 找可点击按钮（原有逻辑）
    var clickableElements = className("android.widget.Button").clickable(true).find();
    for (var i = 0; i < Math.min(clickableElements.length, 10); i++) {
        try {
            var el = clickableElements[i];
            var elText = el.text();
            if (elText && elText.length > 0) {
                log("  点击按钮: " + elText);
                el.click();
                sleep(700);
                return;
            }
        } catch (e) {}
    }

    // 4. 找 A/B/C/D 选项（答题）
    var options = textMatches("^[A-D][.．)]").find();
    if (options.length > 0) {
        var idx = Math.floor(Math.random() * Math.min(options.length, 4));
        var opt = options[idx];
        log("  随机选: " + opt.text());
        opt.click();
        sleep(500);
        return;
    }

    // 5. 不在通用逻辑里点X/关闭，避免neo-08结果页误退出。

    // 6. 尝试坐标戳任何看起来有用的文字
    var keywords = ["继续", "下一", "确定", "完成", "Next", "OK", "Done"];
    for (var k = 0; k < keywords.length; k++) {
        var el = textContains(keywords[k]).findOne(300);
        if (el) {
            var b = el.bounds();
            click(Math.floor((b.left + b.right) / 2), Math.floor((b.top + b.bottom) / 2));
            log("  坐标戳: " + keywords[k]);
            sleep(700);
            return;
        }
    }

    // 7. 实在没辙也不自动返回，避免误退到上一层。
    log("  无可用操作，等待下一轮重试");
    sleep(700);
}

function recoverFromError() {
    log("尝试错误恢复...");

    if (!currentPackage().equals(CONFIG.APP_PACKAGE)) {
        launchNeoApp();
        return;
    }

    log("错误恢复: 保持当前页面，等待下一轮重新识别");
    sleep(700);
    dismissPopups();
}

function swipeUp() {
    var x = device.width / 2 + random(-50, 50);
    var y1 = device.height * 0.7 + random(-30, 30);
    var y2 = device.height * 0.3 + random(-30, 30);
    swipe(x, y1, x, y2, CONFIG.SWIPE_DURATION + random(-100, 100));
}

function swipeDown() {
    var x = device.width / 2 + random(-50, 50);
    var y1 = device.height * 0.3 + random(-30, 30);
    var y2 = device.height * 0.7 + random(-30, 30);
    swipe(x, y1, x, y2, CONFIG.SWIPE_DURATION + random(-100, 100));
}

function randomSleep() {
    var delay = CONFIG.RANDOM_DELAY_MIN + Math.random() * (CONFIG.RANDOM_DELAY_MAX - CONFIG.RANDOM_DELAY_MIN);
    sleep(Math.floor(delay));
}

function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function debugCurrentScreen() {
    log("=== 当前界面调试信息 ===");
    log("包名: " + currentPackage());
    log("Activity: " + currentActivity());

    var allText = className("android.widget.TextView").find();
    log("页面文本元素数量: " + allText.length);
    for (var i = 0; i < Math.min(allText.length, 20); i++) {
        var t = allText[i];
        log("  [" + i + "] text=" + t.text() + " id=" + t.id() + " bounds=" + t.bounds());
    }

    var allButtons = className("android.widget.Button").find();
    log("按钮数量: " + allButtons.length);
    for (var i = 0; i < Math.min(allButtons.length, 10); i++) {
        var b = allButtons[i];
        log("  [" + i + "] text=" + b.text() + " id=" + b.id() + " bounds=" + b.bounds());
    }
}

main();
