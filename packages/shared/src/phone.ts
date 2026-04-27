/**
 * Normalize a raw phone string to E.164 (`+<country><number>`).
 *
 * Handles common Brazilian input shapes:
 *   "(62) 99612-3013"   → "+5562996123013"
 *   "11 99999 9999"     → "+5511999999999"
 *   "+5562996123013"    → "+5562996123013"
 *   "62996123013"       → "+5562996123013"
 *
 * Brazil-specific 9th-digit fix: post-2016 mobile numbers must have a "9"
 * prefix after the DDD. If we receive an old-format 10-digit local number
 * starting with 6-9 (a mobile range), we insert the missing 9. Landlines
 * (which start with 2-5) stay 10 digits.
 */
export function normalizeE164(raw: string, defaultCountry = "55"): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) throw new Error("empty phone");

  // If user explicitly typed +, treat as already-international.
  if (raw.trim().startsWith("+")) return `+${digits}`;

  let withCountry: string;
  if (digits.startsWith(defaultCountry)) {
    withCountry = digits;
  } else {
    withCountry = `${defaultCountry}${digits}`;
  }

  // Brazilian 9th-digit normalization. After prefixing 55, expect:
  //   - 13 digits = 55 + DDD(2) + 9 + 8 digits → already correct mobile
  //   - 12 digits = 55 + DDD(2) + 8 digits     → either old-mobile (needs 9
  //                                                inserted) or landline.
  if (defaultCountry === "55" && withCountry.length === 12) {
    const ddd = withCountry.slice(2, 4);
    const local = withCountry.slice(4);
    const firstLocalDigit = local[0];
    // Mobile range starts with 6,7,8,9 (old format had no leading 9).
    if (firstLocalDigit && "6789".includes(firstLocalDigit)) {
      withCountry = `55${ddd}9${local}`;
    }
  }

  return `+${withCountry}`;
}

/**
 * Strip a phone to digits-only (no `+`, spaces, parens). Used by providers
 * that expect the format `5562996123013` (Uazapi, Evolution, Z-API).
 */
export function toDigitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}
