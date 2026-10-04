import { useContext, useEffect, useRef, useState } from 'react';
import { BALANCE, PieceKind, WOODS, WoodId, isLog } from '../game/balance';
import { WOOD_UNLOCKS } from '../data/discoveries';
import { UIState } from '../game/controller';
import { WIND_FROM_LABEL, WindFrom } from '../game/fire/wind';
import { LAYOUTS } from '../game/fire/layouts';
import { Ctl } from './context';
import { Icon } from './Icon';

const KIND_LABEL: Record<PieceKind, string> = { tinder: '火口', kindling: '細薪', medium: '中薪', large: '太薪' };
const KIND_ICON: Record<PieceKind, string> = { tinder: 'leaf', kindling: 'wood', medium: 'wood', large: 'wood' };
const KIND_NOTE: Record<PieceKind, string> = { tinder: '細かな木毛の束', kindling: '細い焚き付け', medium: '割った主な薪', large: '太く、長く燃える薪' };

export function Dock({ ui }: { ui: UIState }) {
  switch (ui.dock) {
    case 'prepare':
      return <PrepareDock ui={ui} />;
    case 'place':
      return <PlaceDock ui={ui} />;
    case 'play':
      return <PlayDock ui={ui} />;
    case 'woodPick':
      return <WoodPickDock ui={ui} />;
    case 'tongs':
      return <TongsDock ui={ui} />;
    case 'tongsHold':
      return <PlaceDock ui={ui} holding />;
    case 'wind':
      return <WindDock ui={ui} />;
    case 'ember':
      return <EmberDock />;
    case 'farewell':
      return <FarewellDock />;
    case 'memory':
      return null;
    case 'ended':
      return <EndedDock ui={ui} />;
    case 'layout':
      return (
        <aside className="dock" aria-label="薪を組んでいます">
          <div className="eyebrow">組み方の見本</div>
          <h2>{ui.layoutRunning ? LAYOUTS[ui.layoutRunning].label : ''}で、一本ずつ置いています。</h2>
          <p className="hint">置き終わるまで、少しだけ待ってね。</p>
        </aside>
      );
  }
}

function WoodCard({ kind, ui, species }: { kind: PieceKind; ui: UIState; species?: WoodId }) {
  const c = useContext(Ctl)!;
  const count = ui.counts[kind];
  const max = ui.max[kind];
  const full = count >= max;
  return (
    <button
      className={`wood-card${ui.pending?.kind === kind ? ' selected' : ''}`}
      aria-disabled={full}
      aria-label={`${KIND_LABEL[kind]}（${KIND_NOTE[kind]}）${count}/${max}${full ? '、上限です' : ''}`}
      onPointerDown={(e) => {
        if (full || e.button !== 0) return;
        c.beginCardDrag(kind, species);
      }}
      onClick={() => (full ? c.pushToast(`${KIND_LABEL[kind]}はここまで（${max}${kind === 'tinder' ? '束' : '本'}）。`) : c.selectKind(kind, species))}
    >
      <Icon name={KIND_ICON[kind]} className={kind === 'kindling' ? 'thin' : undefined} />
      <span>{KIND_LABEL[kind]}</span>
      <span className="count">
        {count}/{max}
      </span>
    </button>
  );
}

