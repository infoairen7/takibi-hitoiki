import { useContext, useEffect, useRef, useState } from 'react';
import { APP_VERSION, UIState } from '../game/controller';
import { ASSETS, MIT_TEXT, OFL_SUMMARY, PRIVACY, SOFTWARE } from '../data/credits';
import { LAYOUTS, LAYOUT_ORDER } from '../game/fire/layouts';
import { ALBUM_MAX } from '../persistence/storage';
import { DECORS, PLACES, TRAYS } from '../data/discoveries';
import { nextUnlock } from '../game/progress';
import { Ctl } from './context';
import { Icon } from './Icon';
import { SpeciesPick } from './Dock';
import { Modal } from './Modal';

export function Dialogs({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  switch (ui.dialog) {
    case null:
      return null;
    case 'sound':
      return (
        <Modal title="音について" onClose={() => void c.setSound(false)}>
          <div className="stack">
            <p className="muted">焚き火の音は、この端末でその場でつくる音です。あとから設定で変えられます。</p>
            <button className="btn primary" data-autofocus onClick={() => void c.setSound(true)}>
              <Icon name="volume" />
              音ありで始める
            </button>
            <button className="btn" onClick={() => void c.setSound(false)}>
              <Icon name="mute" />
              音なしで始める
            </button>
          </div>
        </Modal>
      );
    case 'resume':
      return (
        <Modal title="前回の火が残っています" onClose={() => c.acceptResume()} closable={false}>
          <div className="stack">
            <p className="muted">離れていた時間は、火の進みに加えていません。</p>
            <button className="btn primary" data-autofocus onClick={() => c.acceptResume()}>
              <Icon name="play" />
              続きから
            </button>
            <button className="btn" onClick={() => c.declineResume()}>
              <Icon name="flame" />
              新しい火をつくる
            </button>
          </div>
        </Modal>
      );
    case 'pause':
      return (
        <Modal title="ひと休み中" onClose={() => c.resumeFromPause()}>
          <div className="stack">
            <p className="muted">
              火も、一緒に待っています。
              <br />
              離れていた時間は、火の進みに加えません。
            </p>
            <button className="btn primary" data-autofocus onClick={() => c.resumeFromPause()}>
              <Icon name="play" />
              続きから
            </button>
            <button className="btn" onClick={() => c.saveAndLeave()}>
              保存して、あとで続ける
            </button>
            <button className="btn ghost" onClick={() => c.openDialog('endConfirm')}>
              今日はここまで
            </button>
          </div>
        </Modal>
      );
    case 'endConfirm':
      return (
        <Modal title="今日は、ここまで？" onClose={() => c.closeDialog()}>
          <div className="stack">
            <p>
              この火を見送ります。
              <br />
              あとで続けたいときは「戻る」を選んでください。
            </p>
            <button className="btn primary" onClick={() => c.endTonight()}>
              火を見送る
            </button>
            <button className="btn" data-autofocus onClick={() => c.closeDialog()}>
              戻る
            </button>
          </div>
        </Modal>
      );
    case 'newConfirm':
      return (
        <Modal title="新しい火をつくる？" onClose={() => c.closeDialog()}>
          <div className="stack">
            <p>今の火を片付けて、空の台から始めます。</p>
            <button className="btn primary" onClick={() => c.newFire()}>
              新しい火をつくる
            </button>
            <button className="btn" data-autofocus onClick={() => c.closeDialog()}>
              戻る
            </button>
          </div>
        </Modal>
      );
    case 'menu':
      return (
        <Modal title="火のそばで" onClose={() => c.closeDialog()}>
          <div className="stack">
            <button className="btn" onClick={() => c.openDialog('journal')}>
              <Icon name="book" />
              火の手帳
            </button>
            <button
              className="btn"
              onClick={() => {
                c.closeAllDialogs();
                void c.takePhoto();
              }}
            >
              <Icon name="camera" />
              今の火を撮る
            </button>
            <button className="btn" onClick={() => c.openDialog('layouts')}>
              <Icon name="wood" />
              組み方の見本
            </button>
            <button className="btn" onClick={() => c.openDialog('outfit')}>
              <Icon name="leaf" />
              場所・焚き火台・装飾
            </button>
            <button className="btn" onClick={() => c.openDialog('settings')}>
              <Icon name="settings" />
              設定
            </button>
            <button className="btn ghost" onClick={() => c.openDialog('about')}>
              <Icon name="info" />
              このゲームについて
            </button>
            <button className="btn ghost" onClick={() => c.openDialog(ui.phase === 'prepare' && ui.counts.medium + ui.counts.kindling + ui.counts.tinder === 0 ? 'layouts' : 'newConfirm')}>
              <Icon name="flame" />
              新しい火をつくる
            </button>
          </div>
        </Modal>
      );
    case 'layouts':
      return (
        <Modal title="組み方の見本" onClose={() => c.closeDialog()}>
          <p className="caption">選ぶと、空の台へ一本ずつ置いていきます。置いたあとも火ばさみで整えられます。</p>
          <p className="caption below">中薪の樹種</p>
          <SpeciesPick ui={ui} />
          <div className="stack below">
            {LAYOUT_ORDER.map((id) => (
              <button key={id} className="layout-card" onClick={() => c.runLayout(id)}>
                <strong>{LAYOUTS[id].label}</strong>
                <span>{LAYOUTS[id].summary}</span>
              </button>
            ))}
          </div>
        </Modal>
      );
    case 'settings':
      return <SettingsDialog ui={ui} />;
    case 'outfit':
      return <OutfitDialog ui={ui} />;
    case 'journal':
      return <JournalDialog ui={ui} />;
    case 'deviceCheck':
      return <DeviceCheckDialog ui={ui} />;
    case 'about':
      return <AboutDialog />;
  }
}

function DeviceCheckDialog({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  const text = ui.check.report ?? '';
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <Modal title="動作チェックの結果" onClose={() => c.closeDialog()}>
      <p className="caption">この結果は、この画面に出しただけで、どこへも送っていません。コピーして送ってもらえると、実機での調整に使えます。</p>
      <textarea
        ref={ref}
        className="check-report below"
        readOnly
        value={text}
        aria-label="動作チェックの結果"
        onFocus={(e) => e.currentTarget.select()}
        rows={14}
      />
      <div className="row wrap below">
        <button
          className="btn primary"
          data-autofocus
          onClick={() => {
            ref.current?.focus();
            ref.current?.select();
            void c.copyCheckReport();
          }}
        >
          <Icon name="check" />
          結果をコピー
        </button>
        <button className="btn" onClick={() => void c.saveCheckReport()}>
          <Icon name="share" />
          ファイルに保存
        </button>
      </div>
    </Modal>
  );
}

function AboutDialog() {
  const c = useContext(Ctl)!;
  return (
    <Modal title="このゲームについて" onClose={() => c.closeDialog()}>
      <p>
        <strong>焚き火と、ひと息。</strong>
      </p>
      <p className="caption">版：{APP_VERSION}</p>
      <h3 className="below small muted">記録とプライバシー</h3>
      <ul className="plain-list">
        {PRIVACY.map((p) => (
          <li key={p} className="caption">
            {p}
          </li>
        ))}
      </ul>
      <h3 className="below small muted">仮の素材について</h3>
      <p className="caption">湖畔以外の場所の背景と、薪・焚き火台・音は仮の素材です（ゲームの中で作った手作りのもの）。</p>
      <h3 className="below small muted">素材と権利</h3>
      <ul className="credit-list">
        {[...ASSETS, ...SOFTWARE].map((a) => (
          <li key={a.name}>
            <strong>{a.name}</strong>
            <span className="tag">{a.status}</span>
            <span className="caption">{a.what}</span>
            <span className="caption">
              {a.license}・{a.holder}
            </span>
          </li>
        ))}
      </ul>
      <details className="below">
        <summary className="caption">ライセンスの全文（MIT・SIL OFL）</summary>
        <pre className="license-text">{`Three.js — Copyright © 2010-2026 three.js authors\nReact・React DOM・scheduler — Copyright (c) Meta Platforms, Inc. and affiliates.\n\nMIT License\n\n${MIT_TEXT}\n\n${OFL_SUMMARY}`}</pre>
      </details>
    </Modal>
  );
}

function SettingsDialog({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  const s = ui.settings;
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Modal title="設定" onClose={() => c.closeDialog()}>
      <p className="caption">自分に心地よい、音と動きに。設定を開いている間、火は止まっています。</p>
      <div className="setting-row row between">
        <div>
          焚き火の音
          <br />
          <span className="caption">{ui.sound.supported ? 'この端末で合成した音（仮素材）' : 'この環境では音を出せません'}</span>
        </div>
        <button className="toggle" role="switch" aria-label="焚き火の音" aria-checked={ui.sound.enabled} onClick={() => c.toggleSound()} disabled={!ui.sound.supported} />
      </div>
      <div className="setting-row">
        <label htmlFor="firevolume">音量</label>
        <input id="firevolume" type="range" min={0} max={100} value={Math.round(s.fireVolume * 100)} onChange={(e) => c.updateSettings({ fireVolume: Number(e.target.value) / 100 })} />
      </div>
      <div className="setting-row">
        <label htmlFor="bgmvolume">BGM{s.bgmVolume <= 0 ? '（止めています）' : ''}</label>
        <input id="bgmvolume" type="range" min={0} max={100} value={Math.round(s.bgmVolume * 100)} onChange={(e) => c.updateSettings({ bgmVolume: Number(e.target.value) / 100 })} disabled={!ui.sound.supported} />
        <p className="caption">この端末で合成する小さな音楽（自作）。いちばん左で止まります。無音でもすべての情報が伝わります。</p>
      </div>
      <div className="setting-row row between">
        <div>
          動きを控えめに
          <br />
          <span className="caption">火の粉・揺らぎ・カメラの動きを減らす</span>
        </div>
        <button className="toggle" role="switch" aria-label="動きを控えめに" aria-checked={s.reducedMotion} onClick={() => c.updateSettings({ reducedMotion: !s.reducedMotion })} />
      </div>
      <div className="setting-row stack">
        <span className="label" id="textsize-label">
          文字の大きさ
        </span>
        <div className="seg" role="group" aria-labelledby="textsize-label">
          {(
            [
              ['normal', '標準'],
              ['large', '大きめ'],
              ['xlarge', 'とても大きい'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} aria-pressed={s.textSize === v} onClick={() => c.updateSettings({ textSize: v })}>
              {l}
            </button>
          ))}
        </div>
        <span className="caption">画面の文字とボタンを大きくします。ブラウザの拡大にも対応しています。</span>
      </div>
      {ui.hapticsSupported && (
        <div className="setting-row row between">
          <div>
            振動
            <br />
            <span className="caption">薪を置いたとき・火がついたときに、軽く震える</span>
          </div>
          <button className="toggle" role="switch" aria-label="振動" aria-checked={s.haptics} onClick={() => c.updateSettings({ haptics: !s.haptics })} />
        </div>
      )}
      <div className="setting-row stack">
        <label htmlFor="quality">描画品質</label>
        <select id="quality" className="setting" value={s.quality} onChange={(e) => c.updateSettings({ quality: e.target.value as typeof s.quality })}>
          <option value="auto">自動（重いときは解像度と粒子を減らす）</option>
          <option value="low">軽量</option>
          <option value="standard">標準</option>
          <option value="high">高品質</option>
        </select>
      </div>
      <div className="setting-row">
        <span className="label">記録について</span>
        <p className="caption">
          {ui.storageOk
            ? '記録はこの端末のブラウザの中にだけ保存します。別の端末とは同期しません。ブラウザのデータを消すと失われます。'
            : 'この環境では記録を保存できません。この場のプレイは続けられます。'}
        </p>
        {ui.saveFailed && (
          <p className="caption warn-text" role="status">
            いま、保存できていません（端末の保存容量がいっぱいかもしれません）。今までの記録は消えていません。記録を書き出しておくと安心です。
          </p>
        )}
        <p className="caption">
          書き出すと、これまでの発見と思い出（小さな画像つき）を1つのファイルにまとめて保存します。読み込むと、今の記録に足し合わせます（今の記録は消えません）。
        </p>
        <div className="row wrap below">
          <button className="btn small" onClick={() => void c.exportRecords()} disabled={ui.records.busy}>
            <Icon name="share" />
            記録を書き出す
          </button>
          <button className="btn small" onClick={() => fileRef.current?.click()} disabled={ui.records.busy || !ui.storageOk}>
            <Icon name="plus" />
            記録を読み込む
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="記録ファイルを選ぶ"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void c.importRecords(f);
            }}
          />
        </div>
        {ui.records.note && (
          <p className="caption" role="status">
            {ui.records.note}
          </p>
        )}
      </div>
      <div className="setting-row row between">
        <div>
          今日はここまで
          <br />
          <span className="caption">火を落として、見送ります（確かめてから）</span>
        </div>
        <button className="btn small" onClick={() => c.openDialog('endConfirm')} disabled={!ui.canEnd}>
          <Icon name="hand" />
          今日はここまで
        </button>
      </div>
      <div className="setting-row">
        <span className="label">動作チェック（実機の確認用）</span>
        <p className="caption">遊んでいる画面のまま、なめらかさ・画質の自動調整・操作の反応・端末の情報をはかります。終わると結果が出るので、コピーして送ってください（自動では送りません）。火が燃えているときにはかるのがおすすめです。</p>
        <div className="row wrap below">
          <button className="btn small" onClick={() => c.startDeviceCheck(60)} disabled={ui.check.running}>
            <Icon name="clock" />
            60秒はかる
          </button>
          <button className="btn small" onClick={() => c.startDeviceCheck(300)} disabled={ui.check.running}>
            <Icon name="clock" />
            5分はかる（熱の確認）
          </button>
        </div>
        {ui.check.report && !ui.check.running && (
          <button className="btn ghost small below" onClick={() => c.openDialog('deviceCheck')}>
            前回の結果を見る
          </button>
        )}
      </div>
    </Modal>
  );
}

