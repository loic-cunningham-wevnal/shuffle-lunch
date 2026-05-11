"use client";

import { useEffect, useRef, useState } from "react";

type Options = {
  // The set of file extensions to accept (lowercase, with leading dot).
  // Files outside this list are silently ignored.
  accept: string[];
  onFile: (file: File) => void;
};

type State = {
  // True whenever an OS-originated file drag is currently over the window.
  // Drives the visual overlay; reset on drop / dragleave / dragend.
  isDraggingFile: boolean;
};

// Window-level drag-and-drop file capture. Listens at the document so any
// drop anywhere on the page triggers the import — there's no specific drop
// zone to find. Only OS-file drags trigger the overlay; in-app member drags
// (which use a custom MIME) are ignored.
//
// We track nested dragenter/dragleave events with a counter because every
// child the cursor passes over fires its own enter/leave pair. Without the
// counter, the overlay flickers as the user moves between elements.
export function useFileDrop({ accept, onFile }: Options): State {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const counterRef = useRef(0);
  const acceptSet = useRef(new Set(accept.map((e) => e.toLowerCase())));
  acceptSet.current = new Set(accept.map((e) => e.toLowerCase()));

  useEffect(() => {
    function isFileDrag(e: DragEvent): boolean {
      // Browsers expose the file MIME flag as a 'Files' entry in
      // dataTransfer.types. Member drags use 'application/x-shuffle-lunch-…'
      // and won't include 'Files'.
      return Boolean(e.dataTransfer?.types?.includes("Files"));
    }

    function onDragEnter(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      counterRef.current += 1;
      if (counterRef.current === 1) setIsDraggingFile(true);
    }

    function onDragOver(e: DragEvent) {
      if (!isFileDrag(e)) return;
      // Without preventDefault on dragover, the browser's default behavior is
      // to treat the page as a non-droppable target — and onDrop never fires.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }

    function onDragLeave(e: DragEvent) {
      if (!isFileDrag(e)) return;
      counterRef.current = Math.max(0, counterRef.current - 1);
      if (counterRef.current === 0) setIsDraggingFile(false);
    }

    function onDrop(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      counterRef.current = 0;
      setIsDraggingFile(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      // Take the first matching file. Multi-file imports could come later but
      // the import operation is destructive (replaces the snapshot), so doing
      // them one at a time is the right default.
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        const dot = f.name.lastIndexOf(".");
        const ext = dot >= 0 ? f.name.slice(dot).toLowerCase() : "";
        if (acceptSet.current.has(ext)) {
          onFile(f);
          return;
        }
      }
    }

    function onDragEnd() {
      counterRef.current = 0;
      setIsDraggingFile(false);
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, [onFile]);

  return { isDraggingFile };
}
