// 流程测试：手动停在Topic列表页(Unit1里的The Secret Code页)再运行
auto();
sleep(500);

// 处理 AutoX 弹窗
function dismissAutoXDialog() {
    var act = currentActivity();
    if (act.indexOf("ComposeDialog") >= 0 || act.indexOf("AutoX") >= 0) {
        var c = text("继续").findOne(1000);
        if (c) { c.click(); log("  处理AutoX弹窗: 继续"); sleep(2000); }
        return true;
    }
    return false;
}

log("=== test-flow 开始 ===");
log("当前Activity: " + currentActivity());
dismissAutoXDialog();

// Step 1: 找 The Secret Code 并点击
log("\nStep1: 找 The Secret Code");
var sc = text("The Secret Code").findOne(3000);
if (!sc) {
    log("FAIL: 找不到 The Secret Code");
    toast("FAIL: 没找到Secret Code");
    return;
}

var b = sc.bounds();
var cx = Math.floor((b.left + b.right) / 2);
var cy = Math.floor((b.top + b.bottom) / 2);
log("  坐标(" + cx + "," + cy + ") 点击");
click(cx, cy);
sleep(3000);
dismissAutoXDialog();

var act = currentActivity();
log("  点击后Activity: " + act);

// Step 2: BottomSheet → 点 Step 1 Preview
if (act.indexOf("BottomSheet") >= 0) {
    log("\nStep2: BottomSheet → 点 Step 1 Preview");
    var preview = text("Step 1 Preview").findOne(3000);
    if (preview) {
        var bb = preview.bounds();
        click(Math.floor((bb.left + bb.right) / 2), Math.floor((bb.top + bb.bottom) / 2));
        sleep(4000);
        dismissAutoXDialog();
        act = currentActivity();
        log("  点击后Activity: " + act);
    } else {
        log("  FAIL: 找不到 Step 1 Preview");
    }
}

// Step 3: 等 GO
log("\nStep3: 等GO按钮");
for (var i = 0; i < 10; i++) {
    dismissAutoXDialog();
    act = currentActivity();
    log("  [" + i + "] Activity: " + act);
    var go = text("GO").findOne(2000);
    if (go) {
        log("  找到GO，点击!");
        go.click();
        sleep(3000);
        dismissAutoXDialog();
        log("  点击后Activity: " + currentActivity());
        break;
    }
    log("  无GO，等5秒");
    sleep(5000);
}

log("\n=== test-flow 完成 ===");
toast("test-flow完成");
