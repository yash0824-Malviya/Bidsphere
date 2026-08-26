/**
 * Pure Deterministic Financial Analysis Engine for BidSphere / ERPNext Business Case.
 *
 * Implements strict financial mathematics for:
 * - Total Investment (CAPEX)
 * - Annual Gross Benefit
 * - Annual Net Benefit
 * - Total Net Benefit
 * - Net Project Gain
 * - Return on Investment (ROI)
 * - Net Present Value (NPV)
 * - Internal Rate of Return (IRR) via numerical solver
 * - Payback Period with linear interpolation
 * - Multi-Year Cash Flow Child Table (Year 0..N)
 */

export interface FinancialAssumptionsInput {
  capex: number | null | undefined;
  opex: number | null | undefined;
  expected_annual_savings: number | null | undefined;
  revenue_increase?: number | null | undefined;
  cost_avoidance?: number | null | undefined;
  project_duration: number | null | undefined;
  discount_rate: number | null | undefined;
}

export interface CashFlowPeriod {
  year: number;
  beginning_balance: number;
  investment: number;
  annual_savings: number;
  revenue_increase: number;
  cost_avoidance: number;
  opex: number;
  annual_gross_benefit: number;
  annual_net_benefit: number;
  discount_rate: number;
  discount_factor: number;
  discounted_cash_flow: number;
  cumulative_cash_flow: number;
}

export type FinancialCalculationStatus =
  | "Incomplete"
  | "Calculated"
  | "Invalid"
  | "Not Applicable";

export interface FinancialCalculationResult {
  status: FinancialCalculationStatus;
  message: string;
  errors: string[];

  // Assumptions echoed (sanitized)
  capex: number;
  opex: number;
  expected_annual_savings: number;
  revenue_increase: number;
  cost_avoidance: number;
  project_duration: number;
  discount_rate: number; // percentage e.g. 10 for 10%

  // Calculated Metrics
  total_investment: number;
  annual_gross_benefit: number;
  annual_net_benefit: number;
  total_net_benefit: number;
  net_project_gain: number;
  roi: number | null; // null if Not Applicable
  roi_formatted: string;
  npv: number;
  npv_formatted: string;
  irr: number | null; // null if no real solution
  irr_formatted: string;
  payback_period_years: number | null;
  payback_period_formatted: string;

  // Yearly Cash Flow breakdown (Year 0..N)
  cash_flows: CashFlowPeriod[];

  calculated_at: string;
}

/**
 * Validates financial inputs strictly according to enterprise requirements.
 */
export function validateFinancialInputs(input: FinancialAssumptionsInput): {
  isValid: boolean;
  isIncomplete: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check missing required fields
  if (input.capex === null || input.capex === undefined || isNaN(Number(input.capex))) {
    errors.push("CAPEX (Initial Investment) is required.");
  }
  if (input.opex === null || input.opex === undefined || isNaN(Number(input.opex))) {
    errors.push("OPEX / Year is required.");
  }
  if (
    input.expected_annual_savings === null ||
    input.expected_annual_savings === undefined ||
    isNaN(Number(input.expected_annual_savings))
  ) {
    errors.push("Expected Annual Savings is required.");
  }
  if (
    input.project_duration === null ||
    input.project_duration === undefined ||
    isNaN(Number(input.project_duration))
  ) {
    errors.push("Project Duration (Years) is required.");
  }
  if (
    input.discount_rate === null ||
    input.discount_rate === undefined ||
    isNaN(Number(input.discount_rate))
  ) {
    errors.push("Discount Rate (%) is required.");
  }

  if (errors.length > 0) {
    return { isValid: false, isIncomplete: true, errors };
  }

  const capex = Number(input.capex);
  const opex = Number(input.opex);
  const savings = Number(input.expected_annual_savings);
  const revInc = Number(input.revenue_increase ?? 0);
  const costAvoid = Number(input.cost_avoidance ?? 0);
  const duration = Number(input.project_duration);
  const discountRate = Number(input.discount_rate);

  // Validate value ranges and invalid numbers
  if (!isFinite(capex) || capex < 0) errors.push("CAPEX must be a non-negative number.");
  if (!isFinite(opex) || opex < 0) errors.push("OPEX must be a non-negative number.");
  if (!isFinite(savings) || savings < 0) errors.push("Expected Annual Savings must be a non-negative number.");
  if (!isFinite(revInc) || revInc < 0) errors.push("Revenue Increase must be a non-negative number.");
  if (!isFinite(costAvoid) || costAvoid < 0) errors.push("Cost Avoidance must be a non-negative number.");

  if (!isFinite(duration) || !Number.isInteger(duration) || duration <= 0 || duration > 50) {
    errors.push("Project Duration must be a positive whole integer between 1 and 50 years.");
  }

  if (!isFinite(discountRate) || discountRate < 0 || discountRate > 100) {
    errors.push("Discount Rate must be between 0% and 100%.");
  }

  const annualGrossBenefit = savings + revInc + costAvoid;
  const isZeroBenefit = annualGrossBenefit === 0;

  return {
    isValid: errors.length === 0,
    isIncomplete: isZeroBenefit,
    errors,
  };
}

