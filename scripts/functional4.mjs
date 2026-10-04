// 公開前の確認（ヘッドレスChromium）：詳細仕様14章「必須の確認」のうち、画面の操作で確かめる項目
//   9. スマホのドラッグを使わず、タップだけで一周できる
//  10. 音を開始できない端末でも遊べる。共有に対応していなくても、画像の保存と文章のコピーが使える
//  12. 思い出の画像を作れなくても、記録と文章は残せる（ボタンが止まったままにならない）
//  ほか：燃え尽きかけた火の案内（熾に風を送る）と、自然な燃料切れ（熾火の時間へ）
//   node scripts/functional4.mjs [baseUrl]
import { createRequire } from 'node:module';
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
const toasts = (page) => page.locator('.toast').allTextContents().then((a) => a.join(' / '));

async function open(vp, init = null) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()));
  await page.goto(base + '?debug=1&panel=0');
  await page.waitForFunction(() => !document.querySelector('.overlay-center'), null, { timeout: 90000 });
  return { ctx, page, errors };
}

// ───────────── 1. タップだけで一周（音を開始できない端末・共有に非対応の端末）
{
  const { ctx, page, errors } = await open({ w: 390, h: 844, mobile: true }, () => {
    // 音を開始できない端末（音の部品はあるが、開始に失敗する）・ファイル共有がない端末
    window.AudioContext = class {
      constructor() {
        throw new Error('audio blocked');
      }
    };
    try {
      Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    } catch {
      /* noop */
    }
    // マウス操作を使っていないことを確かめる（タップはタッチとして届く）
    window.__mouse = 0;
    window.addEventListener('mousedown', (e) => !e.sourceCapabilities?.firesTouchEvents && window.__mouse++, true);
  });
  await page.getByRole('button', { name: '音ありで始める' }).tap();
  await page.waitForTimeout(400);
  const t1 = await toasts(page);
  const dialogOpen = await page.getByRole('button', { name: '音ありで始める' }).isVisible().catch(() => false);
  check('音を開始できない端末：知らせて、そのまま遊べる（たずねる画面は閉じる）', /音を開始できませんでした/.test(t1) && !dialogOpen, t1);
  // 組み方の見本（タップ）→ 火を灯す（タップ）
  await page.getByRole('button', { name: '組み方の見本' }).tap();
  await page.getByRole('button', { name: /井桁型/ }).tap();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '火を灯す' }).tap();
  await page.waitForFunction(() => window.__gyarubi.sim.phase === 'burning', null, { timeout: 30000 });
  check('タップだけで組んで、火を灯せる', true);
  // 育つまで待つ（時間を進めるのは検証用。操作ではない）
  for (let i = 0; i < 60; i++) {
    if (await g(page, () => window.__gyarubi.sim.stage0Done)) break;
    await g(page, () => window.__gyarubi.advance(5));
  }
  // 薪を一本足す：道具「薪」→ 樹種 → 置く（候補の位置のまま）
  await g(page, () => window.__gyarubi.advance(150));
  const n0 = await g(page, () => window.__gyarubi.sim.countOf('medium', true));
  await page.getByRole('button', { name: '薪', exact: true }).tap();
  await page.getByRole('button', { name: /^なら/ }).tap();
  await page.getByRole('button', { name: /次の置き位置の候補/ }).tap();
  await page.getByRole('button', { name: '置く', exact: true }).tap();
  await page.waitForTimeout(300);
  const n1 = await g(page, () => window.__gyarubi.sim.countOf('medium', true));
  check('燃えている間も、タップだけで薪を足せる（道具→樹種→候補→置く）', n1 === n0 + 1, `中薪 ${n0}→${n1}`);
  // 送風
  const g0 = await g(page, () => window.__gyarubi.controller.sess.stats.gusts);
  await page.getByRole('button', { name: '送風', exact: true }).tap();
  await page.getByRole('button', { name: '風を一度送る' }).tap();
  await page.waitForTimeout(300);
  const g1 = await g(page, () => window.__gyarubi.controller.sess.stats.gusts);
  check('タップだけで風を送れる', g1 === g0 + 1);
  await page.getByRole('button', { name: '戻る' }).tap();
  // 見守る → 操作に戻る
  await page.getByRole('button', { name: 'しばらく、火を眺める' }).tap();
  await page.waitForTimeout(200);
  const watching = await g(page, () => window.__gyarubi.controller.getSnapshot().watching);
  await page.getByRole('button', { name: '操作に戻る' }).tap();
  await page.waitForTimeout(200);
  check('タップだけで見守り・操作に戻れる', watching && !(await g(page, () => window.__gyarubi.controller.getSnapshot().watching)));
  // 最後まで（熾火→見送り→思い出）
  for (let i = 0; i < 80; i++) {
    if (await g(page, () => window.__gyarubi.controller.sess.ended)) break;
    await g(page, () => window.__gyarubi.advance(10));
  }
  await page.waitForSelector('.memory-card img', { timeout: 30000 });
  const reason = await g(page, () => window.__gyarubi.controller.sess.endReason);
  check('最後まで燃やして、自然に見送る', reason === 'natural', reason);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.getByRole('button', { name: '思い出を残す' }).tap()]);
  await page.waitForTimeout(400);
  const album = await g(page, () => JSON.parse(localStorage.getItem('gyarubi.album') ?? '{"entries":[]}').entries.length);
  check('タップで思い出を残せる（アルバム＋画像）', album === 1 && !!dl, dl?.suggestedFilename() ?? 'ダウンロードなし');
  // 共有に非対応：画像の保存と文章のコピー
  const shareLabel = await page.locator('.memory-page .stack .btn').nth(1).textContent();
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.getByRole('button', { name: '画像を保存して文章をコピー' }).tap()]);
  await page.waitForTimeout(500);
  const clip = await g(page, () => navigator.clipboard.readText().catch(() => ''));
  const name = await g(page, () => window.__gyarubi.controller.getSnapshot().memory.data.fireName);
  check('共有に非対応の端末：画像を保存し、文章をコピーできる', /画像を保存して文章をコピー/.test(shareLabel ?? '') && !!dl2 && clip.includes(name), `${dl2?.suggestedFilename() ?? 'なし'} / ${clip.slice(0, 40)}`);
  await page.getByRole('button', { name: '新しい火をつくる' }).tap();
  await page.waitForTimeout(300);
  const fresh = await g(page, () => ({ n: window.__gyarubi.sim.pieces.length, dock: window.__gyarubi.controller.debugState.dock }));
  check('タップで新しい火へ', fresh.n === 0 && fresh.dock === 'prepare');
  const mouse = await g(page, () => window.__mouse);
  check('この一周でマウス操作・ドラッグを使っていない', mouse === 0, `mousedown ${mouse}`);
  check('ページエラーなし（タップだけで一周）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ───────────── 2. 燃え尽きかけた火：熾に風を送ると戻る（案内とボタン）
{
  const { ctx, page, errors } = await open({ w: 1280, h: 800 });
  const ns = page.getByRole('button', { name: '音なしで始める' });
  if (await ns.isVisible().catch(() => false)) await ns.click();
  await page.getByRole('button', { name: '組み方の見本' }).click();
  await page.getByRole('button', { name: /井桁型/ }).click();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '火を灯す' }).click();
  await page.waitForFunction(() => window.__gyarubi.sim.phase === 'burning', null, { timeout: 30000 });
  // 薪を足さずに、炎が消えるまで
  for (let i = 0; i < 120; i++) {
    const st = await g(page, () => ({ f: window.__gyarubi.sim.metrics.flamingSegs, t: window.__gyarubi.sim.session.activeTime }));
    if (st.t > 120 && st.f === 0) break;
    await g(page, () => window.__gyarubi.advance(5));
  }
  await page.waitForTimeout(300);
  const s1 = await page.locator('.status-note').textContent().catch(() => '');
  check('炎が消えて熾が残っているとき：「赤い熾が残っています」と、薪を足すボタン', /赤い熾が残っています/.test(s1 ?? '') && (await page.getByRole('button', { name: '乾いた薪を足す' }).isVisible()), s1 ?? '');
  // 熾のいちばん赤い所へ置く（画面では、プレイヤーが場所を選ぶ）
  const placedOk = await g(page, () => {
    const sim = window.__gyarubi.sim;
    const nb = Math.round(Math.sqrt(sim.bedCoal.length));
    const cell = 0.58 / nb;
    let bi = 0;
    for (let i = 0; i < sim.bedCoal.length; i++) if (sim.bedCoal[i] > sim.bedCoal[bi]) bi = i;
    return window.__gyarubi.addLog({ x: -0.29 + ((bi % nb) + 0.5) * cell, z: -0.29 + (Math.floor(bi / nb) + 0.5) * cell });
  });
  await g(page, () => window.__gyarubi.advance(3));
  await page.waitForTimeout(300);
  const s2 = await page.locator('.status-note').textContent().catch(() => '');
  const windBtn = page.getByRole('button', { name: '風を送る', exact: true });
  check('熾の上に薪を置いたら：「熾の上の薪へ、風を少し送ろう」と、風を送るボタン', placedOk && /熾の上の薪へ/.test(s2 ?? '') && (await windBtn.isVisible()), s2 ?? '');
  await windBtn.click();
  const dock = await g(page, () => window.__gyarubi.controller.debugState.dock);
  let lit = false;
  for (let i = 0; i < 20 && !lit; i++) {
    await page.getByRole('button', { name: '風を一度送る' }).click();
    await g(page, () => window.__gyarubi.advance(4));
    lit = await g(page, () => window.__gyarubi.sim.pieces[window.__gyarubi.sim.pieces.length - 1].state === 'flaming');
  }
  check('案内どおり熾に風を送ると、置いた薪に火が移る', dock === 'wind' && lit);
  check('ページエラーなし（熾から戻す）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ───────────── 3. 自然な燃料切れ（20分）：熾火の時間へ入り、自然に見送る
{
  const { ctx, page, errors } = await open({ w: 1280, h: 800 });
  const ns = page.getByRole('button', { name: '音なしで始める' });
  if (await ns.isVisible().catch(() => false)) await ns.click();
  await g(page, () => window.__gyarubi.controller.setMode('long'));
  await page.getByRole('button', { name: '組み方の見本' }).click();
  await page.getByRole('button', { name: /井桁型/ }).click();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '火を灯す' }).click();
  await page.waitForFunction(() => window.__gyarubi.sim.phase === 'burning', null, { timeout: 30000 });
  for (let i = 0; i < 200; i++) {
    if (await g(page, () => window.__gyarubi.sim.session.emberPhase)) break;
    await g(page, () => window.__gyarubi.advance(5));
  }
  await page.waitForTimeout(300);
  const st = await g(page, () => ({ spent: window.__gyarubi.sim.session.fuelSpent, at: window.__gyarubi.sim.session.activeTime, end: window.__gyarubi.sim.endTime, dock: window.__gyarubi.controller.debugState.dock }));
  const t = await toasts(page);
  check('薪を足さずに燃え尽きた（20分）：途中で熾火の時間へ入り、知らせる', st.spent && st.at < 1200 * 0.82 && st.dock === 'ember' && /火が小さくなりました/.test(t), `${st.at.toFixed(0)}秒 → 終わり ${st.end.toFixed(0)}秒 / ${t}`);
  const menuTime = await g(page, () => window.__gyarubi.controller.getSnapshot().session.duration);
  check('残り時間は、熾火の長さ（20分の18%）で終わる。延長しない', Math.abs(menuTime - (st.at + 1200 * 0.18)) < 6 && menuTime <= 1200, `${menuTime.toFixed(0)}秒`);
  for (let i = 0; i < 80; i++) {
    if (await g(page, () => window.__gyarubi.controller.sess.ended)) break;
    await g(page, () => window.__gyarubi.advance(10));
  }
  await page.waitForSelector('.memory-page', { timeout: 30000 });
  const how = await g(page, () => window.__gyarubi.controller.getSnapshot().memory?.data.howRaised ?? '');
  check('燃料切れの回も、自然な見送りとして思い出へ（責めない）', (await g(page, () => window.__gyarubi.controller.sess.endReason)) === 'natural' && /小さくなるまで/.test(how), how);
  check('ページエラーなし（燃料切れ）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ───────────── 4. 思い出の画像を作れない端末：記録と文章は残せる
{
  const { ctx, page, errors } = await open({ w: 1280, h: 800 }, () => {
    // 思い出カード（1080×1350）の画像化だけ失敗させる
    const orig = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) {
      if (this.width === 1080 && this.height === 1350) return void setTimeout(() => cb(null), 10);
      return orig.call(this, cb, ...rest);
    };
  });
  const ns = page.getByRole('button', { name: '音なしで始める' });
  if (await ns.isVisible().catch(() => false)) await ns.click();
  await page.getByRole('button', { name: '組み方の見本' }).click();
  await page.getByRole('button', { name: /ゆったり型/ }).click();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '火を灯す' }).click();
  await page.waitForFunction(() => window.__gyarubi.sim.phase === 'burning', null, { timeout: 30000 });
  for (let i = 0; i < 60; i++) {
    if (await g(page, () => window.__gyarubi.sim.stage0Done)) break;
    await g(page, () => window.__gyarubi.advance(5));
  }
  await page.getByRole('button', { name: '一時停止' }).click();
  await page.getByRole('button', { name: '今日はここまで' }).click();
  await page.getByRole('button', { name: '火を見送る' }).click();
  await g(page, () => window.__gyarubi.advance(16));
  await page.waitForSelector('.memory-page', { timeout: 30000 });
  // 思い出の写真がまだない回（早めに休ませた）：今の画面を高い解像度で撮る。CPU描画では時間がかかる
  await page.waitForFunction(() => window.__gyarubi.controller.getSnapshot().memory && !window.__gyarubi.controller.getSnapshot().memory.busy, null, { timeout: 180000 });
  const fig = await page.locator('.memory-card').textContent();
  const saveBtn = page.getByRole('button', { name: '思い出を残す' });
  check('画像を作れないとき：その旨を出し、残すボタンは押せる（止まったままにしない）', /画像を作れませんでした/.test(fig ?? '') && (await saveBtn.isEnabled()), fig ?? '');
  await saveBtn.click();
  await page.waitForTimeout(400);
  const album = await g(page, () => JSON.parse(localStorage.getItem('gyarubi.album') ?? '{"entries":[]}').entries.length);
  const t = await toasts(page);
  check('画像なしでも、思い出の記録はアルバムへ残る', album === 1 && /記録だけ/.test(t), t);
  await page.getByRole('button', { name: '文章をコピー' }).click();
  await page.waitForTimeout(400);
  const clip = await g(page, () => navigator.clipboard.readText().catch(() => ''));
  check('画像なしでも、文章はコピーできる', clip.length > 10, clip.slice(0, 40));
  check('ページエラーなし（画像を作れない）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ───────────── 5. 横向きの短い画面（スマホの横向き・PCの200%拡大）：火が道具箱に隠れない
for (const vp of [
  { w: 844, h: 390, mobile: true, name: 'スマホ横向き 844×390' },
  { w: 720, h: 450, mobile: false, name: 'PCの200%拡大 720×450' },
]) {
  const { ctx, page, errors } = await open(vp);
  const ns = page.getByRole('button', { name: '音なしで始める' });
  if (await ns.isVisible().catch(() => false)) await ns.click();
  await page.getByRole('button', { name: '組み方の見本' }).click();
  await page.getByRole('button', { name: /井桁型/ }).click();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '火を灯す' }).click();
  await page.waitForFunction(() => window.__gyarubi.sim.phase === 'burning', null, { timeout: 30000 });
  for (let i = 0; i < 60; i++) {
    if (await g(page, () => window.__gyarubi.sim.stage0Done)) break;
    await g(page, () => window.__gyarubi.advance(5));
  }
  await page.waitForTimeout(800);
  const box = async (sel) => page.locator(sel).first().boundingBox();
  const fire = await g(page, () => window.__gyarubi.controller.scene.project([0, 0.12, 0]));
  const dock = await box('.dock');
  const inView = (b) => b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.w + 0.5 && b.y + b.height <= vp.h + 0.5;
  check(
    `${vp.name}：火は道具箱の左に見え、道具箱は画面に収まる`,
    fire.x > 0 && fire.y > 0 && fire.y < vp.h && dock && fire.x < dock.x - 20 && inView(dock),
    `火 (${Math.round(fire.x)},${Math.round(fire.y)}) 道具箱 x=${Math.round(dock?.x)}`,
  );
  await page.getByRole('button', { name: '薪', exact: true }).click();
  await page.getByRole('button', { name: /^なら/ }).click();
  await page.waitForTimeout(300);
  const btns = [];
  for (const name of ['置く', 'やめる', '前の置き位置の候補（[）', '次の置き位置の候補（]）', '左へ回す（Q）', '右へ回す（E）']) {
    const b = await page.getByRole('button', { name, exact: true }).boundingBox();
    btns.push({ name, ok: inView(b) && b.width >= 47.5 && b.height >= 47.5 });
  }
  check(`${vp.name}：置く位置・回転・置く・やめるのボタンが画面内で、48px以上`, btns.every((b) => b.ok), btns.filter((b) => !b.ok).map((b) => b.name).join('・') || 'すべてOK');
  await page.getByRole('button', { name: 'やめる', exact: true }).click();
  for (let i = 0; i < 80; i++) {
    if (await g(page, () => window.__gyarubi.controller.sess.ended)) break;
    await g(page, () => window.__gyarubi.advance(10));
  }
  await page.waitForSelector('.memory-card img', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
  const card = await box('.memory-card');
  const title = await box('#memory-title');
  check(`${vp.name}：思い出はカードと文章を左右に並べ、カードは画面の高さに収まる`, card && title && card.x + card.width <= title.x && card.y + card.height <= vp.h + 1, `カード ${Math.round(card?.width)}×${Math.round(card?.height)}`);
  check(`ページエラーなし（${vp.name}）`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
