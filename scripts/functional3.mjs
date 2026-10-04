// 第3段階の操作確認（ヘッドレスChromium）：動作チェック、画質の自動調整、文字の大きさ、保存の失敗と自動保存、
// このゲームについて（素材と権利）、振動
//   node scripts/functional3.mjs [baseUrl]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/home/claude/.npm-global/lib/node_modules/playwright');
}
const base = process.argv[2] ?? 'http://localhost:8123/index.html';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const browser = await pw.chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const g = (page, fn, arg) => page.evaluate(fn, arg);

async function open(vp, url = base + '?debug=1&panel=0', init = null) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  await ctx.addInitScript(() => {
    window.__vib = [];
    Object.defineProperty(navigator, 'vibrate', { value: (p) => (window.__vib.push(p), true), configurable: true });
  });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('.overlay-center'), null, { timeout: 90000 });
  const ns = page.getByRole('button', { name: '音なしで始める' });
  if (await ns.isVisible().catch(() => false)) await ns.click();
  return { ctx, page, errors };
}

async function lightFire(page) {
  await page.getByRole('button', { name: '組み方の見本' }).click();
  await page.getByRole('button', { name: /ゆったり型/ }).click();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '火を灯す' }).click();
  await page.waitForFunction(() => window.__gyarubi.sim.phase === 'burning', null, { timeout: 30000 });
}

