import { useShepherd } from "vue-shepherd";

export const useDocumentImportTour = () => {
  const tour = useShepherd({
    useModalOverlay: true,
    defaultStepOptions: {
      scrollTo: true,
      cancelIcon: {
        enabled: true,
      },
      classes: "shadow-xl rounded-md",
      modalOverlayOpeningPadding: 8,
      modalOverlayOpeningRadius: 8, // Increase this value for more rounded corners on the overlay cutout
    },
  });

  const steps = [
    {
      id: "welcome",
      text: `
        <div class="space-y-3">
          <h3 class="text-base font-semibold text-foreground">Welcome to Document Import!</h3>
          <p class="text-sm text-neutral-muted">Let's walk through how to import documents into your knowledge base.</p>
        </div>
      `,
      buttons: [
        {
          text: "Skip",
          action: () => tour.cancel(),
          classes: "shepherd-button-secondary",
        },
        {
          text: "Next",
          action: () => tour.next(),
        },
      ],
    },
    {
      id: "import-source",
      text: `
        <div class="space-y-3">
          <h3 class="text-base font-semibold text-foreground">Choose Import Source</h3>
          <p class="text-sm text-neutral-muted">Select how you want to import documents:</p>
          <ul class="text-sm text-foreground list-disc list-inside space-y-1">
            <li><strong class="font-medium">Upload Files:</strong> Import from your computer</li>
            <li><strong class="font-medium">Import from Website:</strong> Crawl and import web pages</li>
            <li><strong class="font-medium">Plugins:</strong> Use specialized importers (if available)</li>
          </ul>
        </div>
      `,
      attachTo: {
        element: '[data-tour="import-sources"]',
        on: "top",
      },
      buttons: [
        {
          text: "Back",
          action: () => tour.back(),
        },
        {
          text: "Next",
          action: () => tour.next(),
        },
      ],
    },
    {
      id: "upload-option",
      text: `
        <div class="space-y-3">
          <h3 class="text-base font-semibold text-foreground">Upload Files</h3>
          <p class="text-sm text-neutral-muted">Click here to upload documents from your computer. You can also drag and drop files anywhere on the page!</p>
          <p class="text-sm text-neutral-400">Supported formats: PDF, TXT, MD, DOC, DOCX, HTML, JSON, CSV</p>
        </div>
      `,
      attachTo: {
        element: '[data-tour="upload-option"]',
        on: "bottom",
      },
      buttons: [
        {
          text: "Back",
          action: () => tour.back(),
        },
        {
          text: "Next",
          action: () => tour.next(),
        },
      ],
    },
    {
      id: "web-import-option",
      text: `
        <div class="space-y-3">
          <h3 class="text-base font-semibold text-foreground">Import from Website</h3>
          <p class="text-sm text-neutral-muted">Use this option to automatically crawl and import documentation from any website.</p>
          <p class="text-sm text-neutral-400">Perfect for importing API docs, guides, or knowledge bases.</p>
        </div>
      `,
      attachTo: {
        element: '[data-tour="web-option"]',
        on: "bottom",
      },
      buttons: [
        {
          text: "Back",
          action: () => tour.back(),
        },
        {
          text: "Next",
          action: () => tour.next(),
        },
      ],
    },
    {
      id: "progress-steps",
      text: `
        <div class="space-y-3">
          <h3 class="text-base font-semibold text-foreground">Track Your Progress</h3>
          <p class="text-sm text-neutral-muted">This progress indicator shows you where you are in the import process.</p>
          <p class="text-sm text-neutral-400">Each import type has its own set of steps to guide you through.</p>
        </div>
      `,
      attachTo: {
        element: '[data-tour="progress-steps"]',
        on: "bottom",
      },
      buttons: [
        {
          text: "Back",
          action: () => tour.back(),
        },
        {
          text: "Finish",
          action: () => tour.complete(),
          classes: "shepherd-button",
        },
      ],
    },
  ];

  const startTour = () => {
    tour.addSteps(steps);
    tour.start();
  };

  const shouldShowTour = () => {
    const hasSeenTour = localStorage.getItem("hay-import-tour-seen");
    return !hasSeenTour;
  };

  const markTourAsSeen = () => {
    localStorage.setItem("hay-import-tour-seen", "true");
  };

  onMounted(() => {
    tour.on("complete", markTourAsSeen);
    tour.on("cancel", markTourAsSeen);
  });

  onUnmounted(() => {
    tour.cancel();
  });

  return {
    tour,
    startTour,
    shouldShowTour,
    markTourAsSeen,
  };
};