/**
 * Calculates deterministic Internal Rate of Return (IRR) using Newton-Raphson with bisection fallback.
 * Cash flows: Year 0 = -total_investment, Year 1..N = annual_net_benefit.
 */
export function calculateIrr(
  totalInvestment: number,
  annualNetBenefit: number,
  projectDuration: number,
): { irr: number | null; formatted: string; reason?: string } {
  if (totalInvestment === 0) {
    if (annualNetBenefit > 0) {
      return { irr: null, formatted: "Not Applicable", reason: "Zero initial investment with positive net benefits." };
    }
    return { irr: 0, formatted: "0.0%" };
  }

  if (annualNetBenefit <= 0) {
    return { irr: null, formatted: "Not Available", reason: "Annual Net Benefit is zero or negative." };
  }

  const totalNetInflow = annualNetBenefit * projectDuration;
  if (totalNetInflow <= totalInvestment) {
    return { irr: null, formatted: "Not Available", reason: "Total net benefits do not exceed initial investment." };
  }

  // NPV function for a given rate r
  const npvAt = (r: number): number => {
    let sum = -totalInvestment;
    for (let t = 1; t <= projectDuration; t++) {
      sum += annualNetBenefit / Math.pow(1 + r, t);
    }
    return sum;
  };

  // Derivative of NPV with respect to r
  const dNpvAt = (r: number): number => {
    let sum = 0;
    for (let t = 1; t <= projectDuration; t++) {
      sum -= (t * annualNetBenefit) / Math.pow(1 + r, t + 1);
    }
    return sum;
  };

  // Newton-Raphson iteration
  let r = 0.1; // initial guess 10%
  const maxIterations = 100;
  const tolerance = 1e-7;

  for (let i = 0; i < maxIterations; i++) {
    const y = npvAt(r);
    const dy = dNpvAt(r);

    if (Math.abs(dy) < 1e-12) break;

    const nextR = r - y / dy;
    if (Math.abs(nextR - r) < tolerance && nextR > -0.99) {
      const irrPercent = Math.round(nextR * 10000) / 100;
      return { irr: irrPercent, formatted: `${irrPercent.toFixed(1)}%` };
    }

    r = nextR;
    if (r < -0.99 || r > 10.0) {
      // Out of bounds, fall back to bisection
      break;
    }
  }

  // Bisection fallback between -0.5 and 5.0 (500%)
  let low = -0.5;
  let high = 5.0;
  if (npvAt(low) * npvAt(high) <= 0) {
    for (let i = 0; i < 100; i++) {
      const mid = (low + high) / 2;
      const val = npvAt(mid);
      if (Math.abs(val) < tolerance || (high - low) < tolerance) {
        const irrPercent = Math.round(mid * 10000) / 100;
        return { irr: irrPercent, formatted: `${irrPercent.toFixed(1)}%` };
      }
      if (npvAt(low) * val < 0) {
        high = mid;
      } else {
        low = mid;
      }
    }
  }

  return { irr: null, formatted: "Not Available", reason: "No convergent real IRR solution found." };
}

/**
 * Calculates Payback Period with exact fractional linear interpolation of cumulative cash flows.
 * Returns exact months (e.g. "26.67 Months", "0 Months", "Not Recoverable", "Not provided").
 */
