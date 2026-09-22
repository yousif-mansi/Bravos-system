/** Surface the browser's existing constraints without changing submission or validity. */
export function installValidationFeedback(root: HTMLElement) {
  const reported = new WeakSet<Element>();
  function field(target: EventTarget | null) {
    return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement
      ? target : null;
  }
  function invalid(event: Event) {
    const target = field(event.target);
    if (!target) return;
    reported.add(target);
    target.setAttribute("aria-invalid", "true");
  }
  function update(event: Event) {
    const target = field(event.target);
    if (!target || !reported.has(target)) return;
    target.setAttribute("aria-invalid", String(!target.validity.valid));
  }
  function reset(event: Event) {
    if (!(event.target instanceof HTMLFormElement)) return;
    for (const target of event.target.elements) {
      if (reported.has(target)) {
        target.removeAttribute("aria-invalid");
        reported.delete(target);
      }
    }
  }
  root.addEventListener("invalid", invalid, true);
  root.addEventListener("input", update);
  root.addEventListener("change", update);
  root.addEventListener("reset", reset);
  return () => {
    root.removeEventListener("invalid", invalid, true);
    root.removeEventListener("input", update);
    root.removeEventListener("change", update);
    root.removeEventListener("reset", reset);
  };
}
