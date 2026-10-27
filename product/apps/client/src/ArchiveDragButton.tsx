import type { ButtonHTMLAttributes } from 'react';
import { useArchiveDrag, type ArchiveDragGesture } from './archive-drag';

/** A real button stays keyboard/click accessible; only a held drag exports a native file. */
export function ArchiveDragButton({onArchiveDrag,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{
  onArchiveDrag?:(gesture:ArchiveDragGesture)=>Promise<void>;
}) {
  const drag=useArchiveDrag<HTMLButtonElement>(props.disabled?undefined:onArchiveDrag);
  return <button {...props} {...drag} draggable={false} data-archive-draggable={!!onArchiveDrag&&!props.disabled}/>;
}
