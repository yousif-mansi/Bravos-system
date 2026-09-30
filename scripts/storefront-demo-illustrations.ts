import { createRequire } from "node:module";
import path from "node:path";

/** Owned vector sample artwork. These are illustrations, never merchandise photographs. */
export async function demoIllustration(repoRoot: string, kind: number, color: string, detail = false): Promise<{ svg: string; png: Buffer }> {
  const storefrontRequire = createRequire(path.join(repoRoot, "apps/storefront/package.json"));
  const nextRequire = createRequire(storefrontRequire.resolve("next/package.json"));
  // Reuse Next's installed image runtime, without adding a direct app dependency.
  const sharp = nextRequire("sharp") as (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } };
  const shapes = [
    `<path d="M240 175 180 198 115 285 165 323 207 278 207 605 393 605 393 278 435 323 485 285 420 198 360 175 Q300 227 240 175Z"/><path d="M264 183 Q300 216 336 183" fill="none" stroke="#ffffff88" stroke-width="8"/>`,
    `<path d="M240 166 180 198 137 604 208 604 227 288 227 618 373 618 373 288 392 604 463 604 420 198 360 166 300 207Z"/><path d="M300 207 V618 M240 166 270 234 300 207 330 234 360 166" fill="none" stroke="#ffffff88" stroke-width="5"/><path d="M317 270 V570" stroke="#ffffff88" stroke-width="8" stroke-dasharray="3 45"/>`,
    `<path d="M213 163 H387 L407 352 385 640 314 640 300 376 286 640 215 640 193 352Z"/><path d="M213 196 H387 M300 196 V376 M222 223 206 282 M378 223 394 282" fill="none" stroke="#ffffff88" stroke-width="5"/>`,
    `<path d="M245 165 180 196 123 584 202 599 229 306 221 631 379 631 371 306 398 599 477 584 420 196 355 165 300 213Z"/><path d="M300 213 V631 M245 165 256 262 300 213 344 262 355 165 M243 450 H281 M319 450 H357" fill="none" stroke="#ffffff88" stroke-width="5"/>`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750"><rect width="600" height="750" fill="#eeeae2"/><ellipse cx="300" cy="657" rx="167" ry="19" fill="#d2cdc2"/><g transform="${detail ? "translate(-75 -70) scale(1.25)" : "translate(0 0)"}" fill="${color}" stroke="#25252533" stroke-width="3" stroke-linejoin="round">${shapes[kind % shapes.length]}</g><rect y="675" width="600" height="75" fill="#eeeae2"/><text x="300" y="705" text-anchor="middle" fill="#68645c" font-family="sans-serif" font-size="16" letter-spacing="3">DEVELOPMENT SAMPLE · ILLUSTRATION</text></svg>`;
  return { svg, png: await sharp(Buffer.from(svg)).png().toBuffer() };
}
