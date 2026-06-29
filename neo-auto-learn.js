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
    topicIndex: 0,       // Current topic index
    samePageCount: 0,    // Consecutive loops on the same Activity
    sameScreenCount: 0,  // Consecutive loops with the same screen signature
    lastActivity: "",    // Previous Activity
    lastScreenSignature: "",
    lastWakeLoop: 0,
    lastAccessibilityShortcutLoop: -999,
    lastRecoveryLoop: 0,
    lastHardRestartLoop: -999,
    lastAutoRefreshLoop: -999,
    levelFailCount: 0,
    targetCourse: "",    // Random level for the current round
    targetUnit: 0,        // Random Unit for the current round
    targetTopicName: "",  // Topic name parsed from Unit<x> <topic>
};

// Polling wait: check every step ms, return immediately on success, false on timeout
function waitUntil(checkFn, maxMs, step) {
    step = step || 120;
    for (var elapsed = 0; elapsed < maxMs; elapsed += step) {
        if (checkFn()) return true;
        sleep(step);
    }
    return false;
}

// Wait for Activity to change away from the given Activity
function waitActivityGone(oldAct, maxMs) {
    maxMs = maxMs || 3000;
    return waitUntil(function () {
        var a = currentActivity();
        return a != oldAct || a.indexOf("ComposeDialog") >= 0 || a.indexOf("AutoX") >= 0;
    }, maxMs);
}

// Wait for Activity to contain a keyword
function waitActivityContains(keyword, maxMs) {
    maxMs = maxMs || 3000;
    return waitUntil(function () {
        return currentActivity().indexOf(keyword) >= 0;
    }, maxMs);
}

function main() {
    // 1. Request accessibility permission and enable the service; more reliable than auto.waitFor()
    auto();
    log("Accessibility service enabled");

    // 2. Request floating window permission for the control panel
    if (!floaty.checkPermission()) {
        toast("Please grant floating window permission");
        floaty.requestPermission();
        sleep(2000);
    }

    // requestScreenCapture(false) was removed. This script only uses text().findOne().
    // It works through accessibility and does not need screenshots; the screenshot permission dialog can block the script.

    // 3. Show control panel
    showControlPanel();

    // 4. Confirm accessibility service is still alive before launching neo
    log("Current accessibility service state: " + auto.service);
    if (!auto.service) {
        toast("Accessibility service is not connected. Make sure AutoX accessibility permission is enabled");
        sleep(3000);
        auto();
    }

    // 5. Launch neo
    launchNeoApp();

    // 6. Main loop: periodically check whether accessibility service is alive
    while (state.isRunning) {
        try {
            // Reconnect automatically when the accessibility service disconnects
            if (!auto.service) {
                log("Accessibility service disconnected; trying to reconnect...");
                auto();
                sleep(2000);
            }
            refreshAutoServiceIfNeeded();

            state.loopCount++;
            handleCurrentScreen();
            randomSleep();
        } catch (e) {
            log("Main loop exception: " + e.message);
            sleep(3000);
            recoverFromError();
        }
    }

    toast("Script stopped");
}

function showControlPanel() {
    var window = floaty.window(
        <vertical padding="8">
            <text id="status" textSize="12sp" textColor="#ffffff" bg="#88000000" padding="4">Running...</text>
            <button id="btnStop" textSize="10sp" text="Stop" w="60" h="30"/>
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
                window.status.setText("Running:" + elapsed + " min loops:" + state.loopCount);
            });
            sleep(5000);
        }
    });
}

function launchNeoApp() {
    log("Launching neo app...");

    if (currentPackage() != CONFIG.APP_PACKAGE) {
        // Launch by package name; more reliable than app.launchApp by app name
        app.launch(CONFIG.APP_PACKAGE);
        waitUntil(function () {
            return currentPackage() == CONFIG.APP_PACKAGE;
        }, 1800, 100);
    }

    // Check whether launch succeeded
    var pkg = currentPackage();
    log("Current foreground package: " + pkg);

    if (pkg == CONFIG.APP_PACKAGE) {
        log("neo launched successfully");
    } else {
        // Retry once
        log("Initial launch failed; retrying...");
        app.launch(CONFIG.APP_PACKAGE);
        waitUntil(function () {
            return currentPackage() == CONFIG.APP_PACKAGE;
        }, 2500, 120);
        pkg = currentPackage();
        if (pkg == CONFIG.APP_PACKAGE) {
            log("Retry succeeded");
        } else {
            log("Launch failed; current package: " + pkg + "; please open neo manually");
            sleep(2000);
        }
    }
}

