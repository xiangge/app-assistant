var CONFIG = {
    APP_PACKAGE: "com.nexgen.nsa",
    APP_NAME: "neo",
    TARGET_POINTS: 6000,
    LOOP_INTERVAL: 2000,
    SWIPE_DURATION: 500,
    MAX_RETRY: 3,
    RANDOM_DELAY_MIN: 20,
    RANDOM_DELAY_MAX: 120,
};

var state = {
    isRunning: true,
    loopCount: 0,
    startTime: Date.now(),
    lastActionTime: 0,
    topicIndex: 0,       // 当前处理到第几个 topic
    samePageCount: 0,    // 同一页面连续循环次数（用于死循环检测）
    lastActivity: "",    // 上一次的 Activity
    targetCourse: "",    // 本轮随机 level
    targetUnit: 0,        // 本轮随机 Unit
    targetTopicName: "",  // 从 Unit<x> <topic> 解析出的 topic 名
};

// 轮询等待：每 step ms 检查条件，满足立即返回，超时返回 false
function waitUntil(checkFn, maxMs, step) {
    step = step || 250;
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

    // 直接用包名启动（比 app.launchApp 按名称更可靠）
    app.launch(CONFIG.APP_PACKAGE);
    sleep(3000);

    // 检查是否启动成功
    var pkg = currentPackage();
    log("当前前台包名: " + pkg);

    if (pkg == CONFIG.APP_PACKAGE) {
        log("neo 已启动成功");
    } else {
        // 重试一次
        log("首次启动未成功，重试...");
        app.launch(CONFIG.APP_PACKAGE);
        sleep(5000);
        pkg = currentPackage();
        if (pkg == CONFIG.APP_PACKAGE) {
            log("重试成功");
        } else {
            log("启动失败，当前包名: " + pkg + "，请手动打开 neo");
            sleep(10000);
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

    // AutoX 系统弹窗（继续/退出）
    if (act.indexOf("ComposeDialog") >= 0 || act.indexOf("AutoX") >= 0) {
        handleAutoXDialog();
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
        sleep(3000);
        return;
    }

    // 步骤弹窗（BottomSheetDialog）优先处理
    if (isOnStepSheet()) {
        handleStepSheet();
        return;
    }

    // MainActivity 的子页面（Preview/GO、学习中、完成）
    if (act == "com.nexgen.nsa.MainActivity") {
        // Preview页：有Preview文字或GO按钮（优先，避免误判成完成页）
        if (isOnPreviewPage()) {
            handlePreviewPage();
            return;
        }
        // 练习/选择页：优先处理，避免被标题 The Secret Code 误判成完成页
        if (isOnExercisePage()) {
            handleExercise();
            return;
        }
        // 完成页：无Preview无GO，且没有可答题控件，同一页面连续6次以上确认不是下载中
        if (isOnCompletePage() && state.samePageCount >= 6) {
            handleCompletePage();
            return;
        }
        if (clickContinueIfExists(true)) {
            return;
        }
        // 下载中/学习中短等；很快交给通用逻辑按当前界面控件尝试点击
        if (state.samePageCount < 2) {
            log("  MainActivity未知状态，短等... (" + state.samePageCount + "/2)");
            sleep(800);
            return;
        }
        handleGenericScreen();
        return;
    }

    // Topic 子列表必须在 Menu 之前检测——Topic页上有"Unit"文字，会误触isOnMenuPage
    if (isOnTopicPage()) {
        handleTopicPage();
        return;
    }

    if (isOnLevelPage()) {
        handleLevelPage();
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
        back();
        log("  处理AutoX弹窗: 无按钮文本，先返回露出neo页面");
    }
    sleep(500);
}

function dismissPopups() {
    var closeButtons = [
        text("关闭").findOne(1000),
        text("确定").findOne(1000),
        text("知道了").findOne(1000),
        text("以后再说").findOne(1000),
        text("跳过").findOne(1000),
        text("暂不升级").findOne(1000),
        desc("关闭").findOne(1000),
        idContains("close").findOne(1000),
        idContains("iv_close").findOne(1000),
        idContains("btn_close").findOne(1000),
    ];

    for (var i = 0; i < closeButtons.length; i++) {
        var btn = closeButtons[i];
        if (btn) {
            btn.click();
            log("关闭弹窗: " + (btn.text() || btn.desc() || btn.id()));
            sleep(1000);
        }
    }

    if (textContains("休息一下").exists() || textContains("已学习").exists()) {
        var continueBtn = text("继续学习").findOne(1000) || text("继续").findOne(1000);
        if (continueBtn) {
            continueBtn.click();
            sleep(1000);
        }
    }
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
        clickNode(cont);
        log("点击继续");
        return true;
    }

    // 2. 找底部候选元素
    var bottomBtn = findBottomContinueButton();
    if (bottomBtn) {
        clickNode(bottomBtn);
        log("点击底部: " + (bottomBtn.text() || bottomBtn.desc() || bottomBtn.className()));
        return true;
    }

    if (useBottomFallback !== true) return false;

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

function isOnHomePage() {
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
        node = text(courseName).findOne(1000);
    }
    if (!node && (courseName == "C1" || courseName == "B2")) {
        // 精确匹配单独的 "C1" 或 "B2"，不匹配包含它们的文字
        node = textMatches("^\\s*C1\\s*$").findOne(1000)
            || textMatches("^\\s*B2\\s*$").findOne(1000);
    }
    if (!node) {
        node = text(courseName).findOne(1000)
            || textContains(courseName).findOne(1000);
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
        var node = text(known[i]).findOne(500);
        if (!node && (known[i] == "C1" || known[i] == "B2")) {
            node = textMatches("^\\s*" + known[i] + "\\s*$").findOne(500);
        }
        if (node) {
            var b = node.bounds();
            if (b.width() > 60 && b.height() > 25) {
                nodes.push({ name: known[i], node: node });
            }
        }
    }
    return nodes;
}

function isOnLevelPage() {
    return currentActivity().indexOf("ProMenuActivity") >= 0
        && findVisibleLevelNodes().length >= 2
        && !textContains("Unit").exists()
        && !textContains("The Secret Code").exists();
}

function handleLevelPage() {
    var nodes = findVisibleLevelNodes();
    if (nodes.length == 0) return;

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
        var idx = Math.floor(Math.random() * nodes.length);
        target = nodes[idx];
        state.targetCourse = target.name;
        state.targetUnit = random(1, 4);
        state.topicIndex = Math.floor(Math.random() * 3);
    }

    log("Level: " + state.targetCourse + " / Unit" + state.targetUnit + " / topic#" + state.topicIndex);
    clickNode(target.node);
    waitUntil(function () {
        return currentActivity().indexOf("Menu") < 0 || textContains("Unit").exists();
    }, 3000);
}

