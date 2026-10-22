import assert from "node:assert/strict";
import test from "node:test";
import { classifyNetError, isCertErrorCode, parseErrorPageMessage, renderErrorPageHtml, shouldShowErrorPage } from "./error-page-html.js";

const render = (overrides: Partial<Parameters<typeof renderErrorPageHtml>[0]> = {}): string =>
  renderErrorPageHtml({ lang: "en", url: "https://example.test/a?b=1", code: -105, errorName: "ERR_NAME_NOT_RESOLVED", online: true, ...overrides });

test("classifyNetError maps net error codes to kinds", () => {
  assert.equal(classifyNetError(-105, true), "dns");
  assert.equal(classifyNetError(-105, false), "offline");
  assert.equal(classifyNetError(-106, true), "offline");
  assert.equal(classifyNetError(-102, true), "refused");
  assert.equal(classifyNetError(-118, true), "timeout");
  assert.equal(classifyNetError(-310, true), "redirects");
  assert.equal(classifyNetError(-300, true), "invalid-url");
  assert.equal(classifyNetError(-6, true), "file");
  assert.equal(classifyNetError(-12345, true), "generic");
});

test("classifyNetError treats the -2xx range as certificate errors", () => {
  for (const code of [-200, -201, -202, -207, -299]) {
    assert.ok(isCertErrorCode(code));
    assert.equal(classifyNetError(code, true), "cert");
  }
  assert.equal(isCertErrorCode(-300), false);
  assert.equal(isCertErrorCode(-199), false);
});

test("shouldShowErrorPage ignores aborted loads, subframes and non-web schemes", () => {
  assert.equal(shouldShowErrorPage(-105, true, "https://a.test/"), true);
  assert.equal(shouldShowErrorPage(-3, true, "https://a.test/"), false);
  assert.equal(shouldShowErrorPage(-105, false, "https://a.test/"), false);
  assert.equal(shouldShowErrorPage(-105, true, "data:text/html,x"), false);
  assert.equal(shouldShowErrorPage(-105, true, "file:///tmp/x"), true);
});

test("parseErrorPageMessage accepts only the page's own nonce and known actions", () => {
  assert.equal(parseErrorPageMessage("MBERR|n0nce|retry", "n0nce"), "retry");
  assert.equal(parseErrorPageMessage("MBERR|n0nce|back", "n0nce"), "back");
  assert.equal(parseErrorPageMessage("MBERR|n0nce|proceed", "n0nce"), "proceed");
  assert.equal(parseErrorPageMessage("MBERR|other|proceed", "n0nce"), null);
  assert.equal(parseErrorPageMessage("MBERR|n0nce|format-disk", "n0nce"), null);
  assert.equal(parseErrorPageMessage("MBERR|n0nce|retry|extra", "n0nce"), null);
  assert.equal(parseErrorPageMessage("hello", "n0nce"), null);
  assert.equal(parseErrorPageMessage(42, "n0nce"), null);
});

test("renderErrorPageHtml localizes, escapes and embeds a nonce the parser accepts", () => {
  const html = render({ url: 'https://x.test/"><script>alert(1)</script>' });
  assert.match(html, /This site can&#39;t be found/);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const nonce = /var nonce = "([0-9a-f]+)"/.exec(html)?.[1];
  assert.ok(nonce);
  assert.equal(parseErrorPageMessage(`MBERR|${nonce}|retry`), "retry");
  assert.match(render({ lang: "pl" }), /Nie można znaleźć strony/);
  assert.match(render({ lang: "pl" }), /lang="pl"/);
});

test("renderErrorPageHtml offers the proceed button only for certificate errors", () => {
  const plain = render();
  assert.ok(!plain.includes('id="proceed"'));
  const cert = render({
    code: -201,
    errorName: "ERR_CERT_DATE_INVALID",
    cert: { errorName: "ERR_CERT_DATE_INVALID", subject: "CN=x", issuer: "CN=ca", validFrom: "2020-01-01", validTo: "2021-01-01", fingerprint: "AA:BB" },
  });
  assert.ok(cert.includes('id="proceed"'));
  assert.match(cert, /Your connection is not private/);
  assert.match(cert, /AA:BB/);
  assert.match(cert, /Back to safety/);
});

test("renderErrorPageHtml styles itself with the theme contract variables only", () => {
  const html = render({ code: -201 });
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  assert.match(style, /var\(--mb-bg, #f0efe9\)/);
  assert.match(style, /var\(--mb-fg, #0a0a0a\)/);
  assert.ok(!/var\(--(?!mb-|font|ctl-)/.test(style), "no non-contract custom properties");
  assert.ok(!/var\(--mb-[a-z-]+\)/.test(style), "every theme variable has a fallback");
});

test("error page headings use the display font when it is provided", async () => {
  const { setErrorPageFontDataUrl } = await import("./error-page-html.js");
  setErrorPageFontDataUrl(() => "data:font/ttf;base64,AAAA");
  const html = render();
  assert.match(html, /font-family: "Bebas Neue"/);
  assert.match(html, /font-src data:/);
  setErrorPageFontDataUrl(() => "");
});
