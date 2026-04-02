import dns from "dns/promises";
import net from "net";

/**
 * Validate a URL is safe to fetch (SSRF protection).
 * Resolves hostname to IP and blocks private/internal ranges.
 */
export async function validateUrlForSSRF(url: string): Promise<void> {
  const parsed = new URL(url);

  // Only allow http(s)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Blocked request to disallowed protocol: ${parsed.protocol}`);
  }

  // Resolve hostname to IPs
  const hostname = parsed.hostname;
  let addresses: string[];

  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const result = await dns.resolve4(hostname);
      addresses = result;
    } catch {
      // If DNS resolution fails, allow the request to fail naturally via axios
      return;
    }
  }

  for (const ip of addresses) {
    if (isPrivateIP(ip)) {
      throw new Error(`Blocked request to private/internal IP: ${hostname} (${ip})`);
    }
  }
}

/**
 * Check if an IP address is in a private/reserved range.
 */
export function isPrivateIP(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return false;

  const [a, b] = parts;

  return (
    a === 0 || // 0.0.0.0/8 — current network
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8 — loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 — link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) // 192.168.0.0/16
  );
}
