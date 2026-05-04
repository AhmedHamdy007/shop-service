const {
  isAllowedImageBuffer,
  normalizeUploadPurpose,
} = require("../config/cloudinary");

function file(buffer, mimetype) {
  return { buffer, mimetype };
}

describe("Cloudinary upload validation", () => {
  it("accepts image content only when the MIME type matches the file signature", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
    ]);
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const webp = Buffer.from("RIFFxxxxWEBP", "ascii");

    expect(isAllowedImageBuffer(file(png, "image/png"))).toBe(true);
    expect(isAllowedImageBuffer(file(jpeg, "image/jpeg"))).toBe(true);
    expect(isAllowedImageBuffer(file(webp, "image/webp"))).toBe(true);
    expect(isAllowedImageBuffer(file(png, "image/jpeg"))).toBe(false);
    expect(isAllowedImageBuffer(file(Buffer.from("not an image"), "image/png"))).toBe(false);
  });

  it("falls back to the general upload folder for unknown purposes", () => {
    expect(normalizeUploadPurpose("profile")).toBe("profile");
    expect(normalizeUploadPurpose("shop-cover")).toBe("shop-cover");
    expect(normalizeUploadPurpose("unexpected")).toBe("general");
    expect(normalizeUploadPurpose()).toBe("general");
  });
});
