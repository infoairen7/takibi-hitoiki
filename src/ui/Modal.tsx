import { ReactNode, useEffect, useId, useRef } from 'react';
import { Icon } from './Icon';

/**
 * ダイアログ：<dialog>のshowModalで背景を操作不能にし（フォーカスを閉じ込める）、
 * Escapeで閉じ、閉じたら開いた元の場所へフォーカスを戻す。見出しをaria-labelledbyへ。
 */
export function Modal({ title, onClose, children, closable = true }: { title: string; onClose: () => void; children: ReactNode; closable?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const origin = useRef<Element | null>(null);
  const id = useId();
  useEffect(() => {
    origin.current = document.activeElement;
    const d = ref.current;
    if (d && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    }
    const first = d?.querySelector<HTMLElement>('[data-autofocus]') ?? d?.querySelector<HTMLElement>('button, [href], input, select');
    first?.focus();
    return () => {
      const o = origin.current as HTMLElement | null;
      if (o && typeof o.focus === 'function' && document.contains(o)) o.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (closable) onClose();
      }}
      onClick={(e) => {
        if (!closable || e.target !== ref.current) return;
        const r = ref.current!.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={id}>{title}</h2>
        {closable && (
          <button className="icon-btn" aria-label="閉じる" onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
