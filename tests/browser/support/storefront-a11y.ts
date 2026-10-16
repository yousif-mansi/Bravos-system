import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

export type ContrastSample = {
  id: string;
  mode: "text" | "placeholder" | "boundary" | "outline";
  exempt: boolean;
  exemptReason: string | null;
  manual: boolean;
  manualReason: string | null;
  ratio: number | null;
  threshold: number | null;
  large: boolean;
  fontSize: number;
  fontWeight: number;
  color: string;
  background: string;
  backgroundKind: string;
  text: string;
};

type Rgb = { r: number; g: number; b: number; a: number };

// Browser-side contrast measurement. Playwright serializes this function, so it
// cannot call the other helpers in this module.
export function measureContrast(element: Element, options: { id: string; mode: ContrastSample["mode"] }): ContrastSample {
  const sampleElement = element as HTMLElement;
  const style = getComputedStyle(sampleElement);
  const fontSize = Number.parseFloat(style.fontSize);
  const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
  const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
  const base: ContrastSample = {
    id: options.id,
    mode: options.mode,
    exempt: false,
    exemptReason: null,
    manual: false,
    manualReason: null,
    ratio: null,
    threshold: options.mode === "text" || options.mode === "placeholder" ? (large ? 3 : 4.5) : 3,
    large,
    fontSize,
    fontWeight,
    color: "",
    background: "",
    backgroundKind: "",
    text: (sampleElement.innerText || sampleElement.textContent || "").trim().slice(0, 160),
  };

  if (isInactive(sampleElement)) {
    return {
      ...base,
      exempt: true,
      exemptReason: "WCAG 1.4.3 and 1.4.11 exempt text and boundaries of inactive user-interface components. Disabled storefront controls stay out of the contrast assertion.",
    };
  }

  const foreground = options.mode === "placeholder"
    ? getComputedStyle(sampleElement, "::placeholder").color
    : options.mode === "outline"
      ? style.outlineColor
      : options.mode === "boundary"
        ? visibleBorderColor(style)
        : style.color;
  if (!foreground) {
    return { ...base, manual: true, manualReason: "No painted border or outline was found to compare." };
  }
  const parsedForeground = parseColor(foreground);
  if (!parsedForeground) throw new Error(`Unexpected computed color: ${foreground}`);
  const surface = resolveSurface(options.mode === "outline" ? sampleElement.parentElement ?? sampleElement : sampleElement);
  if (surface.kind === "manual") {
    return { ...base, color: foreground, manual: true, manualReason: surface.reason, backgroundKind: "manual", ratio: null };
  }
  const ratio = contrastRatio(parsedForeground, surface.color);
  return {
    ...base,
    color: foreground,
    background: formatRgb(surface.color),
    backgroundKind: surface.kind,
    ratio: Number(ratio.toFixed(2)),
  };

  function isInactive(node: HTMLElement) {
    if (node.matches(":disabled") || node.getAttribute("aria-disabled") === "true") return true;
    if (node.closest("fieldset[disabled], [aria-disabled='true']")) return true;
    return node instanceof HTMLLabelElement && Boolean(node.querySelector(":disabled, [aria-disabled='true']"));
  }

  function visibleBorderColor(computed: CSSStyleDeclaration) {
    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      if (Number.parseFloat(computed.getPropertyValue(`border-${side.toLowerCase()}-width`)) >= 1) {
        return computed.getPropertyValue(`border-${side.toLowerCase()}-color`);
      }
    }
    return "";
  }

  function resolveSurface(start: Element): { kind: "solid"; color: Rgb } | { kind: "manual"; reason: string } {
    let over: Rgb = { r: 0, g: 0, b: 0, a: 0 };
    let node: Element | null = start;
    while (node) {
      const computed = getComputedStyle(node);
      const image = computed.backgroundImage;
      // background-image paints above background-color. A visible gradient or image is manual evidence.
      if (image && image !== "none" && over.a < 0.99) {
        return { kind: "manual", reason: "A visible background image or gradient is behind this text. It is manual evidence and is not flattened into an opaque color." };
      }
      const painted = parseColor(computed.backgroundColor);
      const glass = computed.backdropFilter && computed.backdropFilter !== "none";
      if (glass && over.a < 0.99 && (!painted || painted.a < 0.99)) {
        return { kind: "manual", reason: "Backdrop blur leaves the surface translucent. The content behind the glass is not an opaque color and needs manual evidence." };
      }
      if (painted && painted.a > 0) over = composite(over, painted);
      if (over.a >= 0.99) return { kind: "solid", color: { ...over, a: 1 } };
      node = node.parentElement;
    }
    return { kind: "manual", reason: "No opaque background was found. Transparent pixels are not replaced with white." };
  }

  function parseColor(color: string): Rgb | null {
    const match = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i);
    if (!match) return null;
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) };
  }

  function blend(front: Rgb, back: Rgb): Rgb {
    return {
      r: front.r * front.a + back.r * (1 - front.a),
      g: front.g * front.a + back.g * (1 - front.a),
      b: front.b * front.a + back.b * (1 - front.a),
      a: 1,
    };
  }

  function composite(front: Rgb, back: Rgb): Rgb {
    const alpha = front.a + back.a * (1 - front.a);
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha,
      g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha,
      b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha,
      a: alpha,
    };
  }

  function luminance(color: Rgb) {
    const linear = [color.r, color.g, color.b].map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }

  function contrastRatio(foregroundColor: Rgb, background: Rgb) {
    const foregroundSolid = foregroundColor.a >= 1 ? foregroundColor : blend(foregroundColor, background);
    const values = [luminance(foregroundSolid), luminance(background)].sort((left, right) => right - left);
    return (values[0] + 0.05) / (values[1] + 0.05);
  }

  function formatRgb(color: Rgb) {
    return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
  }
}

