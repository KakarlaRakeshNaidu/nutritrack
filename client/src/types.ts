export interface ErrorDetail {
  field: string;
  message: string;
}

export interface Goals {
  daily_calories_kcal: number | null;
  daily_protein_g: number | null;
  daily_carbs_g: number | null;
  daily_fat_g: number | null;
  target_weight_kg: number | null;
}

export interface PersistedGoals extends Goals {
  updated_at: string;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snacks";
export type QuantityUnit = "g" | "ml" | "serving" | "piece";
export type EntrySource = "manual" | "nutrition_label" | "food_plate";

export interface Micronutrients {
  sodium_mg: number | null;
  calcium_mg: number | null;
  iron_mg: number | null;
  potassium_mg: number | null;
  vitamin_c_mg: number | null;
  vitamin_d_mcg: number | null;
}

export interface MealPayload {
  food_name: string;
  meal_type: MealType;
  consumption_date: string;
  consumed_quantity: number;
  quantity_unit: QuantityUnit;
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  micronutrients: Micronutrients;
  entry_source: EntrySource;
  is_estimate: boolean;
}

export interface Meal extends MealPayload {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface MealListParameters {
  start_date?: string;
  end_date?: string;
  meal_type?: MealType;
  page?: number;
  page_size?: number;
}

export interface Pagination {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface MealListResponse {
  items: Meal[];
  pagination: Pagination;
}

export interface Profile {
  display_name: string;
  timezone: string;
  today: string;
  week_start: string;
  week_end: string;
}

export type ReportGrouping = "day" | "week";
export type ReportTemporalState = "past" | "current" | "future";
export type CoreReportField =
  | "calories_kcal"
  | "protein_g"
  | "carbs_g"
  | "fat_g";
export type MicroReportField = keyof Micronutrients;

export interface ReportMicroSummary {
  unit: "mg" | "mcg";
  known_total: number | null;
  known_count: number;
  unknown_count: number;
  entry_count: number;
}

export interface ReportSummary {
  entry_count: number;
  logged_day_count: number;
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  micronutrients: Record<MicroReportField, ReportMicroSummary>;
}

export interface GoalMetric {
  actual: number;
  target: number | null;
  difference: number | null;
  percent: number | null;
}

export interface ReportGoalComparison
  extends Record<CoreReportField, GoalMetric> {
  basis: "current_daily_targets";
  scope_start: string | null;
  scope_end: string | null;
  day_count: number;
}

export interface ReportBucket extends ReportSummary {
  period_start: string;
  period_end: string;
  covered_start: string;
  covered_end: string;
  calendar_day_count: number;
  elapsed_day_count: number;
  temporal_state: ReportTemporalState;
  goal_comparison: ReportGoalComparison;
}

export interface NutritionReport {
  range: {
    start_date: string;
    end_date: string;
    group_by: ReportGrouping;
    timezone: string;
    today: string;
  };
  summary: ReportSummary;
  goal_snapshot: PersistedGoals;
  goal_comparison: ReportGoalComparison;
  items: ReportBucket[];
  pagination: Pagination;
}

export interface ReportRequestParameters {
  start_date?: string;
  end_date?: string;
  group_by?: ReportGrouping;
  page?: number;
  page_size?: number;
}
