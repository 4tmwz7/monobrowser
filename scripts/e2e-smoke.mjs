// Testy dymne w odizolowanym Xvfb: `npm run test:e2e` (wymaga xvfb-run, xdotool i zbudowanej aplikacji).
// Środowisko jest odcięte od pulpitu użytkownika (bez D-Bus i Wayland), a testy nie wywołują
// natywnych dialogów plików – te przez portal D-Bus trafiłyby na prawdziwą sesję.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8765;
const H = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (name, ok, info = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  - ${info}` : ""}`);
};

if (!process.env.DISPLAY) {
  console.error("Uruchom przez: xvfb-run -a npm run test:e2e");
  process.exit(2);
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, H);
  if (pathname === "/fav.png") {
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(PNG);
  }
  if (pathname.startsWith("/cookie") || pathname === "/setcookie") {
    res.writeHead(200, { "content-type": "text/html", ...(pathname === "/setcookie" ? { "set-cookie": "secret=1; Path=/" } : {}) });
    return res.end(`<title>Cookie</title>${pathname}`);
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>Page ${pathname}</title><link rel="icon" href="/fav.png"><body>PAGE ${pathname} lorem ipsum lorem ipsum`);
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "monobrowser-e2e-"));
const isolatedEnv = { ...process.env, DBUS_SESSION_BUS_ADDRESS: "disabled:", GTK_USE_PORTAL: "0", WAYLAND_DISPLAY: "", XDG_SESSION_TYPE: "x11" };
const electronBin = path.join(root, "node_modules", ".bin", "electron");
const launch = (extra = [], port = 9333) => {
  const child = spawn(electronBin, [root, "--no-sandbox", "--ozone-platform=x11", `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, ...extra], { cwd: root, env: isolatedEnv, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { child, log: () => log };
};
const listTargets = async (port = 9333) => (await fetch(`http://127.0.0.1:${port}/json`)).json();
const connect = async (target) => {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const data = JSON.parse(m.data);
    if (data.id) pending.get(data.id)?.(data);
    else events.push(data);
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const callId = ++id;
    pending.set(callId, resolve);
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  const ev = async (expression, userGesture = false) =>
    (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture })).result?.result?.value;
  await send("Runtime.enable");
  await send("Log.enable");
  return { ev, send, events, close: () => ws.close() };
};
const xdotool = (...args) => {
  try { return execFileSync("xdotool", args, { encoding: "utf8" }).trim(); } catch { return ""; }
};

