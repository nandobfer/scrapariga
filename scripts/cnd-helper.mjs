#!/usr/bin/env node
/**
 * cnd-helper.mjs — Windows-side CDP driver for the Receita Federal CND flow.
 *
 * WHY THIS EXISTS
 *   The Receita CND service is protected by an invisible hCaptcha whose token is
 *   validated server-side. A Chromium/Chrome launched by Playwright (Linux, no
 *   GPU, software WebGL) is fingerprinted as a bot and the token is rejected with
 *   `023 / CaptchaFalhaValidacao`. The user's real Windows Chrome passes.
 *
 *   So we let the *real Windows Chrome* do the captcha (the user may have to
 *   click it once) and drive it over the DevTools Protocol (CDP) to fill the
 *   CNPJ, click "Consultar Certidão", and grab the "Segunda via" PDF.
 *
 *   This file is executed by the Windows Node runtime (>=22: global fetch +
 *   WebSocket, zero dependencies). It is copied to a Windows temp dir and run as
 *   `node cnd-helper.mjs ...`.
 *
 * PROTOCOL
 *   - Progress lines:  `[cnd] <message>`
 *   - Final result:    `__CND_RESULT__{"ok":true,"filePath":"C:\\...\\x.pdf"}`
 *
 * ARGS
 *   --port <n>            CDP port the Windows Chrome listens on
 *   --cnpj <digits>       CNPJ (formatted or not) to query
 *   --download-dir <path> Windows directory to save the PDF into
 *   --timeout-ms <n>      Max wait for manual captcha interaction (default 300000)
 *   --url <url>           Override the CND URL (defaults to the CNPJ home)
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    out[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? 9333);
const CNPJ = String(args.cnpj ?? '');
const DOWNLOAD_DIR = args['download-dir'] ?? path.join(process.cwd(), 'downloads');
const TIMEOUT_MS = Number(args['timeout-ms'] ?? 300000);
const CND_URL = args.url ?? 'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj';
const BASE = `http://127.0.0.1:${PORT}`;

const log = (msg) => process.stdout.write(`[cnd] ${msg}\n`);
const emitResult = (obj) => process.stdout.write(`__CND_RESULT__${JSON.stringify(obj)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Minimal CDP client ───────────────────────────────────────────────────────

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`WebSocket error: ${e.message ?? 'unknown'}`));
      this.ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`));
          else res(msg.result);
        } else if (msg.method) {
          const handlers = this.listeners.get(msg.method) ?? [];
          for (const h of handlers) h(msg.params);
        }
      };
    });
  }

  on(method, handler) {
    const arr = this.listeners.get(method) ?? [];
    arr.push(handler);
    this.listeners.set(method, arr);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

// ─── CDP helpers ──────────────────────────────────────────────────────────────

async function waitForCdp(deadlineMs) {
  while (Date.now() < deadlineMs) {
    try {
      const res = await fetch(`${BASE}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error('CDP não ficou disponível (Chrome não abriu com --remote-debugging-port?)');
}

async function evaluate(page, expression, { awaitPromise = false } = {}) {
  const res = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.text ?? 'evaluate failed');
  }
  return res.result?.value;
}

/** Poll an expression until the predicate is satisfied or the deadline passes. */
async function poll(page, expression, predicate, timeoutMs, intervalMs = 700) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(page, expression).catch(() => undefined);
    if (predicate(last)) return last;
    await sleep(intervalMs);
  }
  return last;
}

/** Dismiss the gov.br cookie banner if it is on screen (idempotent). */
async function dismissCookies(page) {
  await evaluate(page, `window.__cnd.clickByText(['Aceitar'])`).catch(() => undefined);
  await sleep(300);
}

/**
 * Types the CNPJ into the masked field with real key events and verifies that
 * all 14 digits landed — retrying if a re-render (e.g. cookie banner) stole the
 * focus mid-typing. Uses a real CDP mouse click so the field is truly focused
 * (element.focus() alone is not enough for the Angular mask).
 */
async function fillCnpj(page, selector, digits) {
  const selAll = { modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 }; // Ctrl+A
  const backspace = { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 };

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await dismissCookies(page);

    // Find the *visible* input and click its center with a real mouse event.
    const box = await evaluate(
      page,
      `(() => {
        const el = Array.from(document.querySelectorAll('${selector}')).find((e) => e.offsetParent !== null);
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
      })()`,
    ).catch(() => null);

    if (!box || !box.w) {
      await sleep(500);
      continue;
    }

    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1,
    });
    await sleep(200);

    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...selAll });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...selAll });
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...backspace });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...backspace });
    await sleep(150);

    for (const ch of digits) {
      await page.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: ch,
        unmodifiedText: ch,
        key: ch,
      });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      await sleep(45);
    }
    await sleep(300);

    let value = await evaluate(
      page,
      `(() => { const el = Array.from(document.querySelectorAll('${selector}')).find((e) => e.offsetParent !== null); return el ? el.value : ''; })()`,
    ).catch(() => '');

    // Fallback: some builds ignore synthetic key events but accept insertText.
    if (String(value).replace(/\D/g, '').length !== digits.length) {
      await evaluate(
        page,
        `(() => { const el = Array.from(document.querySelectorAll('${selector}')).find((e) => e.offsetParent !== null); if (el) { el.focus(); } return true; })()`,
      );
      await page.send('Input.insertText', { text: digits });
      await sleep(300);
      value = await evaluate(
        page,
        `(() => { const el = Array.from(document.querySelectorAll('${selector}')).find((e) => e.offsetParent !== null); return el ? el.value : ''; })()`,
      ).catch(() => '');
    }

    const clean = String(value).replace(/\D/g, '');
    if (clean.length === digits.length) return value;
    log(`campo ficou "${value}" (tentativa ${attempt}) — tentando de novo`);
    await sleep(500);
  }
  return null;
}

