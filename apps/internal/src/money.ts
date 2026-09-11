export function piastersToEgpInput(piasters: number): string {
  const pounds = Math.trunc(piasters / 100);
  const fraction = Math.abs(piasters % 100);
  if (fraction === 0) {
    return String(pounds);
  }
  return `${pounds}.${fraction.toString().padStart(2, "0")}`;
}

export function egpInputToPiasters(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const [pounds, fractions = ""] = trimmed.split(".");
  return Number(pounds) * 100 + Number(fractions.padEnd(2, "0"));
}

export function formatEgpFromPiasters(piasters: number): string {
  return `${piastersToEgpInput(piasters)} ج.م.`;
}
