import { useEffect, useMemo, useRef, useState } from "react";

import { getNutritionReport } from "../api/reports";
import type { NutritionReport, ReportRequestParameters } from "../types";

interface ReportState {
  key: string;
  data: NutritionReport | null;
  error: Error | null;
  loading: boolean;
  refreshing: boolean;
}

export function useNutritionReport(
  parameters: ReportRequestParameters,
  enabled = true,
) {
  const requestKey = JSON.stringify(parameters);
  const stableParameters = useMemo(() => parameters, [requestKey]);
  const sequence = useRef(0);
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, setState] = useState<ReportState>({
    key: "",
    data: null,
    error: null,
    loading: enabled,
    refreshing: false,
  });

  useEffect(() => {
    if (!enabled) {
      sequence.current += 1;
      setState({
        key: requestKey,
        data: null,
        error: null,
        loading: false,
        refreshing: false,
      });
      return undefined;
    }

    let controller: AbortController | undefined;
    let lastRefresh = 0;

    function load(clearPrevious: boolean) {
      controller?.abort();
      controller = new AbortController();
      const current = ++sequence.current;
      setState((previous) => ({
        key: requestKey,
        data:
          !clearPrevious && previous.key === requestKey ? previous.data : null,
        error: null,
        loading: clearPrevious,
        refreshing: !clearPrevious,
      }));

      // Sequence checking complements AbortController because not every runtime
      // stops an already-resolving response immediately.
      getNutritionReport(stableParameters, { signal: controller.signal })
        .then((data) => {
          if (sequence.current === current) {
            setState({
              key: requestKey,
              data,
              error: null,
              loading: false,
              refreshing: false,
            });
          }
        })
        .catch((error: unknown) => {
          if (
            sequence.current === current &&
            (!(error instanceof Error) || error.name !== "AbortError")
          ) {
            setState((previous) => ({
              key: requestKey,
              data: previous.key === requestKey ? previous.data : null,
              error:
                error instanceof Error
                  ? error
                  : new Error("The nutrition report could not be loaded."),
              loading: false,
              refreshing: false,
            }));
          }
        });
    }

    load(true);

    function refreshOnReturn() {
      const now = Date.now();
      if (now - lastRefresh < 150) {
        return;
      }
      lastRefresh = now;
      load(false);
    }
    function refreshVisible() {
      if (document.visibilityState === "visible") {
        refreshOnReturn();
      }
    }

    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      sequence.current += 1;
      controller?.abort();
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [enabled, requestKey, retryVersion, stableParameters]);

  const current =
    state.key === requestKey
      ? state
      : {
          key: requestKey,
          data: null,
          error: null,
          loading: enabled,
          refreshing: false,
        };

  return {
    ...current,
    retry: () => setRetryVersion((version) => version + 1),
  };
}
