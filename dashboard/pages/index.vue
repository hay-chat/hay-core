<template>
  <div></div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useSetupStore } from "@/stores/setup";

/**
 * Landing route. New organizations that haven't finished or set aside setup go
 * to `/setup` (the server decides); everyone else gets the Inbox on phones
 * (what needs a human right now) and the metrics Dashboard on desktops. The cut
 * is the same `md` breakpoint the layout uses to switch between top bar and
 * sidebar. If setup can't be read (error, or a role without access) we fail
 * open to home rather than block the app.
 */
const router = useRouter();
const setup = useSetupStore();

const PHONE_MEDIA_QUERY = "(max-width: 767px)";
const isPhone = typeof window !== "undefined" && window.matchMedia(PHONE_MEDIA_QUERY).matches;

onMounted(async () => {
  await setup.load({ force: true });
  if (setup.board?.shouldPrompt) {
    router.replace("/setup");
  } else {
    router.replace(isPhone ? "/inbox" : "/dashboard");
  }
});
</script>
