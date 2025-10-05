import { ref, computed, watch, type Ref } from "vue";
import {
  useFloating as useFloatingUI,
  autoUpdate,
  offset,
  flip,
  shift,
  size,
  autoPlacement,
  type Placement,
  type Strategy,
} from "@floating-ui/vue";

export interface UseFloatingOptions {
  placement?: Placement;
  strategy?: Strategy;
  offset?: number;
  matchWidth?: boolean;
  useAutoPlacement?: boolean;
  maxHeight?: number;
}

export function useFloating(
  referenceEl: Ref<HTMLElement | null>,
  floatingEl: Ref<HTMLElement | null>,
  options: UseFloatingOptions = {},
) {
  const {
    placement = "bottom-start",
    strategy = "absolute",
    offset: offsetValue = 4,
    matchWidth = false,
    useAutoPlacement = false,
    maxHeight,
  } = options;

  const middleware = computed(() => {
    const middlewares = [offset(offsetValue)];

    // Use autoPlacement OR flip, not both
    if (useAutoPlacement) {
      middlewares.push(
        autoPlacement({
          allowedPlacements: ["top-start", "bottom-start", "top-end", "bottom-end"],
        }),
      );
    } else {
      middlewares.push(flip());
    }

    middlewares.push(shift({ padding: 8 }));

    // Size middleware for width matching and max height
    middlewares.push(
      size({
        apply({ rects, elements, availableHeight }) {
          const styles: Record<string, string> = {};

          if (matchWidth) {
            styles.width = `${rects.reference.width}px`;
          }

          if (maxHeight) {
            styles.maxHeight = `${Math.min(maxHeight, availableHeight)}px`;
            styles.overflowY = "auto";
          }

          Object.assign(elements.floating.style, styles);
        },
      }),
    );

    return middlewares;
  });

  const { floatingStyles, middlewareData, isPositioned, placement: computedPlacement } = useFloatingUI(
    referenceEl,
    floatingEl,
    {
      placement,
      strategy,
      middleware,
      whileElementsMounted: autoUpdate,
    },
  );

  return {
    floatingStyles,
    middlewareData,
    isPositioned,
    placement: computedPlacement,
  };
}
