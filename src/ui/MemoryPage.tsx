import { useContext, useEffect, useRef, useState } from 'react';
import { UIState } from '../game/controller';
import { NAME_MAX, graphemeLength } from '../game/memory';
import { Ctl } from './context';
import { Icon } from './Icon';
import type { FireMood } from '../data/texts';

/** S08 思い出：実際の画面から作ったカード、名前、育て方、保存・シェア・新しい火 */
export function MemoryPage({ ui }: { ui: UIState }) {
  const c = useContext(Ctl)!;
  const m = ui.memory!;
  const d = m.data;
  const [name, setName] = useState(d.fireName);
  const composing = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  const title = d.reason === 'manual' ? '今日はここまで。\nまた火を灯そう。' : MEMORY_TITLE[d.moodId];
  const commit = (v: string) => {
    if (composing.current) return;
    c.renameMemory(v);
  };
  const count = graphemeLength(name);
  return (
    <section className="memory-page" aria-labelledby="memory-title">
      <div className="memory-topbar" aria-hidden="true" />
      <div className="memory-layout">
        <figure className="memory-card">
          {m.cardUrl ? (
            <img src={m.cardUrl} alt={`今夜の火「${d.fireName}」の思い出カード。この回の焚き火の画面から作りました`} />
          ) : m.cardFailed ? (
            <div className="card-wait" role="status">
              思い出の画像を作れませんでした。記録と文章は残せます。
            </div>
          ) : (
            <div className="card-wait" role="status">
              思い出を描いています…
            </div>
          )}
        </figure>
        <div className="memory-text">
          <div className="eyebrow">TONIGHT'S MEMORY</div>
          <h1 id="memory-title" tabIndex={-1} ref={heading}>
            {title}
          </h1>
          <p className="last-line">{d.closing}</p>
          <div className="name-field">
            <label htmlFor="fire-name">今夜の火の名前</label>
            <div className="row">
              <input
                id="fire-name"
                type="text"
                value={name}
                autoComplete="off"
                enterKeyHint="done"
                aria-describedby="fire-name-count"
                onChange={(e) => {
                  setName(e.target.value);
                  commit(e.target.value);
                }}
                onCompositionStart={() => (composing.current = true)}
                onCompositionEnd={(e) => {
                  composing.current = false;
                  commit((e.target as HTMLInputElement).value);
                }}
                onBlur={() => setName(d.fireName)}
              />
              <span id="fire-name-count" className={`caption${count > NAME_MAX ? ' over' : ''}`}>
                {Math.min(count, NAME_MAX)}/{NAME_MAX}
              </span>
            </div>
          </div>
          <div className="statrow">
            <span>火と過ごした時間</span>
            <strong>{d.minutes}</strong>
          </div>
          <div className="statrow">
            <span>今夜の育て方</span>
            <strong>{d.careLabel}</strong>
          </div>
          <div className="statrow">
            <span>今夜の火は</span>
            <strong>{d.mood}</strong>
          </div>
          <div className="statrow">
            <span>落ち着いた火の時間</span>
            <strong>{Math.round(d.record.stableRate * 100)}%</strong>
          </div>
          <div className="memory-tags">
            <span className="badge">{d.woods}</span>
            {d.layout && <span className="badge">{d.layout}</span>}
            <span className="badge">{d.place}</span>
          </div>
          <div className="stack">
            <button className="btn primary" onClick={() => void c.saveMemory()} disabled={(!m.cardUrl && !m.cardFailed) || m.busy}>
              <Icon name="memory" />
              {m.saved === 'yes' ? '保存しました（もう一度保存）' : '思い出を残す'}
            </button>
            <button className="btn" onClick={() => void c.shareMemory()} disabled={(!m.cardUrl && !m.cardFailed) || m.busy}>
              <Icon name="share" />
              {m.cardFailed ? '文章をコピー' : m.canShareFiles ? 'シェアする' : '画像を保存して文章をコピー'}
            </button>
            {ui.canReplay && (
              <button className="btn" onClick={() => c.replaySame()}>
                <Icon name="rotate" />
                今回の組合せでもう一度
              </button>
            )}
            <button className="btn ghost" onClick={() => c.newFire()}>
              <Icon name="flame" />
              新しい火をつくる
            </button>
          </div>
          {m.saved === 'full' && (
            <p className="caption warn-text" role="status">
              アルバムがいっぱいです（100件）。手帳の「思い出」で整理すると、残せます。{m.imageSaved ? '画像は保存しました。' : ''}
            </p>
          )}
          {m.saved === 'failed' && (
            <p className="caption warn-text" role="status">
              この環境では記録を保存できませんでした。{m.imageSaved ? '画像は保存しました。' : m.cardFailed ? '文章はコピーできます。' : '画像は端末へ保存できます。'}
            </p>
          )}
          <details className="share-text">
            <summary>シェア用の文章</summary>
            <p>{m.share}</p>
            <button className="btn small" onClick={() => void c.copyText()}>
              文章をコピー
            </button>
          </details>
          <p className="caption below">記録はこの端末のブラウザにだけ保存します。投稿は自分で確認してから行ってください。</p>
        </div>
      </div>
    </section>
  );
}

/** 思い出の見出し（その回の火の様子ごと） */
const MEMORY_TITLE: Record<FireMood, string> = {
  calm: '静かな火と、\nやさしいひと息。',
  lively: 'よく燃えた火と、\n明るいひと息。',
  tended: '世話をした火と、\nあたたかなひと息。',
  small: '小さな火と、\nささやかなひと息。',
  revived: 'もう一度灯った火と、\nほっとひと息。',
  damp: 'しっとりした火と、\n静かなひと息。',
  spent: '燃え尽きるまで、\nゆっくりひと息。',
  early: '今日はここまで。\nまた火を灯そう。',
};