function enterLearningModule() {
    log("在首页，随机选择level");

    var courses = ["C1 Bridge", "C1", "B2+", "B2"];
    if (!state.targetCourse) {
        state.targetCourse = courses[Math.floor(Math.random() * courses.length)];
        state.targetUnit = random(1, 4);
        state.topicIndex = Math.floor(Math.random() * 4);
        log("本轮目标: " + state.targetCourse + " / Unit " + state.targetUnit + " / subject前四随机#" + state.topicIndex);
    }

    var course = findCourseNode(state.targetCourse);
    if (course) {
        clickNode(course);
        waitUntil(function () {
            return currentActivity().indexOf("Menu") < 0 || textContains("Unit").exists();
        }, 3000);
        log("点击课程: " + state.targetCourse);
        return;
    }

    var learningEntries = [
        textContains("我的课程").findOne(1000),
        textContains("课件").findOne(1000),
        textContains("开始学习").findOne(1000),
        textContains("AI练习").findOne(1000),
        textContains("自主练习").findOne(1000),
    ];

    for (var i = 0; i < learningEntries.length; i++) {
        var entry = learningEntries[i];
        if (entry) {
            clickNode(entry);
            sleep(800);
            log("点击学习入口: " + (entry.text() || entry.id()));
            return;
        }
    }

    log("未找到目标课程，滑动查找");
    swipeUp();
    sleep(2000);
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

function isOnExercisePage() {
    return textContains("选择").exists()
        || textContains("答案").exists()
        || textContains("提交").exists()
        || textContains("A").exists()
        || textContains("B").exists()
        || textMatches("^\\s*(True|False|TRUE|FALSE|true|false)\\s*$").exists()
        || hasTrueFalseButtons()
        || hasClickableTextChoices()
        || hasTextLabelChoices()
        || className("android.widget.RadioButton").exists()
        || className("android.widget.CheckBox").exists();
}

function hasTextLabelChoices() {
    return collectTextLabelChoices().length >= 2;
}

function handleExercise() {
    log("处理练习页面");

    // 1. "继续"按钮优先
    if (clickContinueIfExists(true)) return;

    // 2. True/False
    if (clickTrueFalseOption()) { sleep(400); return; }

    // 3. 纯文本选项（有clickable父级，最常见）
    if (clickClickableTextChoice()) { sleep(400); submitAnswer(); sleep(300); return; }

    // 4. 纯文字标签（无clickable父级，坐标戳）
    if (clickTextLabelChoice()) { sleep(400); submitAnswer(); sleep(300); return; }

    // 5. ABCD/RadioButton/CheckBox 等标准控件
    if (clickRandomOption()) { sleep(400); submitAnswer(); sleep(300); return; }

    // 6. 纯图片选项
    if (clickImageOption()) { sleep(300); submitAnswer(); sleep(200); return; }

    // 7. 口语/填空 特殊题型
    if (textContains("跟读").exists() || textContains("录音").exists() || textContains("说话").exists()) {
        handleSpeakingExercise(); return;
    }
    if (textContains("填空").exists() || className("android.widget.EditText").exists()) {
        handleFillBlank(); return;
    }

    // 8. 无匹配 → 滑动
    swipeUp();
    sleep(800);
}

function clickTrueFalseOption() {
    var options = [];
    var buttons = className("android.widget.Button").find();

    for (var i = 0; i < buttons.length; i++) {
        var s = buttons[i].text();
        if (/^\s*(True|False|TRUE|FALSE|true|false)\s*[:：]?$/.test(s)) {
            options.push(buttons[i]);
        }
    }

    if (options.length == 0) {
        var texts = textMatches("^\\s*(True|False|TRUE|FALSE|true|false)\\s*[:：]?$").find();
        for (var j = 0; j < texts.length; j++) {
            options.push(texts[j]);
        }
    }

    if (options.length == 0) return false;

    var idx = Math.floor(Math.random() * options.length);
    clickNode(options[idx]);
    log("随机点击True/False: " + (options[idx].text() || idx));
    return true;
}

function clickImageOption() {
    var options = [];
    // 收集所有图片选项：clickable ImageView + clickable ImageButton + 带描述的ImageView
    var imgs = [].concat(
        toArr(className("android.widget.ImageView").clickable(true).find()),
        toArr(className("android.widget.ImageButton").clickable(true).find())
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
        // 过滤顶部标题栏和底部导航
        if (b.top < device.height * 0.18 || b.bottom > device.height * 0.88) continue;
        if (b.width() < 50 || b.height() < 50) continue;
        var key = Math.floor(b.left) + "," + Math.floor(b.top);
        if (seen[key]) continue;
        seen[key] = true;
        options.push(imgs[i]);
    }

    if (options.length < 2) return false;

    // 随机选一个
    var idx = Math.floor(Math.random() * options.length);
    clickNode(options[idx]);
    log("随机点击图片选项 #" + idx + "/" + options.length + " " + (options[idx].desc() || ""));
    return true;
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
    var submitBtn = textContains("提交").findOne(1000)
        || textContains("确认").findOne(1000)
        || textContains("确定").findOne(1000)
        || textContains("下一题").findOne(1000)
        || idContains("submit").findOne(1000);

    if (submitBtn) {
        submitBtn.click();
        log("提交答案");
        sleep(1500);
    }
}

function isOnResultPage() {
    return textContains("得分").exists()
        || textContains("Score").exists()
        || textContains("score").exists()
        || textContains("成绩").exists();
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
        if (cx >= device.width * 0.65 && cy >= device.height * 0.75) {
            return candidates[j];
        }
    }

    return null;
}

