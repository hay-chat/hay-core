import { describeDelta, deltaColor, type DeltaUnit } from "@/utils/analytics";

/** MetricCard subtitle props for a change against the previous period. */
export function useDelta() {
  const { t } = useI18n();
  return (
    current: number | null | undefined,
    previous: number | null | undefined,
    unit: DeltaUnit,
    higherIsBetter = true,
  ) => {
    const delta = describeDelta(current, previous, unit);
    return delta
      ? {
          subtitle: delta.text,
          subtitleSuffix: t("analytics.vsPrevious"),
          subtitleColor: deltaColor(delta, higherIsBetter),
        }
      : { subtitle: t("analytics.noPrevious"), subtitleColor: "default" as const };
  };
}
