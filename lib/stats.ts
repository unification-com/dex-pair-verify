import { remove_outliers } from "peirce-criterion";

export type Stats = {
  n: number;
  sum: number;
  mean: number;
  variance: number;
  stdDev: number;
};

export const removeOutliersPeirceCriterion = (dataSet: number[]): number[] => {
  // Too few points to judge → keep all (mirrors the other methods and guards the
  // npm package against degenerate input). Pass a COPY so it can't mutate ours.
  if (dataSet.length < 3) {
    return [...dataSet];
  }
  return remove_outliers([...dataSet]);
};

export const getQuartile = (arr: number[], q: number): number => {
  const pos = (arr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (arr[base + 1] !== undefined) {
    return arr[base] + rest * (arr[base + 1] - arr[base]);
  }
  return arr[base];
};

export const removeOutliersIQD = (dataSet: number[]): number[] => {
  // Sort a COPY into ascending order — never mutate the caller's array.
  const sorted = [...dataSet].sort((a, b) => a - b);

  // calculate quartiles and interquartile range
  const Q1 = getQuartile(sorted, 0.25);
  const Q3 = getQuartile(sorted, 0.75);
  const IQR = Q3 - Q1;

  // Tukey fences (1.5·IQR). Keep everything inside the fences.
  return sorted.filter((n) => !(n > Q3 + 1.5 * IQR || n < Q1 - 1.5 * IQR));
};

export const calculateMean = (dataSet: number[]): number => {
  if (dataSet.length === 0) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < dataSet.length; i += 1) {
    total += dataSet[i];
  }
  return total / dataSet.length;
};

export const countDecimals = (value: number | string): number => {
  if (Math.floor(Number(value)) !== value) return value.toString().split(".")[1].length || 0;
  return 0;
};

export const scientificToDecimal = (_num: number): string | number => {
  const nsign = Math.sign(_num);
  // remove the sign
  let num: string | number = Math.abs(_num);
  // if the number is in scientific notation remove it
  if (/\d+\.?\d*e[+-]*\d+/i.test(String(num))) {
    const zero = "0";
    const parts = String(num).toLowerCase().split("e"); // split into coeff and exponent
    const e = parts.pop() as string; // store the exponential part
    let l = Math.abs(e as unknown as number); // get the number of zeros
    const sign = (e as unknown as number) / l;
    const coeff_array = parts[0].split(".");
    if (sign === -1) {
      l -= coeff_array[0].length;
      if (l < 0) {
        num = `${coeff_array[0].slice(0, l)}.${coeff_array[0].slice(l)}${
          coeff_array.length === 2 ? coeff_array[1] : ""
        }`;
      } else {
        num = `${zero}.${new Array(l + 1).join(zero)}${coeff_array.join("")}`;
      }
    } else {
      const dec = coeff_array[1];
      if (dec) l -= dec.length;
      if (l < 0) {
        num = `${coeff_array[0] + dec.slice(0, l)}.${dec.slice(l)}`;
      } else {
        num = coeff_array.join("") + new Array(l + 1).join(zero);
      }
    }
  }

  return nsign < 0 ? `-${num}` : num;
};

export const getStats = (dataSet: number[]): Stats => {
  const n = dataSet.length;

  if (n === 0) {
    return { n: 0, sum: 0, mean: 0, variance: 0, stdDev: 0 };
  }

  const sum = dataSet.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  // Sample variance divides by (n - 1); undefined for a single element,
  // so report zero spread rather than NaN/Infinity.
  if (n === 1) {
    return { n, sum, mean, variance: 0, stdDev: 0 };
  }

  const variance = dataSet.reduce((result, x) => result + Math.pow(x - mean, 2), 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  return {
    n,
    sum,
    mean,
    variance,
    stdDev,
  };
};

export const cleanseForBn = (num: number): string | number => {
  const numDps = countDecimals(scientificToDecimal(num));
  if (numDps > 18) {
    return scientificToDecimal(num.toFixed(18) as unknown as number);
  }
  return scientificToDecimal(num);
};

export const removeOutliersChauvenet = (dataSet: number[], max?: number): number[] => {
  const dMax = max || 3;
  const stats = getStats(dataSet);
  const ret: number[] = [];

  for (let i = 0; i < dataSet.length; i += 1) {
    if (stats.stdDev > 0) {
      // Standard Chauvenet test.
      if (dMax > Math.abs(dataSet[i] - stats.mean) / stats.stdDev) {
        ret.push(dataSet[i]);
      }
    } else {
      // stdDev === 0 — all values identical (or a single value). The
      // distance ratio would be NaN/Infinity and exclude everything;
      // keep all, mirroring go-ooo's adhoc.go behaviour.
      ret.push(dataSet[i]);
    }
  }
  return ret;
};

// --- Robust aggregation: median + MAD outlier rejection + liquidity weighting ---
//
// go-ooo's AdHoc path aggregates DEX prices with Chauvenet's criterion (mean +
// stdDev) at a hardcoded dMax = 1, which has two failure modes:
//   1. MASKING — a lone gross outlier inflates the stdDev so its OWN distance
//      falls under dMax and it survives (see the Chauvenet masking test).
//   2. Over-rejection — at dMax = 1 a clean normal sample loses ~32% of its
//      points (everything beyond ±1σ), throwing away good data.
// median + MAD is the robust replacement: the median (centre) and MAD (spread)
// have a 50% breakdown point, so a manipulated price is rejected instead of
// dragging the estimate. Liquidity weighting then trusts deep pools — costlier
// to manipulate — over thin ones. All pure, so they unit-test trivially here and
// port directly to go-ooo's adhoc.go (the whole point of this testbed).

// The Iglewicz–Hoaglin modified z-score cutoff. 3.5 is their recommended default.
export const MAD_OUTLIER_THRESHOLD = 3.5;

// Median of a numeric set (interpolated for even lengths). Does not mutate input.
export const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

// Median Absolute Deviation: median(|xi − median(x)|). A robust spread estimate
// that — unlike stdDev — is NOT inflated by the very outliers it exists to
// detect, which is exactly why it defeats Chauvenet's masking.
export const medianAbsoluteDeviation = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const med = median(values);
  return median(values.map((v) => Math.abs(v - med)));
};

