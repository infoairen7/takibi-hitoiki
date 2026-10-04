// esbuildでのビルド（この制作環境ではVite本体をインストールできなかったため、検証ビルドに使用）
//   node scripts/build.mjs          → dist/（複数ファイル）と dist-single/index.html（1ファイル版）
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const single = join(root, 'dist-single');
rmSync(dist, { recursive: true, force: true });
rmSync(single, { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });
mkdirSync(single, { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src/main.tsx')],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  target: ['es2022', 'safari16'],
  outdir: join(dist, 'assets'),
  entryNames: 'app',
  jsx: 'automatic',
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

const fontCss = (url) => `@font-face{font-family:Camp;src:url('${url}') format('woff');font-weight:100 900;font-display:swap}`;

cpSync(join(root, 'public'), dist, { recursive: true });
cpSync(join(root, 'THIRD_PARTY_LICENSES.md'), join(dist, 'THIRD_PARTY_LICENSES.md'));
const html = readFileSync(join(root, 'index.html'), 'utf8')
  .replace('<script type="module" src="./src/main.tsx"></script>', () => '<script type="module" src="./assets/app.js"></script>')
  .replace('</head>', () => `<style>${fontCss('./fonts/NotoSansJP-subset.woff')}</style>\n    <link rel="stylesheet" href="./assets/app.css" />\n  </head>`);
writeFileSync(join(dist, 'index.html'), html);

// 1ファイル版（公開ページ用）：JS・CSS・フォント・遠景を埋め込む
const js = readFileSync(join(dist, 'assets/app.js'), 'utf8');
const css = readFileSync(join(dist, 'assets/app.css'), 'utf8');
const font = readFileSync(join(root, 'public/fonts/NotoSansJP-subset.woff')).toString('base64');
const bg = readFileSync(join(root, 'public/assets/backdrop_forest_dusk_provisional.jpg')).toString('base64');
const assetScript = `<script>window.GYARUBI_BACKDROP='data:image/jpeg;base64,${bg}';</script>`;
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const singleHtml = readFileSync(join(root, 'index.html'), 'utf8')
  // 置き換えは関数で渡す（文字列で渡すと、JS の中の "$&" などが置き換えの記号として解釈され、ページが壊れる）
  .replace('<script type="module" src="./src/main.tsx"></script>', () => `${assetScript}\n    <script type="module">${safeJs}</script>`)
  .replace('</head>', () => `<style>${fontCss(`data:font/woff;base64,${font}`)}\n${css}</style>\n  </head>`);
writeFileSync(join(single, 'index.html'), singleHtml);

// claude.ai 公開ページ用（doctype/html/head/bodyは公開時に付くので本文だけ）
const artifactDir = join(root, 'dist-artifact');
rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(artifactDir, { recursive: true });
const artifactHtml = `<title>焚き火と、ひと息。</title>
<style>${fontCss(`data:font/woff;base64,${font}`)}
${css}</style>
<div id="root"></div>
<noscript>このゲームはJavaScriptが必要です。</noscript>
${assetScript}
<script type="module">${safeJs}</script>
`;
writeFileSync(join(artifactDir, 'gyarubi.html'), artifactHtml);

const kb = (p) => (statSync(p).size / 1024).toFixed(0) + ' KB';
console.log('dist-artifact/gyarubi.html', kb(join(artifactDir, 'gyarubi.html')));
console.log('dist/assets/app.js', kb(join(dist, 'assets/app.js')));
console.log('dist/assets/app.css', kb(join(dist, 'assets/app.css')));
console.log('dist-single/index.html', kb(join(single, 'index.html')));

// 1ファイル版・公開用が壊れていないかの簡単な確認（置き換えの失敗で、元の開発用の script が残っていないか）
for (const f of [join(single, 'index.html'), join(artifactDir, 'gyarubi.html')]) {
  const html = readFileSync(f, 'utf8');
  if (html.includes('src="./src/main.tsx"')) throw new Error(`${f}: 開発用の script が残っています（置き換えの失敗）`);
  const inline = html.match(/<script type="module">/g)?.length ?? 0;
  if (inline !== 1) throw new Error(`${f}: 埋め込みの script の数が ${inline}`);
}
