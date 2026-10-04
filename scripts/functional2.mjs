// 第2段階の操作確認（ヘッドレスChromium）：場所・焚き火台・時間の選択、解放、発見の通知、手帳（発見24件）、
// 前の版の記録の引き継ぎ（キャラクターの課題を外しても解放は残る）、今回の組合せでもう一度、記録の書き出し・読み込み、壊れた記録ファイル
//   node scripts/functional2.mjs [baseUrl]
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
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

async function open(ctxOpts = {}, url = base, ctxIn = null) {
  const ctx = ctxIn ?? (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, acceptDownloads: true, ...ctxOpts }));
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
const g = (page, fn, arg) => page.evaluate(fn, arg);
const toasts = (page) => page.locator('.toast').allTextContents().then((a) => a.join(' / '));

// 1. はじめて：場所・焚き火台・時間、発見の通知、手帳（発見24件）
{
  const { ctx, page, errors } = await open({}, base + '?debug=1');
  const woods0 = await g(page, () => window.__gyarubi.controller.ui?.progress?.woods ?? null);
  await page.getByRole('button', { name: /場所・焚き火台・時間/ }).tap();
  const dlg = page.locator('dialog[open]');
  const locked = await dlg.getByRole('button', { name: /海辺/ }).isDisabled();
  const lockTxt = await dlg.getByRole('button', { name: /海辺/ }).textContent();
  check('場所：はじめは湖畔と夜の森。ほかは「発見N件で」と鍵つき', locked && /発見2件で/.test(lockTxt ?? ''), lockTxt ?? '');
  await dlg.getByRole('button', { name: /夜の森/ }).tap();
  await dlg.getByRole('button', { name: 'ゆっくり 20分' }).tap();
  const st = await g(page, () => ({ place: window.__gyarubi.controller.scene.placeId, dur: window.__gyarubi.sim.session.durationSeconds, hud: document.querySelector('.hud')?.textContent ?? '' }));
  check('夜の森を選ぶと遠景・地面・音が変わり、見出しに出る', st.place === 'forest' && /夜の森/.test(st.hud), `${st.place} ${st.hud.slice(0, 40)}`);
  check('ゆっくり20分：火を灯す前に切り替えられる', st.dur === 1200, `${st.dur}秒`);
  await dlg.getByRole('button', { name: 'ひと息 10分' }).tap();
  await dlg.getByRole('button', { name: '閉じる' }).tap().catch(async () => page.keyboard.press('Escape'));
  await page.waitForTimeout(200);
  // 薪の候補は4種
  await page.getByRole('button', { name: '組み方の見本' }).tap();
  await page.getByRole('button', { name: /ゆったり型/ }).tap();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '火を灯す' }).tap();
  let t1 = '';
  for (let i = 0; i < 40 && !/新しい発見/.test(t1); i++) {
    await page.waitForTimeout(250);
    t1 += ' ' + (await toasts(page));
  }
  check('はじめて火を灯すと「新しい発見」を知らせる（1/24）', /新しい発見：はじめて火を灯す（1\/24）/.test(t1), t1);
  // 灯した後は場所・時間を変えられない
  await page.getByRole('button', { name: 'メニュー' }).tap();
  await page.getByRole('button', { name: '場所・焚き火台・装飾' }).tap();
  const lockedAfter = await page.locator('dialog[open]').getByRole('button', { name: 'ゆっくり 20分' }).isDisabled();
  check('火を灯した後は、場所・焚き火台・時間は変えられない（装飾は変えられる）', lockedAfter);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // 手帳
  await g(page, () => window.__gyarubi.controller.openDialog('journal'));
  await page.getByRole('tab', { name: '発見' }).tap();
  const tasks = await page.locator('.task-list li').count();
  const waiting = await page.locator('.task-list li.waiting').count();
  const tl = await page.locator('.task-list').textContent();
  check('手帳「発見」：24件。「準備中」の課題はない', tasks === 24 && waiting === 0, `${tasks}件・準備中${waiting}件`);
  const tabs = await page.getByRole('tab').allTextContents();
  check('手帳：火の精の図鑑はない（タブは 今の火・記録・発見・思い出）', tabs.join('・') === '今の火・記録・発見・思い出' && !/会う|おじ火|火の精/.test(tl ?? ''), tabs.join('・'));
  await page.keyboard.press('Escape');
  check('ページエラーなし（はじめて）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// 2. 前の版の記録（発見9件のうち3件はキャラクターの課題）：課題は外しても、薪12種・場所6種・焚き火台（9件で石）の解放は残る／今回の組合せでもう一度
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true });
  const seed = {
    schemaVersion: 1,
    tasks: Object.fromEntries(['t01', 't02', 't11', 't14', 't15', 't17', 't18', 't21', 't22'].map((t) => [t, '2026-09-20T10:00:00.000Z'])),
    met: { komugi: { firstAt: '2026-09-20T10:00:00.000Z', count: 2, reason: '穏やかな火を、安定して育てた' } },
    woodsUsed: ['nara', 'shirakaba'],
    memoryPlaces: ['lakeside'],
  };
  await ctx.addInitScript((s) => {
    if (!localStorage.getItem('gyarubi.progress')) localStorage.setItem('gyarubi.progress', s);
  }, JSON.stringify(seed));
  const { page, errors } = await open({}, base + '?debug=1', ctx);
  await page.getByRole('button', { name: /場所・焚き火台・時間/ }).click();
  const dlg = page.locator('dialog[open]');
  const placesOpen = await dlg.locator('[aria-label="場所"] button:not([disabled])').count();
  const traysOpen = await dlg.locator('[aria-label="焚き火台"] button:not([disabled])').count();
  check('前の版の発見9件：場所6種・焚き火台（はじめの台＋黒鉄・銅・陶器・石）が選べるまま', placesOpen === 6 && traysOpen === 5, `場所${placesOpen} 台${traysOpen}`);
  const migrated = await g(page, () => window.__gyarubi.controller.progress);
  check('前の版の記録：キャラクターの課題（t02・t11・t22）は外し、解放の数（9）を残す', Object.keys(migrated.tasks).sort().join() === 't01,t14,t15,t17,t18,t21' && migrated.unlockFloor === 9, JSON.stringify(migrated).slice(0, 160));
  await dlg.getByRole('button', { name: /雪の山小屋/ }).click();
  await dlg.getByRole('button', { name: /^石/ }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // 組み方の見本→着火
  await page.getByRole('button', { name: '組み方の見本' }).click();
  await page.getByRole('button', { name: /井桁型/ }).click();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  const lay = await g(page, () => {
    const c = window.__gyarubi.controller;
    c.setMode('long');
    const a = c.sess.stats.layoutId;
    c.setMode('short');
    return [a, c.sess.stats.layoutId, window.__gyarubi.sim.session.durationSeconds];
  });
  check('組んだ後に時間を切り替えても、組み方の記録（井桁型）は残る', lay[0] === 'igeta' && lay[1] === 'igeta' && lay[2] === 600, JSON.stringify(lay));
  const beforeIgn = await g(page, () => window.__gyarubi.sim.pieces.map((p) => [p.kind, p.species, +p.pose.x.toFixed(3), +p.pose.z.toFixed(3)]).join('|'));
  await page.getByRole('button', { name: '火を灯す' }).click();
  await page.waitForTimeout(500);
  await g(page, () => window.__gyarubi.controller.openWood());
  await page.waitForTimeout(300);
  const woodNames = await page.locator('.wood-grid .wood-card strong').allTextContents();
  check('発見9件：薪は12種から選べる', ['なら', 'くぬぎ', 'しらかば', 'さくら', 'りんご', 'かえで', 'けやき', 'ぶな', 'すぎ', 'ひのき', 'まつ', 'しめり木'].every((w) => woodNames.includes(w)), woodNames.join('・'));
  await page.keyboard.press('Escape');
  const seed1 = await g(page, () => ({ sim: window.__gyarubi.sim.seed, sessSeed: window.__gyarubi.controller.sess.seed, place: window.__gyarubi.controller.scene.placeId, tray: window.__gyarubi.controller.sessionTray }));
  await g(page, () => window.__gyarubi.advance(640));
  await page.waitForSelector('.memory-page', { timeout: 60000 });
  const lockedAtEnd = await g(page, () => {
    const c = window.__gyarubi.controller;
    const before = c.sessionPlace;
    c.setPlace('beach');
    return [c.outfitLocked, c.sessionPlace === before];
  });
  check('見送った後も、その回の場所は変えられない（思い出の場所がずれない）', lockedAtEnd[0] && lockedAtEnd[1], JSON.stringify(lockedAtEnd));
  const replayBtn = page.getByRole('button', { name: '今回の組合せでもう一度' });
  check('思い出の画面に「今回の組合せでもう一度」', await replayBtn.isVisible());
  const toastEnd = await toasts(page);
  await replayBtn.click();
  await page.waitForTimeout(800);
  const after = await g(page, () => ({
    pieces: window.__gyarubi.sim.pieces.map((p) => [p.kind, p.species, +p.pose.x.toFixed(3), +p.pose.z.toFixed(3)]).join('|'),
    ign: window.__gyarubi.sim.ignitedAt,
    sim: window.__gyarubi.sim.seed,
    sessSeed: window.__gyarubi.controller.sess.seed,
    name: window.__gyarubi.controller.sess.fireName,
    place: window.__gyarubi.controller.scene.placeId,
    dock: document.querySelector('.dock')?.textContent ?? '',
  }));
  check('もう一度：薪の構成・場所・焚き火台・乱数seedを再利用し、火を灯す前から', after.pieces === beforeIgn && after.ign === null && after.sim === seed1.sim && after.place === 'cabin', `${after.place} seed ${after.sim === seed1.sim}`);
  check('もう一度：その回の記録は新しく始める（思い出のIDが前の回と重ならない）', after.sessSeed !== seed1.sessSeed && after.sessSeed !== after.sim, `${seed1.sessSeed} → ${after.sessSeed}`);
  check('井桁型で最後まで見送ると発見（t18は達成済み→重複して数えない）', !/井桁型で最後まで見送る（/.test(toastEnd), toastEnd.slice(0, 120));
  check('ページエラーなし（解放・もう一度）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// 3. 記録の書き出し→別の端末（空のブラウザ）で読み込み→足し合わせ／壊れたファイル
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true });
  const album = [
    {
      id: 'rec-1',
      savedAt: '2026-09-20T10:00:00.000Z',
      dateLabel: '2026.09.20',
      fireName: 'こはく',
      characterId: 'komugi',
      characterLabel: 'まったりギャル・こむぎ',
      stageName: 'まったりギャル',
      woods: 'なら × しらかば',
      place: '森の湖畔',
      layout: 'ゆったり型',
      howRaised: 'そっと見守って、最後まで。',
      lastLine: '今日はここまで。また火、つけよ。',
      minutes: '10分',
      reason: 'natural',
      mood: 'まったり気分',
      favorite: true,
      provisional: true,
    },
  ];
  const prog = { schemaVersion: 1, tasks: { t01: '2026-09-20T10:00:00.000Z', t02: '2026-09-20T10:05:00.000Z', t17: '2026-09-20T10:10:00.000Z' }, met: { komugi: { firstAt: '2026-09-20T10:05:00.000Z', count: 1, reason: '穏やかな火を、安定して育てた' } }, woodsUsed: ['nara', 'shirakaba'], memoryPlaces: ['lakeside'] };
  await ctx.addInitScript(
    ([a, p]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('gyarubi.album', JSON.stringify({ schemaVersion: 1, entries: a }));
        localStorage.setItem('gyarubi.progress', JSON.stringify(p));
        sessionStorage.setItem('seeded', '1');
      }
    },
    [album, prog],
  );
  const { page, errors } = await open({}, base + '?debug=1', ctx);
  await g(page, () => window.__gyarubi.controller.openDialog('settings'));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.getByRole('button', { name: '記録を書き出す' }).click()]);
  let file = null;
  if (dl) {
    const path = await dl.path();
    file = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync('/tmp/gyarubi-record-test.json', JSON.stringify(file));
  }
  check('記録を書き出す：発見とアルバムを1つのJSONファイルに（前の版のキャラクターの課題は外し、解放の数は残す）', !!file && file.format === 'gyarubi-record' && file.album.length === 1 && Object.keys(file.progress.tasks).sort().join() === 't01,t17' && file.progress.unlockFloor === 3 && /^takibi-record/.test(dl.suggestedFilename()), dl ? `${dl.suggestedFilename()} ${JSON.stringify(file?.progress?.tasks)}` : 'ダウンロードなし');
  await ctx.close();

  // 別の端末：すでに自分の発見が1件ある
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx2.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('gyarubi.progress', JSON.stringify({ schemaVersion: 1, tasks: { t14: '2026-09-25T10:00:00.000Z' }, met: {}, woodsUsed: ['kunugi'], memoryPlaces: [] }));
      sessionStorage.setItem('seeded', '1');
    }
  });
  const o2 = await open({}, base + '?debug=1', ctx2);
  await g(o2.page, () => window.__gyarubi.controller.openDialog('settings'));
  // 壊れたファイル：何も変えない
  writeFileSync('/tmp/gyarubi-record-broken.json', '{"format":"gyarubi-record","version":1,"progress":{"schemaVersion":1,"tasks":{"t99":"x"}},"album":[]}');
  await o2.page.locator('input[type=file]').setInputFiles('/tmp/gyarubi-record-broken.json');
  await o2.page.waitForTimeout(800);
  const brokenNote = await o2.page.locator('dialog[open] [role=status]').textContent().catch(() => '');
  const still = await g(o2.page, () => JSON.parse(localStorage.getItem('gyarubi.progress')).tasks);
  check('壊れた記録ファイル：理由を出し、今の記録は変えない', /壊れて/.test(brokenNote ?? '') && Object.keys(still).join() === 't14', brokenNote ?? '');
  if (file) {
    await o2.page.locator('input[type=file]').setInputFiles('/tmp/gyarubi-record-test.json');
    await o2.page.waitForTimeout(1500);
    const note = await o2.page.locator('dialog[open] [role=status]').textContent().catch(() => '');
    const merged = await g(o2.page, () => ({ tasks: Object.keys(JSON.parse(localStorage.getItem('gyarubi.progress')).tasks).sort().join(), album: JSON.parse(localStorage.getItem('gyarubi.album')).entries.map((e) => `${e.id}:${e.favorite}`).join() }));
    check('記録を読み込む：今の記録に足し合わせる（消さない）。お気に入りも引き継ぐ。前の版の思い出も読める', merged.tasks === 't01,t14,t17' && merged.album === 'rec-1:true', `${merged.tasks} / ${merged.album} / ${note}`);
    // 同じファイルをもう一度：増えない
    await o2.page.locator('input[type=file]').setInputFiles('/tmp/gyarubi-record-test.json');
    await o2.page.waitForTimeout(1200);
    const note2 = await o2.page.locator('dialog[open] [role=status]').textContent().catch(() => '');
    const again = await g(o2.page, () => JSON.parse(localStorage.getItem('gyarubi.album')).entries.length);
    check('同じ記録をもう一度読んでも、思い出は増えない', again === 1 && /\+0件/.test(note2 ?? ''), note2 ?? '');
  }
  check('ページエラーなし（記録）', o2.errors.length === 0, o2.errors.slice(0, 3).join(' | '));
  await ctx2.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
