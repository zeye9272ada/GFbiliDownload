const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const pngToIco = require("png-to-ico").default;

const root = path.join(__dirname, "..");
const svgPath = path.join(root, "assets", "app-icon.svg");
const outDir = path.join(root, "assets");
const sizes = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const pngPaths = [];

  for (const size of sizes) {
    const outFile = path.join(outDir, `app-icon-${size}.png`);
    await sharp(svgPath)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(outFile);
    pngPaths.push(outFile);
  }

  fs.copyFileSync(path.join(outDir, "app-icon-256.png"), path.join(outDir, "app-icon.png"));
  const ico = await pngToIco(pngPaths);
  fs.writeFileSync(path.join(outDir, "app-icon.ico"), ico);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
