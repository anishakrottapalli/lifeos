import { useEffect, useState } from "react";
import { fileName } from "../core/paths";
import { useStore } from "./hooks";

const IMAGE = /\.(png|jpe?g|gif|webp|heic)$/i;
const PDF = /\.pdf$/i;

/**
 * A course's or program's certificate: the file named "Certificate" in its folder, shown as a preview
 * (a PDF's first page, or the picture). With none, a place to add one.
 */
export function CertificatePanel({ dir, onAdd }: { dir: string | undefined; onAdd: (absPath: string) => Promise<void> }) {
  const store = useStore();
  const path = dir ? store.index.certificateOf(dir) : undefined;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (path) store.storage.fileUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path, store.storage]);

  async function pick() {
    const picked = await store.storage.pickFiles();
    if (picked[0]) await onAdd(picked[0]);
  }

  return (
    <section className="certificate" aria-label="Certificate">
      <div className="section-head">
        <h3>Certificate</h3>
        {path && (
          <button className="small-button" onClick={() => store.storage.reveal(path)}>
            Show
          </button>
        )}
      </div>
      {path ? (
        <div className="cert-preview">
          {url && IMAGE.test(path) ? (
            <img src={url} alt="Certificate" />
          ) : url && PDF.test(path) ? (
            <object data={`${url}#toolbar=0&navpanes=0&view=FitH`} type="application/pdf" aria-label="Certificate preview">
              <p className="muted small">Preview not available.</p>
            </object>
          ) : (
            <p className="muted small">{fileName(path)}</p>
          )}
          <button className="link small" onClick={() => store.storage.open(path)}>
            Open {fileName(path)}
          </button>
        </div>
      ) : (
        <button className="drop-area" onClick={pick}>
          <strong>No certificate</strong>
          <span className="muted small">Add a PDF or picture if this gives one. It shows here as a preview.</span>
        </button>
      )}
    </section>
  );
}