function JournalDialog({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  const [tab, setTab] = useState<'now' | 'log' | 'album' | 'tasks'>('now');
  useEffect(() => {
    if (tab === 'album') c.loadAlbumThumbs();
  }, [tab, c]);
  const m = ui.metrics;
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  return (
    <Modal title="火の手帳" onClose={() => c.closeDialog()}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'now'} onClick={() => setTab('now')}>
          今の火
        </button>
        <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>
          記録
        </button>
        <button role="tab" aria-selected={tab === 'tasks'} onClick={() => setTab('tasks')}>
          発見
        </button>
        <button role="tab" aria-selected={tab === 'album'} onClick={() => setTab('album')}>
          思い出
        </button>
      </div>
      {tab === 'tasks' ? (
        <TasksTab ui={ui} />
      ) : tab === 'album' ? (
        <AlbumTab ui={ui} />
      ) : tab === 'now' ? (
        <div role="tabpanel">
          <Gauge label="火力" word={ui.words.heat} value={m.heat} />
          <Gauge label="空気" word={ui.words.oxygen} value={m.oxygen} />
          <Gauge label="煙" word={ui.words.smoke} value={m.smoke} />
          <Gauge label="燃料" word={ui.words.fuel} value={m.fuel * 100} />
          <div className="statrow">
            <span>着火からの時間</span>
            <strong>
              {fmt(ui.session.activeTime)} / {fmt(ui.session.duration)}
            </strong>
          </div>
          <div className="statrow">
            <span>落ち着いた火の時間</span>
            <strong>{Math.round(m.stableSeconds)}秒</strong>
          </div>
          <div className="statrow">
            <span>いちばん大きな火力</span>
            <strong>{Math.round(ui.record.maxHeat)}</strong>
          </div>
          <div className="statrow">
            <span>世話の回数（薪・風・火吹き筒・組み直し）</span>
            <strong>{ui.record.care}回</strong>
          </div>
          <h3 className="below small muted">薪ひとつずつの様子</h3>
          {ui.pieces.length === 0 && <p className="caption">まだ薪がありません。</p>}
          {ui.pieces.map((p) => (
            <div className="jrow" key={p.id}>
              <div className="top">
                <strong>{p.label}</strong>
                <span className={`state-chip ${p.state}`}>{p.stateLabel}</span>
              </div>
              <div className="caption">
                温まり {Math.min(100, Math.round((p.temp / 1) * 100))}% ・ 焦げ {Math.round(p.char * 100)}% ・ 残り {Math.round(p.fuel * 100)}% ・ 空気 {Math.round(Math.min(1, p.air) * 100)}% ・ 湿り {p.moisture >= 0.45 ? 'しっとり' : p.moisture >= 0.15 ? 'やや湿り' : '乾いている'}
              </div>
            </div>
          ))}
          <p className="caption below">数値はゲーム用の目安で、実際の燃焼性能ではありません。</p>
        </div>
      ) : (
        <div role="tabpanel">
          {ui.timeline.length === 0 ? (
            <p className="caption">火をつけると、ここに経過が残ります。</p>
          ) : (
            <ol className="timeline-list">
              {ui.timeline.map((e, i) => (
                <li key={i}>
                  <time>{fmt(e.t)}</time>
                  <span>{e.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Modal>
  );
}

function TasksTab({ ui }: { ui: UIState }) {
  const p = ui.progress;
  const next = nextUnlock(p.unlock);
  return (
    <div role="tabpanel">
      <div className="statrow">
        <span>見つけた発見</span>
        <strong>
          {p.count} / {p.tasks.length}
        </strong>
      </div>
      {next && (
        <p className="caption">
          発見{next.at}件で：{next.label}
        </p>
      )}
      <ol className="task-list">
        {p.tasks.map((t) => (
          <li key={t.id} className={t.done ? 'done' : ''}>
            <span className="mark" aria-hidden="true">
              {t.done ? <Icon name="check" /> : <span className="dot" />}
            </span>
            <span className="task-text">
              <strong>{t.label}</strong>
              <span className="caption">{t.done ? `見つけた：${t.done.slice(0, 10).replace(/-/g, '.')}` : t.hint}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="caption below">期限はありません。毎日遊ぶことや、続けて遊ぶことは条件にしていません。累計で使った薪：{p.woodsUsed} / 12</p>
      {p.unlock > p.count && <p className="caption">前の版で見つけた発見で解放されたものは、そのまま使えます。</p>}
    </div>
  );
}

function OutfitDialog({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  const o = ui.outfit;
  const p = ui.progress;
  const s = ui.settings;
  return (
    <Modal title="場所・焚き火台・装飾" onClose={() => c.closeDialog()}>
      <p className="caption">{o.locked ? '場所・焚き火台・時間は、火を灯す前に選べます。装飾はいつでも変えられます。' : '見た目と音が変わります。燃え方には影響しません。'}</p>
      <h3 className="below small muted">場所</h3>
      <div className="choice-grid" role="group" aria-label="場所">
        {PLACES.map((pl) => {
          const open = p.places.includes(pl.id);
          return (
            <button key={pl.id} className="choice" aria-pressed={o.place === pl.id} disabled={!open || o.locked} onClick={() => c.setPlace(pl.id)}>
              {!open && <Icon name="lock" />}
              <strong>{pl.label}</strong>
              <small>{open ? (pl.id === 'lakeside' ? '写真の遠景' : '仮の背景（手作り）') : `発見${pl.at}件で`}</small>
            </button>
          );
        })}
      </div>
      <h3 className="below small muted">焚き火台</h3>
      <div className="choice-grid" role="group" aria-label="焚き火台">
        {TRAYS.map((t) => {
          const open = p.trays.includes(t.id);
          return (
            <button key={t.id} className="choice" aria-pressed={o.tray === t.id} disabled={!open || o.locked} onClick={() => c.setTray(t.id)}>
              {!open && <Icon name="lock" />}
              <strong>{t.label}</strong>
              <small>{open ? t.note : `発見${t.at}件で`}</small>
            </button>
          );
        })}
      </div>
      <h3 className="below small muted">時間</h3>
      <div className="seg" role="group" aria-label="時間">
        <button aria-pressed={o.mode === 'short'} disabled={o.locked} onClick={() => c.setMode('short')}>
          ひと息 10分
        </button>
        <button aria-pressed={o.mode === 'long'} disabled={o.locked} onClick={() => c.setMode('long')}>
          ゆっくり 20分
        </button>
      </div>
      <p className="caption">20分では、中薪と熾がゆっくり燃えます（同じ本数で最後まで）。発見に必要な秒数も時間に合わせるので、長く遊んだ方が有利にはなりません。</p>
      <h3 className="below small muted">装飾</h3>
      <div className="choice-grid" role="group" aria-label="記録フレーム">
        <button className="choice" aria-pressed={s.frame === 'paper'} onClick={() => c.setDecor({ frame: 'paper' })}>
          <strong>記録フレーム：紙</strong>
          <small>はじめから</small>
        </button>
        {DECORS.filter((d) => d.group === 'frame').map((d) => {
          const open = p.decors.includes(d.id);
          return (
            <button key={d.id} className="choice" aria-pressed={s.frame === d.id} disabled={!open} onClick={() => c.setDecor({ frame: d.id as typeof s.frame })}>
              {!open && <Icon name="lock" />}
              <strong>{d.label}</strong>
              <small>{open ? '思い出カードの縁' : `発見${d.at}件で`}</small>
            </button>
          );
        })}
      </div>
      <div className="choice-grid below" role="group" aria-label="火ばさみ・小物">
        <button className="choice" aria-pressed={s.tongs === 'steel'} onClick={() => c.setDecor({ tongs: 'steel' })}>
          <strong>火ばさみ：金属</strong>
          <small>はじめから</small>
        </button>
        {DECORS.filter((d) => d.group === 'tongs').map((d) => {
          const open = p.decors.includes(d.id);
          return (
            <button key={d.id} className="choice" aria-pressed={s.tongs === d.id} disabled={!open} onClick={() => c.setDecor({ tongs: d.id as typeof s.tongs })}>
              {!open && <Icon name="lock" />}
              <strong>{d.label}</strong>
              <small>{open ? '台の横の火ばさみ' : `発見${d.at}件で`}</small>
            </button>
          );
        })}
        {DECORS.filter((d) => d.group === 'bag' || d.group === 'lantern').map((d) => {
          const open = p.decors.includes(d.id);
          const on = d.group === 'bag' ? s.bag : s.lantern;
          return (
            <button key={d.id} className="choice" aria-pressed={on} disabled={!open} onClick={() => c.setDecor(d.group === 'bag' ? { bag: !s.bag } : { lantern: !s.lantern })}>
              {!open && <Icon name="lock" />}
              <strong>{d.label}</strong>
              <small>{open ? (on ? '置いています' : '置かない') : `発見${d.at}件で`}</small>
            </button>
          );
        })}
      </div>
      <p className="caption below">場所の背景（湖畔以外）は、本番の画像が届くまでの手作りの仮の背景です。</p>
    </Modal>
  );
}

function AlbumTab({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  return (
    <div role="tabpanel">
      <div className="row between">
        <span className="caption">
          残した思い出 {ui.album.length} / {ALBUM_MAX}
        </span>
      </div>
      {ui.album.length === 0 && <p className="caption below">火を見送ったあと「思い出を残す」を押すと、ここに並びます。</p>}
      <ul className="album-list">
        {ui.album.map((e) => (
          <li key={e.id}>
            {e.thumbUrl ? <img src={e.thumbUrl} alt="" /> : <div className="thumb-empty" aria-hidden="true" />}
            <div className="album-text">
              <strong>{e.fireName}</strong>
              <span className="caption">
                {e.dateLabel} ・ {e.mood} ・ {e.minutes}
              </span>
              <span className="caption">{e.howRaised}</span>
            </div>
            <div className="album-actions">
              <button className="icon-btn" aria-label={e.favorite ? 'お気に入りを外す' : 'お気に入りにする（消えないよう保護）'} aria-pressed={e.favorite} onClick={() => c.toggleAlbumFavorite(e.id)}>
                <Icon name="heart" className={e.favorite ? 'filled' : undefined} />
              </button>
              <button className="icon-btn" aria-label="この思い出を消す" disabled={e.favorite} onClick={() => c.removeAlbumEntry(e.id)}>
                <Icon name="close" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="caption below">お気に入りにした思い出は消えないよう保護されます。記録はこの端末のブラウザにだけ保存します。</p>
    </div>
  );
}

function Gauge({ label, word, value }: { label: string; word: string; value: number }) {
  return (
    <div className="jrow">
      <div className="top">
        <span>{label}</span>
        <strong>
          {word}
          <span className="caption"> （{Math.round(value)}）</span>
        </strong>
      </div>
      <div className="gauge" aria-hidden="true">
        <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}
