// 公開物の確認：1ファイル版（dist-single/index.html）と公開用（dist-artifact/gyarubi.html）を、
// claude.ai の公開ページと同じように「制限付きの iframe（別オリジン扱い・保存は使えないこともある）」の中で開き、
// エラーなく起動して、最初の画面（音のたずね・道具箱）が出ることを確かめる。公開の前に必ず実行する。
//   node scripts/smoke-publish.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
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
const single = readFileSync(join(root, 'dist-single/index.html'));
// 公開時は doctype・head・body が外側に付く（本文だけを公開する）
const artifact = Buffer.concat([
  Buffer.from('<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'),
  readFileSync(join(root, 'dist-artifact/gyarubi.html')),
  Buffer.from('</body></html>'),
]);
const host = (src, sandbox) =>
  `<!doctype html><html><body style="margin:0"><iframe src="${src}" ${sandbox ? `sandbox="${sandbox}"` : ''} style="width:390px;height:844px;border:0"></iframe></body></html>`;
const pages = {
  '/single.html': single,
  '/artifact.html': artifact,
  '/host-single-strict.html': host('single.html', 'allow-scripts allow-downloads'),
  '/host-artifact-strict.html': host('artifact.html', 'allow-scripts allow-downloads'),
  '/host-artifact-same.html': host('artifact.html', 'allow-scripts allow-same-origin allow-downloads allow-popups'),
};
const server = createServer((req, res) => {
  const body = pages[req.url.split('?')[0]];
  if (!body) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await pw.chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = [];
for (const [name, path] of [
  ['1ファイル版（そのまま開く）', '/single.html'],
  ['公開用（そのまま開く）', '/artifact.html'],
  ['1ファイル版（制限付きiframe・保存なし）', '/host-single-strict.html'],
  ['公開用（制限付きiframe・保存なし）', '/host-artifact-strict.html'],
  ['公開用（iframe・保存あり）', '/host-artifact-same.html'],
]) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 880 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()));
  await page.goto(`http://localhost:${port}${path}`);
  const frame = path.startsWith('/host') ? await (await page.waitForSelector('iframe')).contentFrame() : page.mainFrame();
  let ok = false;
  let detail = '';
  try {
    await frame.waitForFunction(() => !document.querySelector('.overlay-center') && !!document.querySelector('canvas') && !!document.querySelector('.dock'), null, { timeout: 90000 });
    const txt = await frame.evaluate(() => document.body.innerText);
    ok = /音ありで始める|薪/.test(txt) && !/3D表示を開始できません/.test(txt);
    detail = txt.replace(/\s+/g, ' ').slice(0, 60);
  } catch (e) {
    detail = String(e).slice(0, 120);
  }
  const pass = ok && errors.length === 0;
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  — ${errors.length ? 'エラー: ' + errors.slice(0, 2).join(' | ') : detail}`);
  await ctx.close();
}
await browser.close();
server.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