// ─── Injected page helpers ────────────────────────────────────────────────────

const PAGE_HELPERS = `
  window.__cnd = {
    setNativeValue(el, value) {
      const proto = window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    },
    clickByText(texts) {
      const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      for (const t of texts) {
        const norm = t.toLowerCase();
        const el = els.find((e) => (e.innerText || e.textContent || '').trim().toLowerCase().includes(norm));
        if (el) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
      }
      return false;
    },
    bodyText() { return (document.body?.innerText || '').slice(0, 4000); },
  };
  true;
`;

// ─── Main flow ────────────────────────────────────────────────────────────────

/** Kept so the finally block can close the Chrome instance we launched. */
let browserCdp = null;

async function main() {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  log(`aguardando CDP na porta ${PORT}...`);
  const version = await waitForCdp(Date.now() + 20000);
  log(`conectado ao ${version.Browser}`);

  // Browser-level connection: configure the download directory.
  const browserWs = version.webSocketDebuggerUrl;
  const browser = new Cdp(browserWs);
  browserCdp = browser;
  await browser.connect();
  await browser.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOAD_DIR,
    eventsEnabled: true,
  });

  // Create a fresh tab and get its page-level endpoint.
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const list = await (await fetch(`${BASE}/json/list`)).json();
  const target = list.find((t) => t.id === targetId);
  if (!target) throw new Error('não encontrei a aba criada via CDP');

  const page = new Cdp(target.webSocketDebuggerUrl);
  await page.connect();

  // Capture the "Segunda via" API response (contains the PDF as base64).
  let segViaBody = null;
  const segViaRequests = new Map(); // requestId -> url
  page.on('Network.responseReceived', (p) => {
    if (p.response?.url?.includes('/consulta/seg-via/')) {
      segViaRequests.set(p.requestId, p.response.url);
    }
  });
  page.on('Network.loadingFinished', (p) => {
    if (!segViaRequests.has(p.requestId)) return;
    page
      .send('Network.getResponseBody', { requestId: p.requestId })
      .then(({ body, base64Encoded }) => {
        segViaBody = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
      })
      .catch(() => undefined);
  });

  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');

  // ── Navigate ────────────────────────────────────────────────────────────────
  log('abrindo a página da Receita...');
  await page.send('Page.navigate', { url: CND_URL });

  const inputSelector = 'input[name="niContribuinte"]';
  await page.send('Runtime.evaluate', { expression: PAGE_HELPERS });

  // Dismiss the cookie banner early so it cannot steal focus while typing.
  await sleep(1500);
  await dismissCookies(page);
  await dismissCookies(page);

  await poll(page, `document.querySelector('${inputSelector}') !== null`, (v) => v === true, 30000);

  // ── Fill the CNPJ ───────────────────────────────────────────────────────────
  // The field uses an input mask, so we must *type* the characters (real key
  // events) instead of assigning .value — otherwise Angular never sees them.
  log(`preenchendo o CNPJ ${CNPJ}...`);
  const typedValue = await fillCnpj(page, inputSelector, CNPJ.replace(/\D/g, ''));
  if (!typedValue) throw new Error('não consegui preencher o CNPJ no campo');
  log(`valor digitado no campo: "${typedValue}"`);

  // ── Trigger the query (this is where the hCaptcha runs) ─────────────────────
  log('clicando em "Consultar Certidão"...');
  const clicked = await evaluate(page, `window.__cnd.clickByText(['Consultar Certidão'])`);
  if (!clicked) throw new Error('não encontrei o botão "Consultar Certidão"');
  log('clique enviado. Se aparecer um captcha, resolva-o na janela; se aparecer um aviso, aguarde.');

  await sleep(3500);
  const afterClick = await evaluate(page, `(document.body?.innerText || '').slice(0, 600)`).catch(() => '');
  log(`texto após o clique: ${JSON.stringify(afterClick)}`);

  // ── Wait for the user to solve the captcha and for a result ─────────────────
  const segViaSelector = 'button[title="Segunda via"], [title="Segunda via"]';
  const deadline = Date.now() + TIMEOUT_MS;
  let outcome = 'timeout';
  let lastText = '';
  let lastCode = '';
  let periodClicked = false;
  while (Date.now() < deadline) {
    const state = await evaluate(
      page,
      `({
         hasSegVia: document.querySelector('${segViaSelector}') !== null,
         hasPeriodForm: /Data de Emiss\u00e3o|Data de Validade|Data Inicial/i.test(document.body?.innerText || ''),
         hasConsultarBtn: Array.from(document.querySelectorAll('button, a, [role="button"]'))
            .some((e) => (e.innerText || '').trim().toLowerCase().includes('consultar certidão')),
         text: (document.body?.innerText || '')
       })`,
    ).catch(() => ({ hasSegVia: false, hasPeriodForm: false, hasConsultarBtn: false, text: '' }));

    if (state.hasSegVia) { outcome = 'ready'; break; }

    const text = state.text || '';
    lastText = text;

    // Intermediate screen: choose the search period, then submit again.
    if (state.hasPeriodForm && state.hasConsultarBtn && !periodClicked) {
      log('tela de período de pesquisa — clicando em "Consultar Certidão"...');
      periodClicked = await evaluate(page, `window.__cnd.clickByText(['Consultar Certidão'])`);
      await sleep(1500);
      continue;
    }

    // Any Receita error banner carries a code in the form "NNN - DD/MM/YYYY".
    if (/Não foi possível/i.test(text)) {
      const code = text.match(/(\d{3})\s*-\s*\d{2}\/\d{2}\/\d{4}/)?.[1] ?? '';
      lastCode = code;
      outcome = code === '023' ? 'captcha-failed' : 'app-error';
      break;
    }
    if (/cnpj inválido|14 caracteres/i.test(text)) {
      outcome = 'invalid-cnpj';
      break;
    }
    await sleep(1000);
  }

  if (outcome === 'timeout') {
    emitResult({
      ok: false,
      errorCode: 'TIMEOUT',
      message: 'Tempo esgotado aguardando o resultado.',
      pageText: lastText.slice(0, 1500),
    });
    return;
  }
  if (outcome === 'invalid-cnpj') {
    emitResult({ ok: false, errorCode: 'INVALID_CNPJ', message: 'O campo do CNPJ não foi aceito.', pageText: lastText.slice(0, 800) });
    return;
  }
  if (outcome === 'captcha-failed') {
    emitResult({
      ok: false,
      errorCode: '023',
      message: 'O captcha não foi validado pela Receita. Tente novamente.',
      pageText: lastText.slice(0, 800),
    });
    return;
  }
  if (outcome === 'app-error') {
    const banner = lastText.match(/Não foi possível[^\n]*/)?.[0] ?? 'Erro na Receita Federal.';
    emitResult({ ok: false, errorCode: lastCode || 'APP_ERROR', message: banner.trim(), pageText: lastText.slice(0, 800) });
    return;
  }

  // ── Download "Segunda via" ──────────────────────────────────────────────────
  log('certidão encontrada — solicitando a 2ª via...');
  await evaluate(page, `(() => {
    const el = document.querySelector('${segViaSelector}');
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  })()`);

  // Grab the PDF either from the intercepted API response or the download folder.
  const pdfPath = path.join(DOWNLOAD_DIR, `Certidao-${CNPJ.replace(/\D/g, '')}.pdf`);
  const before = Date.now();
  while (Date.now() - before < 40000) {
    if (segViaBody) {
      try {
        const parsed = JSON.parse(segViaBody);
        const b64 = parsed.pdf ?? parsed.Pdf ?? null;
        if (b64) {
          fs.writeFileSync(pdfPath, Buffer.from(b64, 'base64'));
          break;
        }
      } catch {
        /* response not JSON yet */
      }
    }
    if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 1024) break;
    // Chrome may also have saved the blob download under its suggested name.
    const candidates = fs.readdirSync(DOWNLOAD_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
    if (candidates.length > 0) {
      const f = path.join(DOWNLOAD_DIR, candidates[0]);
      if (fs.existsSync(f) && fs.statSync(f).size > 1024) {
        emitResult({ ok: true, filePath: f, size: fs.statSync(f).size });
        return;
      }
    }
    await sleep(500);
  }

  if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 1024) {
    emitResult({ ok: true, filePath: pdfPath, size: fs.statSync(pdfPath).size });
    return;
  }

  emitResult({ ok: false, errorCode: 'NO_PDF', message: 'A 2ª via não retornou um PDF legível.' });
}

main()
  .catch((err) => {
    emitResult({ ok: false, errorCode: 'HELPER_ERROR', message: err?.message ?? String(err) });
  })
  .finally(async () => {
    // Close the Chrome instance we launched (dedicated profile) so no stray
    // window is left behind. Browser.close only affects this instance.
    try {
      await browserCdp?.send('Browser.close');
    } catch {
      /* ignore */
    }
    try {
      browserCdp?.close();
    } catch {
      /* ignore */
    }
    // Give stdout a tick to flush before the runtime tears down.
    setTimeout(() => process.exit(0), 50);
  });