function PrepareDock({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  const total = ui.counts.tinder + ui.counts.kindling + ui.counts.medium;
  const out = ui.phase === 'out';
  return (
    <aside className="dock" aria-label="薪支度">
      <div className="eyebrow">{out ? 'もう一度' : total === 0 ? '薪支度' : '薪の配置'}</div>
      <h2>{out ? '火口を置き直して、灯そう。' : total === 0 ? '小さなものから、順番に。' : '空気の隙間を残して。'}</h2>
      <div className="tray" role="group" aria-label="置く薪を選ぶ">
        <WoodCard kind="tinder" ui={ui} />
        <WoodCard kind="kindling" ui={ui} />
        <WoodCard kind="medium" ui={ui} species={ui.prepSpecies} />
      </div>
      <div className="row-actions">
        <button className="btn small" onClick={() => c.openTongs()} disabled={total === 0}>
          <Icon name="tongs" />
          整える
        </button>
        <button className="btn small" onClick={() => c.openDialog('layouts')} disabled={total > 0}>
          <Icon name="book" />
          組み方の見本
        </button>
      </div>
      {!out && (
        <button className="btn small block below outfit-btn" onClick={() => c.openDialog('outfit')}>
          <Icon name="leaf" />
          場所・焚き火台・時間：{ui.outfit.placeLabel}／{ui.outfit.mode === 'long' ? '20分' : '10分'}
        </button>
      )}
      <button className="btn primary block below" onClick={() => c.ignite()} disabled={!ui.canIgnite.ok || ui.lighterActive} aria-describedby="ignite-reason">
        <Icon name="flame" />
        {ui.lighterActive ? '火口へ火を近づけています…' : '火を灯す'}
      </button>
      <p className="caption" id="ignite-reason" role="status">
        {ui.canIgnite.ok ? `今夜の火は、約${ui.outfit.mode === 'long' ? 20 : 10}分でゆっくりおやすみします。` : ui.canIgnite.reason ?? '選んで、置く。ドラッグでも配置できます。'}
      </p>
    </aside>
  );
}

/** 中薪の樹種（太さとは別に選ぶ）。薪支度で置くときと、組み方の見本で使う */
export function SpeciesPick({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  return (
    <div className="species-pick" role="group" aria-label="中薪の樹種">
      <div className="species-row">
        {ui.progress.woods.map((w) => (
          <button key={w} className={`chip-btn${ui.prepSpecies === w ? ' on' : ''}`} aria-pressed={ui.prepSpecies === w} onClick={() => c.setPrepSpecies(w)}>
            {WOODS[w].label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlaceDock({ ui, holding = false }: { ui: UIState; holding?: boolean }) {
  const c = useContext(Ctl)!;
  const primary = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    // 選んだカードが消えたあと、フォーカスを「置く」へ（キーボード操作を続けられるように）
    const a = document.activeElement;
    if (!a || a === document.body || !document.contains(a)) {
      if (primary.current && !primary.current.disabled) primary.current.focus({ preventScroll: true });
      else root.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    }
  }, []);
  const p = ui.placement;
  const kind = ui.pending?.kind ?? 'medium';
  const title = holding ? ui.held?.label ?? '薪' : `${KIND_LABEL[kind]}${isLog(kind) && ui.pending ? `（${WOODS[ui.pending.species].label}）` : ''}`;
  return (
    <aside className="dock" ref={root} aria-label={holding ? '火ばさみで動かす' : '薪を置く'}>
      <div className="dock-head">
        <div className="eyebrow">{holding ? (ui.held?.burning ? '燃えている薪を動かす' : '火ばさみで持っています') : '置く場所を選ぶ'}</div>
      </div>
      <h2>{title}</h2>
      {!holding && isLog(kind) && ui.phase !== 'burning' && <SpeciesPick ui={ui} />}
      <div className="place-info" aria-live="polite">
        {p && p.valid && (
          <>
            <span className="chip good">
              <Icon name="check" />
              {p.supports}
            </span>
            <span className={`chip ${p.air === '詰まりぎみ' ? 'warn' : ''}`}>
              <Icon name="wind" />
              空気の通り：{p.air}
            </span>
          </>
        )}
      </div>
      <p className="reason" role="status">
        {p && !p.valid ? p.reason : p?.compress ? '火口がつぶれて、空気が入りにくくなります。' : p?.clamped ? '台の内側へ寄せました。' : ''}
      </p>
      <div className="row-actions">
        <button className="btn icon-only" aria-label="前の置き位置の候補（[）" onClick={() => c.cycleSpot(-1)}>
          <Icon name="chev-l" />
        </button>
        <button className="btn icon-only" aria-label="次の置き位置の候補（]）" onClick={() => c.cycleSpot(1)}>
          <Icon name="chev-r" />
        </button>
        <button className="btn icon-only" aria-label="左へ回す（Q）" onClick={() => c.rotate(15)}>
          <Icon name="rotate-l" />
        </button>
        <button className="btn icon-only" aria-label="右へ回す（E）" onClick={() => c.rotate(-15)}>
          <Icon name="rotate" />
        </button>
      </div>
      <div className="row-actions">
        <button className="btn small" onClick={() => c.cancelPlace()}>
          {holding ? '元に戻す' : 'やめる'}
        </button>
        {holding && ui.held?.removable && (
          <button className="btn small" onClick={() => c.removeHeld()}>
            台から出す
          </button>
        )}
        <button className="btn primary grow2" ref={primary} onClick={() => c.confirmPlace()} disabled={!p || !p.valid}>
          <Icon name="plus" />
          {holding ? 'ここに置く' : '置く'}
        </button>
      </div>
      <p className="caption">台の上をタップで場所、回転して置く。ドラッグして指を離しても置けます。〈 〉で置き位置の候補。</p>
    </aside>
  );
}

function PlayDock({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  return (
    <aside className="dock" aria-label="火の世話">
      <div className="tools" role="group" aria-label="道具">
        <button className="tool" onClick={() => c.openWood()}>
          <Icon name="wood" />薪
        </button>
        <button className="tool" onClick={() => c.openTongs()}>
          <Icon name="tongs" />
          火ばさみ
        </button>
        <button className="tool" onClick={() => c.openWind()}>
          <Icon name="wind" />
          送風
        </button>
      </div>
      <button className="watch" onClick={() => c.setWatch(true)}>
        <Icon name="moon" />
        しばらく、火を眺める
      </button>
    </aside>
  );
}

function WoodPickDock({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  const woods = ui.progress.woods;
  const next = WOOD_UNLOCKS.find((u) => u.at > ui.progress.unlock);
  // 太さと樹種は別の選択（詳細仕様）。太薪は火が中薪まで育った後で選べる
  const [size, setSize] = useState<'medium' | 'large'>('medium');
  const thick = size === 'large' && ui.largeUnlocked ? 'large' : 'medium';
  const logsFull = ui.logs.used >= ui.logs.max;
  return (
    <aside className="dock" aria-label="薪を選ぶ">
      <div className="dock-head">
        <div className="eyebrow">薪を選ぶ</div>
        <button className="back-link" onClick={() => c.closeTools()}>
          <Icon name="back" />
          戻る
        </button>
      </div>
      <h2>太さと樹種を選んで、火のそばへ。</h2>
      <div className="wood-grid">
        <button className="wood-card" onClick={() => c.selectKind('kindling')} aria-disabled={ui.counts.kindling >= ui.max.kindling}>
          <Icon name="wood" />
          <strong>細薪</strong>
          <small>
            {ui.counts.kindling}/{ui.max.kindling} ・ すぐ燃える
          </small>
        </button>
        {ui.counts.tinder === 0 && (
          <button className="wood-card" onClick={() => c.selectKind('tinder')}>
            <Icon name="leaf" />
            <strong>火口</strong>
            <small>火をつけ直す</small>
          </button>
        )}
      </div>
      <div className="seg-label" id="log-size">
        太さ（中薪・太薪 あわせて {ui.logs.used}/{ui.logs.max}本）
      </div>
      <div className="seg" role="group" aria-labelledby="log-size">
        <button aria-pressed={thick === 'medium'} onClick={() => setSize('medium')}>
          中薪
        </button>
        <button aria-pressed={thick === 'large'} aria-disabled={!ui.largeUnlocked} onClick={() => (ui.largeUnlocked ? setSize('large') : c.selectKind('large'))}>
          {!ui.largeUnlocked && <Icon name="lock" className="inline" />}
          太薪
        </button>
      </div>
      {!ui.largeUnlocked && <p className="caption tight">太薪は、中薪まで火が育つと選べます。</p>}
      {thick === 'large' && <p className="caption tight">太くて温まりにくい薪。強い火の上に置くと、長く燃えて熾火が残ります。</p>}
      <div className="wood-grid">
        {woods.map((w) => (
          <button key={w} className="wood-card" onClick={() => c.selectKind(thick, w)} aria-disabled={logsFull}>
            <Icon name="wood" />
            <strong>{WOODS[w].label}</strong>
            <small>{KIND_LABEL[thick]}</small>
          </button>
        ))}
      </div>
      {next && (
        <p className="caption below">
          <Icon name="lock" className="inline" />
          発見{next.at}件で「{next.woods.map((w) => WOODS[w].label).join('・')}」の薪（いま {ui.progress.unlock}件）
        </p>
      )}
    </aside>
  );
}

function TongsDock({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  return (
    <aside className="dock" aria-label="火ばさみ">
      <div className="dock-head">
        <div className="eyebrow">火ばさみで整える</div>
        <button className="back-link" onClick={() => c.closeTools()}>
          <Icon name="back" />
          戻る
        </button>
      </div>
      <h2>{ui.tongsTarget ? ui.tongsTarget.label : '動かす薪をタップ'}</h2>
      <p className="hint">動かしたい薪をタップ。矢印ボタンでも選べます。</p>
      <div className="row-actions">
        <button className="btn icon-only" aria-label="前の薪" onClick={() => c.cycleTongs(-1)}>
          <Icon name="chev-l" />
        </button>
        <button className="btn icon-only" aria-label="次の薪" onClick={() => c.cycleTongs(1)}>
          <Icon name="chev-r" />
        </button>
        <button className="btn primary" onClick={() => c.grabPiece()} disabled={!ui.tongsTarget}>
          <Icon name="tongs" />
          つかむ
        </button>
      </div>
    </aside>
  );
}

function WindDock({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  const froms: WindFrom[] = ['left', 'front', 'right'];
  const w = ui.wind;
  const tube = w.tool === 'tube';
  return (
    <aside className="dock wind-dock" aria-label="送風">
      <div className="dock-head">
        <div className="eyebrow">送風</div>
        <button className="back-link" onClick={() => c.closeTools()}>
          <Icon name="back" />
          戻る
        </button>
      </div>
      <div className="seg tool-switch" role="group" aria-label="道具">
        <button aria-pressed={!tube} onClick={() => c.setWindTool('fan')}>
          うちわ
        </button>
        <button aria-pressed={tube} aria-disabled={!w.tubeUnlocked} onClick={() => c.setWindTool('tube')}>
          {!w.tubeUnlocked && <Icon name="lock" className="inline" />}
          火吹き筒
        </button>
      </div>
      {!tube ? (
        <>
          <h2 className="wind-title">風を、少しだけ。</h2>
          <div className="seg-label" id="wind-level">
            強さ
          </div>
          <div className="seg" role="group" aria-labelledby="wind-level">
            {BALANCE.wind.levelLabels.map((l, i) => (
              <button key={l} aria-pressed={w.level === i} onClick={() => c.setWindLevel(i)}>
                {l}
              </button>
            ))}
          </div>
          <div className="seg-label" id="wind-from">
            向き
          </div>
          <div className="seg" role="group" aria-labelledby="wind-from">
            {froms.map((f) => (
              <button key={f} aria-pressed={w.from === f} onClick={() => c.setWindFrom(f)}>
                {WIND_FROM_LABEL[f]}
              </button>
            ))}
          </div>
          <button className="btn primary block" onClick={() => c.gust()}>
            <Icon name="wind" />
            風を一度送る
          </button>
          <p className="caption wind-caption">炎が先に傾き、少し遅れて火力が変わります。連打しても強くはなりません。</p>
        </>
      ) : (
        <>
          <h2 className="wind-title">狙った所へ、細い息を。</h2>
          <div className="seg-label" id="tube-aim">
            狙う場所（画面をタップしても選べます）
          </div>
          <div className="row-actions aim-row" role="group" aria-labelledby="tube-aim">
            <button className="btn icon-only" aria-label="前の場所" onClick={() => c.cycleTubeAim(-1)}>
              <Icon name="chev-l" />
            </button>
            <span className="aim-label" aria-live="polite">
              {w.tubeAim ?? '—'}
            </span>
            <button className="btn icon-only" aria-label="次の場所" onClick={() => c.cycleTubeAim(1)}>
              <Icon name="chev-r" />
            </button>
          </div>
          <div className="seg-label" id="tube-level">
            吹き方
          </div>
          <div className="seg" role="group" aria-labelledby="tube-level">
            {BALANCE.tube.levelLabels.map((l, i) => (
              <button key={l} aria-pressed={w.tubeLevel === i} onClick={() => c.setTubeLevel(i)}>
                {l}
              </button>
            ))}
          </div>
          <button className="btn primary block" onClick={() => c.blowTube()} aria-disabled={!w.tubeReady}>
            <Icon name="wind" />
            {w.tubeActive ? 'ふーっ……' : w.tubeReady ? 'ひと吹きする' : 'ひと息ついて……'}
          </button>
          <p className="caption wind-caption">細い風が狙った所だけに届きます。熾を起こしたり、詰まった奥へ空気を入れるのに。炎は傾かず、燃え広がりは助けません。小さな炎にしっかり吹くと消えることも。</p>
        </>
      )}
    </aside>
  );
}

function EmberDock() {
  const c = useContext(Ctl)!;
  return (
    <aside className="dock" aria-label="火を見守る">
      <div className="eyebrow">もうすぐ、おやすみ</div>
      <h2>今は、余韻を楽しもう。</h2>
      <button className="btn primary block" onClick={() => c.setWatch(true)}>
        <Icon name="moon" />
        火を見守る
      </button>
      <div className="row-actions ember-actions">
        <button className="btn small" onClick={() => void c.takePhoto()}>
          <Icon name="camera" />
          今の火を撮る
        </button>
        <button className="btn small" onClick={() => c.openDialog('endConfirm')}>
          <Icon name="hand" />
          今日はここまで
        </button>
      </div>
    </aside>
  );
}

function FarewellDock() {
  const c = useContext(Ctl)!;
  return (
    <aside className="dock" aria-label="おやすみ">
      <div className="eyebrow">おやすみ</div>
      <h2>火を、見送っています。</h2>
      <p className="hint">火が落ち着いたら、今夜の思い出へ進みます。</p>
      <button className="watch" onClick={() => void c.takePhoto()}>
        <Icon name="camera" />
        今の火を撮る
      </button>
    </aside>
  );
}

function EndedDock({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  const mins = Math.floor(ui.session.activeTime / 60);
  const secs = Math.round(ui.session.activeTime % 60);
  return (
    <aside className="dock" aria-label="今夜の火">
      <div className="eyebrow">今夜の火</div>
      <h2>今夜の火は、ここまで。</h2>
      <p className="end-summary">
        火と過ごした時間 {mins}分{secs}秒
      </p>
      <button className="btn primary block" onClick={() => c.newFire()}>
        <Icon name="flame" />
        新しい火をつくる
      </button>
      <button className="watch" onClick={() => void c.takePhoto()}>
        <Icon name="camera" />
        今の火を撮る
      </button>
    </aside>
  );
}
