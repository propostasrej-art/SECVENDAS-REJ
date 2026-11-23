const fs = require('fs');
const path = require('path');

const filesToPatch = [
  path.join(__dirname, '../node_modules/html2canvas/dist/html2canvas.js'),
  path.join(__dirname, '../node_modules/html2canvas/dist/html2canvas.esm.js'),
  path.join(__dirname, '../node_modules/html2pdf.js/dist/html2pdf.js'),
  path.join(__dirname, '../node_modules/html2pdf.js/dist/html2pdf.bundle.js')
];

const oklchFunctionCode = `var oklch = function (context, args) {
    try {
        var tokens = args.filter(nonFunctionArgSeparator);
        var L = tokens[0] ? (tokens[0].type === 16 ? tokens[0].number / 100 : tokens[0].number) : 0;
        var C = tokens[1] ? (tokens[1].type === 16 ? tokens[1].number * 0.4 / 100 : tokens[1].number) : 0;
        var hToken = tokens[2];
        var h = 0;
        if (hToken) {
            if (hToken.type === 17) h = hToken.number;
            else if (typeof angle !== 'undefined' && angle.parse) h = (angle.parse(context, hToken) * 180) / Math.PI;
            else h = Number(hToken.number || 0);
        }
        var aToken = tokens[3];
        var alpha = typeof aToken !== 'undefined' ? (aToken.type === 16 ? aToken.number / 100 : aToken.number) : 1;
        var hRad = (h * Math.PI) / 180;
        var aLab = C * Math.cos(hRad);
        var bLab = C * Math.sin(hRad);
        var l_ = Math.pow(L + 0.3963377774 * aLab + 0.2158037573 * bLab, 3);
        var m_ = Math.pow(L - 0.1055613458 * aLab - 0.0638541728 * bLab, 3);
        var s_ = Math.pow(L - 0.0894841775 * aLab - 1.291485548 * bLab, 3);
        var rLin = +4.076743409 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
        var gLin = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
        var bLin = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
        var toG = function (c) {
            var cl = Math.max(0, Math.min(1, c));
            return cl <= 0.0031308 ? 12.92 * cl : 1.055 * Math.pow(cl, 1 / 2.4) - 0.055;
        };
        return pack(Math.round(toG(rLin) * 255), Math.round(toG(gLin) * 255), Math.round(toG(bLin) * 255), alpha);
    } catch (e) {
        return 0x00000000;
    }
};
`;

let patchedCount = 0;

for (const filePath of filesToPatch) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // 1. Replace throw on unsupported color function with return 0x00000000;
    const throwRegexList = [
      /throw new Error\s*\(\s*["']Attempting to parse an unsupported color function\s*["']\s*\+\s*value\.name\s*\+\s*["']["']\s*\);?/g,
      /throw new Error\s*\(\s*"Attempting to parse an unsupported color function \\""\s*\+\s*value\.name\s*\+\s*"\\""\s*\);?/g,
      /throw new Error\s*\(\s*["']Attempting to parse an unsupported color function[^)]+\);?/g
    ];

    for (const r of throwRegexList) {
      if (r.test(content)) {
        content = content.replace(r, 'return 0x00000000;');
        modified = true;
      }
    }

    // 2. Add oklch to SUPPORTED_COLOR_FUNCTIONS if not already present
    if (!content.includes('oklch: oklch')) {
      const supportedRegex = /var SUPPORTED_COLOR_FUNCTIONS\s*=\s*\{([\s\S]*?)\};/;
      const match = content.match(supportedRegex);
      if (match) {
        const originalBlock = match[0];
        const inner = match[1];
        const newBlock = `${oklchFunctionCode}\nvar SUPPORTED_COLOR_FUNCTIONS = {${inner},    oklch: oklch\n};`;
        content = content.replace(originalBlock, newBlock);
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[patch-html2canvas] Patched ${filePath}`);
      patchedCount++;
    } else {
      console.log(`[patch-html2canvas] Already patched or pattern not found in ${filePath}`);
    }
  } else {
    console.log(`[patch-html2canvas] File not found: ${filePath}`);
  }
}

console.log(`[patch-html2canvas] Done. Patched ${patchedCount} files.`);