function handleCurrentScreen() {
    dismissPopups();

    // Track consecutive loops on the same Activity
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

    // AutoX system dialog: continue/exit
    if (act.indexOf("ComposeDialog") >= 0 || act.indexOf("AutoX") >= 0) {
        handleAutoXDialog();
        return;
    }

    // neo-06: continue/exit overlay after learning starts. Handle continue first to avoid generic logic tapping exit.
    if (isOnResumeOverlay()) {
        handleResumeOverlay();
        return;
    }

    // Handle score/result pages first so they are not intercepted by continue logic
    if (isOnResultPage()) {
        handleResultPage();
        return;
    }

    // Tap continue directly when it appears during learning
    if (clickContinueIfExists()) {
        return;
    }

    // Wait while loading
    if (isOnLoadingPage()) {
        log("Loading; waiting...");
        sleep(800);
        return;
    }

    // Handle step dialogs (BottomSheetDialog) first
    if (isOnStepSheet()) {
        handleStepSheet();
        return;
    }

    // neo-01 level page can return under MainActivity; do not rely only on Activity=Menu.
    if (isOnLevelPage()) {
        handleLevelPage();
        return;
    }

    // MainActivity subpages: Preview/GO, learning, completion
    if (act == "com.nexgen.nsa.MainActivity") {
        if (isOnResultPage()) {
            handleResultPage();
            return;
        }
        // Preview page: Preview text or GO button; keep this before completion detection.
        if (isOnPreviewPage()) {
            handlePreviewPage();
            return;
        }
        // Completion page: handle immediately to avoid exercise/fallback logic tapping replay or X.
        if (isOnCompletePage()) {
            handleCompletePage();
            return;
        }
        // Exercise/choice page: handle early to avoid treating The Secret Code title as completion.
        if (isOnExercisePage()) {
            handleExercise();
            return;
        }
        // Unknown MainActivity state: do not use bottom/random fallback, to avoid the neo-08 left replay button.
        if (clickMidScreenContinueIcon()) {
            return;
        }
        log("  Unknown MainActivity state; waiting for next recognition loop");
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
    log("Reset current round target: " + reason);
}

function refreshAutoServiceIfNeeded() {
    if (state.loopCount - state.lastAutoRefreshLoop < CONFIG.AUTO_SERVICE_REFRESH_LOOPS) return;
    state.lastAutoRefreshLoop = state.loopCount;

    try {
        auto();
        log("Periodic AutoX accessibility refresh");
    } catch (e) {
        log("AutoX accessibility refresh failed: " + e.message);
    }
}

function hardRestartNeo(reason, force) {
    if (!force && state.loopCount - state.lastHardRestartLoop < CONFIG.HARD_RESTART_COOLDOWN_LOOPS) {
        log("Skip hard restart; cooldown active: " + reason);
        resetLoopTarget("Hard restart cooldown active; reset target first");
        return;
    }

    state.lastHardRestartLoop = state.loopCount;
    log("Hard restart NEO: " + reason);
    resetLoopTarget("Clear state before hard restart");

    try {
        shell("am force-stop " + CONFIG.APP_PACKAGE, true);
        sleep(800);
    } catch (e) {
        log("  force-stop failed; still trying to launch: " + e.message);
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

    log("Same screen for a while; gentle wake touch @(" + x + "," + y + ")");
    press(x, y, 35);
    try {
        shell("input tap " + x + " " + y, true);
    } catch (e) {
        log("  System tap wake failed; press fallback was used: " + e.message);
    }
    sleep(180);
}

function tapAccessibilityShortcut() {
    state.lastAccessibilityShortcutLoop = state.loopCount;

    // Android accessibility shortcut is usually near the lower-right edge. Avoid NEO's lower-right Home
    // area around x=75%, y=87%, and tap the system floating button farther right.
    var points = [
        { x: 0.965, y: 0.875 },
        { x: 0.965, y: 0.820 },
        { x: 0.940, y: 0.900 },
    ];

    log("Same screen stuck; trying lower-right accessibility shortcut");
    for (var i = 0; i < points.length; i++) {
        var x = Math.floor(device.width * points[i].x);
        var y = Math.floor(device.height * points[i].y);
        press(x, y, 45);
        try {
            shell("input tap " + x + " " + y, true);
        } catch (e) {
            log("  Accessibility shortcut system tap failed: " + e.message);
        }
        sleep(220);
    }

    // Do not clear sameScreenCount. This button is now only a single attempt;
    // if the page does not change, the next stage must continue to hard recovery instead of restarting the counter.
}

function recoverStuckScreen() {
    state.lastRecoveryLoop = state.loopCount;
    log("Detected the same screen for " + state.sameScreenCount + " loops; running safe recovery: " + currentActivity());

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
        hardRestartNeo("Stuck on neo-01 level page; level taps are ineffective");
        return true;
    }

    if (isOnUnitListPage() || isOnTopicPage()) {
        hardRestartNeo("Stuck in selection flow; restart and begin from level page");
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

    hardRestartNeo("Unknown stuck screen");
    return true;
}

function handleAutoXDialog() {
    var resumeBtn = id("com.nexgen.nsa:id/buttonResume").findOne(200)
        || idContains("buttonResume").findOne(200);
    if (resumeBtn) {
        clickNode(resumeBtn);
        log("  Handled AutoX dialog: tapped continue icon buttonResume");
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
        log("  Handled AutoX dialog: tapped icon above continue text");
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
        log("  Handled AutoX dialog: tapped upper non-exit button");
    } else {
        log("  AutoX dialog has no button text; wait for next loop without auto-back");
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
    log("Handling neo continue/exit overlay; tapping continue");

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
            log("  Tapped continue text @(" + cx + "," + cy + ")");
            sleep(250);
            if (!isOnResumeOverlay()) return;
        }
    }

    // In neo-06, the upper blue play circle is continue; the lower blue X is exit and must never be tapped.
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
        log("  Tapped upper continue/play button @(" + tapped.x + "," + tapped.y + ")");
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
                log("Skip main-page close/X button: " + (btn.text() || btn.desc() || btn.id()));
                continue;
            }
            btn.click();
            log("Closed popup: " + (btn.text() || btn.desc() || btn.id()));
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

    // Top-left X on neo learning/result pages exits the page; it is not a popup close.
    if (cx < device.width * 0.25 && cy < device.height * 0.18) return true;

    // Conservatively skip close-like buttons in MainActivity to avoid leaving the learning flow.
    return act == "com.nexgen.nsa.MainActivity";
}

