import { inflateSync } from "zlib";

/**
 * The text drawn in a pdfkit PDF, one line per text-show operation. pdf-parse
 * 1.x cannot read pdfkit 0.18 output, so tests decode the content streams:
 * inflate each stream and join the WinAnsi hex strings of every TJ array.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const lines: string[] = [];
  const streamPattern = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;
    const bytes = Buffer.from(raw.slice(start, end), "latin1");
    let content: string;
    try {
      content = inflateSync(bytes).toString("latin1");
    } catch {
      continue;
    }
    for (const array of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const text = [...array[1].matchAll(/<([0-9a-fA-F]*)>/g)]
        .map((hex) => Buffer.from(hex[1], "hex").toString("latin1"))
        .join("");
      lines.push(text);
    }
    streamPattern.lastIndex = end;
  }
  return lines.join("\n");
}
