/**
 * Well-test constants kept identical to the SPE field-unit equations.
 * Oil (log10 Horner, slightly compressible):
 *   m [psi/cycle] = 162.6 * q[STB/d] * B * μ[cP] / (k[mD] * h[ft])
 * Gas, pressure-squared:
 *   m [psi²/cycle] = 1637 * q[Mscf/d] * T[°R] * μ[cP] * z / (k[mD] * h[ft])
 * Skin (oil and the P² analogue):
 *   s = 1.1513 * [(P1hr − Pwf) / m − log10(k / (φ μ ct rw²)) + 3.2275]
 *   with k in mD, μ in cP, ct in 1/psi, rw in ft.
 * Radius of investigation:
 *   ri [ft] = 0.029 * sqrt(k[mD] * t[h] / (φ μ ct[1/psi]))
 */

const PSI_PER_MPA = 1 / 0.006894757293168;
const STB_PER_M3 = 1 / 0.158987294928;
const FT_PER_M = 1 / 0.3048;
const MSCF_PER_M3 = 35.3146667214886 / 1000;

export const OIL_K_FACTOR =
  (162.6 * STB_PER_M3) / (PSI_PER_MPA * FT_PER_M);

export const GAS_K_FACTOR =
  (1637 * MSCF_PER_M3 * 1.8) / (PSI_PER_MPA ** 2 * FT_PER_M);

const SKIN_A = 1.1513;
const SKIN_B = 3.2275;

export function oilPermeabilityMd(qM3d: number, formationVolumeFactor: number, viscosity: number, slopeMpa: number, netPayM: number): number | null {
  if (!(qM3d > 0) || !(formationVolumeFactor > 0) || !(viscosity > 0) || !(slopeMpa > 0) || !(netPayM > 0)) return null;
  return (OIL_K_FACTOR * qM3d * formationVolumeFactor * viscosity) / (slopeMpa * netPayM);
}

export function gasPermeabilityMd(qM3d: number, tempK: number, viscosity: number, z: number, slopeMpa2: number, netPayM: number): number | null {
  if (!(qM3d > 0) || !(tempK > 0) || !(viscosity > 0) || !(z > 0) || !(slopeMpa2 > 0) || !(netPayM > 0)) return null;
  return (GAS_K_FACTOR * qM3d * tempK * viscosity * z) / (slopeMpa2 * netPayM);
}

export function skinFromHorner(args: {
  p1hr: number;
  pwf: number;
  slope: number;
  permeabilityMd: number;
  porosity: number;
  viscosity: number;
  compressibilityPerMpa: number;
  wellRadiusM: number;
}): number | null {
  const { p1hr, pwf, slope, permeabilityMd, porosity, viscosity, compressibilityPerMpa, wellRadiusM } = args;
  if (!(slope > 0) || !(permeabilityMd > 0) || !(porosity > 0) || !(viscosity > 0) || !(compressibilityPerMpa > 0) || !(wellRadiusM > 0)) {
    return null;
  }
  const ctPsi = compressibilityPerMpa * 0.006894757293168;
  const rwFt = wellRadiusM / 0.3048;
  const arg = permeabilityMd / (porosity * viscosity * ctPsi * rwFt * rwFt);
  if (!(arg > 0)) return null;
  return SKIN_A * ((p1hr - pwf) / slope - Math.log10(arg) + SKIN_B);
}

export function radiusOfInvestigationM(permeabilityMd: number, hours: number, porosity: number, viscosity: number, compressibilityPerMpa: number): number | null {
  if (!(permeabilityMd > 0) || !(hours > 0) || !(porosity > 0) || !(viscosity > 0) || !(compressibilityPerMpa > 0)) return null;
  const ctPsi = compressibilityPerMpa * 0.006894757293168;
  const riFt = 0.029 * Math.sqrt((permeabilityMd * hours) / (porosity * viscosity * ctPsi));
  return riFt * 0.3048;
}

export function porosityFraction(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value > 1 ? value / 100 : value;
}