export async function expectContrast(sample: ContrastSample) {
  if (sample.exempt) {
    expect(sample.exemptReason, sample.id).toContain("inactive");
    return sample;
  }
  if (sample.manual) {
    expect(sample.manualReason, sample.id).toBeTruthy();
    expect(sample.ratio, `${sample.id} manual evidence is not a contrast pass`).toBeNull();
    return sample;
  }
  expect(sample.ratio, `${sample.id} ${sample.backgroundKind} ${sample.color} on ${sample.background}`).toBeGreaterThanOrEqual(sample.threshold ?? 4.5);
  return sample;
}

export type TargetViolation = {
  tag: string;
  type: string | null;
  text: string;
  width: number;
  height: number;
  labelWidth: number;
  labelHeight: number;
};

export function collectTargetViolations(): TargetViolation[] {
  const violations: TargetViolation[] = [];
  const controls = [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary")];
  for (const element of controls) {
    if (hidden(element) || inactive(element)) continue;
    if (element instanceof HTMLInputElement && (element.type === "radio" || element.type === "checkbox")) {
      const label = element.closest("label") ?? (element.id ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(element.id)}"]`) : null);
      if (!label || hidden(label)) {
        violations.push(boxOf(element, element.getBoundingClientRect(), "missing-label"));
        continue;
      }
      const labelBox = label.getBoundingClientRect();
      if (labelBox.width < 44 || labelBox.height < 44) violations.push(boxOf(element, labelBox, "label"));
      continue;
    }
    const box = element.getBoundingClientRect();
    if (box.width < 44 || box.height < 44) violations.push(boxOf(element, box, "control"));
  }
  return violations;

  function hidden(element: HTMLElement) {
    if (element.closest("[hidden], [inert], [aria-hidden='true']")) return true;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return true;
    const box = element.getBoundingClientRect();
    return box.width <= 1 || box.height <= 1;
  }

  function inactive(element: HTMLElement) {
    if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") return true;
    return Boolean(element.closest("fieldset[disabled], [aria-disabled='true']"));
  }

  function boxOf(element: HTMLElement, box: DOMRect, kind: string): TargetViolation {
    const label = element.closest("label")?.getBoundingClientRect();
    return {
      tag: element.tagName,
      type: element.getAttribute("type") ?? kind,
      text: (element.getAttribute("aria-label") || element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
      width: Math.round(box.width),
      height: Math.round(box.height),
      labelWidth: Math.round(label?.width ?? box.width),
      labelHeight: Math.round(label?.height ?? box.height),
    };
  }
}

export async function expectTargetCoverage(page: Page) {
  const violations = await page.evaluate(collectTargetViolations);
  expect(violations, "visible enabled targets are at least 44 by 44 CSS pixels").toEqual([]);
}

export async function expectTargetSize(target: Locator) {
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
}

export async function expectKeyboardFocus(target: Locator) {
  await expect(target).toBeFocused();
  await expect(target).toBeVisible();
  await expect(target).toBeInViewport();
  let focusEvidence: unknown;
  try {
    await expect.poll(async () => {
      focusEvidence = await target.evaluate((element) => {
        const indicator = element.matches('input[type="radio"]') ? element.closest("label")! : element;
        const style = getComputedStyle(indicator);
        const chain: string[] = [];
        let node: Element | null = element;
        while (node) {
          const className = typeof (node as HTMLElement).className === "string" ? (node as HTMLElement).className : "";
          chain.push(`${node.tagName}${node.id ? `#${node.id}` : ""}${className ? `.${className.split(/\s+/).slice(0, 3).join(".")}` : ""}`);
          node = node.parentElement;
        }
        return {
          tag: element.tagName,
          id: element.id,
          className: typeof element.className === "string" ? element.className.slice(0, 200) : "",
          role: element.getAttribute("role"),
          ariaLabel: element.getAttribute("aria-label"),
          text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160),
          focusVisible: indicator.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          outlineColor: style.outlineColor,
          outlineOffset: style.outlineOffset,
          boxShadow: style.boxShadow,
          border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
          chain,
        };
      });
      const evidence = focusEvidence as { outlineStyle: string; outlineWidth: string };
      return evidence.outlineStyle !== "none" && Number.parseFloat(evidence.outlineWidth) > 0;
    }, "keyboard focus has a visible indicator").toBe(true);
  } catch (error) {
    const evidencePath = test.info().outputPath("focus-indicator.json");
    await writeFile(evidencePath, JSON.stringify(focusEvidence, null, 2));
    await test.info().attach("focus-indicator.json", { path: evidencePath, contentType: "application/json" });
    await target.page().screenshot({ path: test.info().outputPath("focus-indicator.png") });
    throw error;
  }
  let geometry: unknown;
  try {
    await expect.poll(async () => {
      geometry = await target.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        const hit = document.elementFromPoint(centerX, centerY);
        const style = getComputedStyle(element);
        const rootStyle = getComputedStyle(document.documentElement);
        const bar = document.querySelector('[aria-label="Add product to bag"]');
        return {
          unobscured: centerX >= 0 && centerX < innerWidth && centerY >= 0 && centerY < innerHeight
            && Boolean(hit && (element === hit || element.contains(hit))),
          tag: element.tagName,
          publicText: element.textContent?.trim().slice(0, 120),
          bounds: box.toJSON(),
          center: { x: centerX, y: centerY },
          hitTag: hit?.tagName ?? null,
          hitPublicText: hit?.textContent?.trim().slice(0, 120) ?? null,
          viewport: { width: innerWidth, height: innerHeight, scrollY },
          rootScrollPadding: { start: rootStyle.scrollPaddingBlockStart, end: rootStyle.scrollPaddingBlockEnd },
          computedScrollMargin: { start: style.scrollMarginBlockStart, end: style.scrollMarginBlockEnd },
          mobileBar: bar ? { bounds: bar.getBoundingClientRect().toJSON(), visibility: getComputedStyle(bar).visibility } : null,
        };
      });
      return geometry;
    }, "keyboard focus is inside the viewport and unobscured").toMatchObject({ unobscured: true });
  } catch (error) {
    await target.page().screenshot({ path: test.info().outputPath("focus-obstruction.png") });
    const geometryPath = test.info().outputPath("focus-obstruction.json");
    await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
    await test.info().attach("focus-obstruction.json", { path: geometryPath, contentType: "application/json" });
    throw error;
  }
}

