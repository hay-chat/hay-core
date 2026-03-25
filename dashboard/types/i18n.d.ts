/**
 * Type augmentations for @nuxtjs/i18n.
 *
 * The Vue runtime compiler alias (vue/dist/vue.esm-bundler.js) breaks
 * vue-i18n's automatic component instance augmentation for `$t` etc.
 * This file re-declares those types explicitly so vue-tsc is happy.
 */
import type { Composer } from "vue-i18n";

declare module "vue" {
  interface ComponentCustomProperties {
    $t: Composer["t"];
    $rt: Composer["rt"];
    $n: Composer["n"];
    $d: Composer["d"];
    $tm: Composer["tm"];
    $te: Composer["te"];
  }
}

export {};