export function calculatePaybackPeriod(
  totalInvestment: number,
  annualNetBenefit: number,
  projectDuration: number,
): { years: number | null; months: number | null; formatted: string } {
  if (totalInvestment === 0) {
    return { years: 0, months: 0, formatted: "0 Months" };
  }

  if (annualNetBenefit <= 0) {
    return { years: null, months: null, formatted: "Not Recoverable" };
  }

  let cumulative = -totalInvestment;
  for (let year = 1; year <= projectDuration; year++) {
    const prevCum = cumulative;
    cumulative += annualNetBenefit;

    if (cumulative >= 0) {
      // Interpolate fractional year: (previousYear) + |previousCumulative| / annualNetBenefit
      const fraction = Math.abs(prevCum) / annualNetBenefit;
      const exactYears = (year - 1) + fraction;
      const exactMonths = exactYears * 12;

      return {
        years: Number(exactYears.toFixed(4)),
        months: Number(exactMonths.toFixed(2)),
        formatted: `${exactMonths.toFixed(2)} Months`,
      };
    }
  }

  return {
    years: null,
    months: null,
    formatted: "Not Recoverable",
  };
}

/**
 * Performs complete deterministic financial calculation and generates the multi-year cash flow child table.
 */
export function calculateBusinessCaseFinancials(
  input: FinancialAssumptionsInput,
): FinancialCalculationResult {
  const validation = validateFinancialInputs(input);

  if (validation.isIncomplete) {
    const capexVal = Number(input.capex) || 0;
    const opexVal = Number(input.opex) || 0;
    const durationVal = Number(input.project_duration) || 0;
    const discountRateVal = Number(input.discount_rate) || 0;
    const savingsVal = Number(input.expected_annual_savings) || 0;
    const revIncVal = Number(input.revenue_increase) || 0;
    const costAvoidVal = Number(input.cost_avoidance) || 0;
    const grossBenefit = savingsVal + revIncVal + costAvoidVal;
    const netBenefit = grossBenefit - opexVal;

    return {
      status: "Incomplete",
      message:
        grossBenefit === 0
          ? "No measurable annual financial benefit has been provided. Enter at least one expected annual benefit (Annual Savings, Revenue Increase, or Cost Avoidance) to calculate ROI, NPV, IRR, and Payback."
          : "Required financial assumptions are missing.",
      errors: validation.errors,
      capex: capexVal,
      opex: opexVal,
      expected_annual_savings: savingsVal,
      revenue_increase: revIncVal,
      cost_avoidance: costAvoidVal,
      project_duration: durationVal,
      discount_rate: discountRateVal,
      total_investment: capexVal,
      annual_gross_benefit: grossBenefit,
      annual_net_benefit: netBenefit,
      total_net_benefit: netBenefit * durationVal,
      net_project_gain: (netBenefit * durationVal) - capexVal,
      roi: null,
      roi_formatted: "Pending Analysis",
      npv: 0,
      npv_formatted: "Pending Analysis",
      irr: null,
      irr_formatted: "Pending Analysis",
      payback_period_years: null,
      payback_period_formatted: "Pending Analysis",
      cash_flows: [],
      calculated_at: new Date().toISOString(),
    };
  }

  if (!validation.isValid) {
    return {
      status: "Invalid",
      message: "One or more financial assumptions are invalid.",
      errors: validation.errors,
      capex: Number(input.capex) || 0,
      opex: Number(input.opex) || 0,
      expected_annual_savings: Number(input.expected_annual_savings) || 0,
      revenue_increase: Number(input.revenue_increase) || 0,
      cost_avoidance: Number(input.cost_avoidance) || 0,
      project_duration: Number(input.project_duration) || 0,
      discount_rate: Number(input.discount_rate) || 0,
      total_investment: 0,
      annual_gross_benefit: 0,
      annual_net_benefit: 0,
      total_net_benefit: 0,
      net_project_gain: 0,
      roi: null,
      roi_formatted: "Invalid Inputs",
      npv: 0,
      npv_formatted: "Invalid Inputs",
      irr: null,
      irr_formatted: "Invalid Inputs",
      payback_period_years: null,
      payback_period_formatted: "Invalid Inputs",
      cash_flows: [],
      calculated_at: new Date().toISOString(),
    };
  }

  const capex = Number(input.capex);
  const opex = Number(input.opex);
  const savings = Number(input.expected_annual_savings);
  const revInc = Number(input.revenue_increase ?? 0);
  const costAvoid = Number(input.cost_avoidance ?? 0);
  const duration = Number(input.project_duration);
  const discountRatePct = Number(input.discount_rate);
  const discountRateDec = discountRatePct / 100;

  // 1. Core Metrics
  const totalInvestment = capex;
  const annualGrossBenefit = savings + revInc + costAvoid;
  const annualNetBenefit = annualGrossBenefit - opex;
  const totalNetBenefit = annualNetBenefit * duration;
  const netProjectGain = totalNetBenefit - totalInvestment;

  // 2. ROI
  let roi: number | null = null;
  let roiFormatted = "Not Applicable";
  if (totalInvestment > 0) {
    roi = Math.round(((netProjectGain / totalInvestment) * 100) * 100) / 100;
    roiFormatted = `${roi.toFixed(1)}%`;
  }

  // 3. NPV
  let npvSum = -totalInvestment;
  for (let year = 1; year <= duration; year++) {
    npvSum += annualNetBenefit / Math.pow(1 + discountRateDec, year);
  }
  const npv = Math.round(npvSum * 100) / 100;
  const npvFormatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(npv);

  // 4. IRR
  const irrRes = calculateIrr(totalInvestment, annualNetBenefit, duration);

  // 5. Payback Period
  const paybackRes = calculatePaybackPeriod(totalInvestment, annualNetBenefit, duration);

  // 6. Generate Cash Flow Table (Year 0..N)
  const cashFlows: CashFlowPeriod[] = [];

  // Year 0 (Initial Investment)
  cashFlows.push({
    year: 0,
    beginning_balance: 0,
    investment: totalInvestment,
    annual_savings: 0,
    revenue_increase: 0,
    cost_avoidance: 0,
    opex: 0,
    annual_gross_benefit: 0,
    annual_net_benefit: -totalInvestment,
    discount_rate: discountRatePct,
    discount_factor: 1.0,
    discounted_cash_flow: -totalInvestment,
    cumulative_cash_flow: -totalInvestment,
  });

  // Years 1..N
  let runningCum = -totalInvestment;
  for (let year = 1; year <= duration; year++) {
    const beginBal = runningCum;
    runningCum += annualNetBenefit;
    const factor = 1 / Math.pow(1 + discountRateDec, year);
    const dcf = Math.round(annualNetBenefit * factor * 100) / 100;

    cashFlows.push({
      year,
      beginning_balance: Math.round(beginBal * 100) / 100,
      investment: 0,
      annual_savings: savings,
      revenue_increase: revInc,
      cost_avoidance: costAvoid,
      opex,
      annual_gross_benefit: annualGrossBenefit,
      annual_net_benefit: annualNetBenefit,
      discount_rate: discountRatePct,
      discount_factor: Number(factor.toFixed(4)),
      discounted_cash_flow: dcf,
      cumulative_cash_flow: Math.round(runningCum * 100) / 100,
    });
  }

  return {
    status: "Calculated",
    message: "Financial calculations completed successfully.",
    errors: [],
    capex,
    opex,
    expected_annual_savings: savings,
    revenue_increase: revInc,
    cost_avoidance: costAvoid,
    project_duration: duration,
    discount_rate: discountRatePct,
    total_investment: totalInvestment,
    annual_gross_benefit: annualGrossBenefit,
    annual_net_benefit: annualNetBenefit,
    total_net_benefit: totalNetBenefit,
    net_project_gain: netProjectGain,
    roi,
    roi_formatted: roiFormatted,
    npv,
    npv_formatted: npvFormatted,
    irr: irrRes.irr,
    irr_formatted: irrRes.formatted,
    payback_period_years: paybackRes.years,
    payback_period_formatted: paybackRes.formatted,
    cash_flows: cashFlows,
    calculated_at: new Date().toISOString(),
  };
}
