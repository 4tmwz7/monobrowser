import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import type { PromptRequest } from "./prompt-overlay.js";

const uniqSorted = (ports: Iterable<number>): number[] =>
  [...new Set(ports)].filter((p) => Number.isInteger(p) && p > 0 && p < 65536).sort((a, b) => a - b);

// /proc/net/tcp(6): adres to słowa 32-bitowe zapisane hex w kolejności little-endian.
const isLocalProcAddress = (hex: string): boolean => {
  if (/^[0-9A-Fa-f]{8}$/.test(hex)) {
    if (/^0{8}$/.test(hex)) return true;
    return hex.slice(6, 8) === "7F" || hex.slice(6, 8) === "7f"; // pierwszy oktet (ostatni bajt hex) = 127
  }
  if (/^[0-9A-Fa-f]{32}$/.test(hex)) {
    const words = hex.toUpperCase().match(/.{8}/g) as string[];
    if (words.every((w) => w === "00000000")) return true; // ::
    if (words[0] === "00000000" && words[1] === "00000000" && words[2] === "00000000" && words[3] === "01000000") return true; // ::1
    // ::ffff:127.x.x.x
    if (words[0] === "00000000" && words[1] === "00000000" && words[2] === "FFFF0000") return words[3].slice(6, 8) === "7F";
    return false;
  }
  return false;
};

export const parseProcNetTcp = (text: string): number[] => {
  const ports: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || cols[3] !== "0A") continue;
    const [addr, portHex] = cols[1].split(":");
    if (!addr || !portHex || !isLocalProcAddress(addr)) continue;
    ports.push(parseInt(portHex, 16));
  }
  return uniqSorted(ports);
};

const isLocalHostText = (host: string): boolean =>
  host === "0.0.0.0" || host === "[::]" || host === "[::1]" || host === "*" || host === "localhost" || /^127\.\d+\.\d+\.\d+$/.test(host);

export const parseNetstatListening = (text: string): number[] => {
  const ports: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || !/^TCP/i.test(cols[0]) || !/^(LISTENING|NASŁUCHIWANIE)$/i.test(cols[3])) continue;
    const idx = cols[1].lastIndexOf(":");
    if (idx < 0 || !isLocalHostText(cols[1].slice(0, idx))) continue;
    ports.push(Number(cols[1].slice(idx + 1)));
  }
  return uniqSorted(ports);
};

export const parseLsofListening = (text: string): number[] => {
  const ports: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/\(LISTEN\)\s*$/.test(line)) continue;
    const m = /\s(\S+):(\d+)\s+\(LISTEN\)\s*$/.exec(line);
    if (m && isLocalHostText(m[1])) ports.push(Number(m[2]));
  }
  return uniqSorted(ports);
};

const run = (file: string, args: string[], timeout: number): Promise<string> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error && !stdout ? "" : String(stdout));
    });
  });

export const listListeningPorts = async (): Promise<number[]> => {
  try {
    if (process.platform === "linux") {
      const texts = await Promise.all(["/proc/net/tcp", "/proc/net/tcp6"].map((f) => readFile(f, "utf8").catch(() => "")));
      return uniqSorted(texts.flatMap(parseProcNetTcp));
    }
    if (process.platform === "win32") return parseNetstatListening(await run("netstat", ["-ano", "-p", "TCP"], 3000));
    if (process.platform === "darwin") return parseLsofListening(await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], 3000));
  } catch { /* ignore */ }
  return [];
};

const probeHost = (host: string, port: number, timeoutMs: number): Promise<boolean | "refused"> =>
  new Promise((resolve) => {
    let done = false;
    const socket = net.connect({ host, port });
    const finish = (value: boolean | "refused"): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    let received = Buffer.alloc(0);
    socket.on("connect", () => {
      socket.write(`GET / HTTP/1.0\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length >= 5) finish(received.subarray(0, 5).toString("latin1") === "HTTP/");
    });
    socket.on("end", () => finish(received.toString("latin1").startsWith("HTTP/")));
    socket.on("error", (error: NodeJS.ErrnoException) => finish(error.code === "ECONNREFUSED" ? "refused" : false));
  });

export const probeHttp = async (port: number, timeoutMs = 800): Promise<boolean> => {
  try {
    const first = await probeHost("127.0.0.1", port, timeoutMs);
    if (first !== "refused") return first;
    return (await probeHost("::1", port, timeoutMs)) === true;
  } catch {
    return false;
  }
};

export const findLocalWebServers = async (opts: { exclude?: number[]; limit?: number } = {}): Promise<string[]> => {
  const exclude = new Set(opts.exclude ?? []);
  const limit = opts.limit ?? 10;
  const ports = (await listListeningPorts()).filter((p) => !exclude.has(p));
  const found: number[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < ports.length) {
      const port = ports[next++];
      if (await probeHttp(port)) found.push(port);
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, ports.length) }, worker));
  return uniqSorted(found).slice(0, limit).map((p) => `http://localhost:${p}`);
};

const plFew = (n: number): boolean => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);

/** One server: a plain confirmation; several: one prompt with a checkbox per server (all checked). */
export const buildLocalServersNotice = (lang: "pl" | "en", urls: string[]): PromptRequest => {
  if (urls.length === 1) return buildLocalServerNotice(lang, urls[0]);
  const pl = lang === "pl";
  return {
    kind: "confirm",
    tabId: null,
    title: pl ? "Lokalne serwery" : "Local servers",
    lines: [{
      text: pl
        ? `Wykryto ${urls.length} ${plFew(urls.length) ? "działające serwery" : "działających serwerów"} na localhost. Zaznacz, które otworzyć w nowych kartach.`
        : `${urls.length} servers are running on localhost. Choose which ones to open in new tabs.`,
      style: "muted",
    }],
    choices: urls.map((url) => ({ id: url, label: url, checked: true })),
    primary: pl ? "Otwórz zaznaczone" : "Open selected",
    secondary: pl ? "Nie teraz" : "Not now",
  };
};

export const buildLocalServerNotice = (lang: "pl" | "en", url: string): PromptRequest => {
  const pl = lang === "pl";
  return {
    kind: "confirm",
    tabId: null,
    title: pl ? "Lokalny serwer" : "Local server",
    lines: [
      { text: url, style: "strong" },
      {
        text: pl
          ? "Wykryto działający serwer na localhost. Otworzyć go w nowej karcie?"
          : "A server is running on localhost. Open it in a new tab?",
        style: "muted",
      },
    ],
    primary: pl ? "Otwórz" : "Open",
    secondary: pl ? "Nie teraz" : "Not now",
  };
};
