import {
  LABEL_COPIES_MAX,
  LABEL_COPIES_MIN,
  LABEL_DPI,
  LABEL_PAPER_HEIGHT_MM,
  LABEL_PAPER_WIDTH_MM,
  LABEL_PROFILE,
  PRODUCT_NAME_MAX,
} from "./constants.ts";
import {
  exactKeys,
  isDisplayText,
  isInteger,
  isProductCode,
  isSafeTree,
  parseJobId,
} from "./text.ts";

export type LabelJob = {
  kind: "label";
  id: string;
  copies: number;
  product: {
    code: string;
    name: string;
  };
  paper: {
    widthMm: typeof LABEL_PAPER_WIDTH_MM;
    heightMm: typeof LABEL_PAPER_HEIGHT_MM;
  };
  dpi: typeof LABEL_DPI;
  profile: typeof LABEL_PROFILE;
};

export function parseLabelJob(value: unknown): LabelJob | null {
  if (!isSafeTree(value)) return null;
  const record = exactKeys(value, ["kind", "id", "copies", "product", "paper", "dpi", "profile"]);
  if (!record || record.kind !== "label") return null;
  const id = parseJobId(record.id);
  const copies = record.copies;
  if (!id || !isInteger(copies, LABEL_COPIES_MIN, LABEL_COPIES_MAX)) return null;
  if (record.dpi !== LABEL_DPI || record.profile !== LABEL_PROFILE) return null;
  const paper = exactKeys(record.paper, ["widthMm", "heightMm"]);
  if (!paper || paper.widthMm !== LABEL_PAPER_WIDTH_MM || paper.heightMm !== LABEL_PAPER_HEIGHT_MM) return null;
  const product = exactKeys(record.product, ["code", "name"]);
  const code = product?.code;
  const name = product?.name;
  if (!isProductCode(code) || !isDisplayText(name, PRODUCT_NAME_MAX)) return null;
  return {
    kind: "label",
    id,
    copies,
    product: { code, name },
    paper: { widthMm: LABEL_PAPER_WIDTH_MM, heightMm: LABEL_PAPER_HEIGHT_MM },
    dpi: LABEL_DPI,
    profile: LABEL_PROFILE,
  };
}
