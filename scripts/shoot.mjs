// 画面確認：3つの画面サイズで、空の台→組む→着火→燃え移り を撮影する（ヘッドレスChromium・SwiftShader）
//   node scripts/shoot.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/home/claude/.npm-global/lib/node_modules/playwright');
}
const { chromium } = pw;
const base = process.argv[2] ?? 'http://localhost:8123/index.html';
const out = process.argv[3] ?? 'shots';
mkdirSync(out, { recursive: true });

const viewports = [
  { name: 'mobile-390x844', width: 390, height: 844, dpr: 2, mobile: true },
  { name: 'small-360x640', width: 360, height: 640, dpr: 2, mobile: true },
  { name: 'pc-1440x900', width: 1440, height: 900, dpr: 1, mobile: false },
];
const only = process.env.ONLY;
const report = {};
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const vp of viewports) {
  if (only && !vp.name.startsWith(only)) continue;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, isMobile: vp.mobile, hasTouch: vp.mobile });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto(base + '?debug=1');
  await page.waitForFunction(() => !document.querySelector('.overlay-center'), null, { timeout: 60000 });
  const loadMs = Date.now() - t0;
  const shot = async (n) => page.screenshot({ path: `${out}/${vp.name}-${n}.png` });
  // 音の選択
  const noSound = page.getByRole('button', { name: '音なしで始める' });
  if (await noSound.isVisible().catch(() => false)) await noSound.click();
  await page.waitForTimeout(1200);
  await shot('01-empty');
  // タップで置く：火口を選ぶ→台の中央をタップ→置く
  await page.getByRole('button', { name: /^火口/ }).click();
  await page.waitForTimeout(400);
  await shot('02-ghost-tinder');
  await page.getByRole('button', { name: '置く', exact: true }).click();
  await page.waitForTimeout(500);
  // 中薪を選んでゴースト表示
  await page.getByRole('button', { name: /^中薪/ }).click();
  await page.waitForTimeout(400);
  await shot('03-ghost-medium');
  await page.getByRole('button', { name: 'やめる' }).click();
  // 片付けて組み方の見本を使う
  await page.evaluate(() => window.__gyarubi.controller.newFire());
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '組み方の見本' }).click();
  await page.getByRole('button', { name: /ゆったり型/ }).click();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(800);
  await shot('04-stacked');
  await page.getByRole('button', { name: '火を灯す' }).click();
  await page.waitForTimeout(2200);
  await shot('05-lighter');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__gyarubi.advance(4));
  await page.waitForTimeout(1200);
  await shot('06-tinder-burning');
  await page.evaluate(() => window.__gyarubi.advance(8));
  await page.waitForTimeout(1200);
  await shot('07-kindling');
  await page.evaluate(() => window.__gyarubi.advance(25));
  await page.waitForTimeout(1500);
  await shot('08-medium-catching');
  await page.evaluate(() => window.__gyarubi.advance(60));
  await page.waitForTimeout(1500);
  await shot('09-established');
  // 送風
  await page.getByRole('button', { name: '送風' }).click();
  await page.getByRole('button', { name: '強' }).click();
  await page.getByRole('button', { name: '左から' }).click();
  await page.getByRole('button', { name: '風を一度送る' }).click();
  await page.waitForTimeout(700);
  await shot('10-wind-lean');
  await page.getByRole('button', { name: '戻る' }).click();
  // 火ばさみ
  await page.getByRole('button', { name: '火ばさみ' }).click();
  await page.getByRole('button', { name: 'つかむ' }).click();
  await page.waitForTimeout(600);
  await shot('11-tongs-hold');
  await page.getByRole('button', { name: '元に戻す' }).click();
  await page.getByRole('button', { name: '戻る' }).click();
  // 手帳
  await page.getByRole('button', { name: 'メニュー' }).click();
  await page.getByRole('button', { name: '火の手帳' }).click();
  await page.waitForTimeout(400);
  await shot('12-journal');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__gyarubi.advance(200));
  await page.waitForTimeout(1500);
  await shot('13-later');
  const stats = await page.evaluate(() => {
    const c = window.__gyarubi.controller;
    return { initMs: c.sceneInitMs, stats: c.scene?.stats(), clock: c.debugState, heat: c.sim.metrics.heat, pieces: c.sim.pieces.map((p) => [p.kind, p.state]) };
  });
  // 実時間での描画速度（ヘッドレス・CPU描画の参考値）
  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n++;
          if (performance.now() - t0 < 3000) requestAnimationFrame(f);
          else res((n * 1000) / (performance.now() - t0));
        };
        requestAnimationFrame(f);
      }),
  );
  report[vp.name] = { loadMs, fps, stats, logs: logs.slice(0, 30) };
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
