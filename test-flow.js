// Flow test: manually stop on the Topic list page (The Secret Code under Unit 1), then run this script.
auto();
sleep(500);

// Handle AutoX dialog.
function dismissAutoXDialog() {
    var act = currentActivity();
    if (act.indexOf("ComposeDialog") >= 0 || act.indexOf("AutoX") >= 0) {
        var c = text("继续").findOne(1000);
        if (c) { c.click(); log("  Handled AutoX dialog: continue"); sleep(2000); }
        return true;
    }
    return false;
}

log("=== test-flow start ===");
log("Current Activity: " + currentActivity());
dismissAutoXDialog();

// Step 1: find The Secret Code and tap it.
log("\nStep1: find The Secret Code");
var sc = text("The Secret Code").findOne(3000);
if (!sc) {
    log("FAIL: Could not find The Secret Code");
    toast("FAIL: Secret Code not found");
    return;
}

var b = sc.bounds();
var cx = Math.floor((b.left + b.right) / 2);
var cy = Math.floor((b.top + b.bottom) / 2);
log("  Tap coordinate (" + cx + "," + cy + ")");
click(cx, cy);
sleep(3000);
dismissAutoXDialog();

var act = currentActivity();
log("  Activity after tap: " + act);

// Step 2: BottomSheet -> tap Step 1 Preview.
if (act.indexOf("BottomSheet") >= 0) {
    log("\nStep2: BottomSheet -> tap Step 1 Preview");
    var preview = text("Step 1 Preview").findOne(3000);
    if (preview) {
        var bb = preview.bounds();
        click(Math.floor((bb.left + bb.right) / 2), Math.floor((bb.top + bb.bottom) / 2));
        sleep(4000);
        dismissAutoXDialog();
        act = currentActivity();
        log("  Activity after tap: " + act);
    } else {
        log("  FAIL: Could not find Step 1 Preview");
    }
}

// Step 3: wait for GO.
log("\nStep3: wait for GO button");
for (var i = 0; i < 10; i++) {
    dismissAutoXDialog();
    act = currentActivity();
    log("  [" + i + "] Activity: " + act);
    var go = text("GO").findOne(2000);
    if (go) {
        log("  Found GO, tapping");
        go.click();
        sleep(3000);
        dismissAutoXDialog();
        log("  Activity after tap: " + currentActivity());
        break;
    }
    log("  No GO yet; wait 5 seconds");
    sleep(5000);
}

log("\n=== test-flow done ===");
toast("test-flow done");
