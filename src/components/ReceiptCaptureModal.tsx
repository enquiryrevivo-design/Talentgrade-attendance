import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { compressImageFile, fetchMediaAsset, uploadMediaAsset } from '../lib/hrService';
import { MediaAsset } from '../types/hr';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_PDF_BYTES = 500 * 1024; // ~680 KB base64 safely within 750 KB Firestore MediaAsset limit
const MAX_DATAURL_CHARS = 700000;

async function compressImageUnderLimit(file: File): Promise<string> {
  let maxDim = 1080;
  let result = await compressImageFile(file, maxDim);
  while (result.length > MAX_DATAURL_CHARS && maxDim >= 420) {
    maxDim = Math.round(maxDim * 0.72);
    result = await compressImageFile(file, maxDim);
  }
  if (result.length > MAX_DATAURL_CHARS) {
    throw new Error('Image is still too large after compression. Please use a clearer smaller photo.');
  }
  return result;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlobUrl(dataUrl: string): string | null {
  try {
    const parts = dataUrl.split(',');
    if (parts.length !== 2) return null;
    const header = parts[0];
    const mimeMatch = header.match(/data:([^;]+);base64/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const binary = atob(parts[1]);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export interface UploadedAttachmentInfo {
  assetId: string;
  fileName: string;
  mimeType: string;
  previewDataUrl?: string;
}

interface AttachmentUploadFieldProps {
  ownerUid: string;
  assetType: 'expense_receipt' | 'asset_photo';
  allowPdf?: boolean;
  label?: string;
  value?: UploadedAttachmentInfo | null;
  onChange: (next: UploadedAttachmentInfo | null) => void;
  onError?: (msg: string) => void;
}

export function AttachmentUploadField({
  ownerUid,
  assetType,
  allowPdf = false,
  label = 'Receipt / Attachment',
  value,
  onChange,
  onError,
}: AttachmentUploadFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraErr, setCameraErr] = useState('');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileCameraInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const startLiveCamera = useCallback(async () => {
    setCameraErr('');
    setCameraReady(false);
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraErr('Live browser camera is unavailable. Use mobile camera or file upload instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch {
      setCameraErr('Camera access denied or unavailable on this device. Please upload from files instead.');
    }
  }, [stopCamera]);

  useEffect(() => {
    if (cameraOpen) {
      setCapturedPhoto(null);
      void startLiveCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [cameraOpen, startLiveCamera, stopCamera]);

  const handleFileSelect = async (file: File) => {
    const mime = (file.type || '').toLowerCase();
    const isPdf = mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImg = mime.startsWith('image/') || ALLOWED_IMAGE_TYPES.has(mime);

    if (isPdf && !allowPdf) {
      onError?.('Please select an image file (JPG, PNG, or WebP).');
      return;
    }
    if (!isPdf && !isImg) {
      onError?.(
        allowPdf
          ? 'Unsupported file type. Upload an image (JPG, PNG, WebP) or PDF.'
          : 'Unsupported file type. Upload a valid image.'
      );
      return;
    }

    setUploading(true);
    try {
      let dataUrl = '';
      let finalMime = mime || (isPdf ? 'application/pdf' : 'image/jpeg');

      if (isPdf) {
        if (file.size > MAX_PDF_BYTES) {
          throw new Error('PDF receipt must be under 500 KB.');
        }
        dataUrl = await readFileAsDataUrl(file);
        if (dataUrl.length > MAX_DATAURL_CHARS) {
          throw new Error('Encoded PDF exceeds storage limit (500 KB max).');
        }
        finalMime = 'application/pdf';
      } else {
        dataUrl = await compressImageUnderLimit(file);
        finalMime = 'image/jpeg';
      }

      const assetId = await uploadMediaAsset({
        ownerUid,
        assetType,
        fileName: file.name || (isPdf ? 'receipt.pdf' : 'receipt.jpg'),
        mimeType: finalMime,
        dataUrl,
      });

      onChange({
        assetId,
        fileName: file.name || (isPdf ? 'receipt.pdf' : 'receipt.jpg'),
        mimeType: finalMime,
        previewDataUrl: dataUrl,
      });
    } catch (err: unknown) {
      onError?.(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleCaptureFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const vw = video.videoWidth || 1024;
    const vh = video.videoHeight || 768;
    const targetW = Math.min(1080, vw);
    const targetH = Math.max(1, Math.round((vh / vw) * targetW));
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, targetW, targetH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    setCapturedPhoto(dataUrl);
  };

  const handleConfirmCameraPhoto = async () => {
    if (!capturedPhoto) return;
    setUploading(true);
    try {
      const fileName = `${assetType}_${new Date().toISOString().slice(0, 10)}.jpg`;
      const assetId = await uploadMediaAsset({
        ownerUid,
        assetType,
        fileName,
        mimeType: 'image/jpeg',
        dataUrl: capturedPhoto,
      });
      onChange({
        assetId,
        fileName,
        mimeType: 'image/jpeg',
        previewDataUrl: capturedPhoto,
      });
      setCameraOpen(false);
      stopCamera();
    } catch (err: unknown) {
      onError?.(err instanceof Error ? err.message : 'Could not save captured photo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-xs text-zinc-800 dark:text-zinc-200">{label}</span>
        {uploading && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[#B5121B]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Uploading securely...
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="min-h-[40px] px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium inline-flex items-center gap-2 disabled:opacity-50"
        >
          <Upload className="w-3.5 h-3.5" />
          {allowPdf ? 'Upload Image / PDF' : 'Upload Image'}
        </button>

        <button
          type="button"
          disabled={uploading}
          onClick={() => setCameraOpen(true)}
          className="min-h-[40px] px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium inline-flex items-center gap-2 disabled:opacity-50"
        >
          <Camera className="w-3.5 h-3.5 text-[#B5121B]" />
          Capture with Camera
        </button>

        <button
          type="button"
          disabled={uploading}
          onClick={() => mobileCameraInputRef.current?.click()}
          className="sm:hidden min-h-[40px] px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs font-medium inline-flex items-center gap-2 disabled:opacity-50"
        >
          <Camera className="w-3.5 h-3.5" />
          Device Camera
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={allowPdf ? 'image/*,application/pdf' : 'image/*'}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleFileSelect(f);
        }}
      />

      <input
        ref={mobileCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleFileSelect(f);
        }}
      />

      <p className="text-[11px] text-zinc-500">
        {allowPdf
          ? 'Supports JPG, PNG, WebP (auto-compressed) or PDF up to 500 KB.'
          : 'Supports JPG, PNG, WebP (auto-compressed).'}
      </p>

      {value?.assetId && (
        <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {value.mimeType === 'application/pdf' ? (
              <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-950/50 text-[#B5121B] flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
            ) : value.previewDataUrl ? (
              <img
                src={value.previewDataUrl}
                alt={value.fileName}
                className="w-10 h-10 rounded-lg object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                <ImageIcon className="w-5 h-5 text-zinc-500" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {value.fileName || 'Attached file'}
              </div>
              <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-mono">
                Attached · {value.mimeType === 'application/pdf' ? 'PDF Document' : 'Image'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="min-h-[34px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800"
          >
            Remove
          </button>
        </div>
      )}

      {/* Camera Capture Sub-Modal */}
      {cameraOpen && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-sm font-semibold">Capture {label}</span>
              <button
                type="button"
                onClick={() => setCameraOpen(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3] flex items-center justify-center">
                {!capturedPhoto ? (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-cover ${cameraReady ? 'block' : 'hidden'}`}
                    />
                    {!cameraReady && !cameraErr && (
                      <div className="flex flex-col items-center gap-2 text-zinc-300 text-xs">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Starting camera...</span>
                      </div>
                    )}
                    {cameraErr && (
                      <div className="p-4 text-center text-xs text-red-300 space-y-2">
                        <p>{cameraErr}</p>
                        <button
                          type="button"
                          onClick={() => void startLiveCamera()}
                          className="px-3 py-1.5 rounded-lg bg-white text-black font-medium inline-flex items-center gap-1"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Retry
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <img src={capturedPhoto} alt="Captured preview" className="w-full h-full object-contain" />
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>

              <div className="flex gap-2">
                {!capturedPhoto ? (
                  <button
                    type="button"
                    disabled={!cameraReady}
                    onClick={handleCaptureFrame}
                    className="flex-1 min-h-[44px] rounded-xl bg-black dark:bg-white text-white dark:text-black text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40"
                  >
                    <Camera className="w-4 h-4" />
                    Take Photo
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setCapturedPhoto(null)}
                      className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium inline-flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retake
                    </button>
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={handleConfirmCameraPhoto}
                      className="flex-1 min-h-[44px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Use Photo
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface MediaPreviewModalProps {
  assetId: string | null;
  title?: string;
  onClose: () => void;
}

export function MediaPreviewModal({ assetId, title = 'Attachment Preview', onClose }: MediaPreviewModalProps) {
  const [loading, setLoading] = useState(false);
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let createdBlobUrl: string | null = null;

    if (!assetId) {
      setAsset(null);
      setPdfBlobUrl(null);
      return;
    }

    setLoading(true);
    setAsset(null);
    setPdfBlobUrl(null);

    void fetchMediaAsset(assetId)
      .then((res) => {
        if (!active) return;
        setAsset(res);
        if (res?.mimeType === 'application/pdf' && res.dataUrl) {
          createdBlobUrl = dataUrlToBlobUrl(res.dataUrl);
          setPdfBlobUrl(createdBlobUrl);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (createdBlobUrl) {
        URL.revokeObjectURL(createdBlobUrl);
      }
    };
  }, [assetId]);

  if (!assetId) return null;

  const isPdf = asset?.mimeType === 'application/pdf';

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{title}</h3>
            {asset && (
              <p className="text-[11px] text-zinc-500 font-mono truncate">
                {asset.fileName} · {asset.mimeType}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {asset?.dataUrl && (
              <a
                href={pdfBlobUrl || asset.dataUrl}
                download={asset.fileName || 'attachment'}
                className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 flex-1 overflow-auto bg-zinc-100 dark:bg-zinc-950 flex items-center justify-center min-h-[320px]">
          {loading ? (
            <div className="flex flex-col items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="w-6 h-6 animate-spin text-[#B5121B]" />
              <span>Loading attachment...</span>
            </div>
          ) : !asset ? (
            <div className="text-xs text-zinc-500 text-center py-8">
              Attachment could not be loaded or is unavailable.
            </div>
          ) : isPdf ? (
            <div className="w-full space-y-3">
              {pdfBlobUrl ? (
                <iframe
                  title={asset.fileName}
                  src={pdfBlobUrl}
                  className="w-full h-[65vh] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white"
                />
              ) : (
                <div className="p-6 text-center text-xs text-zinc-600 dark:text-zinc-300">
                  Preview unavailable inline. Use Download above to view the PDF.
                </div>
              )}
              {pdfBlobUrl && (
                <div className="flex justify-end">
                  <a
                    href={pdfBlobUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#B5121B] hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open PDF in new tab
                  </a>
                </div>
              )}
            </div>
          ) : (
            <img
              src={asset.dataUrl}
              alt={asset.fileName}
              className="max-w-full max-h-[70vh] rounded-xl object-contain shadow-sm"
            />
          )}
        </div>
      </div>
    </div>
  );
}