function clickNode(node) {
    var b = node.bounds();
    var cx = Math.floor((b.left + b.right) / 2);
    var cy = Math.floor((b.top + b.bottom) / 2);

    // Prefer coordinate + shell double tap; more reliable than accessibility .click() action
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
    // 1. Exact-match continue text
    var cont = text("继续").findOne(200)
        || textContains("继续").findOne(200)
        || desc("继续").findOne(200)
        || descContains("继续").findOne(200)
        || idContains("continue").findOne(200)
        || idContains("next").findOne(200);

    if (cont) {
        var tapped = clickNodeOnce(cont);
        log("Tapped continue @(" + tapped.x + "," + tapped.y + ")");
        return true;
    }

    if (clickMidScreenContinueIcon()) return true;

    if (useBottomFallback !== true) return false;

    // 2. Search bottom candidates only when the caller explicitly allows it.
    // level/menu/topic pages often have A2+/back/navigation at the bottom; do not treat them as global continue buttons.
    var bottomBtn = findBottomContinueButton();
    if (bottomBtn) {
        clickNode(bottomBtn);
        log("Tapped bottom candidate: " + (bottomBtn.text() || bottomBtn.desc() || bottomBtn.className()));
        return true;
    }

    // 3. Coordinate fallback: scan the bottom 20% area and tap any content
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
            // Skip exit/cancel-like items
            if (txt.indexOf("退出") >= 0 || txt.indexOf("取消") >= 0) continue;
            clickNode(allViews[j]);
            log("Bottom fallback tap: " + (txt || allViews[j].className()));
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
            log("Tapped middle continue/play icon @(" + cx + "," + cy + ")");
            return true;
        }
    }

    // Safe coordinate fallback for neo-06 style screens: only tap the middle play button, not bottom replay/Home.
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
            log("Tapped continue/play by middle coordinate @(" + tapped.x + "," + tapped.y + ")");
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
    // Prefer exact match to avoid matching C1 inside C1 Bridge
    var node = null;
    if (courseName == "C1 Bridge" || courseName == "B2+") {
        node = text(courseName).findOne(180);
    }
    if (!node && courseName == "C1") {
        // Exact-match standalone C1, not C1 Bridge
        node = textMatches("^\\s*C1\\s*$").findOne(180);
    }
    if (!node && courseName == "B2") {
        // Exact-match standalone B2, not B2+
        node = textMatches("^\\s*B2\\s*$").findOne(180);
    }
    if (!node) {
        node = text(courseName).findOne(180)
            || textContains(courseName).findOne(180);
    }
    return node;
}

