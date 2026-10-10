// Generates the ingest samples: sample-digital.pdf (real text layer), sample-scan.png (text drawn as an image,
// no text layer) and sample-pasted.txt. Run: npx tsx ingest/samples/make-samples.ts
// The PNG is a synthetic "scan" (clean rendered text), not a real photo of paper.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const dir = dirname(fileURLToPath(import.meta.url));

const LINES = [
  "RESIDENTIAL RENTAL AGREEMENT",
  "",
  "This Agreement is made between the Landlord and the Tenant for the premises at 12 Park Road.",
  "",
  "1. Security Deposit. The Tenant shall pay a security deposit of Rs. 60,000 at signing.",
  "The Landlord may deduct from the deposit any amounts for damages, cleaning, repainting",
  "and other charges as the Landlord deems necessary.",
  "",
  "2. Termination. The Tenant shall give three (3) months' written notice to terminate this",
  "Agreement. The Landlord may terminate this Agreement at any time by giving fifteen (15) days' notice.",
  "",
  "3. Rent Revision. The monthly rent of Rs. 25,000 shall increase by 15% every year.",
  "",
  "4. Maintenance. The Tenant shall pay for minor repairs and monthly society charges.",
];

const PASTED = `RESIDENTIAL RENTAL AGREEMENT

1. Security Deposit. The Tenant shall pay a security deposit of Rs. 60,000 at signing. The Landlord may deduct from the deposit any amounts for damages, cleaning, repainting and other charges as the Landlord deems necessary.

2. Termination. The Tenant shall give three (3) months' written notice to terminate this Agreement. The Landlord may terminate this Agreement at any time by giving fifteen (15) days' notice.

3. Rent Revision. The monthly rent of Rs. 25,000 shall increase by 15% every year.

4. Maintenance. The Tenant shall pay for minor repairs and monthly society charges.
`;

/** Minimal one-page PDF with a Helvetica text layer. */
function buildPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const body = ["BT", "/F1 11 Tf", "14 TL", "50 780 Td", ...lines.map((l) => `(${esc(l)}) Tj T*`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function buildScan(lines: string[]): Buffer {
  const canvas = createCanvas(1240, 900);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111111";
  ctx.font = "26px Arial, sans-serif";
  lines.forEach((l, i) => ctx.fillText(l, 50, 60 + i * 38));
  return canvas.toBuffer("image/png");
}

writeFileSync(join(dir, "sample-digital.pdf"), buildPdf(LINES));
writeFileSync(join(dir, "sample-scan.png"), buildScan(LINES));
writeFileSync(join(dir, "sample-pasted.txt"), PASTED, "utf8");
console.log("Wrote sample-digital.pdf, sample-scan.png, sample-pasted.txt");
