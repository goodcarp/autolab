export type RangeRealitySnapshot = {
  build: "Performance";
  wheelId: "wheels.bs20_at" | "wheels.rb21_as";
  wheelLabel: string;
  estimatedRangeMiles: 307 | 330;
  estimatedVehicleTotal: 63790 | 60790;
  deliveryGate: "2027" | null;
};

export const RANGE_REALITY_FIXTURE: {
  before: RangeRealitySnapshot;
  after: RangeRealitySnapshot;
  restoredMiles: 23;
} = {
  before: {
    build: "Performance",
    wheelId: "wheels.bs20_at",
    wheelLabel: "20-inch Black Sand all-terrain",
    estimatedRangeMiles: 307,
    estimatedVehicleTotal: 63790,
    deliveryGate: "2027",
  },
  after: {
    build: "Performance",
    wheelId: "wheels.rb21_as",
    wheelLabel: "21-inch range-maximizing all-season",
    estimatedRangeMiles: 330,
    estimatedVehicleTotal: 60790,
    deliveryGate: null,
  },
  restoredMiles: 23,
};
