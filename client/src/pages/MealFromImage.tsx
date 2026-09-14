import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiError } from "../api/client";
import { createMeal } from "../api/meals";
import { extractNutrition } from "../api/nutrition";
import { getProfile } from "../api/profile";
import { ImagePicker, validateImageFile } from "../components/ImagePicker";
import { MealForm } from "../components/MealForm";
import { ErrorMessage, LoadingState, StatusMessage } from "../components/UiState";
import type {
  ExtractionResult,
  ImageType,
  Meal,
  MealPayload,
  Profile,
} from "../types";
import {
  extractionToFormValues,
  type MealFormInput,
} from "../validation/meals";

function analysisError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const retry = error.retryAfter
        ? " Retry after " + error.retryAfter + " seconds."
        : " Wait before trying again.";
      return new ApiError({
        status: error.status,
        code: error.code,
        requestId: error.requestId,
        message: error.message + retry,
      });
    }
    return error;
  }
  return new ApiError({
    message: "The image could not be analyzed. You can retry or enter it manually.",
  });
}

export function MealFromImage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<Error | null>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [mode, setMode] = useState<ImageType>("nutrition_label");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<ExtractionResult | null>(null);
  const [formValues, setFormValues] = useState<MealFormInput | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [analysisPending, setAnalysisPending] = useState(false);
  const [analysisFailure, setAnalysisFailure] = useState<ApiError | null>(null);
  const [savePending, setSavePending] = useState(false);
  const analysisController = useRef<AbortController | null>(null);
  const analysisSequence = useRef(0);
  const reviewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setProfileError(null);
    getProfile({ signal: controller.signal })
      .then(setProfile)
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.name !== "AbortError") {
          setProfileError(
            error instanceof Error
              ? error
              : new Error("The date context could not be loaded."),
          );
        }
      });
    return () => controller.abort();
  }, [profileVersion]);

  useEffect(
    () => () => {
      analysisSequence.current += 1;
      analysisController.current?.abort();
    },
    [],
  );

  const cancelAnalysis = useCallback(() => {
    analysisSequence.current += 1;
    analysisController.current?.abort();
    analysisController.current = null;
    setAnalysisPending(false);
    setAnalysisFailure(null);
  }, []);

  function confirmDraftDiscard(message: string): boolean {
    return !dirty || window.confirm(message);
  }

  function clearDraft(): void {
    setDraft(null);
    setFormValues(null);
    setDirty(false);
    setMissingFields([]);
    setFormVersion((value) => value + 1);
  }

  function replaceSelection(action: () => void): boolean {
    if (savePending) return false;
    if (
      !confirmDraftDiscard(
        "Discard your edited draft and use a different image or mode?",
      )
    ) {
      return false;
    }
    cancelAnalysis();
    clearDraft();
    setAnalysisFailure(null);
    action();
    return true;
  }

  function changeMode(next: ImageType): boolean {
    if (next === mode) return true;
    return replaceSelection(() => setMode(next));
  }

  function changeFile(next: File | null): boolean {
    if (next === file) return true;
    return replaceSelection(() => setFile(next));
  }

  async function analyze(): Promise<void> {
    if (analysisPending || savePending) return;
    const validationError = validateImageFile(file);
    if (validationError) {
      setAnalysisFailure(new ApiError({ message: validationError }));
      return;
    }
    if (!file) return;
    if (
      draft &&
      !confirmDraftDiscard(
        "Replace your edited draft with a new analysis result?",
      )
    ) {
      return;
    }

    const selectedFile = file;
    const selectedMode = mode;
    const sequence = ++analysisSequence.current;
    const controller = new AbortController();
    analysisController.current?.abort();
    analysisController.current = controller;
    setAnalysisPending(true);
    setAnalysisFailure(null);

    try {
      const result = await extractNutrition(selectedFile, selectedMode, {
        signal: controller.signal,
      });
      if (sequence !== analysisSequence.current || controller.signal.aborted) {
        return;
      }
      if (result.image_type !== selectedMode) {
        throw new ApiError({
          code: "INVALID_RESPONSE",
          message: "The server returned a draft for the wrong image mode.",
        });
      }
      // Analysis only prepares editable values. Persistence remains an explicit
      // later MealForm submission through the ordinary meal endpoint.
      setDraft(result);
      setFormValues(extractionToFormValues(result.draft));
      setMissingFields(result.missing_fields);
      setDirty(false);
      setFormVersion((value) => value + 1);
      window.requestAnimationFrame(() => reviewHeading.current?.focus());
    } catch (error) {
      if (
        sequence === analysisSequence.current &&
        !controller.signal.aborted
      ) {
        // A failed reanalysis leaves the current editable draft intact.
        setAnalysisFailure(analysisError(error));
      }
    } finally {
      if (sequence === analysisSequence.current) {
        analysisController.current = null;
        setAnalysisPending(false);
      }
    }
  }

  async function save(payload: MealPayload): Promise<Meal> {
    if (!draft) {
      throw new ApiError({ message: "Analyze an image before saving." });
    }
    setSavePending(true);
    try {
      const latestProfile = await getProfile();
      setProfile(latestProfile);
      if (payload.consumption_date > latestProfile.today) {
        throw new ApiError({
          status: 422,
          code: "VALIDATION_ERROR",
          message: "Please correct the highlighted fields.",
          details: [{
            field: "consumption_date",
            message: "Consumption date cannot be after today.",
          }],
        });
      }
      const saved = await createMeal({
        ...payload,
        // Image provenance is server-originated context and cannot silently
        // become manual when the user edits nutritional suggestions.
        entry_source: draft.draft.entry_source,
        is_estimate: draft.draft.is_estimate,
      });
      clearDraft();
      navigate("/meals", {
        state: { message: "Photo meal saved to your history." },
      });
      return saved;
    } finally {
      setSavePending(false);
    }
  }

  const ready = Boolean(file) && !analysisPending && !savePending;

  return (
    <main className="content-shell image-meal-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Image-assisted entry</p>
          <h1>Log a meal from a photo</h1>
          <p>
            Gemini suggests an editable draft. Nothing is saved until you
            review the totals and choose Save meal.
          </p>
        </div>
        <Link className="text-link" to="/meals/new">Enter manually</Link>
      </header>

      <ImagePicker
        mode={mode}
        file={file}
        disabled={analysisPending || savePending}
        onModeChange={changeMode}
        onFileChange={changeFile}
      />

      <section className="analysis-actions" aria-label="Image analysis controls">
        <div className="button-row">
          <button
            className="button primary"
            type="button"
            disabled={!ready}
            onClick={() => void analyze()}
          >
            {analysisPending ? "Analyzing image..." : "Analyze image"}
          </button>
          {analysisPending && (
            <button className="button secondary" type="button" onClick={cancelAnalysis}>
              Cancel analysis
            </button>
          )}
          <Link className="button secondary" to="/meals/new">Enter manually</Link>
        </div>
        <StatusMessage tone="neutral">
          {analysisPending
            ? "Uploading and analyzing securely. No percentage is available."
            : file
              ? "Ready to analyze when you choose."
              : "No image selected."}
        </StatusMessage>
      </section>

      <ErrorMessage
        error={analysisFailure}
        onRetry={file && !analysisPending ? () => void analyze() : undefined}
        title="Image analysis unavailable"
      />

      {!profile && !profileError && <LoadingState message="Loading date context..." />}
      {profileError && !profile && (
        <ErrorMessage
          error={profileError}
          onRetry={() => setProfileVersion((value) => value + 1)}
          title="Date context unavailable"
        />
      )}

      {draft && formValues && profile && (
        <section className="image-review" aria-labelledby="image-review-heading">
          <header className="review-heading">
            <p className="eyebrow">Step 2</p>
            <h2 id="image-review-heading" ref={reviewHeading} tabIndex={-1}>
              Review and complete the meal
            </h2>
            <p>
              {draft.is_estimate
                ? "Plate quantities and nutrition are estimates."
                : "Label values use the extracted reference amount."}
              {" "}Changing consumed quantity does not rescale nutrient totals.
            </p>
          </header>

          <aside className="analysis-notes" aria-label="Extraction guidance">
            <p><strong>Source basis:</strong> {draft.source_basis ?? "Not provided"}</p>
            {draft.assumptions.length > 0 && (
              <>
                <strong>Assumptions</strong>
                <ul>
                  {draft.assumptions.map((assumption, index) => (
                    <li key={index}>{assumption}</li>
                  ))}
                </ul>
              </>
            )}
            <p>
              <strong>Fields still needed:</strong>{" "}
              {missingFields.length > 0
                ? missingFields.join(", ").replaceAll("_", " ")
                : "None"}
            </p>
          </aside>

          <MealForm
            key={formVersion}
            initialValues={formValues}
            today={profile.today}
            submitLabel="Save meal"
            onSubmit={save}
            onDirtyChange={setDirty}
            onMissingFieldsChange={setMissingFields}
            disableSubmitUntilValid
            lockProvenance
          />
        </section>
      )}
    </main>
  );
}
