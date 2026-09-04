export type GroupId = string;
export type OptionId = string;
export type SourceId = string;

export type Confidence = "verified" | "estimated";
export type VisualStatus = "visually_configurable";
export type Orderability = "orderable_now" | "notify" | "concept_only";
export type SelectMode = "one" | "many";
export type PriceMode = "base" | "delta";
export type Severity = "error" | "warning";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ExpressionOperator = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "truthy";

export type Expression =
  | boolean
  | { all: Expression[] }
  | { any: Expression[] }
  | { not: Expression }
  | { selected: OptionId }
  | { var: string; op: ExpressionOperator; value: JsonValue };

export type EvExperience = "new" | "familiar" | "owner" | "unknown";
export type ChargingSituation =
  | "home_l2_possible"
  | "home_l1"
  | "routine_public"
  | "poor_fit"
  | "unknown";
export type UseCaseId = "road_trip" | "towing" | "commute" | "snow";
export type PriorityId = "range" | "delivery" | "price" | "performance" | "comfort";
export type CompetitorId = "model_y" | "ioniq_5";
export type UtilityId = "xcel";
export type UsState = string;

export interface BuyerContext {
  evExperience: EvExperience;
  state: UsState | "unknown";
  utility: UtilityId | "unknown";
  chargingSituation: ChargingSituation;
  useCases: UseCaseId[];
  priorities: PriorityId[];
  financing: boolean | "unknown";
  crossShopIds: CompetitorId[];
}

export type BuyerContextInput = Partial<BuyerContext>;

export interface CatalogSource {
  id: SourceId;
  title: string;
  url: string;
  publishedAt: string;
  retrievedAt: string;
  asOf: string;
}

export interface Provenance {
  sourceIds: SourceId[];
  confidence: Confidence;
  note?: string;
}

export interface CatalogProduct {
  id: string;
  make: string;
  model: string;
  year: number;
  body?: string;
  market: string;
  currency?: string;
  data_as_of: string;
  sources: SourceId[];
  disclaimer?: string;
  /**
   * Whether the catalog describes an actual vehicle or one modelled on
   * published figures. Under "modelled", the sources are the BASIS for the
   * numbers rather than a citation of this vehicle, so no vehicle figure may
   * claim "verified" confidence. Incentive programs are unaffected: they are
   * real regardless of which vehicle qualifies for them.
   */
  representation?: "actual" | "modelled";
  assembly?: {
    country?: string;
    plant?: string;
  };
  delivery_order?: string[];
  calibration?: Record<string, JsonValue>;
}

export interface CatalogGroup {
  id: GroupId;
  label: string;
  select: SelectMode;
  required?: boolean;
  role?: "base" | "option";
  default?: OptionId;
}

export interface CatalogPrice {
  amount: number;
  mode: PriceMode;
  confidence: Confidence;
  note?: string;
}

export interface CatalogEffect {
  spec: string;
  op: "set" | "add" | "mul";
  value: JsonValue;
  confidence: Confidence;
}

export interface CatalogOverride {
  when: Expression;
  effects: CatalogEffect[];
}

export interface CatalogOption {
  id: OptionId;
  group: GroupId;
  label: string;
  vendor_code?: string;
  visualStatus: VisualStatus;
  orderability: Orderability;
  price: CatalogPrice;
  effects?: CatalogEffect[];
  overrides?: CatalogOverride[];
  availability?: Expression;
  delivery?: {
    window: string;
    confidence: Confidence;
  };
  copy?: {
    short?: string;
    long?: string;
    value_note?: string;
  };
  render?: {
    hex?: string;
    mesh_target?: string;
    mesh_swap?: string;
  };
  evidenceIds?: string[];
  provenance: Provenance;
}

export interface CatalogRule {
  id: string;
  when: Expression;
  require: Expression;
  message: string;
  severity?: Severity;
}

export interface CatalogFee {
  id: string;
  label: string;
  amount: number;
  confidence: Confidence;
  note?: string;
  provenance: Provenance;
}

export type IncentiveStatus = "active" | "expired" | "scheduled" | "funds_limited";

export interface CatalogIncentive {
  id: string;
  label: string;
  jurisdiction?: {
    country?: string;
    region?: string;
    program?: string;
  };
  type: "tax_credit" | "rebate" | "deduction" | "utility_rebate" | "vendor_incentive";
  status: IncentiveStatus;
  effective?: {
    from?: string;
    to?: string;
  };
  amount?: {
    fixed?: number;
    estimate_note?: string;
  };
  eligibility: Expression;
  claim?: "point_of_sale" | "tax_return" | "utility_portal" | "at_purchase";
  sourceIds: SourceId[];
  confidence: Confidence;
  notes?: string;
  evidenceIds?: string[];
}

