// 当前界面完整诊断脚本 —— 停在问题页面运行，不点击，只复制控件树摘要
auto();
sleep(500);

var out = [];
function log2(msg) { out.push(String(msg)); log(String(msg)); }

function boundsText(node) {
    var b = node.bounds();
    var cx = Math.floor((b.left + b.right) / 2);
    var cy = Math.floor((b.top + b.bottom) / 2);
    return "bounds=(" + b.left + "," + b.top + "," + b.right + "," + b.bottom + ") center=(" + cx + "," + cy + ") size=(" + b.width() + "x" + b.height() + ")";
}

function safe(v) { return v == null ? "" : String(v); }

function nodeLine(prefix, node) {
    var p = node.parent();
    var gp = p ? p.parent() : null;
    log2(prefix
        + " class=" + safe(node.className())
        + " text='" + safe(node.text()) + "'"
        + " desc='" + safe(node.desc()) + "'"
        + " id='" + safe(node.id()) + "'"
        + " clickable=" + node.clickable()
        + " enabled=" + node.enabled()
        + " visible=" + node.visibleToUser()
        + " " + boundsText(node));
    if (p) {
        log2("    parent class=" + safe(p.className())
            + " text='" + safe(p.text()) + "'"
            + " desc='" + safe(p.desc()) + "'"
            + " id='" + safe(p.id()) + "'"
            + " clickable=" + p.clickable()
            + " enabled=" + p.enabled()
            + " visible=" + p.visibleToUser()
            + " " + boundsText(p));
    }
    if (gp) {
        log2("    grand class=" + safe(gp.className())
            + " text='" + safe(gp.text()) + "'"
            + " desc='" + safe(gp.desc()) + "'"
            + " id='" + safe(gp.id()) + "'"
            + " clickable=" + gp.clickable()
            + " enabled=" + gp.enabled()
            + " visible=" + gp.visibleToUser()
            + " " + boundsText(gp));
    }
}

function toArr(col) {
    var arr = [];
    for (var i = 0; i < col.length; i++) arr.push(col[i]);
    return arr;
}

function dump(title, nodes, limit) {
    log2("\n--- " + title + " count=" + nodes.length + " ---");
    for (var i = 0; i < Math.min(nodes.length, limit); i++) {
        try { nodeLine("[" + i + "]", nodes[i]); } catch (e) { log2("[" + i + "] error=" + e); }
    }
}

function dumpRegion(title, nodes, limit, topRatio) {
    log2("\n--- " + title + " count=" + nodes.length + " ---");
    var shown = 0;
    for (var i = 0; i < nodes.length && shown < limit; i++) {
        try {
            var b = nodes[i].bounds();
            var cy = Math.floor((b.top + b.bottom) / 2);
            if (cy < device.height * topRatio) continue;
            nodeLine("[" + i + "]", nodes[i]);
            shown++;
        } catch (e) { log2("[" + i + "] error=" + e); }
    }
}

try {
    log2("=== 当前界面完整诊断 ===");
    log2("Package: " + currentPackage());
    log2("Activity: " + currentActivity());
    log2("Device: " + device.width + "x" + device.height);

    dump("关键字候选: 继续/退出/确定/Next/Home", [].concat(
        toArr(textContains("继续").find()),
        toArr(textContains("退出").find()),
        toArr(textContains("确定").find()),
        toArr(textContains("Next").find()),
        toArr(textContains("Home").find()),
        toArr(descContains("继续").find()),
        toArr(descContains("退出").find()),
        toArr(descContains("Next").find()),
        toArr(descContains("Home").find()),
        toArr(idContains("continue").find()),
        toArr(idContains("next").find()),
        toArr(idContains("home").find())
    ), 100);

    dumpRegion("下半屏 TextView", toArr(className("android.widget.TextView").find()), 120, 0.45);
    dumpRegion("下半屏 Button", toArr(className("android.widget.Button").find()), 80, 0.45);
    dumpRegion("下半屏 ImageButton", toArr(className("android.widget.ImageButton").find()), 80, 0.45);
    dumpRegion("下半屏 ImageView", toArr(className("android.widget.ImageView").find()), 120, 0.45);
    dumpRegion("下半屏 clickable View", toArr(className("android.view.View").clickable(true).find()), 120, 0.45);
    dumpRegion("下半屏 clickable ViewGroup", toArr(className("android.view.ViewGroup").clickable(true).find()), 120, 0.45);

    dump("全部 TextView", toArr(className("android.widget.TextView").find()), 160);
    dump("全部 Button", toArr(className("android.widget.Button").find()), 100);
    dump("全部 ImageButton", toArr(className("android.widget.ImageButton").find()), 100);
    dump("全部 ImageView", toArr(className("android.widget.ImageView").find()), 160);
    dump("全部 clickable View", toArr(className("android.view.View").clickable(true).find()), 160);
    dump("全部 clickable ViewGroup", toArr(className("android.view.ViewGroup").clickable(true).find()), 160);

    log2("\n--- 坐标参考 ---");
    var pts = [
        [0.5, 0.60], [0.5, 0.65], [0.5, 0.70], [0.5, 0.75], [0.5, 0.80], [0.5, 0.85],
        [0.35, 0.65], [0.65, 0.65], [0.75, 0.87], [0.92, 0.92]
    ];
    for (var i = 0; i < pts.length; i++) {
        log2("(" + pts[i][0] + "w," + pts[i][1] + "h) = (" + Math.floor(device.width * pts[i][0]) + "," + Math.floor(device.height * pts[i][1]) + ")");
    }

    log2("\n完成，已复制到剪贴板");
} catch (e) {
    log2("异常: " + e);
}

try { setClip(out.join("\n")); toast("当前界面诊断已复制"); } catch(e) { toast("查看日志"); }
sleep(3000);
