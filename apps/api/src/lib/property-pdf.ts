import type { schema } from "@pointer/db";
import PDFDocument from "pdfkit";
import { request } from "undici";

type Property = typeof schema.properties.$inferSelect;

const A4_WIDTH = 595;
const A4_HEIGHT = 842;
const MARGIN = 40;

/**
 * Generates a single-property "ficha" PDF as a Buffer.
 * Layout: title + price banner, hero photo, key specs, description, address,
 * features list, gallery (up to 6 thumbnails). Pure pdfkit — no headless
 * Chrome dependency.
 */
export async function generatePropertyPdf(property: Property): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  doc.addPage();

  // ── Header ──────────────────────────────────────────────────────────
  doc
    .fillColor("#157aff")
    .fontSize(10)
    .font("Helvetica-Bold")
    .text("POINTER IMÓVEIS", MARGIN, MARGIN, { characterSpacing: 1.5 });

  if (property.code) {
    doc
      .fillColor("#9ca3af")
      .fontSize(9)
      .font("Helvetica")
      .text(`Código ${property.code}`, A4_WIDTH - MARGIN - 100, MARGIN, {
        width: 100,
        align: "right"
      });
  }

  doc.moveDown(1.5);

  // Title
  doc.fillColor("#0f172a").fontSize(20).font("Helvetica-Bold").text(property.title, MARGIN, doc.y, {
    width: A4_WIDTH - MARGIN * 2
  });
  doc.moveDown(0.3);

  // Price + transaction
  const txLabel = property.transactionType === "sale" ? "Venda" : "Aluguel";
  const priceText =
    property.priceCents != null
      ? formatBRL(property.priceCents)
      : "Consulte";
  doc
    .fillColor("#157aff")
    .fontSize(18)
    .font("Helvetica-Bold")
    .text(`${priceText} · ${txLabel}`, MARGIN, doc.y);
  doc.moveDown(0.6);

  // Address
  if (property.addressJson) {
    const a = property.addressJson;
    const line = [a.street, a.number, a.neighborhood, a.city, a.state]
      .filter(Boolean)
      .join(", ");
    if (line) {
      doc
        .fillColor("#475569")
        .fontSize(10)
        .font("Helvetica")
        .text(line, MARGIN, doc.y);
      doc.moveDown(0.5);
    }
  }

  // Hero photo
  if (property.photosJson?.[0]?.url) {
    const heroBuf = await fetchImage(property.photosJson[0].url);
    if (heroBuf) {
      const heroH = 240;
      try {
        doc.image(heroBuf, MARGIN, doc.y, {
          width: A4_WIDTH - MARGIN * 2,
          height: heroH,
          fit: [A4_WIDTH - MARGIN * 2, heroH] as [number, number]
        });
        doc.y += heroH + 12;
      } catch {
        // Bad image bytes — skip silently.
      }
    }
  }

  // Specs grid
  const specs: Array<[string, string]> = [];
  if (property.bedrooms != null) specs.push(["Quartos", String(property.bedrooms)]);
  if (property.bathrooms != null) specs.push(["Banheiros", String(property.bathrooms)]);
  if (property.parkingSpots != null)
    specs.push(["Vagas", String(property.parkingSpots)]);
  if (property.areaSqm != null) specs.push(["Área", `${property.areaSqm} m²`]);
  if (property.condoFeeCents != null)
    specs.push(["Condomínio", formatBRL(property.condoFeeCents) + "/mês"]);
  if (property.iptuCents != null) specs.push(["IPTU", formatBRL(property.iptuCents) + "/ano"]);

  if (specs.length) {
    const startY = doc.y;
    const colWidth = (A4_WIDTH - MARGIN * 2) / 3;
    for (let i = 0; i < specs.length; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = MARGIN + col * colWidth;
      const y = startY + row * 40;
      const [label, value] = specs[i]!;
      doc
        .fillColor("#9ca3af")
        .fontSize(8)
        .font("Helvetica")
        .text(label.toUpperCase(), x, y, { width: colWidth, characterSpacing: 0.5 });
      doc
        .fillColor("#0f172a")
        .fontSize(13)
        .font("Helvetica-Bold")
        .text(value, x, y + 11);
    }
    doc.y = startY + Math.ceil(specs.length / 3) * 40 + 8;
  }

  // Description
  if (property.description) {
    doc
      .fillColor("#0f172a")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("Descrição", MARGIN, doc.y);
    doc.moveDown(0.3);
    doc
      .fillColor("#475569")
      .fontSize(10)
      .font("Helvetica")
      .text(property.description, MARGIN, doc.y, {
        width: A4_WIDTH - MARGIN * 2,
        align: "left"
      });
    doc.moveDown(0.6);
  }

  // Features
  if (property.featuresJson?.length) {
    doc
      .fillColor("#0f172a")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("Diferenciais", MARGIN, doc.y);
    doc.moveDown(0.3);
    for (const f of property.featuresJson) {
      doc
        .fillColor("#475569")
        .fontSize(10)
        .font("Helvetica")
        .text(`• ${f}`, MARGIN, doc.y);
    }
    doc.moveDown(0.6);
  }

  // Gallery (remaining photos, up to 6)
  const gallery = (property.photosJson ?? []).slice(1, 7);
  if (gallery.length) {
    if (doc.y > A4_HEIGHT - 200) doc.addPage();
    doc
      .fillColor("#0f172a")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("Galeria", MARGIN, doc.y);
    doc.moveDown(0.4);

    const cols = 3;
    const cellW = (A4_WIDTH - MARGIN * 2 - (cols - 1) * 8) / cols;
    const cellH = 110;
    let i = 0;
    for (const photo of gallery) {
      const buf = await fetchImage(photo.url);
      if (!buf) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = MARGIN + col * (cellW + 8);
      const y = doc.y + row * (cellH + 8);
      try {
        doc.image(buf, x, y, {
          width: cellW,
          height: cellH,
          fit: [cellW, cellH] as [number, number]
        });
      } catch {
        // skip
      }
      i++;
    }
    doc.y += Math.ceil(gallery.length / cols) * (cellH + 8);
  }

  // Footer
  doc
    .fillColor("#9ca3af")
    .fontSize(8)
    .font("Helvetica")
    .text(
      `Pointer Imóveis · Gerado em ${new Date().toLocaleString("pt-BR")}`,
      MARGIN,
      A4_HEIGHT - MARGIN,
      { width: A4_WIDTH - MARGIN * 2, align: "center" }
    );

  doc.end();
  await done;
  return Buffer.concat(chunks);
}

function formatBRL(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`;
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await request(url, { method: "GET" });
    if (res.statusCode >= 400) return null;
    const arr = await res.body.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}
