// 操作の確認（ヘッドレスChromium）：タップだけの配置・ドラッグ配置・キーボード・停止理由・非表示・保存と再開・一回の焚き火・思い出・写真・WebGL非対応
//   node scripts/functional.mjs [baseUrl]
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
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

async function open(ctxOpts = {}, url = base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, acceptDownloads: true, ...ctxOpts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('.overlay-center'), null, { timeout: 90000 });
  return { ctx, page, errors };
}
const g = (page, fn) => page.evaluate(fn);

// 1. タップだけで置く・着火する（スマホ）
{
  const { ctx, page, errors } = await open();
  await page.getByRole('button', { name: '音ありで始める' }).tap();
  await page.waitForTimeout(300);
  check('音ありで始める（ユーザー操作の後に開始）', await g(page, () => window.__gyarubi.controller.audio.enabled));
  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  // 火口：カード→台の中央をタップ→置く
  await page.getByRole('button', { name: /^火口/ }).tap();
  const tray = await g(page, () => window.__gyarubi.controller.scene.project([0, 0.085, 0]));
  await page.touchscreen.tap(box.x + tray.x, box.y + tray.y);
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '置く', exact: true }).tap();
  await page.waitForTimeout(200);
  check('タップだけで火口を置ける', (await g(page, () => window.__gyarubi.sim.countOf('tinder'))) === 1);
  // 中薪を奥へ、回転してから置く
  await page.getByRole('button', { name: /^中薪/ }).tap();
  const back = await g(page, () => window.__gyarubi.controller.scene.project([0, 0.085, -0.1]));
  await page.touchscreen.tap(box.x + back.x, box.y + back.y);
  await page.getByRole('button', { name: '右へ回す（E）' }).tap();
  await page.getByRole('button', { name: '左へ回す（Q）' }).tap();
  await page.getByRole('button', { name: '置く', exact: true }).tap();
  await page.waitForTimeout(200);
  check('タップ→回転→置く で中薪を置ける', (await g(page, () => window.__gyarubi.sim.countOf('medium'))) === 1);
  // 細薪を候補位置から（〈〉ボタン）
  await page.getByRole('button', { name: /^細薪/ }).tap();
  await page.getByRole('button', { name: /次の置き位置の候補/ }).tap();
  await page.getByRole('button', { name: '置く', exact: true }).tap();
  await page.getByRole('button', { name: /^細薪/ }).tap();
  await page.getByRole('button', { name: /次の置き位置の候補/ }).tap();
  await page.getByRole('button', { name: /次の置き位置の候補/ }).tap();
  await page.getByRole('button', { name: '置く', exact: true }).tap();
  const kc = await g(page, () => window.__gyarubi.sim.countOf('kindling'));
  check('候補ボタンだけで細薪を置ける', kc >= 1, `細薪 ${kc}本`);
  const supports = await g(page, () => window.__gyarubi.sim.pieces.filter((p) => p.kind === 'kindling').map((p) => p.supports.map((s) => s.by).join(',')));
  check('置いた細薪に支持点がある', supports.every((s) => s.length > 0), supports.join(' / '));
  await page.getByRole('button', { name: '火を灯す' }).tap();
  await page.waitForTimeout(4000);
  const st = await g(page, () => ({ phase: window.__gyarubi.sim.phase, tinder: window.__gyarubi.sim.pieces.find((p) => p.kind === 'tinder').state }));
  check('タップだけで着火できる（実時間4秒）', st.phase === 'burning' && st.tinder === 'flaming', JSON.stringify(st));

  // 2. 停止理由の集合
  await page.getByRole('button', { name: 'メニュー' }).tap();
  await page.getByRole('button', { name: '設定' }).tap();
  await page.waitForTimeout(300);
  const t0 = await g(page, () => window.__gyarubi.sim.time);
  await page.waitForTimeout(1500);
  const t1 = await g(page, () => window.__gyarubi.sim.time);
  const reasons = await g(page, () => window.__gyarubi.controller.debugState.clock);
  check('設定・メニューを開くとゲーム時間が止まる', Math.abs(t1 - t0) < 0.05, `Δ${(t1 - t0).toFixed(2)}s 理由=${reasons.join(',')}`);
  // 設定を開いたまま、画面を非表示にする
  await g(page, () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  const r2 = await g(page, () => window.__gyarubi.controller.debugState.clock);
  check('非表示で停止理由が重なる（設定＋非表示＋ひと休み）', ['settings', 'hidden', 'user'].every((r) => r2.includes(r)), r2.join(','));
  const saved = await g(page, () => !!localStorage.getItem('gyarubi.session'));
  check('非表示になる時に保存する', saved);
  await g(page, () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(600);
  const dlg = await page.getByRole('dialog').textContent().catch(() => '');
  const r3 = await g(page, () => window.__gyarubi.controller.debugState.clock);
  const tA = await g(page, () => window.__gyarubi.sim.time);
  await page.waitForTimeout(1000);
  const tB = await g(page, () => window.__gyarubi.sim.time);
  check('戻っても「続きから」を押すまで止まったまま', /ひと休み中/.test(dlg ?? '') && r3.includes('user') && !r3.includes('hidden') && tB - tA < 0.05, `${r3.join(',')} Δ${(tB - tA).toFixed(2)}s`);
  await page.getByRole('button', { name: '続きから' }).tap();
  await page.waitForTimeout(300);
  const t2 = await g(page, () => window.__gyarubi.sim.time);
  await page.waitForTimeout(1500);
  const t3 = await g(page, () => window.__gyarubi.sim.time);
  check('「続きから」で時間が進む（開いていた設定も閉じる）', t3 - t2 > 0.5, `Δ${(t3 - t2).toFixed(2)}s`);
  // 3. 保存と再開：再読み込み
  await g(page, () => window.__gyarubi.advance(40));
  const before = await g(page, () => ({ n: window.__gyarubi.sim.pieces.length, t: window.__gyarubi.sim.time, active: window.__gyarubi.sim.session.activeTime, fp: window.__gyarubi.sim.fingerprint() }));
  await g(page, () => window.__gyarubi.controller.persist());
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.overlay-center'), null, { timeout: 90000 });
  const resumeText = await page.getByRole('dialog').textContent().catch(() => '');
  check('再読み込みで「前回の火が残っています」', /前回の火/.test(resumeText ?? ''));
  await page.getByRole('button', { name: '続きから' }).tap();
  await page.waitForTimeout(200);
  const after = await g(page, () => ({ n: window.__gyarubi.sim.pieces.length, t: window.__gyarubi.sim.time, active: window.__gyarubi.sim.session.activeTime, phase: window.__gyarubi.sim.phase }));
  check('保存から薪・残り時間・燃焼状態が戻る', after.n === before.n && Math.abs(after.t - before.t) < 0.6 && after.phase === 'burning', `${JSON.stringify(before.n)}本 t=${before.t.toFixed(1)}→${after.t.toFixed(1)} active=${after.active.toFixed(1)}`);
  // 4. 写真（今の3D画面）
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), g(page, () => window.__gyarubi.controller.takePhoto())]);
  let size = 0;
  if (dl) {
    const p = await dl.path();
    size = (await import('node:fs')).statSync(p).size;
  }
  check('写真：今の3D画面をPNGで保存（共有非対応時）', dl && size > 20000, dl ? `${dl.suggestedFilename()} ${(size / 1024).toFixed(0)}KB` : 'ダウンロードなし');
  check('ページエラーなし（スマホ）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// 5. PC：カードからドラッグして置く・キーボードで置く
{
  const { ctx, page, errors } = await open({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  const noSound = page.getByRole('button', { name: '音なしで始める' });
  if (await noSound.isVisible().catch(() => false)) await noSound.click();
  const box = await page.locator('canvas.scene-canvas').boundingBox();
  const card = await page.getByRole('button', { name: /^中薪/ }).boundingBox();
  const target = await g(page, () => window.__gyarubi.controller.scene.project([0, 0.085, 0.05]));
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(card.x + (box.x + target.x - card.x) * (i / 8), card.y + (box.y + target.y - card.y) * (i / 8));
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const m = await g(page, () => window.__gyarubi.sim.pieces.filter((p) => p.kind === 'medium').map((p) => [p.pose.x.toFixed(2), p.pose.z.toFixed(2)]));
  check('道具箱のカードからドラッグして離すと置ける', m.length === 1, JSON.stringify(m));
  // キーボード：Tabで火口カードへ→Enter→矢印・Q→Enter
  await page.getByRole('button', { name: /^火口/ }).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const focused = await g(page, () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '');
  // 中薪と重なるので、Shift+矢印（3cm）で手前へずらし、Qで回してから「置く」をキーボードで押す
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('q');
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '置く', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('キーボードだけで火口を置ける（選んだあと「置く」へフォーカス）', (await g(page, () => window.__gyarubi.sim.countOf('tinder'))) === 1, `focus=${focused.trim()}`);
  // 見守り：Escapeで戻る
  await g(page, () => window.__gyarubi.controller.setWatch(true));
  await page.waitForTimeout(200);
  const watching = await page.getByRole('button', { name: '操作に戻る' }).isVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const back = await g(page, () => window.__gyarubi.controller.getSnapshot().watching);
  check('見守り：「操作に戻る」が常に出て、Escapeで戻れる', watching && back === false);
  check('ページエラーなし（PC）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// 7. 一回の焚き火：キャラクターを出さない・停止中は進まない・保存と再開・今日はここまで・思い出・名前・保存・シェア
{
  const { ctx, page, errors } = await open({}, base + '?debug=1');
  const noSound = page.getByRole('button', { name: '音なしで始める' });
  if (await noSound.isVisible().catch(() => false)) await noSound.tap();
  check('題は「焚き火と、ひと息。」', (await page.locator('.brand').textContent()) === '焚き火と、ひと息。' && (await page.title()).includes('焚き火と、ひと息。'), await page.title());
  await page.getByRole('button', { name: '組み方の見本' }).tap();
  await page.getByRole('button', { name: /ゆったり型/ }).tap();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '火を灯す' }).tap();
  await page.waitForTimeout(800);
  await g(page, () => window.__gyarubi.advance(120));
  await page.waitForTimeout(400);
  const noChar = await g(page, () => ({
    speech: !!document.querySelector('.speech'),
    chip: !!document.querySelector('.provisional-chip'),
    text: document.body.innerText,
    imgs: [...document.querySelectorAll('img')].map((i) => i.src).filter((s) => /character|komugi|ojibi/.test(s)).length,
    slot: !!window.__gyarubi.controller.scene.characters,
  }));
  check('火が育ってもキャラクター・台詞・仮表示の札を出さない', !noChar.speech && !noChar.chip && !noChar.imgs && !noChar.slot && !/火の精|おじ火|ギャル|こむぎ/.test(noChar.text));
  // 停止中は進まない（手帳）
  await page.getByRole('button', { name: 'メニュー' }).tap();
  const menuTxt = await page.getByRole('dialog').textContent();
  check('メニューに「ひとこと」はない', !/ひとこと/.test(menuTxt ?? ''), menuTxt ?? '');
  await page.getByRole('button', { name: '火の手帳' }).tap();
  const w0 = await g(page, () => window.__gyarubi.controller.sess.stats.windowSeconds);
  await page.waitForTimeout(1500);
  const w1 = await g(page, () => window.__gyarubi.controller.sess.stats.windowSeconds);
  await page.getByRole('tab', { name: '発見' }).tap();
  await page.waitForTimeout(200);
  const tabTxt = await page.getByRole('dialog').textContent();
  check('手帳を開いている間は記録が進まない', w0 === w1, `${w0.toFixed(1)}→${w1.toFixed(1)}`);
  check('手帳：発見は焚き火のことだけ（24件）', /\/ ?24/.test(tabTxt ?? '') && !/火の精|出会った回数|おじ火/.test(tabTxt ?? ''), (tabTxt ?? '').slice(0, 120));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // 眺める
  await page.getByRole('button', { name: 'しばらく、火を眺める' }).tap();
  await page.waitForTimeout(200);
  const watching = await g(page, () => window.__gyarubi.controller.sess.watching);
  await g(page, () => window.__gyarubi.advance(20));
  await page.getByRole('button', { name: '操作に戻る' }).tap();
  check('「しばらく、火を眺める」：眺めた時間を記録する', watching && (await g(page, () => window.__gyarubi.controller.sess.stats.watchSeconds)) >= 19.5);
  // 保存と再開：その回の記録が戻る（比べるため、止めてから保存する。止めずに閉じると、閉じる直前の状態が保存される）
  await g(page, () => window.__gyarubi.advance(20));
  await g(page, () => window.__gyarubi.controller.pauseByUser());
  await page.waitForTimeout(200);
  const before = await g(page, () => ({ fp: window.__gyarubi.controller.sess.fingerprint(), name: window.__gyarubi.controller.sess.fireName, watch: window.__gyarubi.controller.sess.stats.watchSeconds }));
  await g(page, () => window.__gyarubi.controller.persist());
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.overlay-center'), null, { timeout: 90000 });
  await page.getByRole('button', { name: '続きから' }).tap();
  await page.waitForTimeout(300);
  const restored = await g(page, () => ({ fp: window.__gyarubi.controller.sess.fingerprint(), name: window.__gyarubi.controller.sess.fireName, watch: window.__gyarubi.controller.sess.stats.watchSeconds }));
  check('再開：その回の記録（落ち着いた火・眺めた時間・火の名前）が保たれる', restored.fp === before.fp && restored.name === before.name && restored.watch === before.watch, `${before.fp} → ${restored.fp}`);
  // 今日はここまで（15秒の見送り）
  await page.getByRole('button', { name: '一時停止' }).tap();
  await page.getByRole('button', { name: '今日はここまで' }).tap();
  await page.getByRole('button', { name: '火を見送る' }).tap();
  await page.waitForTimeout(300);
  const fw = await page.locator('.dock').textContent();
  check('「今日はここまで」：見送りへ（引き止めない）', /見送って/.test(fw ?? '') && !/まだ|行かないで|残念/.test(fw ?? ''), fw ?? '');
  await g(page, () => window.__gyarubi.advance(16));
  await page.waitForSelector('.memory-card img', { timeout: 30000 });
  const mem = await page.locator('.memory-page').textContent();
  check('思い出：カードを実際の画面から作り、今夜の火の名前・火と過ごした時間・結びの一文を出す', /今夜の火の名前/.test(mem ?? '') && /火と過ごした時間/.test(mem ?? '') && /火は、またいつでも|また別の夜に/.test(mem ?? '') && !/火の精|おじ火/.test(mem ?? ''), (mem ?? '').slice(0, 160));
  const cardSize = await g(page, async () => {
    const img = document.querySelector('.memory-card img');
    const b = await (await fetch(img.src)).blob();
    const bm = await createImageBitmap(b);
    return [bm.width, bm.height, b.size];
  });
  check('思い出カードは1080×1350', cardSize[0] === 1080 && cardSize[1] === 1350, `${cardSize[0]}×${cardSize[1]} ${(cardSize[2] / 1024).toFixed(0)}KB`);
  // 名前：12文字まで、絵文字を途中で切らない、HTMLとして解釈しない
  const input = page.getByLabel('今夜の火の名前');
  await input.fill('<b>ほのか</b>🔥👨‍👩‍👧おやすみなさいませ');
  await page.waitForTimeout(600);
  const nm = await g(page, () => window.__gyarubi.controller.getSnapshot().memory.data.fireName);
  check('名前は12文字まで（合成絵文字を切らない・HTMLにしない）', [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(nm)].length === 12 && nm.includes('<b>') && !(await page.locator('.memory-page b').count()), nm);
  // 思い出を残す：アルバム＋画像
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.getByRole('button', { name: '思い出を残す' }).tap()]);
  await page.waitForTimeout(400);
  const albumE = await g(page, () => JSON.parse(localStorage.getItem('gyarubi.album') ?? '{"entries":[]}').entries);
  check('「思い出を残す」：アルバムへ記録し、画像を保存', albumE.length === 1 && albumE[0].characterId === null && !!dl && /^takibi-memory/.test(dl.suggestedFilename()), dl ? dl.suggestedFilename() : 'ダウンロードなし');
  // シェアの文とキャンセル
  let shared = null;
  await page.exposeFunction('__shared', (t) => (shared = t));
  await g(page, () => {
    navigator.canShare = () => true;
    navigator.share = (d) => {
      window.__shared(d.text ?? '');
      return Promise.reject(new DOMException('cancel', 'AbortError'));
    };
  });
  const toastsBefore = await page.locator('.toast').count();
  await g(page, () => window.__gyarubi.controller.shareMemory());
  await page.waitForTimeout(500);
  const toastTxt = (await page.locator('.toast').allTextContents()).join(' ');
  check('シェアのキャンセルで、成功やエラーの通知を出さない', !/できません|失敗|保存しました/.test(toastTxt.split(' ').slice(toastsBefore).join(' ')), toastTxt);
  check('シェアの文：題のハッシュタグと火の名前', !!shared && /#焚き火とひと息/.test(shared) && !/ギャル/.test(shared), shared ?? '');
  // 新しい火
  await page.getByRole('button', { name: '新しい火をつくる' }).tap();
  await page.waitForTimeout(300);
  const fresh = await g(page, () => ({ n: window.__gyarubi.sim.pieces.length, dock: window.__gyarubi.controller.debugState.dock, ended: window.__gyarubi.controller.sess.ended }));
  check('思い出から新しい火へ（空の台）', fresh.n === 0 && fresh.dock === 'prepare' && !fresh.ended);
  check('ページエラーなし（一回の焚き火・スマホ）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// 8. 強すぎる火：案内（火が強すぎるかも）と次の操作（薪を整える）。キャラクターには変わらない
{
  const { ctx, page, errors } = await open({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false }, base + '?debug=1');
  const noSound = page.getByRole('button', { name: '音なしで始める' });
  if (await noSound.isVisible().catch(() => false)) await noSound.click();
  await page.getByRole('button', { name: '組み方の見本' }).click();
  await page.getByRole('button', { name: /井桁型/ }).click();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '火を灯す' }).click();
  await g(page, () => window.__gyarubi.advance(90));
  await g(page, () => { window.__gyarubi.addLog(); window.__gyarubi.addLog(); });
  let sawHint = false;
  let sawAction = false;
  let note = '';
  for (let i = 0; i < 60; i++) {
    await g(page, () => { const c = window.__gyarubi.controller; c.setWindLevel(2); c.gust(); window.__gyarubi.advance(3.2); });
    if (await g(page, () => window.__gyarubi.sim.metrics.heat > 88)) break;
  }
  // 風を止めると、「風、ひと休み」の案内の次に、強すぎる火の案内が出る
  for (let i = 0; i < 12 && !sawHint; i++) {
    await g(page, () => window.__gyarubi.advance(1));
    await page.waitForTimeout(250);
    note = (await page.locator('.status-note').textContent().catch(() => '')) ?? '';
    sawHint = /火が強すぎる/.test(note);
    sawAction = await page.getByRole('button', { name: '薪を整える' }).isVisible().catch(() => false);
  }
  check('強すぎる火：案内と次の操作（薪を整える）を出す', sawHint && sawAction, note);
  await g(page, () => window.__gyarubi.advance(20));
  check('強い火が続いても、キャラクターや台詞は出ない', !(await page.locator('.speech').count()) && !/おじ火/.test(await page.locator('main').innerText()));
  check('ページエラーなし（強い火・PC）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// 10. 読めないアルバムは消さずに退避する
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('gyarubi.album', '{"entries":[{"broken":true}]');
      sessionStorage.setItem('seeded', '1');
    }
  });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector('.overlay-center'), null, { timeout: 90000 });
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({ keys: Object.keys(localStorage).filter((k) => k.startsWith('gyarubi.album')), toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' ') }));
  check('読めないアルバムは消さずに退避し、案内する', st.keys.some((k) => k.startsWith('gyarubi.album.broken.')) && /アルバム/.test(st.toast), `${st.keys.join(',')} ${st.toast}`);
  await ctx.close();
}

// 6. WebGL非対応
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return orig.call(this, type, ...a);
    };
  });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForTimeout(1500);
  const txt = await page.getByRole('alert').textContent().catch(() => '');
  check('WebGL非対応：案内を出し、真っ黒にしない', /3D表示を開始できません/.test(txt ?? ''));
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
