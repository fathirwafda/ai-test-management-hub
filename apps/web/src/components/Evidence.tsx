import type { Attachment } from "@hub/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatBytes } from "../lib/format";
import { Button } from "./ui";

const contentUrl = (a: Attachment, download = false) =>
  `/api/attachments/${a.id}/content${download ? "?download=1" : ""}`;

function TextPreview({ attachment }: { attachment: Attachment }) {
  const text = useQuery({
    queryKey: ["attachment-text", attachment.id],
    queryFn: async () => {
      const res = await fetch(contentUrl(attachment));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      return body.length > 100_000 ? `${body.slice(0, 100_000)}\n… (truncated, download for the full file)` : body;
    },
  });
  if (text.isPending) return <p className="hint">Loading preview…</p>;
  if (text.isError) return <p className="hint">Preview unavailable.</p>;
  return <pre className="log">{text.data}</pre>;
}

/** One evidence file: inline preview for images, video and text, download link for anything else. */
export function EvidenceItem({
  attachment,
  onDelete,
}: {
  attachment: Attachment;
  onDelete?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(attachment.kind === "image");
  const a = attachment;

  if (!a.stored) {
    return (
      <li className="evidence evidence-meta" data-testid="evidence-item">
        <div className="evidence-head">
          <span className="evidence-name">{a.fileName}</span>
          <span className="hint">metadata only (recorded from the report, file not uploaded)</span>
        </div>
        {a.externalPath && <code className="path">{a.externalPath}</code>}
      </li>
    );
  }

  return (
    <li className="evidence" data-testid="evidence-item">
      <div className="evidence-head">
        <span className="evidence-name">{a.fileName}</span>
        <span className="hint">
          {a.mimeType} · {formatBytes(a.sizeBytes)}
        </span>
        <span className="row">
          {a.kind !== "file" && (
            <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? "Hide" : "Preview"}
            </Button>
          )}
          <a className="btn btn-ghost btn-sm" href={contentUrl(a, true)}>
            Download
          </a>
          {onDelete && (
            <Button size="sm" variant="ghost" aria-label={`Delete ${a.fileName}`} onClick={onDelete}>
              ✕
            </Button>
          )}
        </span>
      </div>
      {open && a.kind === "image" && (
        <a href={contentUrl(a)} target="_blank" rel="noreferrer">
          <img className="evidence-image" src={contentUrl(a)} alt={`Evidence: ${a.fileName}`} loading="lazy" />
        </a>
      )}
      {open && a.kind === "video" && (
        <video className="evidence-video" src={contentUrl(a)} controls preload="metadata">
          <track kind="captions" />
        </video>
      )}
      {open && a.kind === "text" && <TextPreview attachment={a} />}
    </li>
  );
}
