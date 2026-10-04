import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GameController } from './game/controller';
import { Ctl } from './ui/context';
import { Dialogs } from './ui/Dialogs';
import { Dock } from './ui/Dock';
import { Icon, IconSprite } from './ui/Icon';
import { MemoryPage } from './ui/MemoryPage';

export function App({ controller, backdropUrl }: { controller: GameController; backdropUrl: string }) {
  const ui = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const host = useRef<HTMLDivElement>(null);
  const [booting, setBooting] = useState(true);
  const returnBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // 読み込み中の文言を先に描いてから、テクスチャ生成とWebGLの初期化を始める
    const id = window.setTimeout(() => {
      if (host.current) controller.mount(host.current, backdropUrl);
      setBooting(false);
    }, 30);
    return () => window.clearTimeout(id);
  }, [controller, backdropUrl]);

  useEffect(() => {
    if (ui.watching) returnBtn.current?.focus();
  }, [ui.watching]);

  // 道具箱の高さに合わせて、通知を道具箱のすぐ上へ
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const main = mainRef.current;
    const dock = main?.querySelector<HTMLElement>('.dock');
    if (!main) return;
    if (!dock) {
      main.style.setProperty('--dock-h', '0px');
      return;
    }
    const set = () => main.style.setProperty('--dock-h', `${Math.round(dock.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(dock);
    return () => ro.disconnect();
  }, [ui.dock, ui.ready, ui.watching]);

  const g = ui.guide;
  const s = ui.status;
  const cls = ['game', 'app', ui.watching ? 'watching' : '', ui.reduceMotion ? 'reduce-motion' : '', ui.check.running ? 'checking' : ''].join(' ');

  return (
    <Ctl.Provider value={controller}>
      <IconSprite />
      <main className={cls} aria-label="焚き火" ref={mainRef}>
        <div className="scene-host" ref={host} />
        <div className="vignette" aria-hidden="true" />

        <header className="hud">
          <div>
            <div className="brand">焚き火と、ひと息。</div>
            <div className="place">
              {ui.outfit.placeLabel} / {ui.outfit.mode === 'long' ? 'ゆっくり 20分' : 'ひと息 10分'}
            </div>
            {ui.check.running && (
              <div className="check-chip">
                <span aria-live="off">チェック中 {ui.check.remaining}秒</span>
                <button className="link-btn" onClick={() => controller.cancelDeviceCheck()}>
                  やめる
                </button>
              </div>
            )}
          </div>
          <div className="hud-actions">
            <button className={`icon-btn${ui.sound.enabled ? ' on' : ''}`} aria-label={ui.sound.enabled ? '音を消す' : '音をつける'} aria-pressed={ui.sound.enabled} onClick={() => controller.toggleSound()}>
              <Icon name={ui.sound.enabled ? 'volume' : 'mute'} />
            </button>
            <button className="icon-btn" aria-label="一時停止" onClick={() => controller.pauseByUser()}>
              <Icon name="pause" />
            </button>
            <button className="icon-btn" aria-label="メニュー" onClick={() => controller.openDialog('menu')}>
              <Icon name="more" />
            </button>
          </div>
        </header>

        {g ? (
          <section className="guide" aria-live="polite">
            <div className="eyebrow">{g.eyebrow}</div>
            <h1>{g.title}</h1>
            <p>{g.desc}</p>
            <div className="step-line" aria-label={`準備 ${g.step + 1} / 3`}>
              {[0, 1, 2].map((n) => (
                <i key={n} className={n <= g.step ? 'active' : ''} />
              ))}
            </div>
            {s && s.tone === 'warn' && (
              <>
                <span className="chip warn">
                  <Icon name="info" />
                  {s.text}
                </span>
                {s.hint && <p className="hint">{s.hint}</p>}
              </>
            )}
          </section>
        ) : (
          s && (
            <div className="status-note" role="status">
              <span className={`chip ${s.tone === 'good' ? 'good' : s.tone === 'warn' ? 'warn' : ''}`}>
                <Icon name={s.tone === 'moon' ? 'moon' : s.tone === 'warn' ? 'info' : 'flame'} />
                {s.text}
              </span>
              {s.hint && <p className="hint">{s.hint}</p>}
              {s.action === 'tongs' && !ui.watching && (ui.dock === 'play' || ui.dock === 'wind' || ui.dock === 'woodPick') && (
                <button className="btn small status-action" onClick={() => controller.openTongs()}>
                  <Icon name="tongs" />
                  薪を整える
                </button>
              )}
              {s.action === 'wind' && !ui.watching && (ui.dock === 'play' || ui.dock === 'tongs') && (
                <button className="btn small status-action" onClick={() => controller.openWind()}>
                  <Icon name="wind" />
                  風を送る
                </button>
              )}
              {s.action === 'log' && !ui.watching && (ui.dock === 'play' || ui.dock === 'wind' || ui.dock === 'tongs') && (
                <button className="btn small status-action" onClick={() => controller.openWood()}>
                  <Icon name="wood" />
                  乾いた薪を足す
                </button>
              )}
            </div>
          )
        )}

        {ui.memory && <MemoryPage ui={ui} />}

        {ui.ready && !ui.watching && ui.dock !== 'memory' && <Dock ui={ui} />}

        <div className="toast-stack" aria-live="polite">
          {ui.toasts.map((t) => (
            <div className="toast" role="status" key={t.id}>
              {t.text}
            </div>
          ))}
        </div>

        {ui.sound.needsResume && !ui.dialog && (
          <button className="btn small" style={{ position: 'absolute', top: 88, right: 20, zIndex: 4 }} onClick={() => void controller.resumeAudio()}>
            <Icon name="volume" />
            音を再開
          </button>
        )}

        {ui.watching && (
          <button className="btn return-watch" ref={returnBtn} onClick={() => controller.setWatch(false)}>
            <Icon name="back" />
            操作に戻る
          </button>
        )}

        {ui.debug && ui.stats && (
          <div className="debug-panel" aria-hidden="true">
            {`fps ${ui.stats.fps.toFixed(0)}  ${ui.stats.frameMs.toFixed(1)}ms
dpr ${ui.stats.dpr.toFixed(2)}  ${ui.stats.quality}
calls ${ui.stats.drawCalls}  tris ${ui.stats.triangles}
flames ${ui.stats.flames} smoke ${ui.stats.smoke} sparks ${ui.stats.sparks}
heat ${ui.metrics.heat.toFixed(0)} O2 ${ui.metrics.oxygen.toFixed(0)} smoke ${ui.metrics.smoke.toFixed(0)}
t ${ui.session.activeTime.toFixed(1)} paused ${ui.paused}
init ${controller.sceneInitMs.toFixed(0)}ms`}
          </div>
        )}

        {(booting || !ui.ready) && !ui.webglError && (
          <div className="overlay-center" role="status">
            <div>
              <p>今夜の場所を準備しています</p>
              <div className="loading-dot" />
            </div>
          </div>
        )}

        {ui.webglError && (
          <div className="overlay-center" role="alert">
            <div className="panel stack">
              <h2>{ui.webglError}</h2>
              <p className="muted">最新のChrome・Safari・Edgeなど、WebGL2に対応したブラウザでお試しください。保存済みの記録は消えていません。</p>
              <button className="btn primary" onClick={() => location.reload()}>
                もう一度試す
              </button>
            </div>
          </div>
        )}

        <Dialogs ui={ui} />
      </main>
    </Ctl.Provider>
  );
}
