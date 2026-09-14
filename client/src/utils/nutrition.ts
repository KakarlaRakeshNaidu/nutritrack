export const MEAL_TYPES = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snacks", label: "Snacks" },
] as const;

export const QUANTITY_UNITS = [
  { value: "g", label: "g" },
  { value: "ml", label: "ml" },
  { value: "serving", label: "serving" },
  { value: "piece", label: "piece" },
] as const;

export const ENTRY_SOURCES = [
  { value: "manual", label: "Manual" },
  { value: "nutrition_label", label: "Nutrition label" },
  { value: "food_plate", label: "Food plate" },
] as const;

export const CORE_NUTRIENTS = [
  { name: "calories_kcal", label: "Calories", unit: "kcal" },
  { name: "protein_g", label: "Protein", unit: "g" },
  { name: "carbs_g", label: "Carbohydrates", unit: "g" },
  { name: "fat_g", label: "Fat", unit: "g" },
] as const;

export const MICRONUTRIENTS = [
  { name: "sodium_mg", label: "Sodium", unit: "mg" },
  { name: "calcium_mg", label: "Calcium", unit: "mg" },
  { name: "iron_mg", label: "Iron", unit: "mg" },
  { name: "potassium_mg", label: "Potassium", unit: "mg" },
  { name: "vitamin_c_mg", label: "Vitamin C", unit: "mg" },
  { name: "vitamin_d_mcg", label: "Vitamin D", unit: "mcg" },
] as const;

export const GOAL_FIELDS = [
  { name: "daily_calories_kcal", label: "Daily calories", unit: "kcal" },
  { name: "daily_protein_g", label: "Daily protein", unit: "g" },
  { name: "daily_carbs_g", label: "Daily carbohydrates", unit: "g" },
  { name: "daily_fat_g", label: "Daily fat", unit: "g" },
  { name: "target_weight_kg", label: "Target weight", unit: "kg" },
] as const;
