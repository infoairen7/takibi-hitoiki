// 公開前の確認（ヘッドレスChromium）：太薪と火吹き筒を、画面の操作（タップ）で確かめる
//   太薪：火が中薪まで育つまでは選べない／太さと樹種を別に選ぶ／中薪とあわせて5本
//   火吹き筒：発見3件で解放／狙う場所を候補とタップで選ぶ／ひと吹き・息継ぎ
//   node scripts/functional5.mjs [baseUrl]
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
const shots = process.env.SHOTS ?? 'docs/screenshots';
mkdirSync(shots, { recursive: true });
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
const toasts = (page) => page.locator('.toast').allTextContents().then((a) => a.join(' / '));

async function open(vp, init = null) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()));
  await page.goto(base + '?debug=1&panel=0');
  await page.waitForFunction(() => !document.querySelector('.overlay-center'), null, { timeout: 90000 });
  const start = page.getByRole('button', { name: '音なしで始める' });
  if (await start.isVisible().catch(() => false)) await start.tap();
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}

async function lightIgeta(page) {
  await page.getByRole('button', { name: '組み方の見本' }).tap();
  await page.getByRole('button', { name: /井桁型/ }).tap();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '火を灯す' }).tap();
  await page.waitForFunction(() => window.__gyarubi.sim.phase === 'burning', null, { timeout: 30000 });
}

