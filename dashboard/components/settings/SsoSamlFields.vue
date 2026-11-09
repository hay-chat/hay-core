<template>
  <div class="space-y-4">
    <div class="space-y-3">
      <div class="space-y-1">
        <p class="text-sm font-medium">{{ $t("sso.provider.saml.acsUrl") }}</p>
        <p id="sso-saml-acs" class="p-2 border rounded-md font-mono text-sm break-all">
          {{ details.acsUrl }}
        </p>
      </div>
      <div class="space-y-1">
        <p class="text-sm font-medium">{{ $t("sso.provider.saml.entityId") }}</p>
        <p id="sso-saml-entity" class="p-2 border rounded-md font-mono text-sm break-all">
          {{ details.entityId }}
        </p>
      </div>
      <div v-if="saved" class="space-y-1">
        <p class="text-sm font-medium">{{ $t("sso.provider.saml.metadataUrl") }}</p>
        <p class="p-2 border rounded-md font-mono text-sm break-all">{{ details.metadataUrl }}</p>
      </div>
    </div>

    <Input
      id="sso-saml-idp-entity"
      v-model="idpEntityId"
      :label="$t('sso.provider.saml.idpEntityId')"
      :helper-text="$t('sso.provider.saml.idpEntityIdHelper')"
      required
    />
    <Input
      id="sso-saml-sso-url"
      v-model="ssoUrl"
      :label="$t('sso.provider.saml.ssoUrl')"
      :helper-text="$t('sso.provider.saml.ssoUrlHelper')"
      placeholder="https://login.example.com/saml"
      required
    />
    <Input
      id="sso-saml-certificate"
      v-model="certificate"
      type="textarea"
      :label="$t('sso.provider.saml.certificate')"
      :helper-text="$t('sso.provider.saml.certificateHelper')"
      required
    />
  </div>
</template>

<script setup lang="ts">
/** The SAML half of the single sign-on provider form: what to paste into the provider, and what it gives back. */
defineProps<{
  details: { acsUrl: string; entityId: string; metadataUrl: string };
  /** Whether a SAML connection is already saved, which is when the metadata URL answers. */
  saved: boolean;
}>();

const idpEntityId = defineModel<string>("idpEntityId", { required: true });
const ssoUrl = defineModel<string>("ssoUrl", { required: true });
const certificate = defineModel<string>("certificate", { required: true });
</script>
