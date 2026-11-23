import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, MapPin, RefreshCw, Check, X, AlertCircle, Loader2 } from 'lucide-react';

interface CameraCaptureModalProps {
  mode: 'in' | 'out';
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (payload: { photoDataUrl: string; lat: number; lng: number; accuracy: number }) => Promise<void>;
}

export function CameraCaptureModal({ mode, isOpen, onClose, onConfirm }: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraStatus, setCameraStatus] = useState<'idle' | 'ready' | 'error'>('idle');
  const [cameraError, setCameraError] = useState<string>('');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);

  const [gpsStatus, setGpsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [gpsError, setGpsError] = useState<string>('');
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraStatus('idle');
    setCameraError('');
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraStatus('error');
      setCameraError('Live camera API is unavailable in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraStatus('ready');
    } catch (err: unknown) {
      setCameraStatus('error');
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access in your browser to capture a live attendance photo.'
          : 'Unable to access device camera. Ensure no other app is using it and retry.';
      setCameraError(msg);
    }
  }, [stopCamera]);

  const fetchGps = useCallback(() => {
    setGpsStatus('loading');
    setGpsError('');
    if (!navigator.geolocation) {
      setGpsStatus('error');
      setGpsError('Geolocation is not supported by this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setGpsStatus('ready');
      },
      (err) => {
        setGpsStatus('error');
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError('Location permission denied. Enable location access to punch attendance.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGpsError('GPS signal unavailable. Move near a window or check device location settings.');
        } else {
          setGpsError('Location request timed out. Tap retry to acquire GPS coordinates.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  useEffect(() => {
    if (isOpen) {
      setCapturedPhoto(null);
      setSubmitError(null);
      startCamera();
      fetchGps();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, startCamera, fetchGps, stopCamera]);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const targetW = 540;
    const targetH = Math.round((height / width) * targetW) || 405;
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, targetW, targetH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    setCapturedPhoto(dataUrl);
  };

  const handleRetake = () => {
    setCapturedPhoto(null);
    if (cameraStatus !== 'ready') {
      startCamera();
    }
  };

  const handleSubmit = async () => {
    if (!capturedPhoto || !coords) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm({
        photoDataUrl: capturedPhoto,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy,
      });
      stopCamera();
      onClose();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save attendance punch.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
              {mode === 'in' ? 'Live Punch-In Verification' : 'Live Punch-Out Verification'}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Live selfie and GPS required · Punch allowed from any location
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Camera viewport */}
          <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3] flex items-center justify-center border border-zinc-200 dark:border-zinc-800">
            {!capturedPhoto ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover scale-x-[-1] ${cameraStatus === 'ready' ? 'block' : 'hidden'}`}
                />
                {cameraStatus === 'idle' && (
                  <div className="flex flex-col items-center gap-2 text-zinc-300 text-sm">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>Initializing camera...</span>
                  </div>
                )}
                {cameraStatus === 'error' && (
                  <div className="p-5 text-center space-y-3">
                    <AlertCircle className="w-8 h-8 text-[#B5121B] mx-auto" />
                    <p className="text-sm text-zinc-200">{cameraError}</p>
                    <button
                      type="button"
                      onClick={startCamera}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-xs font-medium"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry Camera
                    </button>
                  </div>
                )}
              </>
            ) : (
              <img
                src={capturedPhoto}
                alt="Captured attendance selfie"
                className="w-full h-full object-cover scale-x-[-1]"
              />
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Camera capture / retake button */}
          <div className="flex items-center justify-center">
            {!capturedPhoto ? (
              <button
                type="button"
                disabled={cameraStatus !== 'ready'}
                onClick={handleCapture}
                className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-black dark:bg-white text-white dark:text-black font-medium text-sm disabled:opacity-40 transition-opacity"
              >
                <Camera className="w-4 h-4" />
                Capture Live Selfie
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRetake}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <RefreshCw className="w-4 h-4" />
                Retake Photo
              </button>
            )}
          </div>

          {/* GPS Status Card */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3.5 bg-zinc-50 dark:bg-zinc-950/60 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <MapPin
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  gpsStatus === 'ready'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : gpsStatus === 'error'
                    ? 'text-[#B5121B] dark:text-red-400'
                    : 'text-zinc-400'
                }`}
              />
              <div className="text-xs min-w-0">
                {gpsStatus === 'loading' && (
                  <span className="text-zinc-600 dark:text-zinc-300">Acquiring GPS coordinates...</span>
                )}
                {gpsStatus === 'ready' && coords && (
                  <div>
                    <div className="font-medium text-zinc-950 dark:text-zinc-100">Location Verified</div>
                    <div className="text-zinc-500 dark:text-zinc-400 font-mono tabular-nums truncate">
                      {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} · ±{Math.round(coords.accuracy)}m
                    </div>
                  </div>
                )}
                {gpsStatus === 'error' && <span className="text-[#B5121B] dark:text-red-400">{gpsError}</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={fetchGps}
              className="shrink-0 min-h-[36px] px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-800"
            >
              Refresh GPS
            </button>
          </div>

          {submitError && (
            <div className="p-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-[#B5121B] dark:text-red-300">
              {submitError}
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!capturedPhoto || !coords || submitting}
            onClick={handleSubmit}
            className="flex-1 min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-sm font-medium disabled:opacity-40 transition-colors"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {submitting ? 'Saving...' : mode === 'in' ? 'Confirm Punch In' : 'Confirm Punch Out'}
          </button>
        </div>
      </div>
    </div>
  );
}