// Strictly check whether node text is one of the known level choices
function getCourseNameFromNode(node) {
    var txt = (node.text() || "").trim();
    var known = ["C1 Bridge", "C1", "B2+", "B2"];
    for (var i = 0; i < known.length; i++) {
        if (txt == known[i]) return known[i];
    }
    // C1 must be an exact match, not C1 Bridge or similar
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
        log("  Level text node is not visible; tapping screenshot coordinate for " + state.targetCourse + " @(" + tapped.x + "," + tapped.y + ")");
    }
    var moved = waitUntil(function () {
        return textContains("Unit").exists() || textContains("Certification").exists();
    }, 1200);
    if (!moved) {
        var fallback = getLevelTapPoint(state.targetCourse);
        var tapped2 = tapByRatio(fallback.x, fallback.y);
        log("  Did not enter Unit after level tap; retry coordinate tap for " + state.targetCourse + " @(" + tapped2.x + "," + tapped2.y + ")");
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
    log("  Consecutive level tap failures " + state.levelFailCount + "/" + CONFIG.LEVEL_FAIL_RESTARTS);
    state.targetCourse = "";
    if (state.levelFailCount == 2) {
        tapAccessibilityShortcut();
    }
    if (state.levelFailCount >= CONFIG.LEVEL_FAIL_RESTARTS) {
        hardRestartNeo("neo-01 consecutive level taps are ineffective");
    }
}

function enterLearningModule() {
    log("On home page; randomly selecting level");

    ensureLearningTarget();
    log("Current round target: " + state.targetCourse + " / Unit " + state.targetUnit + " / random top-four subject #" + state.topicIndex);

    var course = findCourseNode(state.targetCourse);
    if (course) {
        clickNode(course);
        waitUntil(function () {
            return currentActivity().indexOf("Menu") < 0 || textContains("Unit").exists();
        }, 1200);
        log("Tapped course: " + state.targetCourse);
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
            log("Tapped learning entry: " + (entry.text() || entry.id()));
            return;
        }
    }

    log("Target course not found; swiping to search");
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
    log("Handling lesson page");

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
        log("Video is playing; waiting...");
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
        log("Tapped play button");
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
        // Prefer clickable parent; fall back to text node itself
        options.push(p && p.clickable() ? p : texts[i]);
    }
    return options;
}

