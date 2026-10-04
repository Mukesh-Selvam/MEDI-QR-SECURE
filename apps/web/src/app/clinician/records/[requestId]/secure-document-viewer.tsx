"use client";

import { useEffect, useRef, useState } from "react";

interface SecureDocumentViewerProps {
  documentId: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
}

export function SecureDocumentViewer({
  documentId,
  mimeType,
}: SecureDocumentViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let pdfTask: { destroy: () => Promise<void> } | undefined;
    let renderTasks: Array<{ cancel: () => void }> = [];
    let imageUrl: string | undefined;
    let disposed = false;

    const loadDocument = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/v1/vault/${documentId}/stream`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("This record is no longer available.");
        }
        const bytes = await response.arrayBuffer();
        if (disposed) return;

        if (mimeType === "application/pdf") {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url
          ).toString();
          const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
          pdfTask = task;
          const pdf = await task.promise;
          const canvas = canvasRef.current;
          const container = canvas?.parentElement;
          if (!canvas || !container || disposed) return;

          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1.25 });
            const pageCanvas =
              pageNumber === 1 ? canvas : document.createElement("canvas");
            const context = pageCanvas.getContext("2d");
            if (!context) throw new Error("The record viewer could not be started.");
            pageCanvas.width = viewport.width;
            pageCanvas.height = viewport.height;
            pageCanvas.setAttribute("aria-label", `Document page ${pageNumber}`);
            pageCanvas.className =
              "block h-auto max-w-full border border-[#E7D9E2] bg-white";
            if (pageNumber > 1) container.append(pageCanvas);
            const renderTask = page.render({ canvas: pageCanvas, canvasContext: context, viewport });
            renderTasks = [...renderTasks, renderTask];
            await renderTask.promise;
            if (disposed) return;
          }
        } else {
          const canvas = canvasRef.current;
          if (!canvas) return;
          imageUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
          const image = new Image();
          image.src = imageUrl;
          await image.decode();
          if (disposed) return;
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("The record viewer could not be started.");
          context.drawImage(image, 0, 0);
          canvas.className =
            "block h-auto max-h-[70vh] max-w-full border border-[#E7D9E2] bg-white object-contain";
        }
        if (!disposed) setLoading(false);
      } catch {
        if (!disposed && !controller.signal.aborted) {
          setError("The record could not be opened. Access may have ended.");
          setLoading(false);
        }
      }
    };

    void loadDocument();
    return () => {
      disposed = true;
      controller.abort();
      for (const task of renderTasks) task.cancel();
      if (pdfTask) void pdfTask.destroy();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [documentId, mimeType]);

  return (
    <section
      aria-label="Read-only secure record viewer"
      className="rounded-xl border border-[#E5D8E1] bg-[#F7F2F6] p-4 dark:border-[#493A4A] dark:bg-[#211923]"
    >
      {loading && (
        <p className="py-8 text-center text-sm text-[#5D4D5A] dark:text-[#D4C6D2]" role="status">
          Opening this record securely…
        </p>
      )}
      {error && <p role="alert" className="py-6 text-sm text-red-800 dark:text-red-300">{error}</p>}
      <div className="max-h-[70vh] space-y-4 overflow-auto" hidden={loading || Boolean(error)}>
        <canvas ref={canvasRef} aria-label="Document page 1" />
      </div>
      <p className="mt-3 text-xs text-[#6B5A72] dark:text-[#C8B8C7]">
        Read-only view. Saving and downloading are not available.
      </p>
    </section>
  );
}
