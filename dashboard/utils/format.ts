export const formatCurrency = (amount: number, currency = "USD"): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
};

export const truncateText = (text: string, maxLength = 50): string => {
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}...`;
};

export const capitalize = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

export const kebabToTitle = (str: string): string => {
  return str
    .split("-")
    .map((word) => capitalize(word))
    .join(" ");
};

/** "Pricing | Hay.chat" reads as "Pricing": the site name after the last separator is noise. */
export function pageTitle(title: string): string {
  const cut = title.lastIndexOf(" | ");
  return cut > 0 ? title.slice(0, cut) : title;
}
