/** Native folder drops arrive in batches; read every batch, preserving paths. */
type Entry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, failure: (error: DOMException) => void) => void;
  createReader?: () => { readEntries: (success: (entries: Entry[]) => void, failure: (error: DOMException) => void) => void };
};
type DropItem = { kind: string; getAsFile: () => File | null; webkitGetAsEntry?: () => Entry | null };
type DropTransfer = { items: ArrayLike<DropItem>; files: ArrayLike<File> };

export function importFilePath(file: File) {
  return file.webkitRelativePath || file.name;
}

function atPath(file: File, path: string) {
  // Keep the original File and its basename. Both the image loader and the
  // annotation matcher read this browser-standard relative-path property.
  Object.defineProperty(file, "webkitRelativePath", { value: path, configurable: true });
  return file;
}

export async function filesFromDrop(transfer: DropTransfer): Promise<File[]> {
  // Capture entries/files synchronously, before the browser clears DataTransfer
  // at the end of the drop event's dispatch.
  const fallback = Array.from(transfer.files);
  const roots = Array.from(transfer.items).filter(item => item.kind === "file")
    .map(item => ({ entry: item.webkitGetAsEntry?.() ?? null, file: item.getAsFile() }));
  const files: File[] = [];
  async function walk(entry: Entry, parent: string) {
    if (entry.name.startsWith(".") || entry.name === "__MACOSX") return;
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    if (entry.isFile && entry.file) {
      const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
      files.push(atPath(file, path));
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, path);
      }
    }
  }
  for (const root of roots) {
    if (root.entry) await walk(root.entry, "");
    else if (root.file) files.push(root.file);
  }
  return roots.length ? files : fallback;
}

export function classifyImportFiles(files: File[]) {
  const images: File[] = [], annotations: File[] = [], projects: File[] = [], unsupported: File[] = [];
  for (const file of files) {
    if (/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) images.push(file);
    else if (/\.(json|zip|txt|names|ya?ml)$/i.test(file.name)) annotations.push(file);
    else if (/\.plgm$/i.test(file.name)) projects.push(file);
    else unsupported.push(file);
  }
  return { images, annotations, projects, unsupported };
}
