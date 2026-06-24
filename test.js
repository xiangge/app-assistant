/**
 * AutoX 环境验证脚本
 * 运行前请确保已开启：无障碍服务、悬浮窗、电池不限制、自启动
 *
 * 用法：在 AutoX 中导入此脚本运行即可
 */

var CONFIG = {
    APP_PACKAGE: "com.nexgen.nsa",
    APP_NAME: "neo",
};


// ============================================================
// 1. 无障碍服务
// ============================================================
function test_accessibility() {
    log("=== 1. 无障碍服务 ===");
    auto();
    sleep(500);

    if (auto.service) {
        log("✓ 无障碍服务正常");
        return true;
    } else {
        log("✗ 无障碍服务未连接！");
        log("  请到 系统设置 → 无障碍 → AutoX → 开启");
        return false;
    }
}


// ============================================================
// 2. 悬浮窗权限
// ============================================================
function test_floaty() {
    log("=== 2. 悬浮窗权限 ===");

    if (floaty.checkPermission()) {
        log("✓ 悬浮窗权限已授予");
        return true;
    }

    log("! 悬浮窗权限未授予，正在请求...");
    toast("请在弹出的窗口中授予悬浮窗权限");
    floaty.requestPermission();
    sleep(3000);

    if (floaty.checkPermission()) {
        log("✓ 悬浮窗权限已授予");
        return true;
    }

    log("✗ 悬浮窗权限获取失败");
    log("  请到 系统设置 → 应用 → AutoX → 显示在其他应用上层 → 允许");
    return false;
}


// ============================================================
// 3. 启动 neo
// ============================================================
function test_launch_neo() {
    log("=== 3. 启动 neo ===");

    app.launch(CONFIG.APP_PACKAGE);
    sleep(3000);

    var pkg = currentPackage();
    log("当前前台包名: " + pkg);
    log("目标包名: " + CONFIG.APP_PACKAGE);

    if (pkg == CONFIG.APP_PACKAGE) {
        log("✓ neo 已启动成功");
        return true;
    } else {
        log("✗ 启动失败，当前在前台的不是 neo");
        log("  检查 CONFIG.APP_PACKAGE 是否正确，或手动打开 neo");
        return false;
    }
}


// ============================================================
// 4. 控件读取（核心能力）
// ============================================================
function test_read_elements() {
    log("=== 4. 读取 neo 控件 ===");

    // 列出当前页面所有可见文本
    var allText = className("android.widget.TextView").find();
    log("页面文本元素总数: " + allText.length);

    var found = 0;
    for (var i = 0; i < Math.min(allText.length, 30); i++) {
        try {
            var txt = allText[i].text();
            if (txt && txt.length > 0) {
                log("  [" + i + "] " + txt);
                found++;
            }
        } catch (e) {}
    }

    if (found == 0) {
        log("✗ 读不到任何文字！无障碍服务可能失效");
        return false;
    }

    // 尝试找常见关键词
    var keywords = ["学习", "开始", "首页", "课程", "播放", "继续"];
    var matched = [];
    for (var j = 0; j < keywords.length; j++) {
        if (textContains(keywords[j]).exists()) {
            matched.push(keywords[j]);
        }
    }

    if (matched.length > 0) {
        log("✓ 匹配到的关键词: " + matched.join(", "));
        return true;
    } else {
        log("! 未匹配到预期关键词，当前页面可能是: " + currentActivity());
        log("  请确保 neo 在首页/课程页");
        // 能读到文字就说明无障碍OK，不报错
        return found > 0;
    }
}


// ============================================================
// 5. 点击测试
// ============================================================
function test_click() {
    log("=== 5. 点击测试 ===");

    // 尝试找一个可点击的按钮
    var btn = className("android.widget.Button")
        .clickable(true)
        .findOne(2000);

    if (btn) {
        var btnText = btn.text() || "(无文字)";
        log("找到按钮: " + btnText);
        log("  可点击: " + btn.clickable());
        log("  位置: " + btn.bounds());
        log("✓ 点击能力正常");
        return true;
    }

    // 退一步，找任意可点击的 View
    var view = className("android.view.View")
        .clickable(true)
        .findOne(2000);

    if (view) {
        log("找到可点击 View: " + (view.desc() || "(无描述)"));
        log("✓ 点击能力正常");
        return true;
    }

    log("! 未找到可点击控件，但无障碍服务正常（可能是页面布局问题）");
    return false;
}


// ============================================================
// 6. 弹窗识别
// ============================================================
function test_popup_detection() {
    log("=== 6. 弹窗识别 ===");

    var closeTexts = ["关闭", "确定", "知道了", "以后再说", "跳过",
                      "暂不升级", "不再提醒", "取消"];

    for (var i = 0; i < closeTexts.length; i++) {
        var btn = text(closeTexts[i]).findOne(500);
        if (btn) {
            log("! 发现弹窗: " + closeTexts[i] + "，自动关闭");
            btn.click();
            sleep(500);
        }
    }

    log("✓ 弹窗检查完成");
    return true;
}


// ============================================================
// 主流程
// ============================================================
function main() {
    log("========================================");
    log("  AutoX 环境验证测试");
    log("  时间: " + new Date().toLocaleString());
    log("========================================\n");

    var results = {
        "无障碍服务": test_accessibility(),
        "悬浮窗权限": test_floaty(),
        "启动neo":     test_launch_neo(),
        "控件读取":    test_read_elements(),
        "点击能力":    test_click(),
        "弹窗识别":    test_popup_detection(),
    };

    // 总结
    log("\n========================================");
    log("  测试结果汇总");
    log("========================================");

    var pass = 0;
    var fail = 0;
    for (var key in results) {
        if (results[key]) {
            log("  ✓ " + key);
            pass++;
        } else {
            log("  ✗ " + key);
            fail++;
        }
    }

    log("\n通过: " + pass + " / " + Object.keys(results).length);

    if (fail == 0) {
        log("🎉 全部通过！可以运行 neo-auto-learn.js");
        toast("全部通过！环境就绪");
    } else {
        log("⚠️ 有 " + fail + " 项未通过，按上面提示修复后重新测试");
        toast("有 " + fail + " 项未通过");
    }
}

main();
