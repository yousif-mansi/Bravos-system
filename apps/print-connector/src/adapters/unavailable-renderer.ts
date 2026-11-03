export type UnavailableRender = { ok: false; reason: "renderer_unavailable" };

/**
 * C1 has no label or receipt renderer. This object cannot report success.
 * The Windows print port also refuses a successful result if one is ever added
 * without replacing the submission path.
 */
export const UNAVAILABLE_RENDERER = {
  render(): UnavailableRender {
    return { ok: false, reason: "renderer_unavailable" };
  },
};
