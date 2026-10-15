import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: pdf.getDocument }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf-worker" }));
import { observeClmPdfViewport, renderClmPdfPreview } from "./ClmPdfPreview";

function fixture(pages = 2) {
  const canvases: Record<string, unknown>[] = [];
  const context = {};
  const host = {
    clientWidth: 700,
    ownerDocument: { createElement: vi.fn(() => ({ style: {}, getContext: vi.fn(() => context), setAttribute: vi.fn() })) },
    replaceChildren: vi.fn(), append: vi.fn((canvas: Record<string, unknown>) => canvases.push(canvas)),
  };
  const tasks = Array.from({ length: pages }, () => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const page = tasks.map(task => ({ getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale })), render: vi.fn(() => task), cleanup: vi.fn() }));
  const loading = { promise: Promise.resolve({ numPages: pages, getPage: vi.fn(async (number: number) => page[number - 1]) }), destroy: vi.fn(async () => undefined) };
  pdf.getDocument.mockReturnValue(loading);
  return { host: host as unknown as HTMLDivElement, canvases, tasks, page, loading };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("Contract PDF preview readiness", () => {
  it("renders every page using copied bytes before reporting readiness", async () => {
    const f = fixture(); const bytes = new Uint8Array([1, 2, 3]);
    const pageCount = await renderClmPdfPreview(bytes, f.host, new AbortController().signal);
    expect(pageCount).toBe(2);
    expect(pdf.getDocument.mock.calls[0][0].data).toEqual(bytes);
    expect(pdf.getDocument.mock.calls[0][0].data).not.toBe(bytes);
    expect(f.canvases).toHaveLength(2);
    expect(f.page.every(page => page.render.mock.calls.length === 1 && page.cleanup.mock.calls.length === 1)).toBe(true);
    expect(f.loading.destroy).toHaveBeenCalledOnce();
  });
  it("does not finish until the last page finishes rendering", async () => {
    const f = fixture(); let finish!: () => void;
    f.tasks[1].promise = new Promise(resolve => { finish = resolve; });
    const ready = vi.fn(); const pending = renderClmPdfPreview(new Uint8Array([1]), f.host, new AbortController().signal).then(ready);
    await vi.waitFor(() => expect(f.page[1].render).toHaveBeenCalled());
    expect(ready).not.toHaveBeenCalled(); finish(); await pending; expect(ready).toHaveBeenCalledOnce();
  });
  it("rejects a page render failure instead of authorizing signing from a successful document load", async () => {
    const f = fixture(); f.page[1].render.mockImplementation(() => ({ promise: Promise.reject(new Error("Unable to render page 2")), cancel: vi.fn() }));
    await expect(renderClmPdfPreview(new Uint8Array([1]), f.host, new AbortController().signal)).rejects.toThrow("Unable to render page 2");
    expect(f.loading.destroy).toHaveBeenCalledOnce();
  });
  it("rejects a document with no reviewable pages", async () => {
    const f = fixture(0);
    await expect(renderClmPdfPreview(new Uint8Array([1]), f.host, new AbortController().signal)).rejects.toThrow("no pages");
    expect(f.canvases).toHaveLength(0);
  });
  it("cancels active rendering when review closes", async () => {
    const f = fixture(1); const controller = new AbortController(); let reject!: (reason: Error) => void;
    f.tasks[0].promise = new Promise((_, fail) => { reject = fail; });
    f.tasks[0].cancel.mockImplementation(() => reject(new Error("Rendering cancelled")));
    const pending = renderClmPdfPreview(new Uint8Array([1]), f.host, controller.signal);
    const failure = expect(pending).rejects.toThrow("Rendering cancelled");
    await vi.waitFor(() => expect(f.page[0].render).toHaveBeenCalled()); controller.abort(); await failure;
    expect(f.tasks[0].cancel).toHaveBeenCalledOnce(); expect(f.loading.destroy).toHaveBeenCalledOnce();
  });
  it("fits an entire page into the measured viewport without CSS enlargement", async () => {
    const f = fixture(1);
    await renderClmPdfPreview(new Uint8Array([1]), f.host, new AbortController().signal, { width: 1000, height: 600, fit: "page", pixelRatio: 2 });
    // A 600 x 800 point page becomes 450 x 600 CSS pixels, regardless of device density.
    expect(f.canvases[0]).toMatchObject({ width: 900, height: 1200, style: { width: "450px", height: "600px", maxWidth: "100%", margin: "0 auto 16px", transform: "none", zoom: "1", padding: "0" } });
    expect(f.page[0].render).toHaveBeenCalledWith(expect.objectContaining({ viewport: { width: 450, height: 600 }, transform: [2, 0, 0, 2, 0, 0] }));
    expect(f.canvases[0].className).not.toContain("w-full");
  });
  it("fits every page to a narrow viewport and keeps its aspect ratio", async () => {
    const f = fixture();
    await renderClmPdfPreview(new Uint8Array([1]), f.host, new AbortController().signal, { width: 300, height: 600, fit: "page", pixelRatio: 1.5 });
    for (const canvas of f.canvases) expect(canvas).toMatchObject({ width: 450, height: 600, style: { width: "300px", height: "400px" } });
  });
  it("keeps width-fit pages vertically scrollable instead of squeezing their height", async () => {
    const f = fixture(1);
    await renderClmPdfPreview(new Uint8Array([1]), f.host, new AbortController().signal, { width: 600, height: 300, fit: "width", pixelRatio: 1 });
    expect(f.canvases[0]).toMatchObject({ width: 600, height: 800, style: { width: "600px", height: "800px" } });
  });
  it("does not detach the caller's PDF bytes when PDF.js transfers its worker input", async () => {
    const f = fixture(1); const bytes = new Uint8Array([1, 2, 3]);
    pdf.getDocument.mockImplementation(({ data }: { data: Uint8Array }) => { structuredClone(data, { transfer: [data.buffer] }); return f.loading; });
    await renderClmPdfPreview(bytes, f.host, new AbortController().signal);
    expect([...bytes]).toEqual([1, 2, 3]);
  });
  it("does not attach a stale document when its load finishes after closing or resizing", async () => {
    const f = fixture(1); const controller = new AbortController();
    let complete!: (document: Awaited<typeof f.loading.promise>) => void;
    const document = await f.loading.promise;
    f.loading.promise = new Promise(resolve => { complete = resolve; });
    const pending = renderClmPdfPreview(new Uint8Array([1]), f.host, controller.signal);
    const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); complete(document); await failure;
    expect(f.host.replaceChildren).not.toHaveBeenCalled(); expect(f.canvases).toHaveLength(0);
    expect(f.loading.destroy).toHaveBeenCalledOnce();
  });
});

