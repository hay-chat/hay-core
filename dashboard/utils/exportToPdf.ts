import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export interface ConversationPdfOptions {
  conversationTitle?: string;
  conversationId?: string;
  status?: string;
  createdAt?: string;
  filename?: string;
}

/**
 * Export a conversation to PDF
 * @param element - The HTML element containing the conversation messages
 * @param options - Additional metadata and options for the PDF
 */
export async function exportConversationToPdf(
  element: HTMLElement,
  options: ConversationPdfOptions = {},
): Promise<void> {
  try {
    // Show loading state (caller should handle this)
    const {
      conversationTitle = "Conversation",
      conversationId = "",
      status = "",
      createdAt = "",
      filename = `conversation-${Date.now()}.pdf`,
    } = options;

    // Create a temporary container for PDF generation
    const pdfContainer = document.createElement("div");
    pdfContainer.style.position = "absolute";
    pdfContainer.style.left = "-9999px";
    pdfContainer.style.top = "0";
    pdfContainer.style.width = "210mm"; // A4 width
    pdfContainer.style.backgroundColor = "white";
    pdfContainer.style.padding = "20mm";
    document.body.appendChild(pdfContainer);

    // Create header with conversation metadata
    const header = document.createElement("div");
    header.style.marginBottom = "20px";
    header.style.paddingBottom = "10px";
    header.style.borderBottom = "2px solid #e5e7eb";
    header.innerHTML = `
      <h1 style="font-size: 24px; font-weight: bold; margin: 0 0 10px 0; color: #111827;">
        ${conversationTitle}
      </h1>
      <div style="font-size: 14px; color: #6b7280;">
        ${conversationId ? `<div>ID: ${conversationId}</div>` : ""}
        ${status ? `<div>Status: ${status}</div>` : ""}
        ${createdAt ? `<div>Date: ${new Date(createdAt).toLocaleString()}</div>` : ""}
        <div>Exported: ${new Date().toLocaleString()}</div>
      </div>
    `;
    pdfContainer.appendChild(header);

    // Clone the conversation messages
    const messagesClone = element.cloneNode(true) as HTMLElement;
    messagesClone.style.maxHeight = "none";
    messagesClone.style.overflow = "visible";

    // Clean up classes and styles for PDF
    messagesClone.querySelectorAll(".animate-pulse").forEach((el) => {
      (el as HTMLElement).style.display = "none";
    });

    // Remove any scrollbars
    messagesClone.style.overflowY = "visible";

    pdfContainer.appendChild(messagesClone);

    // Remove all class attributes to avoid Tailwind oklch colors
    const removeClasses = (el: HTMLElement) => {
      // Get computed styles before removing classes
      const computedStyle = window.getComputedStyle(el);

      // Store essential computed styles
      const color = computedStyle.color;
      const backgroundColor = computedStyle.backgroundColor;
      const fontSize = computedStyle.fontSize;
      const fontWeight = computedStyle.fontWeight;
      const padding = computedStyle.padding;
      const margin = computedStyle.margin;
      const display = computedStyle.display;
      const flexDirection = computedStyle.flexDirection;
      const gap = computedStyle.gap;
      const borderRadius = computedStyle.borderRadius;
      const border = computedStyle.border;

      // Remove all classes
      el.className = '';

      // Apply stored styles as inline styles (skip oklch values)
      if (color && !color.includes('oklch')) el.style.color = color;
      if (backgroundColor && !backgroundColor.includes('oklch')) el.style.backgroundColor = backgroundColor;
      el.style.fontSize = fontSize;
      el.style.fontWeight = fontWeight;
      el.style.padding = padding;
      el.style.margin = margin;
      el.style.display = display;
      el.style.flexDirection = flexDirection;
      el.style.gap = gap;
      el.style.borderRadius = borderRadius;
      if (border && !border.includes('oklch')) el.style.border = border;

      // Process children
      Array.from(el.children).forEach(child => {
        removeClasses(child as HTMLElement);
      });
    };

    removeClasses(pdfContainer);

    // Generate canvas from the container
    const canvas = await html2canvas(pdfContainer, {
      scale: 2, // Higher quality
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: 794, // A4 width in pixels at 96 DPI (210mm)
      onclone: (clonedDoc) => {
        // Additional cleanup on cloned document if needed
        const clonedContainer = clonedDoc.body.querySelector('[style*="position: absolute"]');
        if (clonedContainer) {
          // Remove any remaining oklch from inline styles
          const allElements = clonedContainer.querySelectorAll('*');
          allElements.forEach((el) => {
            const htmlEl = el as HTMLElement;
            if (htmlEl.style.color?.includes('oklch')) htmlEl.style.color = '#000000';
            if (htmlEl.style.backgroundColor?.includes('oklch')) htmlEl.style.backgroundColor = 'transparent';
            if (htmlEl.style.borderColor?.includes('oklch')) htmlEl.style.borderColor = 'transparent';
          });
        }
      },
    });

    // Remove temporary container
    document.body.removeChild(pdfContainer);

    // Calculate PDF dimensions
    const imgWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;

    // Create PDF
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    let position = 0;

    // Add image to PDF (handle multiple pages if needed)
    const imgData = canvas.toDataURL("image/png");

    // First page
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    // Add additional pages if content is longer than one page
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    // Save the PDF
    pdf.save(filename);
  } catch (error) {
    console.error("Failed to export conversation to PDF:", error);
    throw new Error("Failed to export conversation. Please try again.");
  }
}
