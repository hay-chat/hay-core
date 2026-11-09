/** Tailwind classes for links that look like buttons or text actions, so they stay real links. */
export const textLinkClass =
  "inline-flex min-h-11 items-center rounded px-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0";

export const buttonLinkClass =
  "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:min-h-10";

export const outlineLinkClass =
  "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:min-h-10";

/** The card's own action, quieter than a primary button: a blue tint, for buttons and links. */
export const softLinkClass =
  "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary-50 px-3 text-sm font-medium text-primary transition-colors hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 md:min-h-8";
