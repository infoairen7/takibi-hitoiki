/**
 * 思い出カード（1080×1350）。絵60%・余白と文字40%。
 * 絵は、その回に実際に描画した画面（薪と火）を使う。
 */
import { GAME_TITLE, type MemoryData } from '../game/memory';
import type { FrameId } from '../data/discoveries';

/** 記録フレーム（装飾）。紙の色・文字の色・縁 */
const FRAMES: Record<FrameId, { paper: string; paperRGB: string; ink: string; muted: string; accent: string; border: 'none' | 'wood' | 'ember'; texture: 'none' | 'stars' | 'washi' }> = {
  paper: { paper: '#eee7db', paperRGB: '238,231,219', ink: '#3c3129', muted: '#7a6a5c', accent: '#a35a2a', border: 'none', texture: 'none' },
  frameWood: { paper: '#efe6d6', paperRGB: '239,230,214', ink: '#3a2b20', muted: '#7a6450', accent: '#8a4a22', border: 'wood', texture: 'none' },
  frameNight: { paper: '#18233a', paperRGB: '24,35,58', ink: '#eef2fa', muted: '#a8b6d0', accent: '#f0c890', border: 'none', texture: 'stars' },
  frameWashi: { paper: '#f4f0e6', paperRGB: '244,240,230', ink: '#34302a', muted: '#7a7264', accent: '#9a3a3a', border: 'none', texture: 'washi' },
  frameEmber: { paper: '#261914', paperRGB: '38,25,20', ink: '#f6e6d8', muted: '#c6a894', accent: '#ff9a50', border: 'ember', texture: 'none' },
};

export const CARD_W = 1080;
export const CARD_H = 1350;
const PHOTO_H = Math.round(CARD_H * 0.6);

export interface CardPhoto {
  blob: Blob;
  /** 前の版の名残（いつも null） */
  face?: null;
  /** 画面の中の火の中心（0..1）と、焚き火台の幅（画面の幅に対する割合）。なければ画面の中央 */
  focus?: { x: number; y: number; span: number } | null;
  aspect: number;
}

