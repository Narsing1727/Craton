import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { parseUnits, UNITS_COOKIE, type UnitSystem } from "@/lib/units";

/** The viewer's display units, from their cookie (metric when unset or outside a request). */
export async function getUnits(): Promise<UnitSystem> {
  try {
    return parseUnits((await cookies()).get(UNITS_COOKIE)?.value);
  } catch (err) {
    unstable_rethrow(err);
    return "metric";
  }
}