// Collect plain text label choices; parent is not clickable, so tap by coordinate
function collectTextLabelChoices() {
    var options = [];
    var seen = {};
    var texts = className("android.widget.TextView").find();
    for (var i = 0; i < texts.length; i++) {
        var s = texts[i].text();
        if (!s || s.length < 2) continue;
        if (s == "" || s.indexOf("Product") >= 0 || s.indexOf("Secret") >= 0) continue;
        var p = texts[i].parent();
        // Only collect text whose parent is not clickable; clickable cases were handled above
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

    log("Random text-label tap '" + opt.text() + "' @(" + cx + "," + cy + ")");
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

    log("Option #" + idx + "/" + options.length + " @(" + cx + "," + cy + ")");
    // Coordinate + shell double tap to improve hit rate
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

    log("Random visible answer tap: " + opt.text + " #" + idx + "/" + options.length + " @(" + cx + "," + cy + ")");
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
    log("Sequential option tap #" + index + "/" + options.length + " '" + opt.text + "' @(" + cx + "," + cy + ")");
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

    log("Detected fill-in-the-blank underline slots: " + blanks + "; sequentially tapping the first " + blanks + " options this round");
    for (var i = 0; i < blanks; i++) {
        if (!clickOrderedOption(i)) {
            log("  Sequential selection #" + (i + 1) + " failed; stopping");
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
    log("Handling exercise page");

    // 1. Tap only explicit continue text; exercise pages often have a bottom replay button, so bottom fallback is disabled.
    if (clickContinueIfExists(false)) return;

    // 2. Fill-in-the-blank: consecutive underscores count as one blank; tap the first N options in order.
    if (clickOrderedForBlankSlots()) return;

    // 3. True/False
    if (clickTrueFalseOption()) { sleep(180); return; }

    // 4. Large-card answers like neo-07: randomly select True/False or any visible string option.
    if (clickVisibleAnswerChoice()) { sleep(180); submitAnswer(); sleep(120); return; }

    // 5. Middle-area image choices: randomly tap an image when there are no text choices.
    if (clickImageOption()) { sleep(180); submitAnswer(); sleep(120); return; }

    // 6. Plain text choices with clickable parent; the common case
    if (clickClickableTextChoice()) { sleep(180); submitAnswer(); sleep(120); return; }

    // 7. Plain text labels without clickable parent; tap by coordinate
    if (clickTextLabelChoice()) { sleep(180); submitAnswer(); sleep(120); return; }

    // 8. Standard controls such as ABCD, RadioButton, CheckBox
    if (clickRandomOption()) { sleep(180); submitAnswer(); sleep(120); return; }

    // 9. Special speaking/fill-in-the-blank exercise types
    if (textContains("跟读").exists() || textContains("录音").exists() || textContains("说话").exists()) {
        handleSpeakingExercise(); return;
    }
    if (textContains("填空").exists() || className("android.widget.EditText").exists()) {
        handleFillBlank(); return;
    }

    // 10. No match -> swipe
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
            log("True/False text nodes are not visible; random screenshot-coordinate tap for " + (useTrue ? "True" : "False") + " @(" + tapped.x + "," + tapped.y + ")");
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
    log("Random True/False tap: " + (opt.text() || idx) + " @(" + cx + "," + cy + ")");
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
    log("Random middle image option tap #" + idx + "/" + options.length + " @(" + x + "," + y + ") " + (opt.desc() || ""));
    return true;
}

function hasMiddleImageOptions() {
    return collectMiddleImageOptions().length >= 2;
}

function collectMiddleImageOptions() {
    var options = [];
    // Collect all image choices: clickable ImageView + clickable ImageButton + ImageView with description
    var imgs = [].concat(
        toArr(className("android.widget.ImageView").clickable(true).find()),
        toArr(className("android.widget.ImageButton").clickable(true).find()),
        toArr(className("android.widget.ImageView").find()),
        toArr(className("android.view.View").clickable(true).find()),
        toArr(className("android.widget.FrameLayout").clickable(true).find()),
        toArr(className("android.widget.LinearLayout").clickable(true).find()),
        toArr(className("android.widget.RelativeLayout").clickable(true).find())
    );
    // Also collect non-clickable ImageView nodes with contentDescription; pure image choices often use desc.
    var descImgs = className("android.widget.ImageView").find();
    for (var d = 0; d < descImgs.length; d++) {
        if (descImgs[d].desc() && descImgs[d].desc().length > 0) {
            imgs.push(descImgs[d]);
        }
    }

    var seen = {};
    for (var i = 0; i < imgs.length; i++) {
        var b = imgs[i].bounds();
        // Image choices may appear from the upper quarter to the middle; filter status bar, bottom replay/Home, and tiny icons.
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

    // 2. A/B/C/D text choices; extended patterns: "A.", "A)", "(A)", "A、", "A ", "A:"
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

    // 3. True/False buttons
    var btns = className("android.widget.Button").find();
    for (var b = 0; b < btns.length; b++) {
        var s = btns[b].text();
        if (/^\s*(True|False|TRUE|FALSE|true|false)\s*[:：]?$/.test(s)) addOpt(btns[b], "TF-btn");
    }
    // True/False text
    var tfTexts = textMatches("^\\s*(True|False|TRUE|FALSE|true|false|T|F)\\s*[:：]?$").find();
    for (var t = 0; t < tfTexts.length; t++) addOpt(tfTexts[t], "TF-text");

    // 4. Clickable View choices in the middle area
    var views = className("android.view.View").clickable(true).find();
    for (var v = 0; v < views.length; v++) {
        var vb = views[v].bounds();
        if (vb.top < device.height * 0.2 || vb.bottom > device.height * 0.88) continue;
        if (vb.width() < 80 || vb.height() < 40 || vb.height() > 300) continue;
        addOpt(views[v], "view");
    }

    // 5. Plain text choices with clickable parent in the middle area
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
        log("Selected option " + randomIndex + "/" + options.length + " @(" + cx + "," + cy + ")");
        click(cx, cy);
        sleep(80);
        shell("input tap " + cx + " " + cy, true);
        return true;
    }

    return false;
}

function handleSpeakingExercise() {
    log("Handling speaking exercise");

    var micBtn = idContains("mic").findOne(1000)
        || idContains("record").findOne(1000)
        || descContains("录音").findOne(1000)
        || textContains("开始录音").findOne(1000)
        || textContains("按住说话").findOne(1000);

    if (micBtn) {
        micBtn.click();
        sleep(3000 + Math.random() * 2000);

        var stopBtn = textContains("Stop").findOne(500)
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
    log("Handling fill-in-the-blank exercise");

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
        log("Submitted answer");
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
    // neo-08 style result pages have at least a top-left close X and no answer choices; sometimes the score number is not a TextView.
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
    // neo-08 Home icon center is roughly x=75%, y=87%. Scan the lower-right Home circle area,
    // to avoid missing due to coordinate system, nav bar height, or screenshot scaling differences.
    var absoluteX = Math.floor(device.width * 0.75);
    var absoluteY = Math.floor(device.width * 1.885);
    if (absoluteY < device.height * 0.98) {
        click(absoluteX, absoluteY);
        sleep(60);
        press(absoluteX, absoluteY, 80);
        sleep(120);
        if (isOnLevelPage() || isOnUnitListPage() || isOnTopicPage() || currentActivity().indexOf("Menu") >= 0) {
            log("  Home hit absolute @(" + absoluteX + "," + absoluteY + ")");
            return;
        }
    }

    var xRatios = [0.74, 0.76, 0.78];
    var yRatios = [0.85, 0.87, 0.89];
    log("  Trying Home area device=" + device.width + "x" + device.height);
    for (var yi = 0; yi < yRatios.length; yi++) {
        for (var xi = 0; xi < xRatios.length; xi++) {
            var x = Math.floor(device.width * xRatios[xi]);
            var y = Math.floor(device.height * yRatios[yi]);
            click(x, y);
            sleep(50);
            press(x, y, 80);
            sleep(120);
            if (isOnLevelPage() || isOnUnitListPage() || isOnTopicPage() || currentActivity().indexOf("Menu") >= 0) {
                log("  Home hit @(" + x + "," + y + ") ratio=(" + xRatios[xi] + "," + yRatios[yi] + ")");
                return;
            }
        }
    }
    log("  Home area scan still missed");
}

function handleResultPage() {
    log("Handling score/result page");

    if (CONFIG.RESTART_AFTER_RESULT) {
        hardRestartNeo("Restart after completing a round to avoid long-running touch/accessibility failure", true);
        return;
    }

    tapBottomRightHome();

    state.targetCourse = "";
    state.targetUnit = random(1, 4);
    state.targetTopicName = "";
    state.topicIndex = 0;
    state.samePageCount = 0;
    log("Returned Home; reset random target for next round");
    waitUntil(function () {
        return !isOnResultPage()
            && (isOnLevelPage() || isOnUnitListPage() || currentActivity().indexOf("Menu") >= 0);
    }, 2000);
}

// ============================================================
// Unit list page: ProMenuActivity / Unit selection page
// Unit list for courses such as C1 Bridge and C2 Bridge
// ============================================================
function isOnMenuPage() {
    // Contains Unit text or matches ProMenuActivity
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
    log("=== Handling Unit list page ===");

    ensureLearningTarget();

    if (!state.targetUnit || state.targetUnit < 1 || state.targetUnit > 4) {
        state.targetUnit = random(1, 4);
    }

    toast("Menu page; random tap Unit" + state.targetUnit);

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
        log("  Target text: " + txt + " topic=" + state.targetTopicName);
    }

    var unitPoint = getUnitTapPoint(state.targetUnit);
    var tapped = tapOnceByRatio(unitPoint.x, unitPoint.y);
    log("  Single tap Unit" + state.targetUnit + " card center @(" + tapped.x + "," + tapped.y + ")");
    toast("Tapped Unit" + state.targetUnit);

    var moved = waitUntil(function () {
        var a = currentActivity();
        if (a.indexOf("BottomSheet") >= 0) return true;
        if (a.indexOf("Menu") < 0) return true;
        if (isOnTopicPage()) return true;
        if (!isOnUnitListPage()) return true;
        return false;
    }, 1500);

    var act = currentActivity();
    log("  Activity after tap: " + act + (moved ? " (moved)" : ""));

    if (moved) {
        if (act.indexOf("ProgressDialog") >= 0) {
            log("  Waiting for loading...");
            waitActivityGone("android.app.ProgressDialog", 1800);
        }
        return;
    }

    log("  Single tap ineffective; tapping Unit card center again");
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
        log("  Second tap succeeded");
        if (currentActivity().indexOf("ProgressDialog") >= 0) {
            waitActivityGone("android.app.ProgressDialog", 1800);
        }
        return;
    }

    log("  Unit card tap ineffective; stay and retry next loop");
    sleep(300);
}

// ============================================================
// Unit sub-course list page: ProMenuActivity with Mastery Test/Dictations, etc.
// Topic selection page after entering a Unit
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

    log("Handling subject list page; current random subjectIndex=" + state.topicIndex);
    toast("Subject #" + state.topicIndex);

    var subjects = collectSubjectNodes();
    log("  Found first-four subject candidates: " + subjects.length + "");

    if (subjects.length == 0) {
        var topicPoint = getTopicTapPoint(state.topicIndex);
        var tapped = tapByRatio(topicPoint.x, topicPoint.y);
        log("  Subject text node not found; tapping screenshot coordinate for subject#" + state.topicIndex + " @(" + tapped.x + "," + tapped.y + ")");
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

    log("  Tap Unit" + state.targetUnit + " - " + subjectText + " @(" + cx + "," + cy + ")");

    clickNode(el);

    // Poll until leaving Menu or entering BottomSheet
    var moved = waitUntil(function () {
        var a = currentActivity();
        return a.indexOf("Menu") < 0 || a.indexOf("BottomSheet") >= 0;
    }, 1000);

    if (moved) { log("  Entered successfully"); return; }

    log("  click ineffective; trying shell input tap");
    shell("input tap " + cx + " " + cy, true);

    moved = waitUntil(function () {
        var a = currentActivity();
        return a.indexOf("Menu") < 0 || a.indexOf("BottomSheet") >= 0;
    }, 1000);

    if (moved) { log("  shell tap entered successfully"); return; }

    log("  shell ineffective; trying press");
    press(cx, cy, 200);

    moved = waitUntil(function () {
        var a = currentActivity();
        return a.indexOf("Menu") < 0 || a.indexOf("BottomSheet") >= 0;
    }, 1000);

    if (moved) { log("  press entered successfully"); return; }

    log("  All attempts failed; swiping");
    swipeUp();
    sleep(700);
}

// ============================================================
// Step selection dialog (BottomSheetDialog)
// Step 1 Preview / Step 2 selection shown after tapping a topic
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
    log("Handling step dialog");
    toast("Step dialog -> Step1Preview");

    // Directly search for Step 1 Preview text
    var target = text("Step 1 Preview").findOne(180);
    if (!target) {
        target = textContains("Preview").findOne(180);
    }
    if (!target) {
        target = findFirstStepSheetOption();
    }
    if (!target) {
        var tapped = tapByRatio(0.50, 0.530);
        log("  Step text node not found; tapping Step1 screenshot coordinate @(" + tapped.x + "," + tapped.y + ")");
        sleep(300);
        return;
    }

    log("  Found: " + (target.text() || target.desc() || target.id()));
    clickNode(target);

    sleep(300);
    log("  Activity after tap: " + currentActivity());
}

// ============================================================
// MainActivity - Preview page with Preview text or GO button
// ============================================================
function isOnPreviewPage() {
    return textContains("Preview").exists()
        || text("GO").exists();
}

function handlePreviewPage() {
    log("Handling Preview/GO page");

    // Reset stuck counter; this means the page is progressing
    state.samePageCount = 0;

    // Tap GO when it appears
    var goBtn = text("GO").findOne(180);
    if (goBtn) {
        toast("Tap GO");
        clickNode(goBtn);
        log("  Tap GO");
        // Poll for AutoX dialog or Activity change
        waitUntil(function () {
            var a = currentActivity();
            return a.indexOf("ComposeDialog") >= 0 || a.indexOf("AutoX") >= 0 || a.indexOf("MainActivity") < 0;
        }, 900);
        // Handle AutoX dialog
        var act2 = currentActivity();
        if (act2.indexOf("ComposeDialog") >= 0 || act2.indexOf("AutoX") >= 0) {
            var cont = text("继续").findOne(300);
            if (cont) { cont.click(); log("  Handled AutoX dialog"); }
        }
        return;
    }

    // If GO is not visible yet, briefly poll for download completion; if still invisible, use screenshot coordinate fallback.
    log("  Waiting for download/GO...");
    var found = false;
    for (var i = 0; i < 6; i++) {
        sleep(200);
        if (text("GO").exists()) { found = true; break; }
    }
    if (found) {
        log("  GO appeared");
        return;
    }

    if (textContains("Preview").exists()) {
        var tapped = tapByRatio(0.50, 0.885);
        log("  GO text node not visible; tapping GO screenshot coordinate @(" + tapped.x + "," + tapped.y + ")");
    }
}

// ============================================================
// MainActivity - completion page: has icon but no Preview/GO
// ============================================================
function isOnCompletePage() {
    // Exclude Preview/GO; completion page must be checked before exercise to avoid misclassifying neo-08 as exercise.
    if (textContains("Preview").exists() || text("GO").exists()) return false;
    return text("✗").exists()
        || text("×").exists()
        || text("X").exists()
        || text("✘").exists()
        || descContains("close").exists()
        || textContains("关闭").exists();
}

function handleCompletePage() {
    log("Handling completion page");
    toast("Done; restarting");

    if (CONFIG.RESTART_AFTER_RESULT) {
        hardRestartNeo("Restart after completion page to avoid long-running touch/accessibility failure", true);
        return;
    }

    tapBottomRightHome();

    state.targetCourse = "";
    state.targetUnit = random(1, 4);
    state.targetTopicName = "";
    state.topicIndex = 0;
    state.samePageCount = 0;
    log("  Requested Home; next round starts from level");

    waitUntil(function () {
        var a = currentActivity();
        return !isOnResultPage() && (a.indexOf("Menu") >= 0 || isOnLevelPage() || isOnUnitListPage());
    }, 1000);
}

function handleGenericScreen() {
    log("Handling generic screen: " + currentActivity());

    // 1. Find GO / Start button, the entry after download completes
    var goBtn = text("GO").findOne(500) || text("Go").findOne(500)
             || text("START").findOne(500) || text("Start").findOne(500)
             || textContains("开始").findOne(500);
    if (goBtn) {
        var b = goBtn.bounds();
        click(Math.floor((b.left + b.right) / 2), Math.floor((b.top + b.bottom) / 2));
        log("  Tap GO/Start");
        sleep(900);
        return;
    }

    // 2. Find submit button; may be on exercise page
    var submit = text("提交").findOne(500) || textContains("Submit").findOne(500);
    if (submit) {
        submit.click();
        log("  Tapped submit");
        sleep(700);
        return;
    }

    // 3. Find clickable buttons; original fallback logic
    var clickableElements = className("android.widget.Button").clickable(true).find();
    for (var i = 0; i < Math.min(clickableElements.length, 10); i++) {
        try {
            var el = clickableElements[i];
            var elText = el.text();
            if (elText && elText.length > 0) {
                log("  Tapped button: " + elText);
                el.click();
                sleep(700);
                return;
            }
        } catch (e) {}
    }

    // 4. Find A/B/C/D answer choices
    var options = textMatches("^[A-D][.．)]").find();
    if (options.length > 0) {
        var idx = Math.floor(Math.random() * Math.min(options.length, 4));
        var opt = options[idx];
        log("  Random pick: " + opt.text());
        opt.click();
        sleep(500);
        return;
    }

    // 5. Do not tap X/close in generic logic, to avoid exiting neo-08 result page.

    // 6. Try coordinate-tapping useful-looking text
    var keywords = ["继续", "下一", "确定", "完成", "Next", "OK", "Done"];
    for (var k = 0; k < keywords.length; k++) {
        var el = textContains(keywords[k]).findOne(300);
        if (el) {
            var b = el.bounds();
            click(Math.floor((b.left + b.right) / 2), Math.floor((b.top + b.bottom) / 2));
            log("  Coordinate tap: " + keywords[k]);
            sleep(700);
            return;
        }
    }

    // 7. Do not auto-back even as a last resort, to avoid leaving the current layer.
    log("  No available action; waiting for next retry loop");
    sleep(700);
}

function recoverFromError() {
    log("Trying error recovery...");

    if (!currentPackage().equals(CONFIG.APP_PACKAGE)) {
        launchNeoApp();
        return;
    }

    log("Error recovery: keep current page and wait for next recognition loop");
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
    log("=== Current Screen Debug Info ===");
    log("Package: " + currentPackage());
    log("Activity: " + currentActivity());

    var allText = className("android.widget.TextView").find();
    log("Text element count: " + allText.length);
    for (var i = 0; i < Math.min(allText.length, 20); i++) {
        var t = allText[i];
        log("  [" + i + "] text=" + t.text() + " id=" + t.id() + " bounds=" + t.bounds());
    }

    var allButtons = className("android.widget.Button").find();
    log("Button count: " + allButtons.length);
    for (var i = 0; i < Math.min(allButtons.length, 10); i++) {
        var b = allButtons[i];
        log("  [" + i + "] text=" + b.text() + " id=" + b.id() + " bounds=" + b.bounds());
    }
}

main();
