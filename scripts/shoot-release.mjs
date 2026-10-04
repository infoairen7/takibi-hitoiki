// 公開版（1.0）の画面確認：支度・組んだところ・燃えている火・状態の案内・眺める・手帳・思い出
//   node scripts/shoot-release.mjs [baseUrl] [outDir]   （ONLY=mobile|pc で一つだけ）
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/home/claude/.npm-global/lib/node_modules/playwright');
}
const base = process.argv[2] ?? 'http://localhost:8123/index.html';
const out = process.argv[3] ?? 'docs/screens/release';
mkdirSync(out, { recursive: true });
const viewports = [
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true },
  { name: 'pc-1440x900', width: 1440, height: 900, mobile: false },
];
const only = process.env.ONLY;
const browser = await pw.chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const vp of viewports) {
  if (only && !vp.name.startsWith(only)) continue;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector('.overlay-center'), null, { timeout: 90000 });
  const shot = async (n) => page.screenshot({ path: `${out}/${vp.name}-${n}.jpg`, quality: 82, timeout: 120000 });
  const ns = page.getByRole('button', { name: '音なしで始める' });
  if (await ns.isVisible().catch(() => false)) await ns.click();
  await page.waitForTimeout(600);
  await shot('01-start');
  await page.getByRole('button', { name: '組み方の見本' }).click();
  await page.getByRole('button', { name: /井桁型/ }).click();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(600);
  await shot('02-built');
  await page.getByRole('button', { name: '火を灯す' }).click();
  await page.waitForTimeout(4500);
  await page.evaluate(() => window.__gyarubi.advance(110));
  await page.waitForTimeout(2500);
  await shot('03-burning');
  // 強い火：状態の案内と次の操作
  await page.evaluate(() => {
    window.__gyarubi.addLog();
    window.__gyarubi.addLog();
  });
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => {
      const c = window.__gyarubi.controller;
      c.setWindLevel(2);
      c.gust();
      window.__gyarubi.advance(3.2);
    });
    if (await page.evaluate(() => window.__gyarubi.sim.metrics.heat > 88)) break;
  }
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.__gyarubi.advance(1));
    if (/火が強すぎる/.test((await page.locator('.status-note').textContent().catch(() => '')) ?? '')) break;
  }
  await page.waitForTimeout(1500);
  await shot('04-hot-hint');
  // 眺める
  await page.evaluate(() => window.__gyarubi.advance(40));
  await page.getByRole('button', { name: 'しばらく、火を眺める' }).click();
  await page.waitForTimeout(2500);
  await shot('05-watching');
  await page.getByRole('button', { name: '操作に戻る' }).click();
  // 手帳（発見）
  await page.evaluate(() => window.__gyarubi.controller.openDialog('journal'));
  await page.getByRole('tab', { name: '発見' }).click();
  await page.waitForTimeout(400);
  await shot('06-journal-tasks');
  await page.keyboard.press('Escape');
  // 熾火まで → 思い出
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => window.__gyarubi.sim.session.emberPhase)) break;
    await page.evaluate(() => window.__gyarubi.advance(10));
  }
  await page.waitForTimeout(2500);
  await shot('07-ember');
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => window.__gyarubi.controller.sess.ended)) break;
    await page.evaluate(() => window.__gyarubi.advance(10));
  }
  await page.waitForSelector('.memory-card img', { timeout: 60000 });
  await page.waitForTimeout(800);
  await shot('08-memory');
  const card = await page.evaluate(() => document.querySelector('.memory-card img')?.src ?? null);
  if (card) {
    const b64 = await page.evaluate(async (src) => {
      const b = await (await fetch(src)).blob();
      const buf = new Uint8Array(await b.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, card);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${out}/${vp.name}-09-card.png`, Buffer.from(b64, 'base64'));
  }
  console.log(vp.name, 'done', logs.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
