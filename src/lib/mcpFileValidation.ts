const MAX_FILE_BYTES = 10 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain",
  zip: "application/zip",
};

export type ValidatedMcpFile = {
  safeName: string;
  contentType: string;
};

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

// Browser MIME metadata is not trusted by itself. We also check the leading
// bytes associated with each supported file family before Storage receives it.
export function validateMcpFile(
  originalName: string,
  contentType: string,
  bytes: Uint8Array
): ValidatedMcpFile {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error("File size must be between 1 byte and 10 MB.");
  }

  const safeName = originalName.split(/[\\/]/).pop()?.trim() ?? "";
  if (
    !safeName ||
    safeName.length > 180 ||
    /[\u0000-\u001f\u007f]/.test(safeName)
  ) {
    throw new Error("The file name is invalid.");
  }

  const extension = safeName.toLowerCase().split(".").pop() ?? "";
  const expectedType = MIME_BY_EXTENSION[extension];
  if (!expectedType || contentType !== expectedType) {
    throw new Error("The file extension and MIME type do not match.");
  }

  const isZip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  const signatureMatches =
    (extension === "pdf" && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) ||
    (["doc", "xls"].includes(extension) &&
      startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) ||
    (["docx", "xlsx", "zip"].includes(extension) && isZip) ||
    (extension === "png" &&
      startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (["jpg", "jpeg"].includes(extension) &&
      startsWith(bytes, [0xff, 0xd8, 0xff])) ||
    (extension === "webp" &&
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") ||
    (extension === "txt" && !bytes.includes(0));

  if (!signatureMatches) {
    throw new Error("The file content does not match its declared type.");
  }
  return { safeName, contentType: expectedType };
}

export { MAX_FILE_BYTES };
