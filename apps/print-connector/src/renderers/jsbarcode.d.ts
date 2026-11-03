declare module "jsbarcode" {
  type JsBarcodeTarget = {
    encodings?: { data?: string; binary?: string; text?: string }[];
  };

  function JsBarcode(
    target: JsBarcodeTarget,
    value: string,
    options?: {
      format?: string;
      displayValue?: boolean;
      margin?: number;
      marginLeft?: number;
      marginRight?: number;
      ean128?: boolean;
    },
  ): void;

  export default JsBarcode;
}
