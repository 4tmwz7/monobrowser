import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { buildLocalServerNotice, buildLocalServersNotice, parseLsofListening, parseNetstatListening, parseProcNetTcp, probeHttp } from "./localhost-scan.js";

test("parseProcNetTcp reads IPv4 listeners", () => {
  const text = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 1 0
   1: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2 1 0
   2: 0100A8C0:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 3 1 0
   3: 0100007F:C000 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1000        0 4 1 0
   4: 0101007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5 1 0`;
  assert.deepEqual(parseProcNetTcp(text), [22, 3000, 8080]);
});

test("parseProcNetTcp reads IPv6 listeners", () => {
  const text = `  sl  local_address                         remote_address                        st
   0: 00000000000000000000000001000000:1538 00000000000000000000000000000000:0000 0A 0 0
   1: 00000000000000000000000000000000:1F40 00000000000000000000000000000000:0000 0A 0 0
   2: 0000000000000000FFFF00000100007F:2382 00000000000000000000000000000000:0000 0A 0 0
   3: 0000000000000000FFFF00000100A8C0:0050 00000000000000000000000000000000:0000 0A 0 0
   4: B80D01200000000000000000FFFFFFFF:1BB 00000000000000000000000000000000:0000 0A 0 0
   5: 00000000000000000000000001000000:1539 00000000000000000000000001000000:9999 01 0 0`;
  assert.deepEqual(parseProcNetTcp(text), [0x1538, 0x1f40, 0x2382]);
});

test("parseNetstatListening", () => {
  const text = `Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1080
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4242
  TCP    192.168.1.5:139        0.0.0.0:0              LISTENING       4
  TCP    127.0.0.1:5173         127.0.0.1:50000        ESTABLISHED     4242
  TCP    [::]:3000              [::]:0                 LISTENING       99
  TCP    [::1]:8080             [::]:0                 LISTENING       100
  TCP    [fe80::1]:9000         [::]:0                 LISTENING       101`;
  assert.deepEqual(parseNetstatListening(text), [135, 3000, 5173, 8080]);
});

test("parseLsofListening", () => {
  const text = `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    1234 me   23u  IPv4 0x1      0t0  TCP 127.0.0.1:3000 (LISTEN)
node    1234 me   24u  IPv6 0x2      0t0  TCP [::1]:5173 (LISTEN)
rapportd 400 me    8u  IPv4 0x3      0t0  TCP *:49152 (LISTEN)
foo      500 me    9u  IPv4 0x4      0t0  TCP 192.168.1.2:8000 (LISTEN)
node    1234 me   25u  IPv4 0x5      0t0  TCP 127.0.0.1:3000->127.0.0.1:60000 (ESTABLISHED)`;
  assert.deepEqual(parseLsofListening(text), [3000, 5173, 49152]);
});

test("buildLocalServerNotice texts", () => {
  const pl = buildLocalServerNotice("pl", "http://localhost:3000");
  assert.equal(pl.kind, "confirm");
  assert.equal(pl.tabId, null);
  assert.equal(pl.title, "Lokalny serwer");
  assert.deepEqual(pl.lines[0], { text: "http://localhost:3000", style: "strong" });
  assert.equal(pl.lines[1].style, "muted");
  assert.equal(pl.primary, "Otwórz");
  assert.equal(pl.secondary, "Nie teraz");
  const en = buildLocalServerNotice("en", "http://localhost:1");
  assert.equal(en.title, "Local server");
  assert.equal(en.primary, "Open");
  assert.equal(en.secondary, "Not now");
});

const listen = (server: net.Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)));
const close = (server: net.Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

test("probeHttp detects HTTP, rejects non-HTTP and closed ports", async () => {
  const web = http.createServer((_req, res) => res.end("ok"));
  const ssh = net.createServer((s) => { s.write("SSH-2.0-x\r\n"); s.on("error", () => {}); });
  const webPort = await listen(web);
  const sshPort = await listen(ssh);
  const closed = net.createServer();
  const closedPort = await listen(closed);
  await close(closed);
  try {
    assert.equal(await probeHttp(webPort), true);
    assert.equal(await probeHttp(sshPort), false);
    assert.equal(await probeHttp(closedPort, 300), false);
  } finally {
    web.closeAllConnections();
    await close(web);
    ssh.close();
  }
});

test("buildLocalServersNotice: one server is a plain confirm, several get checkboxes", () => {
  assert.equal(buildLocalServersNotice("pl", ["http://localhost:3000"]).choices, undefined);
  const pl = buildLocalServersNotice("pl", ["http://localhost:3000", "http://localhost:5173"]);
  assert.deepEqual(pl.choices, [
    { id: "http://localhost:3000", label: "http://localhost:3000", checked: true },
    { id: "http://localhost:5173", label: "http://localhost:5173", checked: true },
  ]);
  assert.equal(pl.primary, "Otwórz zaznaczone");
  assert.match(pl.lines[0].text, /2 działające serwery/);
  const en = buildLocalServersNotice("en", ["http://localhost:1", "http://localhost:2"]);
  assert.equal(en.primary, "Open selected");
  assert.equal(en.title, "Local servers");
});

test("buildLocalServersNotice uses the right Polish plural", () => {
  const urls = (n: number) => Array.from({ length: n }, (_, i) => `http://localhost:${3000 + i}`);
  assert.match(buildLocalServersNotice("pl", urls(4)).lines[0].text, /4 działające serwery/);
  assert.match(buildLocalServersNotice("pl", urls(5)).lines[0].text, /5 działających serwerów/);
  assert.match(buildLocalServersNotice("pl", urls(12)).lines[0].text, /12 działających serwerów/);
});
