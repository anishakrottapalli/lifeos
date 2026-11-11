import type { ReactNode } from "react";

export function Modal({ close, children }: { close: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
