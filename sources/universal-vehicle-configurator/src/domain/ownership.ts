import type { Catalog, ResolveResult } from "./catalog.types";

export interface OwnershipAssumptions {
  aprPct: number;
  termMonths: number;
  downPayment: number;
  salesTaxRate: number;
  annualMiles: number;
  homeKwhRate: number;
  publicKwhRate: number;
  homeChargingShare: number;
  horizonYears: number;
}

export interface OwnershipResult {
  assumptions: OwnershipAssumptions;
  taxableVehicleAmount: number;
  salesTax: number;
  principal: number;
  monthlyPayment: number;
  totalLoanPayments: number;
  blendedEnergyRate: number;
  annualEnergy: number;
  annualMaintenance: number;
  ownershipSetup: number;
  ownershipTotal: number;
  separatelyDisplayedSavings: number;
  note: string;
}

export class OwnershipAssumptionError extends RangeError {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid ownership assumptions: ${issues.join("; ")}`);
    this.name = "OwnershipAssumptionError";
    this.issues = issues;
  }
}

function inRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function validateOwnershipAssumptions(
  assumptions: OwnershipAssumptions,
  vehicleTotal: number,
): string[] {
  const issues: string[] = [];
  if (!inRange(assumptions.aprPct, 0, 30)) issues.push("aprPct must be between 0 and 30");
  if (!inRange(assumptions.termMonths, 12, 96) || !Number.isInteger(assumptions.termMonths)) {
    issues.push("termMonths must be an integer between 12 and 96");
  }
  if (!inRange(assumptions.downPayment, 0, vehicleTotal)) {
    issues.push("downPayment must be between 0 and vehicleTotal");
  }
  if (!inRange(assumptions.salesTaxRate, 0, 0.2)) {
    issues.push("salesTaxRate must be between 0 and 0.2");
  }
  if (!inRange(assumptions.annualMiles, 0, 50_000)) {
    issues.push("annualMiles must be between 0 and 50,000");
  }
  if (!inRange(assumptions.homeKwhRate, 0, 2)) issues.push("homeKwhRate must be between 0 and 2");
  if (!inRange(assumptions.publicKwhRate, 0, 2)) issues.push("publicKwhRate must be between 0 and 2");
  if (!inRange(assumptions.homeChargingShare, 0, 1)) {
    issues.push("homeChargingShare must be between 0 and 1");
  }
  if (!inRange(assumptions.horizonYears, 1, 10) || !Number.isInteger(assumptions.horizonYears)) {
    issues.push("horizonYears must be an integer between 1 and 10");
  }
  return issues;
}

export function estimateOwnership(
  catalog: Catalog,
  resolved: ResolveResult,
  assumptions: OwnershipAssumptions,
): OwnershipResult {
  const issues = validateOwnershipAssumptions(assumptions, resolved.price.vehicleTotal);
  if (issues.length > 0) throw new OwnershipAssumptionError(issues);

  const efficiency = catalog.tco_model?.mi_per_kwh_est;
  if (efficiency === undefined || !Number.isFinite(efficiency) || efficiency <= 0) {
    throw new OwnershipAssumptionError(["catalog efficiency must be a positive finite number"]);
  }

  const taxableVehicleAmount = resolved.price.vehicleTotal;
  const salesTax = taxableVehicleAmount * assumptions.salesTaxRate;
  const principal = Math.max(0, taxableVehicleAmount + salesTax - assumptions.downPayment);
  const monthlyRate = assumptions.aprPct / 1_200;
  const monthlyPayment =
    monthlyRate === 0
      ? principal / assumptions.termMonths
      : (principal * monthlyRate * (1 + monthlyRate) ** assumptions.termMonths) /
        ((1 + monthlyRate) ** assumptions.termMonths - 1);
  const totalLoanPayments = monthlyPayment * assumptions.termMonths;
  const blendedEnergyRate =
    assumptions.homeChargingShare * assumptions.homeKwhRate +
    (1 - assumptions.homeChargingShare) * assumptions.publicKwhRate;
  const annualEnergy = (assumptions.annualMiles / efficiency) * blendedEnergyRate;
  const annualMaintenance = catalog.tco_model?.maintenance_per_year_est ?? 0;
  const ownershipTotal =
    assumptions.downPayment +
    totalLoanPayments +
    resolved.price.ownershipSetup +
    assumptions.horizonYears * (annualEnergy + annualMaintenance);

  return {
    assumptions: { ...assumptions },
    taxableVehicleAmount: cents(taxableVehicleAmount),
    salesTax: cents(salesTax),
    principal: cents(principal),
    monthlyPayment: cents(monthlyPayment),
    totalLoanPayments: cents(totalLoanPayments),
    blendedEnergyRate,
    annualEnergy: cents(annualEnergy),
    annualMaintenance: cents(annualMaintenance),
    ownershipSetup: cents(resolved.price.ownershipSetup),
    ownershipTotal: cents(ownershipTotal),
    separatelyDisplayedSavings: cents(resolved.price.fixedSavings),
    note:
      "Illustrative, nonbinding estimate. Conditional offers, tax-return credits, deductions, and unverified programs are shown separately and are not netted into payment or ownership total.",
  };
}
