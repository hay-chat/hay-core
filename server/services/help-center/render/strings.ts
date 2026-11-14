/**
 * The site's own labels. Article and collection text comes from the
 * organization; these are only the words around it.
 */
export interface SiteStrings {
  search: string;
  searchPlaceholder: string;
  collections: string;
  articleCount: (count: number) => string;
  helpfulQuestion: string;
  yes: string;
  no: string;
  feedbackThanks: string;
  stillNeedHelp: string;
  chatWithUs: string;
  noResults: string;
  pageNotFound: string;
  backToHome: string;
  poweredBy: string;
  skipToContent: string;
}

const en: SiteStrings = {
  search: "Search",
  searchPlaceholder: "Search for articles",
  collections: "Collections",
  articleCount: (count) => (count === 1 ? "1 article" : `${count} articles`),
  helpfulQuestion: "Was this helpful?",
  yes: "Yes",
  no: "No",
  feedbackThanks: "Thanks for the feedback!",
  stillNeedHelp: "Still need help?",
  chatWithUs: "Chat with us using the chat button in the corner of this page.",
  noResults: "No results",
  pageNotFound: "Page not found",
  backToHome: "Back to home",
  poweredBy: "Powered by Hay",
  skipToContent: "Skip to content",
};

const pt: SiteStrings = {
  search: "Pesquisar",
  searchPlaceholder: "Pesquisar artigos",
  collections: "Coleções",
  articleCount: (count) => (count === 1 ? "1 artigo" : `${count} artigos`),
  helpfulQuestion: "Isto foi útil?",
  yes: "Sim",
  no: "Não",
  feedbackThanks: "Obrigado pelo seu feedback!",
  stillNeedHelp: "Ainda precisa de ajuda?",
  chatWithUs: "Fale connosco através do botão de chat no canto desta página.",
  noResults: "Sem resultados",
  pageNotFound: "Página não encontrada",
  backToHome: "Voltar ao início",
  poweredBy: "Com tecnologia Hay",
  skipToContent: "Saltar para o conteúdo",
};

const es: SiteStrings = {
  search: "Buscar",
  searchPlaceholder: "Buscar artículos",
  collections: "Colecciones",
  articleCount: (count) => (count === 1 ? "1 artículo" : `${count} artículos`),
  helpfulQuestion: "¿Te ha resultado útil?",
  yes: "Sí",
  no: "No",
  feedbackThanks: "¡Gracias por tu opinión!",
  stillNeedHelp: "¿Aún necesitas ayuda?",
  chatWithUs: "Chatea con nosotros con el botón de chat en la esquina de esta página.",
  noResults: "Sin resultados",
  pageNotFound: "Página no encontrada",
  backToHome: "Volver al inicio",
  poweredBy: "Con tecnología de Hay",
  skipToContent: "Saltar al contenido",
};

const STRINGS = new Map<string, SiteStrings>([
  ["en", en],
  ["pt", pt],
  ["es", es],
]);

/** Labels for a language code ("pt", "pt-BR"); English for any other language. */
export function siteStrings(language: string | null | undefined): SiteStrings {
  const base = (language ?? "").toLowerCase().split(/[-_]/)[0];
  return STRINGS.get(base) ?? en;
}

/** A value fit for `<html lang>`: the given code when it looks like one, else "en". */
export function htmlLang(language: string | null | undefined): string {
  return language && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language) ? language : "en";
}
