// Tiny CDP client (Node built-ins only).
// node cdp.mjs <port> list
// node cdp.mjs <port> eval <urlSubstring> <file.js|-e expr>   (evaluates in the first matching target, awaits promises)
// node cdp.mjs <port> shot <out.png>                          (screenshot of the OBR room tab)
import { readFileSync, writeFileSync } from "node:fs";

const [port, cmd, a, b, c] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();

function session(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => {
    await ready;
    return new Promise((r) => {
      pending.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  return { send, close: () => ws.close() };
}

if (cmd === "list") {
  for (const t of targets) console.log(t.type, "|", t.title.slice(0, 40), "|", t.url.slice(0, 120));
} else if (cmd === "eval") {
  const t = targets.find((t) => t.url.includes(a) && (t.type === "page" || t.type === "iframe"));
  if (!t) throw new Error("no target " + a);
  const expr = a && b === "-e" ? c : readFileSync(b, "utf8");
  const s = session(t);
  const r = await s.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? r, null, 1));
  s.close();
} else if (cmd === "click" || cmd === "drag" || cmd === "rclick") {
  // click x y | rclick x y | drag x1 y1 x2 y2  (on the room page)
  const t = targets.find((t) => t.type === "page" && t.url.includes("/room/"));
  const s = session(t);
  const [x1, y1, x2, y2] = process.argv.slice(4).map(Number);
  const m = (type, x, y, extra = {}) => s.send("Input.dispatchMouseEvent", { type, x, y, button: cmd === "rclick" ? "right" : "left", clickCount: 1, ...extra });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await m("mouseMoved", x1, y1, { button: "none" });
  await m("mousePressed", x1, y1, { buttons: cmd === "rclick" ? 2 : 1 });
  if (cmd === "drag") {
    for (let i = 1; i <= 15; i++) { await m("mouseMoved", x1 + ((x2 - x1) * i) / 15, y1 + ((y2 - y1) * i) / 15, { buttons: 1 }); await sleep(20); }
    await m("mouseReleased", x2, y2);
  } else await m("mouseReleased", x1, y1);
  console.log("ok");
  s.close();
} else if (cmd === "shot") {
  const t = targets.find((t) => t.type === "page" && t.url.includes("/room/"));
  const s = session(t);
  const r = await s.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(a, Buffer.from(r.result.data, "base64"));
  console.log("saved", a);
  s.close();
}