function handleResultPage() {
    log("处理得分页面，点击右下角Home");

    var homeBtn = findBottomRightHomeButton();
    if (homeBtn) {
        clickNode(homeBtn);
    } else {
        click(Math.floor(device.width * 0.75), Math.floor(device.height * 0.87));
    }

    state.targetCourse = "";
    state.targetUnit = random(1, 4);
    state.targetTopicName = "";
    state.topicIndex = 0;
    state.samePageCount = 0;
    log("已回Home，重置下一轮随机目标");
    sleep(3000);
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

function isOnLoadingPage() {
    var act = currentActivity();
    return act.indexOf("ProgressDialog") >= 0
        || act.indexOf("Loading") >= 0;
}

function parseTopicNameFromUnitText(s) {
    var m = (s || "").match(/Unit\s*\d+\s*(?:-|\s+)\s*(.+)/);
    return m ? m[1].replace(/^\s+|\s+$/g, "") : "";
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

    if (!state.targetUnit || state.targetUnit < 1 || state.targetUnit > 4) {
        state.targetUnit = random(1, 4);
    }

    toast("Menu页面，随机戳Unit" + state.targetUnit);

    var target = textContains("Unit " + state.targetUnit).findOne(1500)
        || textContains("Unit" + state.targetUnit).findOne(1500);

    if (!target) {
        var units = textMatches("^Unit\\s*[1-4]").find();
        if (units.length > 0) {
            target = units[Math.floor(Math.random() * Math.min(units.length, 4))];
            var m = target.text().match(/Unit\s*(\d+)/);
            if (m) state.targetUnit = parseInt(m[1]);
        }
    }

    if (!target) {
        log("  找不到Unit 1-4，滑动查找");
        swipeUp();
        sleep(2000);
        return;
    }

    var b = target.bounds();
    var cx = Math.floor((b.left + b.right) / 2);
    var cy = Math.floor((b.top + b.bottom) / 2);
    var txt = target.text();
    state.targetTopicName = parseTopicNameFromUnitText(txt) || findTopicNameNearUnit(target);

    log("  目标: " + txt + " @ (" + cx + "," + cy + ") topic=" + state.targetTopicName);

    clickNode(target);
    toast("已戳 " + txt);

    // 轮询等待离开Menu或进入Topic（最快250ms即检测到跳转）
    var oldAct = currentActivity();
    var moved = waitUntil(function () {
        var a = currentActivity();
        if (a.indexOf("Menu") < 0 || a.indexOf("BottomSheet") >= 0) return true;
        if (isOnTopicPage()) return true;
        return false;
    }, 3000);

    var act = currentActivity();
    log("  点击后Activity: " + act + (moved ? " (已跳转)" : ""));

    if (moved) {
        if (act.indexOf("ProgressDialog") >= 0) {
            log("  等待loading...");
            waitActivityGone("android.app.ProgressDialog", 5000);
        }
        return;
    }

    // 没走？shell 再补一刀
    log("  click无效，补shell tap");
    shell("input tap " + cx + " " + cy, true);

    moved = waitUntil(function () {
        var a = currentActivity();
        if (a.indexOf("Menu") < 0 || a.indexOf("BottomSheet") >= 0) return true;
        if (isOnTopicPage()) return true;
        return false;
    }, 3000);

    if (moved) {
        log("  ★ shell成功");
        if (currentActivity().indexOf("ProgressDialog") >= 0) {
            waitActivityGone("android.app.ProgressDialog", 5000);
        }
        return;
    }

    // 两招都不行，滑动再试
    log("  点击无效，滑动");
    swipeUp();
    sleep(2000);
}

// ============================================================
// Unit 子课程列表页（ProMenuActivity + 含 Mastery Test/Dictations 等）
// 点进 Unit 后的 topic 选择页
// ============================================================
function isOnTopicPage() {
    if (currentActivity().indexOf("Menu") < 0) return false;
    return textMatches("Unit\\s*\\d+\\s*(-|\\s+)").exists()
        || hasTopicSubjectText()
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
    log("处理subject列表页，当前随机subjectIndex=" + state.topicIndex);
    toast("Subject #" + state.topicIndex);

    var subjects = collectSubjectNodes();
    log("  找到前四subject候选 " + subjects.length + " 个");

    if (subjects.length == 0) {
        log("  找不到subject，滑动查找");
        swipeUp();
        sleep(2000);
        return;
    }

    var idx = state.topicIndex % Math.min(subjects.length, 3);
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
    }, 2000);

    if (moved) { log("  ★ 进入成功"); return; }

    log("  click无效，试 shell input tap");
    shell("input tap " + cx + " " + cy, true);

    moved = waitUntil(function () {
        var a = currentActivity();
        return a.indexOf("Menu") < 0 || a.indexOf("BottomSheet") >= 0;
    }, 3000);

    if (moved) { log("  ★ shell进入成功"); return; }

    log("  shell无效，试 press");
    press(cx, cy, 200);

    moved = waitUntil(function () {
        var a = currentActivity();
        return a.indexOf("Menu") < 0 || a.indexOf("BottomSheet") >= 0;
    }, 3000);

    if (moved) { log("  ★ press进入成功"); return; }

    log("  全部失败，滑动");
    swipeUp();
    sleep(2000);
}

