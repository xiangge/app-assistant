var CONFIG = {
    APP_PACKAGE: "com.nexgen.nsa",
    APP_NAME: "neo",
    TARGET_POINTS: 6000,
    LOOP_INTERVAL: 2000,
    SWIPE_DURATION: 500,
    MAX_RETRY: 3,
    RANDOM_DELAY_MIN: 800,
    RANDOM_DELAY_MAX: 2500,
};

var state = {
    isRunning: true,
    loopCount: 0,
    startTime: Date.now(),
    lastActionTime: 0,
};

function main() {
    auto.waitFor();
    toast("neo 自动学习脚本启动");

    requestScreenCapture(false);

    showControlPanel();

    launchNeoApp();

    while (state.isRunning) {
        try {
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
    toast("启动 neo 应用...");
    app.launchApp(CONFIG.APP_NAME);
    sleep(5000);

    if (!currentPackage().equals(CONFIG.APP_PACKAGE)) {
        log("包名不匹配，尝试通过包名启动");
        launch(CONFIG.APP_PACKAGE);
        sleep(5000);
    }

    if (currentPackage().equals(CONFIG.APP_PACKAGE)) {
        toast("neo 已启动");
    } else {
        toast("启动失败，请手动打开 neo");
        sleep(10000);
    }
}

function handleCurrentScreen() {
    dismissPopups();

    if (isOnHomePage()) {
        enterLearningModule();
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

function isOnHomePage() {
    return textContains("学习").exists()
        || textContains("首页").exists()
        || textContains("我的课程").exists()
        || idContains("home").exists()
        || idContains("main").exists();
}

function enterLearningModule() {
    log("在首页，尝试进入学习模块");

    var learningEntries = [
        textContains("继续学习").findOne(2000),
        textContains("开始学习").findOne(1000),
        textContains("AI练习").findOne(1000),
        textContains("自主练习").findOne(1000),
        textContains("我的课程").findOne(1000),
        textContains("课件").findOne(1000),
    ];

    for (var i = 0; i < learningEntries.length; i++) {
        var entry = learningEntries[i];
        if (entry) {
            entry.click();
            sleep(2000);
            log("点击了学习入口: " + (entry.text() || entry.id()));
            return;
        }
    }

    var courseItem = className("android.widget.ImageView")
        .clickable(true)
        .findOne(1000);
    if (courseItem) {
        courseItem.click();
        sleep(2000);
        log("点击了课程项");
        return;
    }

    log("未找到学习入口，尝试滑动查找");
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

function isOnExercisePage() {
    return textContains("选择").exists()
        || textContains("答案").exists()
        || textContains("提交").exists()
        || textContains("A").exists()
        || textContains("B").exists()
        || className("android.widget.RadioButton").exists()
        || className("android.widget.CheckBox").exists();
}

function handleExercise() {
    log("处理练习页面");

    var optionClicked = clickRandomOption();
    if (optionClicked) {
        sleep(1000);
        submitAnswer();
        sleep(2000);
        return;
    }

    if (textContains("跟读").exists() || textContains("录音").exists() || textContains("说话").exists()) {
        handleSpeakingExercise();
        return;
    }

    if (textContains("填空").exists() || className("android.widget.EditText").exists()) {
        handleFillBlank();
        return;
    }

    swipeUp();
    sleep(1500);
}

function clickRandomOption() {
    var options = [];

    var radioButtons = className("android.widget.RadioButton").find();
    for (var i = 0; i < radioButtons.length; i++) {
        options.push(radioButtons[i]);
    }

    var checkBoxes = className("android.widget.CheckBox").find();
    for (var i = 0; i < checkBoxes.length; i++) {
        options.push(checkBoxes[i]);
    }

    var textOptions = textMatches("[A-F][.．]").find();
    for (var i = 0; i < textOptions.length; i++) {
        options.push(textOptions[i]);
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
        options[randomIndex].click();
        log("选择了选项 " + randomIndex);
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
    return textContains("完成").exists()
        || textContains("得分").exists()
        || textContains("正确").exists()
        || textContains("继续").exists()
        || textContains("恭喜").exists();
}

function handleResultPage() {
    log("处理结果页面");

    var continueBtn = textContains("继续").findOne(1000)
        || textContains("下一课").findOne(1000)
        || textContains("继续学习").findOne(1000)
        || textContains("下一步").findOne(1000)
        || textContains("完成").findOne(1000);

    if (continueBtn) {
        continueBtn.click();
        sleep(2000);
        return;
    }

    back();
    sleep(2000);
}

function handleGenericScreen() {
    log("处理通用界面: " + currentActivity());

    if (textContains("积分").exists()) {
        var pointText = textMatches("\\d+").findOne(1000);
        if (pointText) {
            log("当前积分信息: " + pointText.text());
        }
    }

    var clickableElements = className("android.widget.Button").clickable(true).find();
    if (clickableElements.length > 0) {
        for (var i = 0; i < clickableElements.length; i++) {
            var el = clickableElements[i];
            var elText = el.text();
            if (elText && (
                elText.contains("学习") || elText.contains("继续")
                || elText.contains("开始") || elText.contains("下一")
                || elText.contains("播放")
            )) {
                el.click();
                sleep(2000);
                return;
            }
        }
    }

    if (state.loopCount % 5 === 0) {
        log("定期返回首页检查");
        back();
        sleep(2000);
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
