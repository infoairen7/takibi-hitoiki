// BGM（自作・その場で合成）の確認（ヘッドレスChromium）
//  1. 音を書き出して（OfflineAudioContext）はかる：立ち上がりがなめらか・割れない・急に大きくならない・見送りで静かに終わる
//  2. 遊んでいる画面で、焚き火の音とBGMの大きさをくらべる（BGMは焚き火より小さい）・設定で止められる
//   node scripts/audio-check.mjs [baseUrl]
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/home/claude/.npm-global/lib/node_modules/playwright');
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-∞');

// ───────────── 1. 書き出してはかる
{
  const bundle = await build({ entryPoints: [join(root, 'src/audio/music.ts')], bundle: true, write: false, format: 'iife', globalName: 'Music', target: 'es2022' });
  const page = await (await browser.newContext()).newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const res = await page.evaluate(async () => {
    const { AmbientMusic } = window.Music;
    // 再現できる乱数
    const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const out = [];
    for (const place of ['lakeside', 'forest', 'beach', 'pavilion', 'cabin', 'rooftop']) {
      const sr = 22050;
      const seconds = 60;
      const ctx = new OfflineAudioContext(2, sr * seconds, sr);
      const m = new AmbientMusic(ctx, ctx.destination, rng(7));
      m.setMood({ place, phase: 'burning', paused: false });
      m.setVolume(0.4);
      // 0.25秒ごとに予約（画面の毎フレームの代わり）。38秒で見送り
      for (let t = 0; t < seconds; t += 0.25) {
        ctx.suspend(t).then(() => {
          if (Math.abs(t - 38) < 0.01) m.setMood({ place, phase: 'farewell', paused: false });
          if (Math.abs(t - 50) < 0.01) m.setMood({ place, phase: 'ended', paused: false });
          m.update();
          ctx.resume();
        });
      }
      const buf = await ctx.startRendering();
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      const win = Math.round(sr * 0.25);
      const rms = [];
      let peak = 0;
      for (let i = 0; i + win <= L.length; i += win) {
        let s = 0;
        for (let j = i; j < i + win; j++) {
          s += (L[j] * L[j] + R[j] * R[j]) / 2;
          peak = Math.max(peak, Math.abs(L[j]), Math.abs(R[j]));
        }
        rms.push(Math.sqrt(s / win));
      }
      let first = 0;
      for (let j = 0; j < sr * 0.1; j++) first = Math.max(first, Math.abs(L[j]), Math.abs(R[j]));
      // 鳴っている間（5〜38秒）の平均の大きさと、となりの0.25秒との差の最大（急に大きくならないか）
      const body = rms.slice(20, 152);
      const mean = Math.sqrt(body.reduce((a, b) => a + b * b, 0) / body.length);
      let jump = 0;
      for (let i = 21; i < 152; i++) if (rms[i - 1] > 1e-4) jump = Math.max(jump, rms[i] / rms[i - 1]);
      const tail = Math.max(...rms.slice(-12)); // 57〜60秒（見送りの和音の後）
      out.push({ place, mean, peak, first, jump, tail, stats: m.stats });
    }
    return out;
  });
  for (const r of res) {
    const name = r.place;
    check(
      `BGM ${name}：小さめ（-46〜-26dB）・割れない・急に大きくならない`,
      r.mean > 0.005 && r.mean < 0.05 && r.peak < 0.35 && r.jump < 4,
      `平均 ${db(r.mean)}dB・最大 ${db(r.peak)}dB・0.25秒ごとの増え方 最大×${r.jump.toFixed(2)}・和音${r.stats.chords}・単音${r.stats.notes}`,
    );
    check(`BGM ${name}：ふわっと始まり、見送りで静かに終わる`, r.first < 0.002 && r.tail < r.mean * 0.1 && r.stats.finales === 1, `始まり0.1秒の最大 ${db(r.first)}dB・終わり ${db(r.tail)}dB`);
  }
  await page.context().close();
}

