import type { ReactNode } from "react";

export function Modal({ close, children, className = "" }: { close: () => void; children: ReactNode; className?: string }) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className={`modal ${className}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
