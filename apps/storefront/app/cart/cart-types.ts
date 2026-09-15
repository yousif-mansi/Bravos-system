export type CartLine = {
  productId: string;
  variantId: string;
  productNameAr: string;
  sizeNameAr: string;
  colorNameAr: string;
  unitPricePiasters: number;
  imageRef: string | null;
  quantity: number;
  knownAvailableQuantity: number;
  orderable: boolean;
};

export type AddCartLine = Omit<CartLine, "quantity"> & { quantity?: number };
