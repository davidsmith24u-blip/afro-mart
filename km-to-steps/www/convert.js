function kmToSteps(distance, stepLengthCm = 76, unit = "km") {
  if (!(distance >= 0) || !(stepLengthCm > 0)) return NaN;
  const km = unit === "mi" ? distance * 1.609344 : distance;
  return Math.round((km * 100000) / stepLengthCm);
}
if (typeof module !== "undefined") module.exports = { kmToSteps };

// Export helpers for step-tracking apps (Apple Health / Health Connect importers)
function toCSV(entries) {
  const rows = entries.map(e => [e.date, e.distanceKm, e.stepLengthCm, e.steps].join(","));
  return ["date,distance_km,step_length_cm,steps", ...rows].join("\n");
}
function toJSON(entries) {
  return JSON.stringify({ source: "km-to-steps", type: "HKQuantityTypeIdentifierStepCount", samples: entries.map(e => ({ date: e.date, steps: e.steps, unit: "count" })) }, null, 2);
}
if (typeof module !== "undefined") Object.assign(module.exports, { toCSV, toJSON });
