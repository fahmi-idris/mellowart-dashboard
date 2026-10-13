import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../docs/webflow-auto-expand.txt", import.meta.url), "utf8")
  .replace(/^<script>\s*/, "")
  .replace(/\s*<\/script>\s*$/, "");

function setup(readyState = "complete") {
  class Textarea {
    visible = true;
    scrollHeight = 200;
    height = "80px";
    style = {
      setProperty: (key: string, value: string, priority: string) => {
        expect(priority).toBe("important");
        if (key === "height") this.height = value;
      },
    };
    getClientRects() {
      return this.visible ? [{}] : [];
    }
    getBoundingClientRect() {
      return { height: parseFloat(this.height) };
    }
  }
  const artistBio = new Textarea();
  const productInfo = new Textarea();
  const buddy = new Textarea();
  buddy.visible = false;
  const fields = [artistBio, productInfo, buddy];
  const handlers: Record<string, (event: { target: unknown }) => void> = {};
  const form = {
    dataset: {},
    querySelectorAll: () => fields,
    addEventListener: (name: string, handler: (typeof handlers)[string]) => {
      handlers[name] = handler;
    },
  };
  let loaded: (() => void) | undefined;
  let observe: ((mutations: { type: string; target: unknown }[]) => void) | undefined;
  const frames: (() => void)[] = [];
  const context = {
    document: {
      readyState,
      getElementById: () => form,
      addEventListener: (_name: string, handler: () => void) => {
        loaded = handler;
      },
    },
    window: { addEventListener: () => {} },
    HTMLTextAreaElement: Textarea,
    getComputedStyle: () => ({ borderTopWidth: "1px", borderBottomWidth: "1px" }),
    requestAnimationFrame: (fn: () => void) => {
      frames.push(fn);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
    MutationObserver: class {
      constructor(callback: typeof observe) {
        observe = callback;
      }
      observe() {}
    },
  };
  const flush = () => {
    while (frames.length) frames.shift()!();
  };
  runInNewContext(source, context);
  return {
    artistBio,
    productInfo,
    buddy,
    fields,
    handlers,
    frames,
    flush,
    context,
    load: () => loaded?.(),
    mutate: (target: unknown) => observe?.([{ type: "attributes", target }]),
  };
}

describe("copy-ready Webflow auto-expand script", () => {
  it("runs after late injection and expands artist bio and product info, not only the last field", () => {
    const ui = setup();
    ui.flush();
    expect(ui.artistBio.height).toBe("202px");
    expect(ui.productInfo.height).toBe("202px");
    ui.artistBio.scrollHeight = 350;
    ui.handlers.input({ target: ui.artistBio });
    expect(ui.artistBio.height).toBe("352px");
    ui.artistBio.scrollHeight = 20;
    ui.handlers.input({ target: ui.artistBio });
    expect(ui.artistBio.height).toBe("80px");
  });

  it("waits for DOMContentLoaded while loading, and initializes only once", () => {
    const ui = setup("loading");
    expect(ui.handlers.input).toBeUndefined();
    ui.load();
    ui.flush();
    expect(ui.artistBio.height).toBe("202px");
    const handler = ui.handlers.input;
    runInNewContext(source, ui.context);
    ui.load();
    expect(ui.handlers.input).toBe(handler);
  });

  it("resizes newly shown buddy fields without observing its own style changes repeatedly", () => {
    const ui = setup();
    ui.flush();
    expect(ui.buddy.height).toBe("80px");
    ui.buddy.visible = true;
    ui.mutate({ section: "buddy" });
    ui.flush();
    expect(ui.buddy.height).toBe("202px");
    ui.mutate(ui.artistBio);
    expect(ui.frames).toHaveLength(0);
  });
});