// 1. 動作チェック・画質の自動調整（この環境はCPU描画なので重い＝自動で軽くなるはず。
//    PCの大きさだと1fps未満になり、2fps未満ではゲーム時間を遅らせる設計なので、スマホの大きさで確かめる）
{
  const { ctx, page, errors } = await open({ w: 390, h: 844 });
  await lightFire(page);
  // この環境（CPU描画）では最初は重いので、自動調整が落ち着いてからはかる
  await page.waitForFunction(() => window.__gyarubi.controller.scene.stats().quality === 'low', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await g(page, () => window.__gyarubi.controller.startDeviceCheck(20));
  const chip = await page.locator('.check-chip').textContent().catch(() => '');
  check('動作チェック中は、残り時間とやめるボタンを出す', /チェック中 \d+秒/.test(chip ?? '') && (await page.getByRole('button', { name: 'やめる' }).isVisible()), chip ?? '');
  // 画面に触れて、入力の遅れをはかる
  for (let i = 0; i < 4; i++) {
    await page.mouse.click(120 + i * 40, 200);
    await page.waitForTimeout(700);
  }
  await page.waitForSelector('.check-report', { timeout: 60000 });
  const report = await page.locator('.check-report').inputValue();
  writeFileSync('/tmp/gyarubi-check-report.txt', report);
  check(
    '動作チェックの結果：fps・遅いほう1%・画質・ゲームの進み・入力・端末をまとめる',
    /平均 [\d.]+ fps/.test(report) && /遅いほう1%/.test(report) && /ゲーム時間の進み：実時間の [\d.]+%/.test(report) && /入力から次の描画まで：中央値/.test(report) && /GPU：/.test(report) && /画面：/.test(report),
    report.split('\n').slice(0, 3).join(' / '),
  );
  const rate = Number(/実時間の ([\d.]+)%/.exec(report)?.[1] ?? 0);
  const avgFps = Number(/平均 ([\d.]+) fps/.exec(report)?.[1] ?? 0);
  const medMs = Number(/中央値 ([\d.]+) ms/.exec(report)?.[1] ?? 0);
  // 2fps（1フレーム0.5秒）までは実時間どおり。それより遅い（この環境のCPU描画）ときは、1フレーム0.5秒ぶんだけ進む設計
  const expectRate = medMs <= 450 ? 100 : Math.min(100, (500 / medMs) * 100);
  check(
    '重くても2fpsまでは、ゲーム時間は実時間どおりに進む（育つ速さは変えない）。結果にその割合が出る',
    Math.abs(rate - expectRate) < (medMs <= 450 ? 10 : 25),
    `${rate}%（平均 ${avgFps} fps・中央値 ${medMs} ms → 見込み ${expectRate.toFixed(0)}%）`,
  );
  const adapt = await g(page, () => ({ log: window.__gyarubi.controller.scene.adaptLog.map((a) => a.what), q: window.__gyarubi.controller.scene.stats().quality }));
  check('重いときは自動で解像度→軽量の順に下げる（この環境はCPU描画で重い）', adapt.log.length > 0 && adapt.q === 'low', adapt.log.join(' / '));
  const [copied] = await Promise.all([
    page.getByRole('button', { name: '結果をコピー' }).click().then(() => page.waitForTimeout(400)).then(() => g(page, () => navigator.clipboard.readText())),
  ]);
  check('結果をコピーできる', copied.startsWith('【焚き火と、ひと息。 動作チェック】'), copied.slice(0, 20));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.getByRole('button', { name: 'ファイルに保存' }).click()]);
  const txt = dl ? readFileSync(await dl.path(), 'utf8') : '';
  check('結果をファイルに保存できる', !!dl && txt === report, dl ? dl.suggestedFilename() : 'ダウンロードなし');
  check('ページエラーなし（動作チェック）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// 2. 文字の大きさ（360×640 のいちばん小さい画面で、重要な操作が画面の外や重なりに隠れない）
{
  const { ctx, page, errors } = await open({ w: 360, h: 640, mobile: true });
  await g(page, () => window.__gyarubi.controller.updateSettings({ textSize: 'xlarge' }));
  const fs = await g(page, () => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim());
  await lightFire(page);
  await page.waitForTimeout(800);
  const boxes = await g(page, () => {
    const pick = (sel, name) => {
      const el = [...document.querySelectorAll(sel)].find((e) => !name || e.textContent.includes(name) || e.getAttribute('aria-label') === name);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, fs: parseFloat(getComputedStyle(el).fontSize) };
    };
    return {
      wood: pick('.dock button', '薪'),
      tongs: pick('.dock button', '火ばさみ'),
      wind: pick('.dock button', '送風'),
      watch: pick('.dock button', '火を眺める'),
      menu: pick('.hud-actions button', 'メニュー'),
      pause: pick('.hud-actions button', '一時停止'),
      vw: innerWidth,
      vh: innerHeight,
    };
  });
  const inside = (b) => b && b.x >= 0 && b.y >= 0 && b.x + b.w <= boxes.vw + 0.5 && b.y + b.h <= boxes.vh + 0.5;
  const keys = ['wood', 'tongs', 'wind', 'watch', 'menu', 'pause'];
  check('文字「とても大きい」：文字が大きくなる（×1.36）', fs === '1.36' && boxes.wood?.fs > 12, `--fs=${fs} 道具の文字 ${boxes.wood?.fs}px`);
  check('文字「とても大きい」でも 360×640 で道具・見守り・メニューが画面内', keys.every((k) => inside(boxes[k])), keys.map((k) => `${k}:${boxes[k] ? `${Math.round(boxes[k].x)},${Math.round(boxes[k].y)} ${Math.round(boxes[k].w)}×${Math.round(boxes[k].h)}` : 'なし'}`).join(' '));
  await page.screenshot({ path: '/tmp/gyarubi-xlarge-360.jpg', quality: 80 });
  await g(page, () => window.__gyarubi.controller.openDialog('settings'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/gyarubi-xlarge-360-settings.jpg', quality: 80 });
  // 振動：置いたとき・火がついたとき
  const vib = await g(page, () => window.__vib);
  check('振動：火がついたときに軽く震える（対応端末）', vib.some((p) => Array.isArray(p) && p.length === 3), JSON.stringify(vib).slice(0, 80));
  await g(page, () => window.__gyarubi.controller.updateSettings({ textSize: 'normal', haptics: false }));
  await g(page, () => (window.__vib.length = 0));
  await g(page, () => window.__gyarubi.addLog());
  const vib2 = await g(page, () => window.__vib.length);
  check('振動：設定でオフにすると震えない', vib2 === 0, `${vib2}`);
  check('ページエラーなし（文字の大きさ）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// 3. 保存：自動保存・保存容量が足りないとき（今までの記録は消さない）
{
  const { ctx, page, errors } = await open({ w: 390, h: 844, mobile: true });
  await lightFire(page);
  await g(page, () => window.__gyarubi.controller.persist());
  const t0 = await g(page, () => JSON.parse(localStorage.getItem('gyarubi.session')).savedAt);
  await page.waitForTimeout(23000);
  const t1 = await g(page, () => JSON.parse(localStorage.getItem('gyarubi.session')).savedAt);
  check('燃えている間は、10秒ごとに自動で保存する', t1 !== t0, `${t0} → ${t1}`);
  // 容量不足を再現：session の書き込みだけ失敗させる
  const before = await g(page, () => localStorage.getItem('gyarubi.session'));
  await g(page, () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'gyarubi.session') throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  });
  await g(page, () => window.__gyarubi.controller.persist());
  await page.waitForTimeout(300);
  const toast = await page.locator('.toast').allTextContents();
  const after = await g(page, () => localStorage.getItem('gyarubi.session'));
  check('保存できないときは一度だけ知らせ、今までの保存は消さない', toast.join(' ').includes('保存できませんでした') && after === before, toast.join(' / ').slice(0, 80));
  await g(page, () => window.__gyarubi.controller.persist());
  const toasts2 = (await page.locator('.toast').allTextContents()).filter((t) => t.includes('保存できませんでした')).length;
  check('保存の失敗の知らせは繰り返さない', toasts2 <= 1, `${toasts2}`);
  await g(page, () => window.__gyarubi.controller.openDialog('settings'));
  const note = await page.locator('.warn-text').textContent().catch(() => '');
  check('設定の「記録について」に、いま保存できていないことを出す', /保存できていません/.test(note ?? ''), note ?? '');
  // freeze（端末がページを凍結するとき）でも保存を試みる
  await g(page, () => window.__gyarubi.controller.closeAllDialogs());
  check('ページエラーなし（保存）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// 4. このゲームについて（素材と権利）
{
  const { ctx, page, errors } = await open({ w: 390, h: 844, mobile: true });
  await page.getByRole('button', { name: 'メニュー' }).click();
  await page.getByRole('button', { name: 'このゲームについて' }).click();
  const txt = await page.locator('dialog[open]').textContent();
  check('このゲームについて：素材と権利・仮素材・記録の扱い（キャラクターの記載はない）', /Three\.js/.test(txt) && /React/.test(txt) && /Noto Sans JP/.test(txt) && /SIL Open Font License/.test(txt) && /どこへも送りません/.test(txt) && /仮の素材/.test(txt) && !/キャラ|火の精|おじ火/.test(txt));
  await page.locator('dialog[open] summary').click();
  const lic = await page.locator('.license-text').textContent();
  check('ライセンスの全文（MIT）を読める', /Permission is hereby granted/.test(lic ?? '') && /three\.js authors/.test(lic ?? ''));
  const res = await page.request.get(new URL('THIRD_PARTY_LICENSES.md', base).href);
  check('THIRD_PARTY_LICENSES.md を同梱', res.ok() && /SIL OPEN FONT LICENSE/.test(await res.text()));
  check('ページエラーなし（このゲームについて）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