// ───────────── 1. 太薪（縦のスマホ）
{
  const { ctx, page, errors } = await open({ w: 390, h: 844, mobile: true });
  await lightIgeta(page);
  // 着火直後：太薪はまだ選べない
  await page.getByRole('button', { name: '薪', exact: true }).tap();
  const largeBtn = page.locator('.seg button', { hasText: '太薪' });
  const lockedBefore = (await largeBtn.getAttribute('aria-disabled')) === 'true';
  // aria-disabled のボタンも押せる（理由を知らせるため）。Playwright は押せないものとして扱うので force
  await largeBtn.tap({ force: true });
  await page.waitForTimeout(200);
  const t0 = await toasts(page);
  check('太薪：火が中薪まで育つまでは選べない（理由を知らせる）', lockedBefore && /育ってから/.test(t0), t0);
  await page.getByRole('button', { name: '戻る' }).tap();
  // 育つまで（検証用の早送り）
  for (let i = 0; i < 40; i++) {
    if (await g(page, () => window.__gyarubi.sim.stage0Done)) break;
    await g(page, () => window.__gyarubi.advance(5));
  }
  await g(page, () => window.__gyarubi.advance(20));
  await page.getByRole('button', { name: '薪', exact: true }).tap();
  const lockedAfter = (await largeBtn.getAttribute('aria-disabled')) === 'true';
  await largeBtn.tap();
  const pressed = await largeBtn.getAttribute('aria-pressed');
  const label = await page.locator('#log-size').textContent();
  await page.screenshot({ path: `${shots}/f5_large_pick_390.png` });
  const logs0 = await g(page, () => window.__gyarubi.sim.countOf('medium') + window.__gyarubi.sim.countOf('large'));
  check('太薪：火が育つと「太さ」で太薪を選べる。中薪とあわせた本数を表示', !lockedAfter && pressed === 'true' && (label ?? '').includes(`あわせて ${logs0}/5本`), label ?? '');
  const n0 = await g(page, () => window.__gyarubi.sim.countOf('large'));
  await page.getByRole('button', { name: /^くぬぎ/ }).tap();
  const title = await page.locator('.dock h2').textContent();
  await page.getByRole('button', { name: /次の置き位置の候補/ }).tap();
  await page.getByRole('button', { name: '置く', exact: true }).tap();
  await page.waitForTimeout(300);
  const n1 = await g(page, () => window.__gyarubi.sim.countOf('large'));
  const sp = await g(page, () => window.__gyarubi.sim.pieces.filter((p) => p.kind === 'large').map((p) => p.species).join(','));
  check('太薪：樹種を選んで、タップだけで置ける', n1 === n0 + 1 && sp === 'kunugi' && /太薪/.test(title ?? ''), `${title} / 太薪 ${n0}→${n1} / ${sp}`);
  // 5本まで：中薪を足していって、5本目の後は太薪も中薪も選べない
  for (let k = 0; k < 3; k++) {
    if ((await g(page, () => window.__gyarubi.sim.countOf('medium') + window.__gyarubi.sim.countOf('large'))) >= 5) break;
    await page.getByRole('button', { name: '薪', exact: true }).tap();
    await page.locator('.seg button', { hasText: '中薪' }).tap();
    await page.getByRole('button', { name: /^なら/ }).tap();
    for (let i = 0; i < 6; i++) {
      const v = await g(page, () => window.__gyarubi.controller.getSnapshot().placement?.valid);
      if (v) break;
      await page.getByRole('button', { name: /次の置き位置の候補/ }).tap();
    }
    await page.getByRole('button', { name: '置く', exact: true }).tap();
    await page.waitForTimeout(300);
  }
  const logs = await g(page, () => window.__gyarubi.sim.countOf('medium') + window.__gyarubi.sim.countOf('large'));
  await page.getByRole('button', { name: '薪', exact: true }).tap();
  const full = (await page.getByRole('button', { name: /^さくら/ }).getAttribute('aria-disabled')) === 'true';
  await page.getByRole('button', { name: /^さくら/ }).tap({ force: true });
  await page.waitForTimeout(200);
  const t5 = await toasts(page);
  check('太薪：中薪とあわせて5本まで（6本目は選べず、理由を知らせる）', logs === 5 && full && /あわせて5本/.test(t5), `${logs}本 / ${t5}`);
  await page.getByRole('button', { name: '戻る' }).tap();
  check('太薪：画面のエラーなし', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ───────────── 2. 火吹き筒（縦のスマホ・横のスマホ）
for (const vp of [
  { w: 390, h: 844, mobile: true, name: '縦' },
  { w: 844, h: 390, mobile: true, name: '横' },
]) {
  const { ctx, page, errors } = await open(vp);
  await lightIgeta(page);
  await g(page, () => window.__gyarubi.advance(60));
  // 未解放：選べず、理由を知らせる
  await page.getByRole('button', { name: '送風', exact: true }).tap();
  const tubeBtn = page.locator('.tool-switch button', { hasText: '火吹き筒' });
  const locked = (await tubeBtn.getAttribute('aria-disabled')) === 'true';
  await tubeBtn.tap({ force: true });
  await page.waitForTimeout(200);
  const tl = await toasts(page);
  check(`火吹き筒（${vp.name}）：初期は使えない（発見3件で、と知らせる）`, locked && /発見3件/.test(tl), tl);
  await page.getByRole('button', { name: '戻る' }).tap();
  // 発見を3件にする（検証用）
  await g(page, () => {
    const c = window.__gyarubi.controller;
    for (const id of ['t01', 't02', 't03']) c.progress.tasks[id] = new Date().toISOString();
    c.emit();
  });
  await page.getByRole('button', { name: '送風', exact: true }).tap();
  await tubeBtn.tap();
  await page.waitForTimeout(200);
  const aim0 = (await page.locator('.aim-label').textContent())?.trim();
  const ring = await g(page, () => {
    const s = window.__gyarubi.controller.scene;
    return !!s.tubeRing && s.tubeRing.visible;
  });
  await page.screenshot({ path: `${shots}/f5_tube_${vp.w}x${vp.h}.png` });
  check(`火吹き筒（${vp.name}）：切り替えると、いちばん熱い所を狙い、台に輪を出す`, !!aim0 && aim0 !== '—' && ring, aim0);
  // 候補を順に選ぶ
  await page.getByRole('button', { name: '次の場所' }).tap();
  const aim1 = (await page.locator('.aim-label').textContent())?.trim();
  check(`火吹き筒（${vp.name}）：狙う場所を、ボタンで順に選べる`, aim1 && aim1 !== aim0, `${aim0} → ${aim1}`);
  // 画面をタップして狙う（台の中央付近）
  const pt = await g(page, () => {
    const s = window.__gyarubi.controller.scene;
    const r = s.renderer.domElement.getBoundingClientRect();
    // 台の床の上、手前寄りの何もない所（道具箱に隠れていない所）
    const fy = -s.floorPlane.constant;
    const p = s.project([0.2, fy, -0.2]);
    return { x: r.left + p.x, y: r.top + p.y, fy };
  });
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(200);
  const aimTap = await g(page, () => window.__gyarubi.controller.tubeAim);
  check(`火吹き筒（${vp.name}）：画面をタップした所を狙える`, aimTap && Math.abs(aimTap.x - 0.2) < 0.04 && Math.abs(aimTap.z + 0.2) < 0.04, `${JSON.stringify(aimTap)} / tap ${Math.round(pt.x)},${Math.round(pt.y)}`);
  // ひと吹き → 息継ぎ
  const before = await g(page, () => window.__gyarubi.controller.sess.stats.blows);
  await page.getByRole('button', { name: 'ひと吹きする' }).tap();
  await page.waitForTimeout(150);
  const active = await g(page, () => window.__gyarubi.sim.tube.t >= 0);
  const btnText = (await page.locator('.dock .btn.primary').textContent())?.trim();
  await page.locator('.dock .btn.primary').tap({ force: true });
  await page.waitForTimeout(150);
  const t2 = await toasts(page);
  const after = await g(page, () => window.__gyarubi.controller.sess.stats.blows);
  check(`火吹き筒（${vp.name}）：ひと吹きでき、息継ぎの間は吹けない（連打は強くならない）`, active && after === before + 1 && /ひと息/.test(t2), `${btnText} / ${t2}`);
  // 戻ると輪が消える
  await page.getByRole('button', { name: '戻る' }).tap();
  const ringOff = await g(page, () => !window.__gyarubi.controller.scene.tubeRing.visible);
  check(`火吹き筒（${vp.name}）：道具を閉じると狙いの輪が消える`, ringOff);
  // 送風の道具箱が画面に収まる（横の短い画面でも、ボタンが押せる）
  await page.getByRole('button', { name: '送風', exact: true }).tap();
  const box = await page.getByRole('button', { name: /ひと吹き|ひと息|ふーっ/ }).boundingBox();
  check(`火吹き筒（${vp.name}）：吹くボタンが画面内にあり、48px以上`, box && box.y + box.height <= vp.h && box.height >= 48, JSON.stringify(box));
  check(`火吹き筒（${vp.name}）：画面のエラーなし`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
process.exit(fails.length ? 1 : 0);