describe("Contract PDF viewport resizing", () => {
  it("remeasures width, height and browser zoom density and releases all observers on close", () => {
    let resize!: () => void;
    const observer = { observe: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe = observer.observe; disconnect = observer.disconnect; });
    const frames = new Map<number, () => void>(); let nextFrame = 0;
    const view = {
      devicePixelRatio: 1,
      getComputedStyle: vi.fn(() => ({ paddingTop: "24px", paddingBottom: "24px" })),
      requestAnimationFrame: vi.fn((callback: () => void) => { const id = ++nextFrame; frames.set(id, callback); return id; }),
      cancelAnimationFrame: vi.fn((id: number) => { frames.delete(id); }),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      visualViewport: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    };
    const viewport = { clientHeight: 648, ownerDocument: { defaultView: view } };
    const host = { clientWidth: 1000 };
    const onResize = vi.fn();
    const stop = observeClmPdfViewport(host as HTMLDivElement, viewport as unknown as HTMLDivElement, onResize);
    const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
    expect(onResize).toHaveBeenLastCalledWith({ width: 1000, height: 600, pixelRatio: 1 });
    resize(); flush(); expect(onResize).toHaveBeenCalledOnce();
    host.clientWidth = 650; viewport.clientHeight = 448; view.devicePixelRatio = 1.25;
    resize(); flush(); expect(onResize).toHaveBeenLastCalledWith({ width: 650, height: 400, pixelRatio: 1.25 });
    view.devicePixelRatio = 1.5;
    const browserResize = view.addEventListener.mock.calls.find(([name]) => name === "resize")![1] as () => void;
    browserResize(); flush(); expect(onResize).toHaveBeenLastCalledWith({ width: 650, height: 400, pixelRatio: 1.5 });
    expect(observer.observe).toHaveBeenCalledWith(host); expect(observer.observe).toHaveBeenCalledWith(viewport);
    resize(); stop(); expect(frames.size).toBe(0); expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(view.removeEventListener).toHaveBeenCalledWith("resize", browserResize);
    expect(view.visualViewport.removeEventListener).toHaveBeenCalledWith("resize", browserResize);
  });
});
