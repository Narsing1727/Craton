// Is a socket address in a list of trusted addresses? Entries are single addresses or IPv4 ranges in CIDR form ("10.0.0.0/8",
// "172.16.0.0/12"), which is what a container or load-balancer deployment needs: the web app's address is not fixed, only its network.

/** "::ffff:10.0.0.5" is the IPv4 address 10.0.0.5 as a dual-stack socket reports it. */
const plain = (addr: string) => addr.replace(/^::ffff:/i, "");

function ipv4(addr: string): number | null {
  const m = plain(addr).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function addressInList(addr: string, list: readonly string[]): boolean {
  const a = plain(addr).toLowerCase();
  const n = ipv4(addr);
  for (const raw of list) {
    const entry = plain(raw.trim()).toLowerCase();
    if (!entry) continue;
    const slash = entry.indexOf("/");
    if (slash < 0) {
      if (entry === a) return true;
      continue;
    }
    const base = ipv4(entry.slice(0, slash));
    const bits = Number(entry.slice(slash + 1));
    if (n === null || base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if (((n & mask) >>> 0) === ((base & mask) >>> 0)) return true;
  }
  return false;
}
