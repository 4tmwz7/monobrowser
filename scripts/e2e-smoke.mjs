// Testy dymne w odizolowanym Xvfb: `npm run test:e2e` (wymaga xvfb-run, xdotool i zbudowanej aplikacji).
// Środowisko jest odcięte od pulpitu użytkownika (bez D-Bus i Wayland), a testy nie wywołują
// natywnych dialogów plików – te przez portal D-Bus trafiłyby na prawdziwą sesję.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let PORT = 0; // free port picked at listen time (other tools may hold 8765)
let H = "http://127.0.0.1:0";
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
  if (pathname === "/auth") {
    const expected = `Basic ${Buffer.from("u:p").toString("base64")}`;
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="e2e"', "content-type": "text/html" });
      return res.end("<title>Denied</title>denied");
    }
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<title>Authed</title>authed");
  }
  if (pathname === "/unload") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<!doctype html><title>Unload</title><body>unload page<script>addEventListener('beforeunload',e=>{e.preventDefault();e.returnValue='x';})</script>");
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>Page ${pathname}</title><link rel="icon" href="/fav.png"><body>PAGE ${pathname} lorem ipsum lorem ipsum`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
PORT = server.address().port;
H = `http://127.0.0.1:${PORT}`;

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "monobrowser-e2e-"));
const isolatedEnv = { ...process.env, MB_NO_ANIM: "1", MB_SKIP_ONBOARDING: "1", DBUS_SESSION_BUS_ADDRESS: "disabled:", NODE_OPTIONS: "--trace-warnings", GTK_USE_PORTAL: "0", WAYLAND_DISPLAY: "", XDG_SESSION_TYPE: "x11" };
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
  // A listed target can vanish before the socket opens (overlay views are recreated); never wait forever.
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("CDP connect failed"));
    setTimeout(() => reject(new Error("CDP connect timeout")), 4000);
  });
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
    // A target can die before it replies (overlay views are destroyed on answer): never wait forever.
    setTimeout(() => resolve({ error: { message: "CDP reply timeout" } }), 60000).unref?.();
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
// Watchdog: a hung step must not hold the e2e lock forever.
setTimeout(() => {
  console.error("E2E watchdog: timeout");
  try { app.child.kill("SIGKILL"); } catch {}
  process.exit(1);
}, 10 * 60 * 1000).unref();
try {
  await sleep(9000);
  const shell = await connect((await listTargets()).find((t) => t.url.includes("index.html")));
  const api = "window.browserApi";
  // Navigations/closes that raise an in-window prompt only settle once the prompt is answered: fire, do not await.
  const fire = (expression) => { void shell.ev(expression).catch(() => undefined); };
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

  // regresja: wpisanie monobrowser://settings w pasku adresu nie rusza istniejących kart (ani ich adresów)
  {
    const urlsBefore = (await state()).tabs.map((t) => t.url);
    check("przed ustawieniami są co najmniej 3 karty z różnymi adresami", new Set(urlsBefore).size >= 3, urlsBefore.join(" "));
    await shell.ev(`${api}.navigate("monobrowser://settings")`);
    await sleep(2500);
    let after = (await state()).tabs;
    check("monobrowser://settings z paska adresu zachowuje wszystkie karty i ich adresy",
      urlsBefore.every((u) => after.some((t) => t.url === u)) && after.length === urlsBefore.length + 1 && after.filter((t) => t.url === "monobrowser://settings").length === 1,
      after.map((t) => t.url).join(" "));
    await shell.ev(`${api}.navigate("monobrowser://settings")`);
    await sleep(800);
    check("ponowne wpisanie ustawień nie tworzy duplikatu ani nie ruszy kart", (await state()).tabs.length === after.length);
    // zepsute dane wejściowe (adres doklejony do monobrowser://...) nie stają się wyszukiwaniem
    await shell.ev(`${api}.navigate("monobrowser://settings${H}/mal")`);
    await sleep(2500);
    after = (await state()).tabs;
    check("monobrowser://settingshttp://… otwiera wklejony adres zamiast szukać", after.some((t) => t.url.endsWith("/mal")) && !after.some((t) => /google\.com\/search|monobrowser%3A/.test(t.url)), after.map((t) => t.url).join(" "));
    const lenBogus = after.length;
    const bogus = await shell.ev(`${api}.navigate("monobrowser://bogus")`);
    await sleep(600);
    check("nieznany adres monobrowser:// jest ignorowany", bogus === false && (await state()).tabs.length === lenBogus);
    check("zepsute dane wejściowe nie trafiają do historii", !(await shell.ev(`(async()=>JSON.stringify(await ${api}.getHistory()))()`)).includes("monobrowser"));
    await shell.ev(`${api}.switchTab(${urlsBefore.length ? (await state()).tabs.find((t) => t.url === urlsBefore[0]).id : 0})`);
    await sleep(500);
  }

  // widok podzielony (dwie karty obok siebie)
  {
    const original = (await state()).activeTabId;
    const [first, second] = (await state()).tabs.map((t) => t.id).slice(-2);
    await shell.ev(`${api}.switchTab(${first})`);
    await sleep(500);
    await shell.ev(`${api}.executePaletteCommand("split-with:${second}")`);
    await sleep(1500);
    let s = await state();
    const left = s.tabs.find((t) => t.id === first);
    const right = s.tabs.find((t) => t.id === second);
    check("podział widoku łączy dwie karty w grupę", left.splitGroupId != null && left.splitGroupId === right.splitGroupId && left.splitSide === "left" && right.splitSide === "right");
    check("pasek kart oznacza parę podzielonego widoku", (await shell.ev(`document.querySelectorAll('.tab-btn.split-member').length`)) === 2);
    check("ramka podzielonego widoku istnieje", (await listTargets()).some((t) => t.url.includes("split-frame.html")));
    await shell.ev(`${api}.switchTab(${second})`);
    await sleep(600);
    s = await state();
    check("przełączenie panelu zmienia aktywną kartę i zachowuje podział", s.activeTabId === second && s.tabs.find((t) => t.id === first).splitGroupId != null);
    await shell.ev(`${api}.executePaletteCommand("split-close")`);
    await sleep(800);
    s = await state();
    check("zamknięcie podziału rozdziela karty", s.tabs.find((t) => t.id === first).splitGroupId == null && s.tabs.find((t) => t.id === second).splitGroupId == null);

    // tryb kompaktowy: nakładka z paskiem (drugi egzemplarz powłoki) istnieje tylko przy włączonym trybie
    const overlayCount = async () => (await listTargets()).filter((t) => t.url.includes("chrome=overlay")).length;
    check("bez trybu kompaktowego brak nakładki paska", (await overlayCount()) === 0);
    await shell.ev(`${api}.setLayoutSettings({ compactMode: true })`);
    await sleep(2500);
    check("tryb kompaktowy tworzy nakładkę paska", (await overlayCount()) === 1);
    check("tryb kompaktowy jest zapisany w ustawieniach", (await shell.ev(`(async()=>(await ${api}.getLayoutSettings()).compactMode)()`)) === true);
    await shell.ev(`${api}.setLayoutSettings({ compactMode: false })`);
    await sleep(1500);
    check("wyłączenie trybu kompaktowego usuwa nakładkę", (await overlayCount()) === 0);
    await shell.ev(`${api}.switchTab(${original})`);
    await sleep(600);
  }

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
  const promptTarget = async () => (await listTargets()).find((t) => t.url.includes("renderer/prompt.html"));
  // The overlay view is destroyed and recreated between prompts, so a stale target is retried with a fresh list.
  const answerPrompt = async (button, fill) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const target = await promptTarget();
      if (target) {
        try {
          const prompt = await connect(target);
          // Answering destroys the overlay view, so the evaluate reply may never arrive: treat silence as success.
          const clicked = await Promise.race([
            prompt.ev(`(()=>{${fill ?? ""};const b=document.getElementById(${JSON.stringify(button)});if(!b)return false;b.click();return true;})()`),
            sleep(2000).then(() => "gone"),
          ]);
          prompt.close();
          if (clicked === true || clicked === "gone") return true;
        } catch {}
      }
      await sleep(500);
    }
    return false;
  };
  // Monit jest powiązany z kartą: pokazuje się tylko, gdy karta strony /a jest aktywna.
  const pageTab = (await state()).tabs.find((t) => t.url.endsWith("/a"));
  if (pageTab) await shell.ev(`${api}.switchTab(${pageTab.id})`);
  await sleep(500);
  const geo = page.ev(`new Promise(r=>navigator.geolocation.getCurrentPosition(()=>r('granted'),e=>r('denied:'+e.code),{timeout:15000}))`);
  await sleep(2500);
  check("monit uprawnień pojawia się w oknie", Boolean(await promptTarget()));
  await answerPrompt("secondary"); // Zablokuj
  check("Zablokuj odrzuca geolokalizację", String(await geo).startsWith("denied"));
  const notif = page.ev(`Notification.requestPermission()`, true);
  await sleep(2500);
  await answerPrompt("primary"); // Zezwól
  const notifResult = await notif;
  check("zgoda w monicie przyznaje powiadomienia", notifResult === "granted", String(notifResult));
  await sleep(600);
  check("monit znika po odpowiedzi", !(await promptTarget()));
  check("zgoda jest zapamiętana (Notification.permission)", (await page.ev(`Notification.permission`)) === "granted");
  check("fullscreen działa z gestem użytkownika", (await page.ev(`document.documentElement.requestFullscreen().then(()=>'ok',e=>'err:'+e.message)`, true)) === "ok");
  await page.ev(`document.exitFullscreen()`, true);
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true }); // dialogi zabierają fokus dokumentowi
  const clip = await page.ev(`navigator.clipboard.writeText('x').then(()=>'ok',e=>'err:'+e.message)`, true);
  check("zapis do schowka dozwolony", clip === "ok", String(clip));
  page.close();

  const ab = JSON.parse(await shell.ev(`(async()=>JSON.stringify(await ${api}.getAdblockStatus()))()`));
  check("silnik adblocka gotowy", ab.enabled && ab.ready);
  const exAdd = JSON.parse(await shell.ev(`(async()=>JSON.stringify(await ${api}.addAdblockException("WWW.Exception-Test.example")))()`));
  check("wyjątek adblocka dodany i znormalizowany", exAdd.ok && exAdd.hosts.includes("exception-test.example"));
  const exBad = JSON.parse(await shell.ev(`(async()=>JSON.stringify(await ${api}.addAdblockException("bad host/x")))()`));
  check("nieprawidłowy wyjątek odrzucony", exBad.ok === false);
  const exDel = JSON.parse(await shell.ev(`(async()=>JSON.stringify(await ${api}.removeAdblockException("exception-test.example")))()`));
  check("wyjątek adblocka usunięty", exDel.ok && !exDel.hosts.includes("exception-test.example"));

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

  // menu wyskakujące (jeden współdzielony widok): otwieranie, przełączanie, menu kontekstowe karty
  const popupTarget = async () => (await listTargets()).find((t) => t.url.startsWith("data:text/html") && t.title !== "");
  const popupHas = async (selector) => {
    const target = await popupTarget();
    if (!target) return false;
    const popup = await connect(target);
    const found = await popup.ev(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    popup.close();
    return found === true;
  };
  const menuOpens = [];
  for (let i = 0; i < 3; i += 1) {
    menuOpens.push(await shell.ev(`${api}.openNavigationMenu({x:600,y:40})`));
    await sleep(800);
    if (i === 1) menuOpens.push(await shell.ev(`${api}.openNavigationMenu({x:600,y:40})`)); // przełączenie (zamknięcie)
    if (i === 1) await sleep(500);
  }
  check("menu nawigacji otwiera się wielokrotnie", menuOpens.every((r) => r === true) && (await popupHas(".nav-popup")));
  const tabIdForMenu = (await state()).tabs[0].id;
  check("menu kontekstowe karty otwiera się", (await shell.ev(`${api}.openTabContextMenu(${tabIdForMenu},{x:300,y:20})`)) === true);
  await sleep(800);
  check("menu kontekstowe karty ma zawartość", await popupHas(".context-popup"));

  // Motyw: zmiana działa na żywo w powłoce, zapisuje się i można wrócić do domyślnego.
  const themeBg = () => shell.ev(`getComputedStyle(document.documentElement).getPropertyValue('--mb-bg').trim()`);
  const themed = await shell.ev(`${api}.setTheme({id:'gruvbox-dark'}).then((s)=>s.tokens.bg)`, true);
  await sleep(300);
  check("motyw: preset zmienia zmienne w powłoce na żywo", themed === "#282828" && (await themeBg()) === "#282828", String(themed));
  const customTheme = await shell.ev(`${api}.setTheme({id:'custom',custom:{bg:'#102030',fg:'#eeeeee'}}).then((s)=>s.settings.id+s.tokens.scheme)`, true);
  check("motyw: własny z częściowymi danymi jest uzupełniany", customTheme === "customdark", String(customTheme));
  const resetTheme = await shell.ev(`${api}.setTheme({id:'default'}).then((s)=>s.settings.id)`, true);
  check("motyw: powrót do domyślnego", resetTheme === "default");

  // Glance: Alt+klik w link otwiera podgląd (zwykła i prywatna karta), zamknięcie i rozwinięcie do karty
  const glanceTargets = async () => (await listTargets()).filter((t) => t.url.endsWith("/glance-target") || t.url.endsWith("/cookieG") || t.url.includes("renderer/glance.html"));
  const altClickLink = async (suffix, href) => {
    const src = await pageOf(suffix);
    await src.ev(`document.body.insertAdjacentHTML('beforeend', '<a href="${href}" style="position:fixed;left:10px;top:10px;width:200px;height:40px;display:block;background:#ccc">glance link</a>')`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await src.send("Input.dispatchMouseEvent", { type, x: 50, y: 30, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1, modifiers: 1 });
    }
    src.close();
  };
  await shell.ev(`${api}.createTab("${H}/glance-src")`);
  await sleep(2500);
  const tabsBeforeGlance = (await state()).tabs.length;
  await altClickLink("/glance-src", "/glance-target");
  await sleep(2500);
  let gt = await glanceTargets();
  check("Alt+klik otwiera Glance (powłoka + strona)", gt.some((t) => t.url.includes("renderer/glance.html")) && gt.some((t) => t.url.endsWith("/glance-target")));
  check("Glance nie tworzy karty", (await state()).tabs.length === tabsBeforeGlance);
  await shell.ev(`${api}.closeGlance()`);
  await sleep(1000);
  check("zamknięcie Glance usuwa widoki", (await glanceTargets()).length === 0);
  await altClickLink("/glance-src", "/glance-target");
  await sleep(2500);
  await shell.ev(`${api}.expandGlance()`);
  await sleep(1500);
  st = await state();
  check("rozwinięcie Glance tworzy aktywną kartę z załadowaną stroną", st.tabs.length === tabsBeforeGlance + 1 && st.tabs.find((t) => t.id === st.activeTabId)?.url.endsWith("/glance-target"));
  check("po rozwinięciu nie zostaje widok Glance", !(await glanceTargets()).some((t) => t.url.includes("renderer/glance.html")));
  await shell.ev(`${api}.setGlanceSettings({ enabled: false })`);
  await sleep(500);
  await shell.ev(`${api}.createTab("${H}/glance-off")`);
  await sleep(2500);
  await altClickLink("/glance-off", "/glance-target");
  await sleep(2000);
  check("wyłączony Glance nie reaguje na Alt+klik", !(await glanceTargets()).some((t) => t.url.includes("renderer/glance.html")));
  await shell.ev(`${api}.setGlanceSettings({ enabled: true })`);
  await sleep(500);
  await shell.ev(`${api}.executePaletteCommand("new-private-tab")`);
  await sleep(1500);
  await shell.ev(`${api}.navigate("${H}/setcookie")`);
  await sleep(2500);
  await altClickLink("/setcookie", "/cookieG");
  await sleep(2500);
  const privGlance = (await glanceTargets()).find((t) => t.url.endsWith("/cookieG"));
  check("Glance z karty prywatnej otwiera się", Boolean(privGlance));
  if (privGlance) {
    const privGlancePage = await connect(privGlance);
    check("Glance z karty prywatnej używa sesji prywatnej", (await privGlancePage.ev("document.cookie")).includes("secret=1"));
    privGlancePage.close();
  }
  await shell.ev(`${api}.closeGlance()`);
  await sleep(800);

  // strony wewnętrzne jako karty (bez dialogów natywnych, bez prawdziwych pobrań)
  const internalTarget = async (re) => (await listTargets()).find((t) => t.url.startsWith("data:text/html") && re.test(t.title));
  await shell.ev(`${api}.executePaletteCommand("open-history")`);
  await sleep(1500);
  await shell.ev(`${api}.executePaletteCommand("open-history")`);
  await sleep(800);
  check("historia otwiera się jako jedna karta", (await state()).tabs.filter((t) => t.url === "monobrowser://history").length === 1);
  const historyTarget = await internalTarget(/History|Historia/);
  check("strona historii ma cel CDP", Boolean(historyTarget));
  if (historyTarget) {
    const historyPage = await connect(historyTarget);
    await historyPage.ev("window.__marker = 1");
    await shell.ev(`${api}.createTab("${H}/hist-live")`);
    await sleep(3000);
    check("historia aktualizuje się bez przeładowania", (await historyPage.ev("window.__marker === 1 && document.querySelectorAll('.history-panel li').length > 0")) === true);
    historyPage.close();
  }
  await shell.ev(`${api}.executePaletteCommand("open-downloads")`);
  await shell.ev(`${api}.executePaletteCommand("open-site-data")`);
  await shell.ev(`${api}.executePaletteCommand("open-stats")`);
  await sleep(2000);
  const kinds = (await state()).tabs.map((t) => t.url).filter((u) => u.startsWith("monobrowser://") && u !== "monobrowser://new-tab");
  check("downloads, site-data i stats jako karty", ["downloads", "site-data", "stats"].every((k) => kinds.includes(`monobrowser://${k}`)));
  // statystyki: wyszukiwania z paska adresu (też z karty wewnętrznej) są liczone; adres http(s) nie
  {
    await shell.ev(`${api}.setSearchSettings({ engine: "custom", customUrl: "${H}/search?q={query}" })`);
    await sleep(500);
    const readSearches = async () => {
      await shell.ev(`${api}.executePaletteCommand("open-stats")`);
      await sleep(1500);
      const target = await internalTarget(/Statistics|Statystyki/);
      if (!target) return -1;
      const page = await connect(target);
      const value = await page.ev(`Number([...document.querySelectorAll('.stats-row')].find((row) => /Wyszukiwania|Searches/.test(row.textContent))?.querySelector('strong')?.textContent ?? -1)`);
      page.close();
      return value;
    };
    const searchesBefore = await readSearches();
    await shell.ev(`${api}.navigate("e2e search words")`);
    await sleep(1500);
    await shell.ev(`${api}.navigate("${H}/not-a-search")`);
    await sleep(1500);
    const searchesAfter = await readSearches();
    check("statystyki liczą wyszukiwania z paska adresu (nie adresy)", searchesBefore >= 0 && searchesAfter === searchesBefore + 1, `${searchesBefore} -> ${searchesAfter}`);
    await shell.ev(`${api}.setSearchSettings({ engine: "google", customUrl: "" })`);
  }
  const downloadsTarget = await internalTarget(/Downloads|Pobieranie/);
  if (downloadsTarget) {
    const downloadsPage = await connect(downloadsTarget);
    await downloadsPage.ev("window.__got = []; window.browserApi.onDownloadsUpdated((p) => window.__got.push(p.downloads.length)); 0");
    await downloadsPage.ev("window.browserApi.clearDownloadsHistory()");
    await sleep(800);
    check("karta pobierania dostaje downloads:updated przez IPC", (await downloadsPage.ev("window.__got.length")) >= 1);
    downloadsPage.close();
  } else {
    check("karta pobierania ma cel CDP", false);
  }

  // uwierzytelnianie HTTP w oknie
  const authPromptAnswer = (button, username, password) => answerPrompt(button, username === undefined ? "" : `document.getElementById('username').value=${JSON.stringify(username)};document.getElementById('password').value=${JSON.stringify(password)}`);
  await shell.ev(`${api}.createTab("${H}/auth")`);
  await sleep(2500);
  check("monit logowania HTTP pojawia się", Boolean(await promptTarget()));
  await authPromptAnswer("secondary");
  await sleep(1500);
  check("Anuluj logowanie pokazuje odmowę serwera", (await state()).tabs.some((t) => t.url.endsWith("/auth") && /Denied/.test(t.title)));
  fire(`${api}.navigate("${H}/auth")`);
  await sleep(2000);
  await authPromptAnswer("primary", "u", "p");
  await sleep(2000);
  check("poprawne dane logują", (await state()).tabs.some((t) => t.url.endsWith("/auth") && /Authed/.test(t.title)));

  // strona błędu (połączenie odrzucone) z przyciskiem ponowienia
  // A port that was just free and is closed again (low ports such as 9 are blocked by Chromium as unsafe).
  const closedPort = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
  await shell.ev(`${api}.navigate("http://127.0.0.1:${closedPort}/")`);
  await sleep(3000);
  const errTarget = (await listTargets()).find((t) => t.url.startsWith("data:text/html") && /Connection refused|Połączenie odrzucone/.test(t.title));
  check("błąd połączenia pokazuje stylową stronę błędu", Boolean(errTarget), errTarget ? "" : (await listTargets()).filter((t) => t.url.startsWith("data:")).map((t) => t.title).join(" | "));
  check("karta pokazuje adres, który zawiódł", (await state()).tabs.some((t) => t.url.startsWith(`http://127.0.0.1:${closedPort}`)));

  // beforeunload: zostań / opuść (nawigacja z paska adresu) i zamknięcie karty
  await shell.ev(`${api}.createTab("${H}/unload")`);
  await sleep(2500);
  const unloadPage = await pageOf("/unload");
  await unloadPage.ev("document.body.click(); 0", true);
  unloadPage.close();
  fire(`${api}.navigate("${H}/after-unload")`);
  await sleep(1500);
  check("beforeunload pokazuje monit Opuścić stronę", Boolean(await promptTarget()));
  await authPromptAnswer("secondary"); // Zostań
  await sleep(1000);
  check("Zostań zostawia stronę", (await state()).tabs.some((t) => t.url.endsWith("/unload")));
  fire(`${api}.navigate("${H}/after-unload")`);
  await sleep(1500);
  await authPromptAnswer("primary"); // Opuść
  await sleep(2500);
  check("Opuść wykonuje przerwaną nawigację", (await state()).tabs.some((t) => t.url.endsWith("/after-unload")));
  await shell.ev(`${api}.navigate("${H}/unload")`);
  await sleep(2500);
  const unloadPage2 = await pageOf("/unload");
  await unloadPage2.ev("document.body.click(); 0", true);
  unloadPage2.close();
  const unloadTabId = (await state()).activeTabId;
  const tabsBeforeClose = (await state()).tabs.length;
  fire(`${api}.closeTab(${unloadTabId})`);
  await sleep(1500);
  check("zamknięcie karty z beforeunload pokazuje monit", Boolean(await promptTarget()) && (await state()).tabs.length === tabsBeforeClose);
  await authPromptAnswer("primary");
  await sleep(2000);
  check("Opuść zamyka kartę", (await state()).tabs.length === tabsBeforeClose - 1);

  // przestrzenie (workspaces): tworzenie, przenoszenie kart, przełączanie, zapis sesji, usuwanie
  const wsApi = async (expr) => JSON.parse(await shell.ev(`(async()=>JSON.stringify(await ${expr}))()`));
  const mainTabsBefore = (await state()).tabs.length;
  st = await state();
  check("przestrzeń Główna istnieje domyślnie", st.workspaces?.length === 1 && st.currentWorkspaceId === "main");
  const wsA = await wsApi(`${api}.createWorkspace()`);
  await sleep(1200);
  st = await state();
  check("nowa przestrzeń jest bieżąca i ma jedną kartę startową", st.workspaces.length === 2 && st.currentWorkspaceId === wsA && st.tabs.length === 1);
  await shell.ev(`${api}.createTab("${H}/ws-a")`);
  await sleep(1500);
  check("karty innej przestrzeni są ukryte", (await state()).tabs.length === 2 && (await state()).tabs.every((t) => !t.url.includes("/hist-live")));
  await shell.ev(`${api}.switchWorkspace("main")`);
  await sleep(1200);
  st = await state();
  check("przełączenie na Główną pokazuje jej karty", st.currentWorkspaceId === "main" && st.tabs.length === mainTabsBefore);
  const moveId = st.tabs.find((t) => t.url.endsWith("/b"))?.id ?? st.tabs.at(-1).id;
  await wsApi(`${api}.moveTabToWorkspace(${moveId}, ${JSON.stringify(wsA)})`);
  await sleep(800);
  st = await state();
  check("przeniesienie karty usuwa ją z bieżącej przestrzeni", st.tabs.length === mainTabsBefore - 1 && !st.tabs.some((t) => t.id === moveId));
  await shell.ev(`${api}.executePaletteCommand(${JSON.stringify("workspace:" + wsA)})`);
  await sleep(1200);
  st = await state();
  check("paleta przełącza przestrzeń", st.currentWorkspaceId === wsA && st.tabs.length === 3 && st.tabs.some((t) => t.id === moveId));
  await wsApi(`${api}.updateWorkspace(${JSON.stringify(wsA)}, { name: "Praca", icon: "P", color: "accent" })`);
  await sleep(1500);
  const sessionJson = JSON.parse(fs.readFileSync(path.join(userData, "session.json"), "utf8"));
  const savedA = sessionJson.workspaces?.find((w) => w.id === wsA);
  check("sesja zapisuje przestrzenie (nazwa, ikona, kolor) i przynależność kart", sessionJson.version === 2 && savedA?.name === "Praca" && savedA.icon === "P" && savedA.color === "accent" && sessionJson.tabs.some((t) => t.workspaceId === wsA) && sessionJson.currentWorkspaceId === wsA);
  check("przestrzeń w ładunku stanu ma nazwę i ikonę", (await state()).workspaces.find((w) => w.id === wsA)?.name === "Praca");
  const answerWorkspacePopup = async (hrefPart) => {
    await sleep(1500);
    const target = (await listTargets()).find((t) => t.url.startsWith("data:text/html") && /Delete space|Usunąć przestrzeń/.test(t.title));
    if (!target) return false;
    const popup = await connect(target);
    const clicked = await popup.ev(`(()=>{const a=document.querySelector('a[href*="${hrefPart}"]');if(!a)return false;a.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true,cancelable:true}));return true;})()`);
    popup.close();
    return clicked === true;
  };
  await shell.ev(`${api}.deleteWorkspace(${JSON.stringify(wsA)})`);
  check("usuwanie przestrzeni pyta w oknie", await answerWorkspacePopup("ws-delete-move"));
  await sleep(1500);
  st = await state();
  // wszystkie karty widoczne w przestrzeni (3) wracają do Głównej; ginie tylko samotna, nietknięta karta startowa
  check("usunięcie z przeniesieniem oddaje karty do Głównej", st.workspaces.length === 1 && st.currentWorkspaceId === "main" && st.tabs.length === mainTabsBefore + 2);
  const wsB = await wsApi(`${api}.createWorkspace()`);
  await sleep(1200);
  await shell.ev(`${api}.createTab("${H}/ws-b")`);
  await sleep(1200);
  await shell.ev(`${api}.deleteWorkspace(${JSON.stringify(wsB)})`);
  check("usuwanie z zamknięciem kart pyta w oknie", await answerWorkspacePopup("ws-delete-close"));
  await sleep(1500);
  st = await state();
  check("usunięcie z zamknięciem nie zostawia kart", st.workspaces.length === 1 && st.currentWorkspaceId === "main" && st.tabs.length === mainTabsBefore + 2 && !st.tabs.some((t) => t.url.endsWith("/ws-b")));
  check("nie można usunąć przestrzeni Głównej", (await wsApi(`${api}.deleteWorkspace("main")`)) === false);

  // podział widoku należy do przestrzeni: ukrywany przy przełączeniu, usuwany przy przeniesieniu panelu i usunięciu przestrzeni
  {
    st = await state();
    const [t1, t2] = st.tabs.map((t) => t.id).slice(-2);
    await shell.ev(`${api}.switchTab(${t1})`);
    await sleep(500);
    await shell.ev(`${api}.executePaletteCommand("split-with:${t2}")`);
    await sleep(1200);
    st = await state();
    check("podział powstaje w przestrzeni Głównej", st.tabs.find((t) => t.id === t1)?.splitGroupId != null);
    const wsS = await wsApi(`${api}.createWorkspace()`);
    await sleep(1200);
    st = await state();
    check("w nowej przestrzeni nie ma podziałów innych przestrzeni", st.currentWorkspaceId === wsS && st.tabs.every((t) => t.splitGroupId == null));
    await shell.ev(`${api}.switchWorkspace("main")`);
    await sleep(1200);
    st = await state();
    check("powrót do Głównej przywraca jej podział", st.currentWorkspaceId === "main" && st.tabs.find((t) => t.id === t1)?.splitGroupId != null && st.tabs.find((t) => t.id === t2)?.splitGroupId === st.tabs.find((t) => t.id === t1)?.splitGroupId);
    await wsApi(`${api}.moveTabToWorkspace(${t2}, ${JSON.stringify(wsS)})`);
    await sleep(800);
    st = await state();
    check("przeniesienie panelu do innej przestrzeni rozwiązuje podział", st.tabs.every((t) => t.splitGroupId == null) && !st.tabs.some((t) => t.id === t2));
    await shell.ev(`${api}.switchWorkspace(${JSON.stringify(wsS)})`);
    await sleep(1200);
    await shell.ev(`${api}.createTab("${H}/ws-s1")`);
    await sleep(1500);
    await shell.ev(`${api}.executePaletteCommand("split-new")`);
    await sleep(1500);
    st = await state();
    check("podział w drugiej przestrzeni powstaje", st.currentWorkspaceId === wsS && st.tabs.filter((t) => t.splitGroupId != null).length === 2);
    await shell.ev(`${api}.deleteWorkspace(${JSON.stringify(wsS)})`);
    check("usuwanie przestrzeni z podziałem pyta w oknie", await answerWorkspacePopup("ws-delete-move"));
    await sleep(1500);
    st = await state();
    check("usunięcie przestrzeni usuwa jej podziały", st.currentWorkspaceId === "main" && st.workspaces.length === 1 && st.tabs.every((t) => t.splitGroupId == null));
  }

  // druga instancja
  const before = (await state()).tabs.length;
  const second = spawn(electronBin, [root, "--no-sandbox", "--ozone-platform=x11", `--user-data-dir=${userData}`, "--remote-debugging-port=9334", `${H}/d`], { cwd: root, env: isolatedEnv, stdio: "ignore" });
  const exited = await Promise.race([new Promise((resolve) => second.on("exit", () => resolve(true))), sleep(10000).then(() => false)]);
  await sleep(2000);
  st = await state();
  check("druga instancja kończy się i otwiera kartę z adresem", exited && st.tabs.length === before + 1 && st.tabs.some((t) => t.url.endsWith("/d")));

  const csp = shell.events.filter((e) => JSON.stringify(e).toLowerCase().includes("content security policy"));
  check("brak naruszeń CSP w powłoce", csp.length === 0);
  check("brak wyjątków w logu aplikacji", !/TypeError|ReferenceError|Uncaught|UnhandledPromise/.test(app.log()), app.log().split("\n").filter((line) => /TypeError|ReferenceError|Uncaught|UnhandledPromise/.test(line)).slice(0, 3).join(" // "));
  if (/TypeError|ReferenceError|Uncaught|UnhandledPromise/.test(app.log())) {
    const lines = app.log().split("\n");
    const first = lines.findIndex((line) => /TypeError|ReferenceError|Uncaught|UnhandledPromise/.test(line));
    console.log(lines.slice(Math.max(0, first - 2), first + 12).join("\n"));
  }
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
