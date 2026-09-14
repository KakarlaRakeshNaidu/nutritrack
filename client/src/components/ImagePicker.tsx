import { useEffect, useRef, useState } from "react";

import type { ImageType } from "../types";

export const MAX_IMAGE_BYTES = 10_000_000;
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export function validateImageFile(file: File | null): string | null {
  if (!file) return "Select an image before analyzing.";
  if (file.size === 0) return "The selected image is empty.";
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return "Choose a JPEG, PNG, or WebP image.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "The image must be 10,000,000 bytes or smaller.";
  }
  return null;
}

interface ImagePickerProps {
  mode: ImageType;
  file: File | null;
  disabled?: boolean;
  onModeChange: (mode: ImageType) => boolean;
  onFileChange: (file: File | null) => boolean;
}

export function ImagePicker({
  mode,
  file,
  disabled = false,
  onModeChange,
  onFileChange,
}: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    setPreviewFailed(false);
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    // Object URLs are request-local UI state and are revoked on replacement,
    // removal, and unmount.
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    const error = validateImageFile(next);
    if (error) {
      setFileError(error);
      event.target.value = "";
      return;
    }
    setFileError("");
    if (!onFileChange(next)) {
      event.target.value = "";
    }
  }

  function removeFile() {
    if (onFileChange(null) && inputRef.current) {
      inputRef.current.value = "";
      setFileError("");
    }
  }

  return (
    <section className="image-picker form-card" aria-labelledby="image-picker-heading">
      <div className="section-heading">
        <p className="eyebrow">Step 1</p>
        <h2 id="image-picker-heading">Choose a photo</h2>
        <p className="section-note">
          JPEG, PNG, or WebP up to 10,000,000 bytes. Selecting a file does not
          upload it.
        </p>
      </div>

      <div className="form-grid">
        <label className="form-field">
          <span>Image mode</span>
          <select
            value={mode}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value as ImageType;
              if (!onModeChange(next)) event.target.value = mode;
            }}
          >
            <option value="nutrition_label">Nutrition label</option>
            <option value="food_plate">Plate of food</option>
          </select>
        </label>
        <label className="form-field">
          <span>Image file</span>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            disabled={disabled}
            aria-label="Image file"
            aria-describedby="image-guidance image-file-error"
            onChange={selectFile}
          />
          <span className="field-help" id="image-guidance">
            Plate nutrition is estimated. Review every suggestion before saving.
          </span>
          {fileError && (
            <span className="field-error" id="image-file-error" role="alert">
              {fileError}
            </span>
          )}
        </label>
      </div>

      {file && (
        <div className="preview-card">
          <div>
            <strong>{file.name}</strong>
            <span>{file.size.toLocaleString()} bytes</span>
          </div>
          {previewUrl && !previewFailed ? (
            <img
              src={previewUrl}
              alt="Preview of selected meal image"
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <p role="status">Preview unavailable. You can still analyze the file.</p>
          )}
          <button
            className="button secondary"
            type="button"
            disabled={disabled}
            onClick={removeFile}
          >
            Remove image
          </button>
        </div>
      )}
    </section>
  );
}
