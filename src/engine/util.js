'use strict';

const money = (n) =>
  (n < 0 ? '-' : '') +
  '$' +
  Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Compress a sorted list of integers into "10062–10064, 10070" style ranges. */
function fmtRanges(nums) {
  const xs = [...nums].sort((a, b) => a - b);
  const out = [];
  let start = null;
  let prev = null;
  for (const n of xs) {
    if (start === null) {
      start = prev = n;
    } else if (n === prev + 1) {
      prev = n;
    } else {
      out.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = prev = n;
    }
  }
  if (start !== null) out.push(start === prev ? `${start}` : `${start}–${prev}`);
  return out.join(', ');
}

const sum = (arr, key) => arr.reduce((a, b) => a + (key ? b[key] : b), 0);

module.exports = { money, fmtRanges, sum };
