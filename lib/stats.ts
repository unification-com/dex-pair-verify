import { remove_outliers } from "peirce-criterion";

export type Stats = {
  n: number;
  sum: number;
  mean: number;
  variance: number;
  stdDev: number;
};

export const removeOutliersPeirceCriterion = (dataSet: number[]): number[] =>
  remove_outliers(dataSet);

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
  // sort into ascending order
  dataSet.sort((a, b) => a - b);

  // calculate quartiles and interquartile range
  const Q1 = getQuartile(dataSet, 0.25);
  const Q3 = getQuartile(dataSet, 0.75);
  const IQR = Q3 - Q1;

  const noneOutliers: number[] = [];
  dataSet.forEach((number) => {
    if (number > Q3 + 1.5 * IQR || number < Q1 - 1.5 * IQR) {
      // ignore outlier
    } else {
      // add to dataset
      noneOutliers.push(number);
    }
  });
  return noneOutliers;
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

// Per-value reject test (shared by removeOutliersMAD + robustAggregate so the
// rule lives in one place): the modified z-score 0.6745·|xi − median| / MAD
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

export type RobustAggregate = {
  price: number; // liquidity-weighted mean of the kept prices
  nUsed: number;
  nRejected: number;
  kept: PriceSample[];
  rejected: PriceSample[];
  median: number;
  mad: number;
};

// The full robust pipeline in one call, the shape go-ooo needs: reject price
// outliers by MAD modified z-score, then take the liquidity-weighted mean of the
// survivors. Partitions on the SAMPLES (not just the price array) so each kept
// price keeps its own pool's liquidity for the weighting.
export const robustAggregate = (
  samples: PriceSample[],
  opts: { threshold?: number } = {},
): RobustAggregate => {
  const threshold = opts.threshold ?? MAD_OUTLIER_THRESHOLD;
  const prices = samples.map((s) => s.price);
  const med = median(prices);
  const mad = medianAbsoluteDeviation(prices);
  const tooFew = samples.length < 3; // mirror removeOutliersMAD: keep all

  const kept: PriceSample[] = [];
  const rejected: PriceSample[] = [];
  for (const s of samples) {
    if (!tooFew && isMadOutlier(s.price, med, mad, threshold)) {
      rejected.push(s);
    } else {
      kept.push(s);
    }
  }

  return {
    price: weightedMean(
      kept.map((s) => s.price),
      kept.map((s) => s.liquidity),
    ),
    nUsed: kept.length,
    nRejected: rejected.length,
    kept,
    rejected,
    median: med,
    mad,
  };
};
