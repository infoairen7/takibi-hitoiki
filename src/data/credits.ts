/**
 * 素材と権利（「このゲームについて」に表示する）。
 * 同じ内容を THIRD_PARTY_LICENSES.md にも置いている。素材を足したら両方を更新する。
 */
export interface CreditItem {
  name: string;
  what: string;
  license: string;
  holder: string;
  status: '本番' | '仮素材' | '自作' | '参考';
}

export const SOFTWARE: CreditItem[] = [
  { name: 'Three.js r186', what: '3Dの描画（ポストエフェクトを含む）', license: 'MIT', holder: 'Copyright © 2010-2026 three.js authors', status: '本番' },
  { name: 'React 19.2', what: '画面のUI', license: 'MIT', holder: 'Copyright (c) Meta Platforms, Inc. and affiliates.', status: '本番' },
  { name: 'React DOM 19.2・scheduler', what: '画面のUI', license: 'MIT', holder: 'Copyright (c) Meta Platforms, Inc. and affiliates.', status: '本番' },
];

export const ASSETS: CreditItem[] = [
  { name: 'Noto Sans JP（使う文字だけに絞った版）', what: '文字', license: 'SIL Open Font License 1.1', holder: 'Copyright 2014-2021 Adobe, with Reserved Font Name "Source"', status: '本番' },
  { name: 'UIの部品・アイコン', what: 'ボタン・パネル・アイコン', license: '企画パッケージ同梱（本作のために制作）', holder: '企画者', status: '本番' },
  { name: '森の湖畔の遠景', what: '承認済みの画像（F01）の上部を切り出し', license: '企画パッケージ同梱', holder: '企画者', status: '仮素材' },
  { name: 'ほかの5か所の遠景・雨・雪・東屋・手すり', what: 'ゲームの中で描いた手作りの背景', license: '本作のプログラムで生成', holder: '本作', status: '仮素材' },
  { name: '薪・焚き火台・地面・装飾・炎・煙・火の粉', what: '手続き生成の形と模様', license: '本作のプログラムで生成', holder: '本作', status: '仮素材' },
  { name: '焚き火の音・環境音・効果音', what: 'その場で合成する音（録音素材は使っていない）', license: '本作のプログラムで生成', holder: '本作', status: '自作' },
  { name: 'BGM', what: 'その場で合成する小さな音楽（和音と単音。既存の曲・録音は使っていない）', license: '本作のプログラムで生成', holder: '本作', status: '自作' },
];

export const PRIVACY = [
  '記録（途中の火・アルバム・発見・設定）は、この端末のブラウザの中にだけ保存します。どこへも送りません。',
  '「動作チェック」の結果も、画面に出すだけです。送るかどうかは、あなたが決めます。',
  'シェアは、あなたが確認して行います。自動で投稿することはありません。',
];

export const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export const OFL_SUMMARY = `SIL Open Font License, Version 1.1（https://openfontlicense.org）
フォントは自由に使用・同梱・再配布できます。フォント単体での販売はできません。
改変した場合は、予約フォント名（Source）を使わない別の名前にします。全文は同梱の OFL.txt にあります。`;
