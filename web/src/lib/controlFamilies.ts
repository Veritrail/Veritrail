/** Framework control-family grouping shared by Compliance and History. */

export type ControlFamily = { key: string; label: string };

/** Families hidden from Compliance and History UI (backend/manual flows unchanged). */
export const HIDDEN_COMPLIANCE_FAMILY_KEYS = new Set(["manual-evidence"]);

export function isHiddenComplianceFamily(key: string): boolean {
  return HIDDEN_COMPLIANCE_FAMILY_KEYS.has(key);
}

/** SOC 2 families Veritrail collects via cloud automation (Criteria tab only). */
export const SOC2_COLLECTABLE_CRITERIA_FAMILY_KEYS = new Set(["cc6", "cc7", "cc8"]);

/** Whether a control belongs on the Compliance Criteria tab. */
export function isCollectableCriteriaControl(framework: string, controlId: string): boolean {
  const family = controlFamily(framework, controlId);
  if (isHiddenComplianceFamily(family.key)) return false;
  if (framework === "soc2") return SOC2_COLLECTABLE_CRITERIA_FAMILY_KEYS.has(family.key);
  return true;
}

export function controlFamily(framework: string, controlId: string): ControlFamily {
  if (framework === "soc2") {
    if (controlId.startsWith("CC6"))
      return { key: "cc6", label: "CC6 Cloud Access" };
    if (controlId.startsWith("CC7"))
      return { key: "cc7", label: "CC7 Cloud Operations" };
    if (controlId.startsWith("CC8"))
      return { key: "cc8", label: "CC8 Change Evidence" };
    if (controlId.startsWith("A1"))
      return { key: "soc2-a1", label: "Availability criteria (A1)" };
    return { key: "manual-evidence", label: "Manual Evidence" };
  }

  if (framework === "cis_aws_l1") {
    const section = controlId.split(".")[0];
    if (section === "1")
      return { key: "cis-1", label: "CIS 1 Identity and Access" };
    if (section === "2")
      return { key: "cis-2", label: "CIS 2 Storage and Logging" };
    if (section === "3") return { key: "cis-3", label: "CIS 3 Networking" };
    if (section === "4") return { key: "cis-4", label: "CIS 4 Monitoring" };
  }

  if (framework === "iso27001") {
    if (controlId.startsWith("A.9"))
      return { key: "iso-a9", label: "A.9 Access Control" };
    if (controlId.startsWith("A.10"))
      return { key: "iso-a10", label: "A.10 Cryptography" };
    if (controlId.startsWith("A.12"))
      return { key: "iso-a12", label: "A.12 Operations Security" };
    if (controlId.startsWith("A.13"))
      return { key: "iso-a13", label: "A.13 Communications Security" };
  }

  return { key: "other", label: "Other" };
}

export function controlIdSortKey(controlId: string): (string | number)[] {
  const parts: (string | number)[] = [];
  const re = /(\d+)|(\D+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(controlId)) !== null) {
    parts.push(match[1] ? Number.parseInt(match[1], 10) : match[2]);
  }
  return parts;
}

export function compareControlIds(a: string, b: string): number {
  const pa = controlIdSortKey(a);
  const pb = controlIdSortKey(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i];
    const vb = pb[i];
    if (va === undefined) return -1;
    if (vb === undefined) return 1;
    if (typeof va === "number" && typeof vb === "number") {
      if (va !== vb) return va - vb;
    } else {
      const cmp = String(va).localeCompare(String(vb));
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}
