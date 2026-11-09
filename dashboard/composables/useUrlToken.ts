import { onMounted, ref, type Ref } from "vue";

/**
 * The `?token=` from an emailed link. The token is taken out of the address bar
 * and the history entry once read, so reloading needs the link from the email.
 */
export function useUrlToken(): Ref<string> {
  const route = useRoute();
  const router = useRouter();
  const raw = route.query.token;
  const token = ref(typeof raw === "string" ? raw : "");

  onMounted(() => {
    if (route.query.token === undefined) return;
    const { token: _token, ...query } = route.query;
    void router.replace({ path: route.path, query, hash: route.hash });
  });

  return token;
}