const app = launch();
let exitCode = 0;
try {
  await sleep(9000);
  const shell = await connect((await listTargets()).find((t) => t.url.includes("index.html")));
  const api = "window.browserApi";
  const state = async () => JSON.parse(await shell.ev(`(async()=>JSON.stringify(await ${api}.getTabsState()))()`));
  const pageOf = async (suffix) => connect((await listTargets()).find((t) => t.url.endsWith(suffix)));

  // favicony
  await shell.ev(`${api}.createTab("${H}/a")`);
  await sleep(3000);
  let st = await state();
  check("favicon jako data URL", Boolean(st.tabs.find((t) => t.url.endsWith("/a"))?.favicon?.startsWith("data:image/png")));
  check("favicon <img> w pasku kart", (await shell.ev(`document.querySelectorAll('img.tab-favicon').length`)) >= 1);

  // przeciąganie kart
  await shell.ev(`${api}.createTab("${H}/b")`);
  await sleep(1500);
  await shell.ev(`${api}.createTab("${H}/c")`);
  await sleep(1500);
  const ids = (await state()).tabs.map((t) => t.id);
  await shell.ev(`${api}.moveTab(${ids.at(-1)}, ${ids[1]})`);
  await sleep(400);
  check("moveTab przed drugą kartą", (await state()).tabs.map((t) => t.id).join() === [ids[0], ids.at(-1), ...ids.slice(1, -1)].join());
  await shell.ev(`${api}.moveTab(${ids[0]}, null)`);
  await sleep(400);
  check("moveTab na koniec", (await state()).tabs.at(-1).id === ids[0]);
  check("moveTab odrzuca złe dane", (await shell.ev(`${api}.moveTab("x", null)`)) === false);

  // karty prywatne
  await shell.ev(`${api}.executePaletteCommand("new-private-tab")`);
  await sleep(1500);
  const priv = (await state()).tabs.find((t) => t.isPrivate);
  check("karta prywatna z palety", Boolean(priv));
  await shell.ev(`${api}.navigate("${H}/setcookie")`);
  await sleep(2500);
  const privPage = await pageOf("/setcookie");
  check("ciasteczko w karcie prywatnej", (await privPage.ev("document.cookie")).includes("secret=1"));
  privPage.close();
  await shell.ev(`${api}.createTab("${H}/cookie")`);
  await sleep(2500);
  const normal = await pageOf("/cookie");
  check("zwykła karta nie widzi ciasteczka prywatnego", !(await normal.ev("document.cookie")).includes("secret"));
  normal.close();
  check("adres prywatny poza historią", !(await shell.ev(`(async()=>JSON.stringify(await ${api}.getHistory()))()`)).includes("setcookie"));
  await shell.ev(`${api}.switchTab(${priv.id})`);
  await sleep(800);
  await shell.ev(`${api}.closeTab(${priv.id})`);
  await sleep(1500);
  await shell.ev(`${api}.executePaletteCommand("new-private-tab")`);
  await sleep(1500);
  await shell.ev(`${api}.navigate("${H}/cookieB")`);
  await sleep(2500);
  const wiped = await pageOf("/cookieB");
  check("sesja prywatna wyczyszczona po zamknięciu ostatniej karty", !(await wiped.ev("document.cookie")).includes("secret"));
  wiped.close();

  // izolacja strony i adblock
  const page = await pageOf("/a");
  check("strona nie widzi browserApi ani IPC", (await page.ev("typeof window.browserApi + typeof require + typeof ipcRenderer")) === "undefinedundefinedundefined");

  // uprawnienia: odmowa (domyślnie) i zgoda
  const geo = page.ev(`new Promise(r=>navigator.geolocation.getCurrentPosition(()=>r('granted'),e=>r('denied:'+e.code),{timeout:15000}))`);
  await sleep(2500);
  check("dialog uprawnień się pojawia", xdotool("search", "--name", "Uprawnienia witryny|Site permission").length > 0);
  xdotool("key", "Return"); // domyślny przycisk = Zablokuj
  check("domyślnie blokuje geolokalizację", String(await geo).startsWith("denied"));
  const notif = page.ev(`Notification.requestPermission()`, true);
  await sleep(2500);
  xdotool("key", "Tab");
  xdotool("key", "Return"); // Tab przenosi fokus na „Zezwól”
  const notifResult = await notif;
  check("zgoda w dialogu przyznaje powiadomienia", notifResult === "granted", String(notifResult));
  check("zgoda jest zapamiętana (Notification.permission)", (await page.ev(`Notification.permission`)) === "granted");
  check("fullscreen działa z gestem użytkownika", (await page.ev(`document.documentElement.requestFullscreen().then(()=>'ok',e=>'err:'+e.message)`, true)) === "ok");
  await page.ev(`document.exitFullscreen()`, true);
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true }); // dialogi zabierają fokus dokumentowi
  const clip = await page.ev(`navigator.clipboard.writeText('x').then(()=>'ok',e=>'err:'+e.message)`, true);
  check("zapis do schowka dozwolony", clip === "ok", String(clip));
  page.close();

  const ab = JSON.parse(await shell.ev(`(async()=>JSON.stringify(await ${api}.getAdblockStatus()))()`));
  check("silnik adblocka gotowy", ab.enabled && ab.ready);

  // uśpienie kart i wyszukiwanie
  await shell.ev(`${api}.executePaletteCommand("sleep-other-tabs")`);
  await sleep(1500);
  st = await state();
  const sleeping = st.tabs.find((t) => t.isSleeping);
  check("karty zasypiają", Boolean(sleeping));
  if (sleeping) {
    await shell.ev(`${api}.switchTab(${sleeping.id})`);
    await sleep(3000);
    check("uśpiona karta budzi się", !(await state()).tabs.find((t) => t.id === sleeping.id).isSleeping);
  }
  await shell.ev(`${api}.createTab("${H}/c")`);
  await sleep(2500);
  const found = JSON.parse(await shell.ev(`(async()=>JSON.stringify(await ${api}.findInPage("lorem",{})))()`));
  check("wyszukiwanie zwraca trafienia", found.matches >= 2);

  // druga instancja
  const before = (await state()).tabs.length;
  const second = spawn(electronBin, [root, "--no-sandbox", "--ozone-platform=x11", `--user-data-dir=${userData}`, "--remote-debugging-port=9334", `${H}/d`], { cwd: root, env: isolatedEnv, stdio: "ignore" });
  const exited = await Promise.race([new Promise((resolve) => second.on("exit", () => resolve(true))), sleep(10000).then(() => false)]);
  await sleep(2000);
  st = await state();
  check("druga instancja kończy się i otwiera kartę z adresem", exited && st.tabs.length === before + 1 && st.tabs.some((t) => t.url.endsWith("/d")));

  const csp = shell.events.filter((e) => JSON.stringify(e).toLowerCase().includes("content security policy"));
  check("brak naruszeń CSP w powłoce", csp.length === 0);
  check("brak wyjątków w logu aplikacji", !/TypeError|ReferenceError|Uncaught|UnhandledPromise/.test(app.log()));
} catch (error) {
  console.error("E2E error:", error);
  exitCode = 1;
} finally {
  const closed = new Promise((resolve) => app.child.on("exit", resolve));
  app.child.kill();
  await Promise.race([closed, sleep(5000)]);
  server.close();
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(exitCode || (passed === results.length ? 0 : 1));
