// const BN = require("bn.js")
// const Web3 = require("web3")
const { remove_outliers } = require("peirce-criterion")

const removeOutliersPeirceCriterion = (dataSet) => {
    return remove_outliers(dataSet)
}

const getQuartile = (arr, q) => {
    const pos = (arr.length - 1) * q
    const base = Math.floor(pos)
    const rest = pos - base
    if (arr[base + 1] !== undefined) {
        return arr[base] + rest * (arr[base + 1] - arr[base])
    }
    return arr[base]
}

const removeOutliersIQD = (dataSet) => {
    // sort into ascending order
    dataSet.sort((a, b) => a - b)

    // calculate quartiles and interquartile range
    const Q1 = getQuartile(dataSet, 0.25)
    const Q3 = getQuartile(dataSet, 0.75)
    const IQR = Q3 - Q1

    const noneOutliers = []
    dataSet.forEach((number) => {
        if (number > Q3 + 1.5 * IQR || number < Q1 - 1.5 * IQR) {
            // ignore outlier
        } else {
            // add to dataset
            noneOutliers.push(number)
        }
    })
    return noneOutliers
}

// const calculateMeanBn = (dataSet) => {
//     let totalBN = new BN("0")
//     for (let i = 0; i < dataSet.length; i += 1) {
//         const priceBn = Web3.utils.toWei(String(dataSet[i]), "ether")
//         totalBN = totalBN.add(new BN(priceBn))
//     }
//     return totalBN.div(new BN(dataSet.length))
// }

const calculateMean = (dataSet) => {
    let total = 0
    for (let i = 0; i < dataSet.length; i += 1) {
        total += dataSet[i]
    }
    if (total > 0) {
        return total / dataSet.length
    }
    return 0
}

const countDecimals = (value) => {
    if (Math.floor(value) !== value) return value.toString().split(".")[1].length || 0
    return 0
}

const scientificToDecimal = (_num) => {
    const nsign = Math.sign(_num)
    // remove the sign
    let num = Math.abs(_num)
    // if the number is in scientific notation remove it
    if (/\d+\.?\d*e[+-]*\d+/i.test(num)) {
        const zero = "0"
        const parts = String(num).toLowerCase().split("e") // split into coeff and exponent
        const e = parts.pop() // store the exponential part
        let l = Math.abs(e) // get the number of zeros
        const sign = e / l
        const coeff_array = parts[0].split(".")
        if (sign === -1) {
            l -= coeff_array[0].length
            if (l < 0) {
                num = `${coeff_array[0].slice(0, l)}.${coeff_array[0].slice(l)}${
                    coeff_array.length === 2 ? coeff_array[1] : ""
                }`
            } else {
                num = `${zero}.${new Array(l + 1).join(zero)}${coeff_array.join("")}`
            }
        } else {
            const dec = coeff_array[1]
            if (dec) l -= dec.length
            if (l < 0) {
                num = `${coeff_array[0] + dec.slice(0, l)}.${dec.slice(l)}`
            } else {
                num = coeff_array.join("") + new Array(l + 1).join(zero)
            }
        }
    }

    return nsign < 0 ? `-${num}` : num
}

const getStats = (dataSet) => {
    const add = (a, b) => a + b

    const n = dataSet.length
    const sum = dataSet.reduce(add)
    const mean = sum / n
    const variance = dataSet.reduce((result, x) => result + Math.pow(x - mean, 2), 0) / (n - 1)
    const stdDev = Math.sqrt(variance)

    return {
        n,
        sum,
        mean,
        variance,
        stdDev,
    }
}

const cleanseForBn = (num) => {
    const numDps = countDecimals(scientificToDecimal(num))
    if (numDps > 18) {
        return scientificToDecimal(num.toFixed(18))
    }
    return scientificToDecimal(num)
}

const removeOutliersChauvenet = (dataSet, max) => {
    const dMax = max || 3
    const stats = getStats(dataSet)
    const ret = []

    for (let i = 0; i < dataSet.length; i += 1) {
        if (dMax > Math.abs(dataSet[i] - stats.mean) / stats.stdDev) {
            ret.push(dataSet[i])
        }
    }
    return ret
}

module.exports = {
    getStats,
    scientificToDecimal,
    getQuartile,
    removeOutliersIQD,
    // calculateMeanBn,
    calculateMean,
    removeOutliersPeirceCriterion,
    removeOutliersChauvenet,
    countDecimals,
    cleanseForBn,
}
