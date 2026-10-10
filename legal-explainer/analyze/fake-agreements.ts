/**
 * FAKE rental agreement data for the manual live checks (live-language.ts, live-multibatch.ts).
 * Everything here is invented: no real people, addresses or documents. Not part of the test
 * suite and never imported by production code.
 */
import type { Clause } from "../packages/shared/schemas";

export type Kind = "TRAP" | "FAIR";

export interface PlantedClause {
  kind: Kind;
  trap?: string;
  clause: Clause;
}

const c = (n: number, heading: string, text: string): Clause => ({
  id: `c${n}`,
  index: n - 1,
  heading,
  text,
  page: 1,
});

/** 10 clauses: 3 planted traps (c2, c5, c7) and 7 fair clauses. */
export const TEN_CLAUSE_AGREEMENT: PlantedClause[] = [
  {
    kind: "FAIR",
    clause: c(
      1,
      "Parties and Premises",
      "Parties and Premises. This Agreement is made between Mr. A. Kumar (the Landlord) and Ms. R. " +
        "Singh (the Tenant) for the residential flat at 12 Example Street, Sample City, for use as a " +
        "private residence only.",
    ),
  },
  {
    kind: "TRAP",
    trap: "vague deposit deduction",
    clause: c(
      2,
      "Security Deposit",
      "Security Deposit. The Tenant shall pay a security deposit of Rs. 50,000 at signing. The " +
        "Landlord may deduct from the deposit any amounts for damages, cleaning, repainting and other " +
        "charges as the Landlord deems necessary, and the balance will be refunded within a " +
        "reasonable time after the Tenant vacates.",
    ),
  },
  {
    kind: "FAIR",
    clause: c(
      3,
      "Term",
      "Term. This Agreement starts on 1 January and continues for eleven (11) months, and may be " +
        "renewed for a further term by written agreement of both parties.",
    ),
  },
  {
    kind: "FAIR",
    clause: c(
      4,
      "Rent and Payment",
      "Rent and Payment. The Tenant shall pay monthly rent of Rs. 20,000 on or before the 5th day " +
        "of each month by bank transfer, and the Landlord shall give a written receipt on request.",
    ),
  },
  {
    kind: "TRAP",
    trap: "automatic rent escalation",
    clause: c(
      5,
      "Rent Revision",
      "Rent Revision. The monthly rent shall increase by 15% every year on the anniversary of this " +
        "Agreement, without the need for any notice to the Tenant.",
    ),
  },
  {
    kind: "FAIR",
    clause: c(
      6,
      "Utilities",
      "Utilities. The Tenant shall pay electricity and water charges according to the meter " +
        "readings, and the Landlord shall pay property tax and society maintenance charges.",
    ),
  },
  {
    kind: "TRAP",
    trap: "one-sided notice period",
    clause: c(
      7,
      "Termination",
      "Termination. The Tenant shall give three (3) months' written notice to terminate this " +
        "Agreement. The Landlord may terminate this Agreement at any time by giving fifteen (15) " +
        "days' notice.",
    ),
  },
  {
    kind: "FAIR",
    clause: c(
      8,
      "Repairs",
      "Repairs. The Landlord shall pay for structural repairs and repairs to fixtures supplied by " +
        "the Landlord. The Tenant shall pay for minor repairs caused by the Tenant's own use, up to " +
        "Rs. 1,000 per repair.",
    ),
  },
  {
    kind: "FAIR",
    clause: c(
      9,
      "Landlord Access",
      "Landlord Access. The Landlord may inspect the premises once every three months after giving " +
        "the Tenant at least 48 hours' prior notice, and at any time without notice only in an " +
        "emergency.",
    ),
  },
  {
    kind: "FAIR",
    clause: c(
      10,
      "Governing Law",
      "Governing Law. This Agreement is governed by the laws of India, and the courts at Sample " +
        "City shall have jurisdiction over any dispute.",
    ),
  },
];
