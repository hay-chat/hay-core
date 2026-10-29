/**
 * Call a plugin-api mutation on Hay core. The worker receives HAY_API_URL and
 * HAY_API_TOKEN (an org- and plugin-scoped JWT) from the plugin runner.
 * tRPC without a transformer takes the raw input as the POST body.
 */
export async function pluginApiMutation(
  procedure: string,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  const apiUrl = env.HAY_API_URL;
  const token = env.HAY_API_TOKEN;
  if (!apiUrl || !token) throw new Error("HAY_API_URL / HAY_API_TOKEN not set");

  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/pluginApi.${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Plugin API ${procedure} failed: ${response.status} ${text.slice(0, 200)}`);
  }
  const data = (await response.json()) as { result?: { data?: unknown } };
  return data?.result?.data ?? data;
}
