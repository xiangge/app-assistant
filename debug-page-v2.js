// 在当前neo页面直接跑即可
// 结果保存在 /sdcard/neo-debug.txt，同时弹 toast 提示关键信息
auto();
sleep(500);

var out = [];

function p(msg) {
    out.push(msg);
    log(msg);
}

p("=== 当前页面诊断 ===");
p("包名: " + currentPackage());
p("Activity: " + currentActivity());

p("\n--- 文本元素 ---");
var texts = className("android.widget.TextView").find();
for (var i = 0; i < Math.min(texts.length, 30); i++) {
    try {
        var t = texts[i].text();
        if (t && t.length > 0) {
            p("  [" + i + "] '" + t + "'");
        }
    } catch (e) {}
}

p("\n--- 按钮 ---");
var btns = className("android.widget.Button").find();
for (var i = 0; i < Math.min(btns.length, 15); i++) {
    try {
        var b = btns[i];
        p("  [" + i + "] '" + (b.text() || "(无字)") + "'");
    } catch (e) {}
}

p("\n--- 可点击View ---");
var views = className("android.view.View").clickable(true).find();
for (var i = 0; i < Math.min(views.length, 15); i++) {
    try {
        var v = views[i];
        p("  [" + i + "] text='" + (v.text() || "") + "' desc='" + (v.desc() || "") + "'");
    } catch (e) {}
}

p("\n--- ImageView ---");
var imgs = className("android.widget.ImageView").find();
for (var i = 0; i < Math.min(imgs.length, 15); i++) {
    try {
        var img = imgs[i];
        p("  [" + i + "] desc='" + (img.desc() || "") + "' clickable=" + img.clickable());
    } catch (e) {}
}

p("\n完成: " + new Date().toLocaleString());

// 写入文件
var path = "/sdcard/neo-debug.txt";
files.write(path, out.join("\n"));

toast("已保存到: " + path);
sleep(3000);
