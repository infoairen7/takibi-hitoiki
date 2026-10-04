// 第3段階の画面確認：文字の大きさ（標準・とても大きい）、動作チェック、このゲームについて
//   node scripts/shoot3.mjs [baseUrl] [outDir]   （ONLY=mobile|small|pc で一つだけ）
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
const out = process.argv[3] ?? 'shots3';
mkdirSync(out, { recursive: true });
const viewports = [
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true },
  { name: 'small-360x640', width: 360, height: 640, mobile: true },
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
  await page.goto(base + '?debug=1&panel=0');
  await page.waitForFunction(() => !document.querySelector('.overlay-center'), null, { timeout: 90000 });
  const shot = async (n) => page.screenshot({ path: `${out}/${vp.name}-${n}.jpg`, quality: 82, timeout: 120000 });
  const ns = page.getByRole('button', { name: '音なしで始める' });
  if (await ns.isVisible().catch(() => false)) await ns.click();
  await page.getByRole('button', { name: '組み方の見本' }).click();
  await page.getByRole('button', { name: /ゆったり型/ }).click();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '火を灯す' }).click();
  await page.waitForTimeout(4500);
  await page.evaluate(() => window.__gyarubi.advance(100));
  await page.waitForTimeout(2500);
  // 01 標準の文字
  await shot('01-text-normal');
  // 02 とても大きい文字
  await page.evaluate(() => window.__gyarubi.controller.updateSettings({ textSize: 'xlarge' }));
  await page.waitForTimeout(600);
  await shot('02-text-xlarge');
  await page.evaluate(() => window.__gyarubi.controller.openDialog('journal'));
  await page.getByRole('tab', { name: '発見' }).click();
  await page.waitForTimeout(400);
  await shot('03-text-xlarge-journal');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__gyarubi.controller.updateSettings({ textSize: 'normal' }));
  // 04 設定（文字の大きさ・動作チェック）
  await page.evaluate(() => window.__gyarubi.controller.openDialog('settings'));
  await page.getByText('文字の大きさ').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot('04-settings-text');
  await page.getByRole('button', { name: '60秒はかる' }).scrollIntoViewIfNeeded();
  await shot('05-settings-check');
  // 06 動作チェック中 → 07 結果
  await page.evaluate(() => window.__gyarubi.controller.startDeviceCheck(12));
  await page.waitForTimeout(1500);
  await shot('06-check-running');
  await page.waitForSelector('.check-report', { timeout: 120000 });
  await page.waitForTimeout(300);
  await shot('07-check-result');
  await page.keyboard.press('Escape');
  // 08 このゲームについて
  await page.evaluate(() => window.__gyarubi.controller.openDialog('about'));
  await page.waitForTimeout(300);
  await shot('08-about');
  await page.locator('.credit-list').scrollIntoViewIfNeeded();
  await shot('09-about-credits');
  console.log(vp.name, 'done', logs.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