export interface OwnershipSetupItem {
  id: string;
  label: string;
  amount: number;
  confidence: Confidence;
  when: Expression;
  sourceIds: SourceId[];
  note?: string;
}

export interface TcoModel {
  mi_per_kwh_est?: number;
  mi_per_kwh_confidence?: Confidence;
  maintenance_per_year_est?: number;
  defaults?: {
    miles_per_year?: number;
    years?: number;
    kwh_rate_home?: number;
    pct_home_charging?: number;
    kwh_rate_public?: number;
  };
}

export interface SceneStep {
  camera?: string;
  orbit_to?: string;
  caption?: string;
  set_option?: OptionId;
  highlight?: string;
}

export interface CatalogScene {
  model?: {
    src?: string;
    format?: string;
    license?: string;
    attribution?: string;
    status?: string;
  };
  parts?: Record<string, string>;
  mesh_swaps?: Record<string, string>;
  cameras?: Array<{
    id: string;
    label?: string;
    pos?: number[];
    target?: number[];
  }>;
  demos?: Array<{
    id: string;
    label?: string;
    steps: SceneStep[];
  }>;
}

export interface Catalog {
  format: "uconf/0.2";
  migration?: {
    from: string;
    archivedSource: string;
    notes?: string[];
  };
  sources: CatalogSource[];
  product: CatalogProduct;
  groups: CatalogGroup[];
  options: CatalogOption[];
  rules?: CatalogRule[];
  fees?: CatalogFee[];
  incentives?: CatalogIncentive[];
  ownership_setup?: OwnershipSetupItem[];
  tco_model?: TcoModel;
  scene?: CatalogScene;
  export?: {
    vendor_url_template?: string;
    confidence?: "verified" | "experimental";
    note?: string;
  };
}

export type SelectionInputValue = OptionId | OptionId[];
export type SelectionInput = Record<GroupId, SelectionInputValue | undefined>;
export type CanonicalSelections = Record<GroupId, OptionId[]>;

export interface DomainViolation {
  rule: string;
  message: string;
  severity: Severity;
  group?: GroupId;
  option?: OptionId;
  unmetConditionIds?: string[];
}

export interface NormalizedSelections {
  selections: CanonicalSelections;
  selectedOptionIds: OptionId[];
  violations: DomainViolation[];
}

export interface PriceLine {
  id: string;
  label: string;
  amount: number;
  confidence: Confidence;
  category: "base" | "vehicle_option" | "fee" | "ownership_setup";
}

export interface ResolvedPrice {
  baseMSRP: number;
  vehicleOptions: number;
  vehicleMSRP: number;
  destination: number;
  vehicleTotal: number;
  ownershipSetup: number;
  fixedSavings: number;
  illustrativeOwnershipTotal: number;
  lines: PriceLine[];
  confidence: Record<
    | "baseMSRP"
    | "vehicleOptions"
    | "vehicleMSRP"
    | "destination"
    | "vehicleTotal"
    | "ownershipSetup"
    | "fixedSavings"
    | "illustrativeOwnershipTotal",
    Confidence
  >;
}

export interface IncentiveOutcome {
  id: string;
  label: string;
  type: CatalogIncentive["type"];
  amount: number | null;
  estimateNote: string | null;
  claim: CatalogIncentive["claim"] | null;
  confidence: Confidence;
  sourceIds: SourceId[];
  reason: string;
  missingContext: string[];
  notes?: string;
}

export interface ResolvedIncentives {
  encodedPredicatesMatched: IncentiveOutcome[];
  potentiallyApplicable: IncentiveOutcome[];
  expired: IncentiveOutcome[];
  ineligible: IncentiveOutcome[];
  fixedSavings: number;
}

export interface ResolvedDelivery {
  window: string;
  gatedBy: OptionId;
  confidence: Confidence;
}

export interface ResolveResult {
  valid: boolean;
  violations: DomainViolation[];
  selections: CanonicalSelections;
  selectedOptionIds: OptionId[];
  buyerContext: BuyerContext;
  price: ResolvedPrice;
  specs: Record<string, JsonValue>;
  specConfidence: Record<string, Confidence>;
  delivery: ResolvedDelivery | null;
  incentives: ResolvedIncentives;
}

export interface SelectionPatch {
  set: Record<GroupId, OptionId[]>;
}

export interface PatchResolution {
  valid: boolean;
  base: ResolveResult;
  candidate: ResolveResult;
  patch: SelectionPatch;
}

export interface CompatibleAlternative {
  patch: SelectionPatch;
  selections: CanonicalSelections;
  changedGroups: GroupId[];
  priceDelta: number;
  rangeDelta: number | null;
  delivery: ResolvedDelivery | null;
}