async function loadImage(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const ch of Array.from(text)) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxW && line) {
      out.push(line);
      line = ch;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export async function renderMemoryCard(m: MemoryData, photo: CardPhoto | null, frame: FrameId = 'paper'): Promise<Blob | null> {
  const F = FRAMES[frame] ?? FRAMES.paper;
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    await Promise.all([document.fonts?.load('500 40px Camp'), document.fonts?.load('400 26px Camp')]);
  } catch {
    /* 代わりの書体で描く */
  }
  // 紙
  ctx.fillStyle = F.paper;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  if (F.texture === 'washi') {
    // 和紙の繊維
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * CARD_W;
      const y = PHOTO_H + Math.random() * (CARD_H - PHOTO_H);
      ctx.strokeStyle = `rgba(120,100,70,${0.04 + Math.random() * 0.06})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.random() * 20 - 10, y + Math.random() * 10 - 5, x + Math.random() * 36 - 18, y + Math.random() * 14 - 7);
      ctx.stroke();
    }
  } else if (F.texture === 'stars') {
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(230,236,255,${0.15 + Math.random() * 0.5})`;
      ctx.beginPath();
      ctx.arc(Math.random() * CARD_W, PHOTO_H + Math.random() * (CARD_H - PHOTO_H), Math.random() < 0.1 ? 1.8 : 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 絵（実際の画面）。読めない絵（壊れた・読み込めない）は使わず、絵なしのカードにする
  let img: (CanvasImageSource & { width: number; height: number }) | null = null;
  if (photo) {
    try {
      img = await loadImage(photo.blob);
      if (!img.width || !img.height) img = null;
    } catch {
      img = null;
    }
  }
  if (photo && img) {
    const iw = img.width;
    const ih = img.height;
    const target = CARD_W / PHOTO_H;
    let sw = iw;
    let sh = iw / target;
    if (sh > ih) {
      sh = ih;
      sw = ih * target;
    }
    // 焚き火台が絵の幅の7割ほどになるまで寄る。寄りすぎない（画面の半分まで）
    const f = photo.focus;
    if (f && f.span > 0.05) {
      const wantW = Math.min(sw, Math.max(iw * 0.5, (f.span * iw) / 0.7));
      if (wantW < sw) {
        sh *= wantW / sw;
        sw = wantW;
      }
    }
    // 火の中心を、絵の中の真ん中より少し下に（炎が上へ伸びる分をあける）
    const fx = (f?.x ?? 0.5) * iw;
    const fy = (f?.y ?? 0.55) * ih;
    let sx = fx - sw / 2;
    let sy = fy - sh * 0.56;
    // はみ出さないように
    sx = Math.max(0, Math.min(iw - sw, sx));
    sy = Math.max(0, Math.min(ih - sh, sy));
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, CARD_W, PHOTO_H);
    // 下端を紙へなじませる
    const g = ctx.createLinearGradient(0, PHOTO_H - 60, 0, PHOTO_H);
    g.addColorStop(0, `rgba(${F.paperRGB},0)`);
    g.addColorStop(1, `rgba(${F.paperRGB},0.9)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, PHOTO_H - 60, CARD_W, 60);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, PHOTO_H);
    g.addColorStop(0, '#1b2733');
    g.addColorStop(1, '#3a2a20');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, PHOTO_H);
  }
  const ink = F.ink;
  const muted = F.muted;
  const accent = F.accent;
  const left = 72;
  const maxW = CARD_W - left * 2;
  let y = PHOTO_H + 70;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent;
  ctx.font = '600 22px Camp, "Noto Sans JP", sans-serif';
  ctx.fillText(`TONIGHT'S MEMORY  ·  ${m.dateLabel}`, left, y);
  y += 66;
  ctx.fillStyle = ink;
  ctx.font = '500 50px Camp, "Noto Sans JP", sans-serif';
  ctx.fillText(`今夜の火：${m.fireName}`, left, y);
  y += 58;
  ctx.font = '500 32px Camp, "Noto Sans JP", sans-serif';
  ctx.fillText(m.mood, left, y);
  y += 48;
  ctx.fillStyle = muted;
  ctx.font = '400 26px Camp, "Noto Sans JP", sans-serif';
  ctx.fillText(`${m.woods}／${m.place}${m.layout ? `／${m.layout}` : ''}`, left, y);
  y += 44;
  ctx.fillStyle = ink;
  ctx.fillText(m.howRaised, left, y);
  if (m.closing) {
    y += 56;
    ctx.font = '500 29px Camp, "Noto Sans JP", sans-serif';
    for (const l of wrap(ctx, m.closing, maxW).slice(0, 2)) {
      ctx.fillText(l, left, y);
      y += 42;
    }
  }
  // 下の余白
  ctx.fillStyle = muted;
  ctx.font = '400 19px Camp, "Noto Sans JP", sans-serif';
  ctx.fillText(GAME_TITLE, left, CARD_H - 44);
  const note = m.record?.maxHeat != null ? `${m.minutes}・いちばん大きな火 ${m.record.maxHeat}` : m.minutes;
  ctx.fillText(note, CARD_W - left - ctx.measureText(note).width, CARD_H - 44);
  // 縁
  if (F.border === 'wood') {
    const bw = 26;
    const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    g.addColorStop(0, '#6a4428');
    g.addColorStop(0.5, '#8a5a34');
    g.addColorStop(1, '#5a3a22');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, bw);
    ctx.fillRect(0, CARD_H - bw, CARD_W, bw);
    ctx.fillRect(0, 0, bw, CARD_H);
    ctx.fillRect(CARD_W - bw, 0, bw, CARD_H);
    ctx.strokeStyle = 'rgba(40,24,12,0.35)';
    for (let i = 0; i < 60; i++) {
      const y = Math.random() * CARD_H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(bw, y + Math.random() * 6);
      ctx.moveTo(CARD_W - bw, y);
      ctx.lineTo(CARD_W, y + Math.random() * 6);
      ctx.stroke();
    }
  } else if (F.border === 'ember') {
    const bw = 18;
    ctx.fillStyle = '#1a100c';
    ctx.fillRect(0, 0, CARD_W, bw);
    ctx.fillRect(0, CARD_H - bw, CARD_W, bw);
    ctx.fillRect(0, 0, bw, CARD_H);
    ctx.fillRect(CARD_W - bw, 0, bw, CARD_H);
    ctx.strokeStyle = 'rgba(255,140,60,0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bw, bw, CARD_W - bw * 2, CARD_H - bw * 2);
    for (let i = 0; i < 80; i++) {
      const x = Math.random() < 0.5 ? Math.random() * bw : CARD_W - Math.random() * bw;
      const y = Math.random() * CARD_H;
      ctx.fillStyle = `rgba(255,${120 + Math.random() * 80},60,${0.3 + Math.random() * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, 1 + Math.random() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/** アルバム用の小さな画像 */
export async function makeThumb(card: Blob, w = 270): Promise<Blob | null> {
  const img = await loadImage(card);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = Math.round((w * img.height) / img.width);
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', 0.82));
}
