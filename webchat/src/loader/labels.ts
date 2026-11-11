// The accessible names of the button and of the teaser's dismiss button, the
// only translated strings the loader needs.
import type { Locale } from "@/i18n/resolve";
import enUs from "@/i18n/locales/en-us";
import ptBr from "@/i18n/locales/pt-br";
import ptPt from "@/i18n/locales/pt-pt";
import esEs from "@/i18n/locales/es-es";
import deDe from "@/i18n/locales/de-de";
import itIt from "@/i18n/locales/it-it";
import frFr from "@/i18n/locales/fr-fr";
import nlNl from "@/i18n/locales/nl-nl";
import plPl from "@/i18n/locales/pl-pl";
import jaJp from "@/i18n/locales/ja-jp";
import zhCn from "@/i18n/locales/zh-cn";
import koKr from "@/i18n/locales/ko-kr";
import trTr from "@/i18n/locales/tr-tr";

export interface LauncherLabels {
  open: string;
  dismissTeaser: string;
}

const pick = (messages: Record<"chat.open" | "chat.dismissTeaser", string>): LauncherLabels => ({
  open: messages["chat.open"],
  dismissTeaser: messages["chat.dismissTeaser"],
});

export const launcherLabels: Record<Locale, LauncherLabels> = {
  "en-us": pick(enUs),
  "pt-br": pick(ptBr),
  "pt-pt": pick(ptPt),
  "es-es": pick(esEs),
  "de-de": pick(deDe),
  "it-it": pick(itIt),
  "fr-fr": pick(frFr),
  "nl-nl": pick(nlNl),
  "pl-pl": pick(plPl),
  "ja-jp": pick(jaJp),
  "zh-cn": pick(zhCn),
  "ko-kr": pick(koKr),
  "tr-tr": pick(trTr),
};
