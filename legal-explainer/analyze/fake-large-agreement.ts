/**
 * FAKE 40-clause rental agreement for the manual multi-batch live check (live-multibatch.ts).
 * Everything is invented. Each clause is a short core sentence plus two neutral boilerplate
 * paragraphs, so the whole text is long enough to be split into several LLM batches.
 * Not part of the test suite and never imported by production code.
 */
import type { Clause } from "../packages/shared/schemas";
import type { PlantedClause } from "./fake-agreements";

interface Core {
  heading: string;
  text: string;
  /** Set only for planted traps. */
  trap?: string;
}

const CORES: Core[] = [
  { heading: "Parties", text: "This Agreement is made between Mr. A. Kumar (the Landlord) and Ms. R. Singh (the Tenant) for the residential flat at 12 Example Street, Sample City." },
  { heading: "Premises", text: "The premises are a two-bedroom flat with one parking space, together with the fixtures and fittings listed in Schedule A." },
  { heading: "Security Deposit", trap: "vague deposit deduction", text: "The Tenant shall pay a security deposit of Rs. 50,000 at signing. The Landlord may deduct from the deposit any amounts for damages, cleaning, repainting and other charges as the Landlord deems necessary, and the balance will be refunded within a reasonable time after the Tenant vacates." },
  { heading: "Term", text: "This Agreement starts on 1 January and continues for eleven (11) months." },
  { heading: "Rent", text: "The Tenant shall pay monthly rent of Rs. 20,000 on or before the 5th day of each month by bank transfer." },
  { heading: "Receipts", text: "The Landlord shall give the Tenant a written receipt for every payment on request." },
  { heading: "Late Payment", text: "If rent is more than ten (10) days late, the Tenant shall pay a late fee of Rs. 200 per day, up to a maximum of Rs. 2,000 in any month." },
  { heading: "Utilities", text: "The Tenant shall pay electricity and water charges according to the meter readings. The Landlord shall pay property tax and society maintenance charges." },
  { heading: "Rent Revision", trap: "automatic rent escalation", text: "The monthly rent shall increase by 15% every year on the anniversary of this Agreement, without the need for any notice to the Tenant." },
  { heading: "Use of Premises", text: "The premises shall be used as a private residence only and not for any business." },
  { heading: "Occupancy", text: "The premises may be occupied by the Tenant and up to three members of the Tenant's family." },
  { heading: "Subletting", text: "The Tenant shall not sublet the premises without the Landlord's written consent, which shall not be unreasonably withheld." },
  { heading: "Structural Repairs", text: "The Landlord shall pay for structural repairs and for repairs to fixtures supplied by the Landlord." },
  { heading: "Termination", trap: "one-sided notice period", text: "The Tenant shall give three (3) months' written notice to terminate this Agreement. The Landlord may terminate this Agreement at any time by giving fifteen (15) days' notice." },
  { heading: "Minor Repairs", text: "The Tenant shall pay for minor repairs caused by the Tenant's own use, up to Rs. 1,000 per repair." },
  { heading: "Landlord Access", text: "The Landlord may inspect the premises once every three months after giving the Tenant at least 48 hours' prior notice, and at any time without notice only in an emergency." },
  { heading: "Insurance", text: "The Landlord shall insure the building. The Tenant may insure the Tenant's own belongings." },
  { heading: "Furniture", text: "The items in Schedule A shall be returned in the same condition, except for normal wear and tear." },
  { heading: "Pets", text: "The Tenant may keep a pet with the Landlord's prior written consent." },
  { heading: "Noise and Conduct", text: "The Tenant shall not cause nuisance or unreasonable noise to the neighbours." },
  { heading: "Notices", text: "Notices under this Agreement shall be in writing and delivered by hand or by registered post to the addresses given above." },
  { heading: "Administrative Charges", trap: "hidden fee", text: "The Tenant shall pay an administrative charge of Rs. 5,000 for each request made to the Landlord, including requests for repairs, receipts or copies of documents." },
  { heading: "Wall Fittings", text: "The Tenant may hang pictures on the walls and shall fill any holes made, using paint of the same colour." },
  { heading: "Keys", text: "The Landlord shall hand over two sets of keys at the start and the Tenant shall return all keys when leaving." },
  { heading: "Water Supply", text: "The Landlord shall ensure a regular water supply to the premises as provided by the municipal authority." },
  { heading: "Common Areas", text: "The Tenant shall keep the common areas clean and shall follow the rules of the housing society." },
  { heading: "Waste", text: "The Tenant shall dispose of household waste only in the places provided by the society." },
  { heading: "Electrical Safety", text: "The Tenant shall not overload the electrical wiring or install heavy appliances without informing the Landlord." },
  { heading: "Alterations", text: "The Tenant shall not make structural changes to the premises without the Landlord's written consent." },
  { heading: "Visitors", text: "The Tenant may have visitors at reasonable hours and shall be responsible for their conduct in the premises." },
  { heading: "Vacating", text: "At the end of the term the Tenant shall vacate the premises and hand over possession with all keys." },
  { heading: "Handover Inspection", text: "The Landlord and the Tenant shall inspect the premises together at the start and at the end of the term and record its condition." },
  { heading: "Fire Safety", text: "The Tenant shall keep the fire extinguisher accessible and shall report any fire hazard to the Landlord." },
  { heading: "Mail", text: "The Tenant shall pass on any mail addressed to the previous occupant to the Landlord." },
  { heading: "Language", text: "This Agreement is written in English, and the Tenant confirms that its terms have been explained." },
  { heading: "Copies", text: "This Agreement is signed in two copies, and each party keeps one signed copy." },
  { heading: "Entire Agreement", text: "This Agreement records the whole understanding between the parties about the premises." },
  { heading: "Amendments", text: "Any change to this Agreement must be in writing and signed by both parties." },
  { heading: "Dispute Resolution", text: "The parties shall first try to settle any dispute by discussion, and may then go to the courts at Sample City." },
  { heading: "Governing Law", text: "This Agreement is governed by the laws of India." },
];

/** Neutral filler (no money, dates, rights or duties) that makes each clause long enough to batch. */
const PADDING =
  " The parties agree that this clause is to be read together with the other clauses of this " +
  "Agreement and with the schedules attached to it, and that the headings are for convenience " +
  "only and do not change its meaning. Any reference in this clause to a party includes that " +
  "party's lawful heirs and permitted successors, any reference to a month means a calendar " +
  "month, and any reference to writing includes a signed letter or a signed email.";

const toClause = (core: Core, n: number): Clause => ({
  id: `c${n}`,
  index: n - 1,
  heading: core.heading,
  text: `${core.heading}. ${core.text}${PADDING}`,
  page: Math.ceil(n / 8),
});

/** 40 clauses: 4 planted traps (deposit, rent escalation, notice period, hidden fee), 36 fair. */
export const LARGE_AGREEMENT: PlantedClause[] = CORES.map((core, i) => ({
  kind: core.trap === undefined ? "FAIR" : "TRAP",
  ...(core.trap === undefined ? {} : { trap: core.trap }),
  clause: toClause(core, i + 1),
}));
