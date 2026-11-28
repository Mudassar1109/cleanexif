export type PlanPresentationInput = {
  code: string;
  name: string;
  price_monthly: number;
  daily_images_limit: number;
  watermark_images_per_batch: number;
  watermark_total_mb: number;
  max_file_mb: number;
};

export function getPlanPresentation(plan: PlanPresentationInput) {
  const code = String(plan.code || "").toLowerCase();
  const title = plan.name || (code ? code[0].toUpperCase() + code.slice(1) : "Plan");

  return {
    code,
    title,
    price: "$" + Number(plan.price_monthly ?? 0).toFixed(2),
    pricePeriod: code === "free" ? " forever" : "/ month",
    popularBadge: code === "pro" ? "MOST POPULAR" : null,
    cornerBadge: code === "free" ? "START HERE" : code === "pro" ? "BEST VALUE" : null,
    featureHighlight:
      code === "free"
        ? "All five tools included"
        : code === "pro"
          ? "Larger batches and ZIP export"
          : "Higher daily and batch limits",
    bullets: [
      `${plan.daily_images_limit ?? 0} metadata-cleaning images per day`,
      `${plan.watermark_images_per_batch ?? 0} images per batch`,
      `${plan.watermark_total_mb ?? 0} MB total batch size`,
      `${plan.max_file_mb ?? 0} MB maximum per file`,
      code === "free"
        ? "Core cleaner and watermark workflow"
        : code === "business"
          ? "High-volume batch workflows"
          : "Higher daily and batch limits",
      "All five image tools",
    ],
  };
}