// ============================================================
// 步骤选择弹窗（BottomSheetDialog）
// 点 topic 后弹出的 Step 1 Preview / Step 2 ... 选择
// ============================================================
function isOnStepSheet() {
    return currentActivity().indexOf("BottomSheet") >= 0
        || currentActivity().indexOf("bottomsheet") >= 0;
}

function findFirstStepSheetOption() {
    var candidates = [];
    var texts = className("android.widget.TextView").find();
    for (var i = 0; i < texts.length; i++) {
        var s = texts[i].text();
        if (!s) continue;
        if (s.indexOf("Step") >= 0 || s.indexOf("Preview") >= 0 || s.indexOf("Practice") >= 0) {
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
    var target = text("Step 1 Preview").findOne(2000);
    if (!target) {
        target = textContains("Preview").findOne(2000);
    }
    if (!target) {
        target = findFirstStepSheetOption();
    }
    if (!target) {
        log("  找不到Step选项，等待，不返回");
        sleep(1000);
        return;
    }

    log("  找到: " + (target.text() || target.desc() || target.id()));
    clickNode(target);

    sleep(700);
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
    var goBtn = text("GO").findOne(1500);
    if (goBtn) {
        toast("点击GO");
        goBtn.click();
        log("  点击GO");
        // 轮询等AutoX弹窗或Activity变化
        waitUntil(function () {
            var a = currentActivity();
            return a.indexOf("ComposeDialog") >= 0 || a.indexOf("AutoX") >= 0 || a.indexOf("MainActivity") < 0;
        }, 2000);
        // 处理AutoX弹窗
        var act2 = currentActivity();
        if (act2.indexOf("ComposeDialog") >= 0 || act2.indexOf("AutoX") >= 0) {
            var cont = text("继续").findOne(2000);
            if (cont) { cont.click(); log("  处理AutoX弹窗"); }
        }
        return;
    }

    // 还没有GO，轮询等待下载完成（每500ms检查一次，最多等8秒）
    log("  等待下载/GO...");
    var found = false;
    for (var i = 0; i < 16; i++) {
        sleep(500);
        if (text("GO").exists()) { found = true; break; }
    }
    if (found) { log("  GO已出现"); }
}

// ============================================================
// MainActivity - 完成页（有  但无 Preview 无 GO）
// ============================================================
function isOnCompletePage() {
    // 排除 Preview、GO 和练习页；只有出现明确关闭/完成标记时才当完成页
    if (textContains("Preview").exists() || text("GO").exists() || isOnExercisePage()) return false;
    return text("✗").exists()
        || text("×").exists()
        || text("X").exists()
        || text("✘").exists()
        || descContains("close").exists()
        || textContains("关闭").exists();
}

function handleCompletePage() {
    log("处理完成页，点✗返回");
    toast("完成，返回");

    // 尝试找 ✗ / × / X / 关闭 按钮
    var closeBtn = text("✗").findOne(1000) || text("×").findOne(1000)
                || text("X").findOne(1000) || text("✘").findOne(1000)
                || textContains("关闭").findOne(1000)
                || descContains("close").findOne(1000);

    if (closeBtn) {
        var b = closeBtn.bounds();
        click(Math.floor((b.left + b.right) / 2), Math.floor((b.top + b.bottom) / 2));
        log("  点击✗关闭");
    } else {
        // 找不到就按返回
        log("  找不到✗，按back");
        back();
    }

    // 完成一个topic，进下一个
    state.topicIndex++;
    state.samePageCount = 0;
    log("  topicIndex -> " + state.topicIndex);

    // 轮询等待回到Topic页或Menu页
    waitUntil(function () {
        var a = currentActivity();
        return a.indexOf("Menu") >= 0 || a.indexOf("MainActivity") >= 0;
    }, 3000);
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
        sleep(3000);
        return;
    }

    // 2. 找提交按钮（可能在答题页）
    var submit = text("提交").findOne(500) || textContains("Submit").findOne(500);
    if (submit) {
        submit.click();
        log("  点击提交");
        sleep(2000);
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
                sleep(2000);
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
        sleep(1500);
        return;
    }

    // 5. 找 ✗ 关闭按钮（答题结果页）
    var closeBtn = text("✗").findOne(500) || text("×").findOne(500)
                || text("X").findOne(500) || textContains("关闭").findOne(500);
    if (closeBtn) {
        closeBtn.click();
        log("  点击关闭✗");
        sleep(2000);
        return;
    }

    // 6. 尝试坐标戳任何看起来有用的文字
    var keywords = ["继续", "下一", "确定", "完成", "返回", "Next", "OK", "Done"];
    for (var k = 0; k < keywords.length; k++) {
        var el = textContains(keywords[k]).findOne(300);
        if (el) {
            var b = el.bounds();
            click(Math.floor((b.left + b.right) / 2), Math.floor((b.top + b.bottom) / 2));
            log("  坐标戳: " + keywords[k]);
            sleep(2500);
            return;
        }
    }

    // 7. 实在没辙，每10次循环才按一次返回（降低误伤）
    if (state.loopCount % 10 === 0) {
        log("  无可用操作，尝试返回");
        back();
        sleep(2000);
    } else {
        log("  无可用操作，等待...");
        sleep(3000);
    }
}

function recoverFromError() {
    log("尝试错误恢复...");

    if (!currentPackage().equals(CONFIG.APP_PACKAGE)) {
        launchNeoApp();
        return;
    }

    back();
    sleep(2000);

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
