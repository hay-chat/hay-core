// The button's accessible name, the only translated string the loader needs.
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

export const openChatLabels: Record<Locale, string> = {
  "en-us": enUs["chat.open"],
  "pt-br": ptBr["chat.open"],
  "pt-pt": ptPt["chat.open"],
  "es-es": esEs["chat.open"],
  "de-de": deDe["chat.open"],
  "it-it": itIt["chat.open"],
  "fr-fr": frFr["chat.open"],
  "nl-nl": nlNl["chat.open"],
  "pl-pl": plPl["chat.open"],
  "ja-jp": jaJp["chat.open"],
  "zh-cn": zhCn["chat.open"],
  "ko-kr": koKr["chat.open"],
  "tr-tr": trTr["chat.open"],
};
