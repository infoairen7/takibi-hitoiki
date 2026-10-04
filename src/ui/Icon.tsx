import { ICON_SPRITE } from './iconSprite';

export function IconSprite() {
  return <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON_SPRITE }} />;
}

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg className={`icon${className ? ' ' + className : ''}`} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}