// Per-value reject test (the MAD rule in one place): the modified z-score
// 0.6745·|xi − median| / MAD
// exceeds the threshold. 0.6745 = Φ⁻¹(0.75) makes MAD a consistent estimator of
// σ for normal data. MAD = 0 (≥ half the values identical) ⇒ no robust spread to
// test against ⇒ never an outlier (mirrors the stdDev = 0 guard above).
const isMadOutlier = (v: number, med: number, mad: number, threshold: number): boolean =>
  mad > 0 && (0.6745 * Math.abs(v - med)) / mad > threshold;

// MAD modified-z-score outlier removal. Fewer than 3 points is too few to judge
// robustly, so all are kept.
export const removeOutliersMAD = (values: number[], threshold = MAD_OUTLIER_THRESHOLD): number[] => {
  if (values.length < 3) {
    return [...values];
  }
  const med = median(values);
  const mad = medianAbsoluteDeviation(values);
  return values.filter((v) => !isMadOutlier(v, med, mad, threshold));
};

// Liquidity-weighted mean: Σ(value·weight) / Σ(weight). Degrades to a plain
// arithmetic mean when the total weight is 0 (no liquidity data) rather than
// dividing by zero. A missing weight counts as 0.
export const weightedMean = (values: number[], weights: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  let weightSum = 0;
  let weightedSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const w = weights[i] ?? 0;
    weightSum += w;
    weightedSum += values[i] * w;
  }
  return weightSum > 0 ? weightedSum / weightSum : calculateMean(values);
};

export type PriceSample = { price: number; liquidity: number };

// The outlier-removal methods, selectable in the pipeline. MAD is the robust
// DEFAULT (go-ooo should default to it); the others are kept for comparison.
export type OutlierMethod = "mad" | "chauvenet" | "peirce" | "iqd" | "none";

export type AggregateResult = {
  price: number; // the (optionally liquidity-weighted) mean of the kept prices
  nUsed: number;
  nRejected: number;
  kept: PriceSample[];
  rejected: PriceSample[];
  method: OutlierMethod;
  weighted: boolean;
};

// Remove price outliers by the chosen method. `chauvenetDMax` only applies to
// Chauvenet (the others ignore it).
const removeOutliersByMethod = (prices: number[], method: OutlierMethod, chauvenetDMax?: number): number[] => {
  switch (method) {
    case "mad":
      return removeOutliersMAD(prices);
    case "chauvenet":
      return removeOutliersChauvenet(prices, chauvenetDMax);
    case "peirce":
      return removeOutliersPeirceCriterion(prices);
    case "iqd":
      return removeOutliersIQD(prices);
    case "none":
    default:
      return [...prices];
  }
};

// THE one aggregation pipeline — one number out. Remove price outliers by the
// chosen METHOD (default MAD — the robust estimator go-ooo should default to),
// then take the (optionally liquidity-weighted) mean of the survivors. Partitions
// on the SAMPLES (not just the price array) so each kept price keeps its own
// pool's liquidity for the weighting. This is the shape go-ooo's adhoc.go mirrors,
// and the dex-pair-verify price-test UI renders exactly this single result.
export const aggregatePrices = (
  samples: PriceSample[],
  opts: { method?: OutlierMethod; weightByLiquidity?: boolean; chauvenetDMax?: number } = {},
): AggregateResult => {
  const method = opts.method ?? "mad";
  const weighted = opts.weightByLiquidity ?? true;

  const survivors = removeOutliersByMethod(
    samples.map((s) => s.price),
    method,
    opts.chauvenetDMax,
  );
  // Multiset of survivor prices so duplicate prices align to distinct samples.
  const counts = new Map<number, number>();
  for (const p of survivors) {
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const kept: PriceSample[] = [];
  const rejected: PriceSample[] = [];
  for (const s of samples) {
    const c = counts.get(s.price) ?? 0;
    if (c > 0) {
      kept.push(s);
      counts.set(s.price, c - 1);
    } else {
      rejected.push(s);
    }
  }

  const keptPrices = kept.map((s) => s.price);
  const price = weighted
    ? weightedMean(
        keptPrices,
        kept.map((s) => s.liquidity),
      )
    : calculateMean(keptPrices);

  return { price, nUsed: kept.length, nRejected: rejected.length, kept, rejected, method, weighted };
};