// Advance with real Tab presses, without programmatic focus or a fixed DOM order.
export async function tabTo(page: Page, target: Locator, unavailable?: Locator) {
  await expect(target).toBeVisible();
  const readBound = () => page.evaluate(() => {
    function tabbable(element: Element) {
      if (!(element instanceof HTMLElement)) return false;
      if (element.tabIndex < 0 || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
      if (element.closest("[hidden], [inert]")) return false;
      if (element instanceof HTMLInputElement && element.type === "hidden") return false;
      if (element.closest("details:not([open])") && element.tagName !== "SUMMARY") return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    }
    return [...document.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex]")].filter(tabbable).length;
  });
  let bound = await readBound();
  expect(bound, "rendered tabbable controls").toBeGreaterThan(0);
  const seen = new Set<string>();
  let categoryLinks = 0;
  let productSteps = 0;
  for (let presses = 0; presses < bound + 8; presses += 1) {
    await page.keyboard.press("Tab");
    if (unavailable) await expect(unavailable).not.toBeFocused();
    const focusKind = await page.evaluate(() => {
      const overlay = (start: EventTarget | null) => {
        let node: Node | null = start instanceof Node ? start : null;
        while (node) {
          if (node instanceof Element && (node.id === "next-logo" || node.id === "devtools-indicator" || node.classList.contains("nextjs-toast") || node.tagName === "NEXTJS-PORTAL" || (node.getAttribute("aria-label") ?? "").includes("Next.js Dev Tools"))) return true;
          const root = node.getRootNode();
          if (root instanceof ShadowRoot && root.host && root.host !== node) {
            node = root.host;
            continue;
          }
          node = node.parentNode;
        }
        return false;
      };
      let node = document.activeElement;
      if (!node || node === document.body || node === document.documentElement) return "none";
      if (overlay(node)) return "overlay";
      const openShadow = node.shadowRoot?.activeElement;
      if (openShadow && overlay(openShadow)) return "overlay";
      return "product";
    });
    // The Next.js dev indicator is injected only by `next dev`. It is not a production control.
    if (focusKind !== "product") continue;
    const focused = page.locator(":focus").filter({ hasNot: page.locator(":focus") });
    await expectKeyboardFocus(focused);
    productSteps += 1;
    const identity = await focused.evaluate((element) => {
      const parts: string[] = [];
      let node: Element | null = element;
      while (node && node !== document.documentElement) {
        const parent: HTMLElement | null = node.parentElement;
        const index = parent ? Array.prototype.indexOf.call(parent.children, node) : 0;
        parts.push(`${node.tagName}:${index}`);
        node = parent;
      }
      return parts.join(">");
    });
    if (seen.has(identity)) {
      throw new Error(`Focus cycled at ${identity} after ${presses + 1} Tab presses before reaching ${target}. Rendered tabbable controls: ${bound}.`);
    }
    seen.add(identity);
    const href = await focused.evaluate((element) => element.getAttribute("href"));
    if (href?.includes("category=")) categoryLinks += 1;
    // Native Tab can load more category cards. Keep the traversal bound tied to
    // rendered controls while retaining the cycle and per-focus safety checks.
    bound = Math.max(bound, await readBound());
    if (productSteps > bound) break;
    if (await target.count() > 0 && await target.evaluate((element) => element === document.activeElement)) {
      return { steps: presses + 1, categoryLinks };
    }
  }
  throw new Error(`Keyboard could not reach ${target} within ${bound} rendered tabbable controls`);
}