// ───────────── 2. 遊んでいる画面で：焚き火の音とくらべる・設定で止める
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?debug=1&panel=0');
  await page.waitForFunction(() => !document.querySelector('.overlay-center'), null, { timeout: 90000 });
  await page.getByRole('button', { name: '音ありで始める' }).click();
  await page.getByRole('button', { name: '組み方の見本' }).click();
  await page.getByRole('button', { name: /井桁型/ }).click();
  await page.getByRole('button', { name: '火を灯す' }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '火を灯す' }).click();
  await page.waitForFunction(() => window.__gyarubi.sim.phase === 'burning', null, { timeout: 30000 });
  await page.evaluate(() => window.__gyarubi.advance(150));
  const running = await page.evaluate(() => window.__gyarubi.controller.audio.ctx?.state);
  // 音の出口の手前で大きさをはかる
  await page.evaluate(() => {
    const a = window.__gyarubi.controller.audio;
    const an = a.ctx.createAnalyser();
    an.fftSize = 2048;
    a.master.connect(an);
    window.__an = an;
    // BGMだけの大きさ（BGMの出口。全体の音量をかけてくらべる）
    const am = a.ctx.createAnalyser();
    am.fftSize = 2048;
    a.music.bus.connect(am);
    window.__am = am;
  });
  const measure = (ms, which = '__an') =>
    page.evaluate(async ([ms, which]) => {
      const an = window[which];
      const buf = new Float32Array(an.fftSize);
      let s = 0;
      let n = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        an.getFloatTimeDomainData(buf);
        for (const v of buf) s += v * v;
        n += buf.length;
        await new Promise((r) => setTimeout(r, 40));
      }
      return Math.sqrt(s / n);
    }, [ms, which]);
  await page.evaluate(() => window.__gyarubi.controller.updateSettings({ bgmVolume: 0 }));
  await page.waitForTimeout(4000);
  const fire = await measure(5000);
  await page.evaluate(() => window.__gyarubi.controller.updateSettings({ bgmVolume: 0.4 }));
  await page.waitForTimeout(9000);
  const musicBus = await measure(8000, '__am');
  const masterGain = await page.evaluate(() => window.__gyarubi.controller.audio.master.gain.value);
  const stats1 = await page.evaluate(() => window.__gyarubi.controller.audio.musicStats);
  const music = musicBus * masterGain;
  check(
    '遊んでいる画面：BGMは焚き火の音より小さく（-6〜-18dB）、聞こえる大きさ（はじめの設定）',
    running === 'running' && stats1.chords > 0 && music > fire * 0.125 && music < fire * 0.5,
    `焚き火 ${db(fire)}dB・BGM ${db(music)}dB（差 ${(20 * Math.log10(music / fire)).toFixed(1)}dB）・和音${stats1.chords}・単音${stats1.notes}`,
  );
  // 設定で止める（0）：新しい音を鳴らさない
  await page.getByRole('button', { name: 'メニュー' }).click();
  await page.getByRole('button', { name: '設定' }).click();
  const slider = page.getByLabel(/^BGM/);
  await slider.fill('0');
  await page.waitForTimeout(300);
  const label = await page.locator('label[for=bgmvolume]').textContent();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gyarubi.settings')).bgmVolume);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '続きから' }).click().catch(() => {});
  const s0 = await page.evaluate(() => window.__gyarubi.controller.audio.musicStats);
  await page.waitForTimeout(15000);
  const s1 = await page.evaluate(() => window.__gyarubi.controller.audio.musicStats);
  check('設定の「BGM」をいちばん左にすると止まり、その設定を保存する', saved === 0 && /止めています/.test(label ?? '') && s1.chords === s0.chords && s1.notes === s0.notes, `${label} / 保存 ${saved}`);
  check('ページエラーなし（BGM）', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
