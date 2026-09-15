import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UploadedProductMediaDto } from "@bravos/contracts";
import sharp from "sharp";
import {
  MAX_PRODUCT_IMAGE_DIMENSION,
  MAX_PRODUCT_IMAGE_PIXELS,
  validateProductImage,
  type ProductImageContentType,
  type ValidatedProductImage,
} from "../domain/media.ts";
import { CatalogValidationError } from "../domain/errors.ts";
import { assertProductMediaRef } from "../domain/product.ts";
import type { ProductMediaStorage } from "../application/ports.ts";

export function createLocalProductMediaStorage(rootDirectory: string): ProductMediaStorage {
  const root = path.resolve(rootDirectory);
  return {
    async save(input): Promise<UploadedProductMediaDto> {
      await assertDecodableImage(input);
      const ref = `products/${randomUUID()}.${input.extension}`;
      const destination = resolveRef(root, ref);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, input.bytes, { flag: "wx", mode: 0o640 });
      return {
        ref,
        contentType: input.contentType,
        byteLength: input.bytes.byteLength,
      };
    },

    async read(value) {
      const ref = assertProductMediaRef(value);
      const filePath = resolveRef(root, ref);
      let bytes: Uint8Array;
      try {
        bytes = await readFile(filePath);
      } catch (error) {
        if (isMissingFile(error)) {
          return null;
        }
        throw error;
      }
      const contentType = contentTypeFor(ref);
      return validateProductImage({ fileName: ref, contentType, bytes });
    },
  };
}

async function assertDecodableImage(image: ValidatedProductImage): Promise<void> {
  try {
    const decoder = sharp(Buffer.from(image.bytes), {
      failOn: "warning",
      limitInputPixels: MAX_PRODUCT_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await decoder.metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (
      !width ||
      !height ||
      width > MAX_PRODUCT_IMAGE_DIMENSION ||
      height > MAX_PRODUCT_IMAGE_DIMENSION ||
      width * height > MAX_PRODUCT_IMAGE_PIXELS
    ) {
      throw new CatalogValidationError(
        "أبعاد الصورة غير صالحة. الحد الأقصى 8000 بكسل للعرض أو الارتفاع و20 مليون بكسل إجمالاً.",
      );
    }
    const expectedFormat = image.extension === "jpg" ? "jpeg" : image.extension;
    if (metadata.format !== expectedFormat) {
      throw new CatalogValidationError("نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP.");
    }
    await decoder.clone().raw().toBuffer();
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      throw error;
    }
    throw new CatalogValidationError("ملف الصورة تالف أو غير قابل للقراءة.");
  }
}

function resolveRef(root: string, ref: string): string {
  const relative = assertProductMediaRef(ref).split("/").join(path.sep);
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Product media path escaped its storage root.");
  }
  return resolved;
}

function contentTypeFor(ref: string): ProductImageContentType {
  const extension = path.extname(ref).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".png") {
    return "image/png";
  }
  return "image/webp";
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
