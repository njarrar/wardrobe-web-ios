import { forwardRef, useEffect, useRef, useState } from "react";
import { CoatHanger } from "@phosphor-icons/react";
import { Image } from "@unpic/react";
import { assetUrl, serverUrl } from "./api.js";
import { localApi } from "./local/mode.js";
import { t } from "./i18n.js";

const IPX_OPTIONS = { ipx: { baseURL: "/_ipx" } };
const DEFAULT_BREAKPOINTS = [160, 240, 320, 480, 640, 800, 960, 1280];
const MAX_CLOUD_TRIES = 3;

function sourcePath(src) {
  if (!src || typeof src !== "string") return src;
  return src.split(/[?#]/, 1)[0];
}

export const OptimizedImage = forwardRef(function OptimizedImage({
  src,
  alt = "",
  sizes = "100vw",
  breakpoints = DEFAULT_BREAKPOINTS,
  quality = 80,
  priority = false,
  loading,
  decoding,
  onError,
  className,
  ...props
}, ref) {
  const [tries, setTries] = useState(0);
  const [failed, setFailed] = useState(false);
  const aliveRef = useRef(true);
  const normalizedSource = sourcePath(src);

  useEffect(() => {
    aliveRef.current = true;
    setTries(0);
    setFailed(false);
    return () => { aliveRef.current = false; };
  }, [src]);

  const handleError = (event) => {
    onError?.(event);
    const store = localApi()?.store;
    if (store?.fetchFile && tries < MAX_CLOUD_TRIES) {
      const link = event.currentTarget?.currentSrc || event.currentTarget?.src || assetUrl(src);
      const next = tries + 1;
      store.fetchFile(link)
        .then((ready) => {
          if (!aliveRef.current) return;
          if (ready) setTries(next);
          else setFailed(true);
        })
        .catch(() => {
          if (aliveRef.current) setFailed(true);
        });
      return;
    }
    setFailed(true);
  };

  if (failed) {
    return (
      <span
        className={`image-fallback${className ? ` ${className}` : ""}`}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : "true"}
      >
        <CoatHanger size={24} weight="light" aria-hidden="true" />
      </span>
    );
  }

  if (!normalizedSource || normalizedSource.startsWith("data:") || normalizedSource.startsWith("blob:") || normalizedSource.startsWith("/api/")) {
    // A remote server (the iOS app) needs CORS mode so color sampling can read pixels.
    const crossOrigin = normalizedSource?.startsWith("/api/") && serverUrl() ? "anonymous" : undefined;
    const baseSrc = assetUrl(src);
    const resolvedSrc = tries > 0 && baseSrc ? `${baseSrc.split("#")[0]}#${tries}` : baseSrc;
    return (
      <img
        ref={ref}
        className={className}
        src={resolvedSrc}
        crossOrigin={crossOrigin}
        alt={alt}
        sizes={props.srcSet ? sizes : undefined}
        loading={loading || (priority ? "eager" : "lazy")}
        decoding={decoding || "async"}
        onError={handleError}
        {...props}
      />
    );
  }

  return (
    <Image
      ref={ref}
      className={className}
      src={normalizedSource}
      alt={alt || t("Garment image")}
      fallback="ipx"
      options={IPX_OPTIONS}
      operations={{ ipx: { quality } }}
      layout="fullWidth"
      unstyled
      sizes={sizes}
      breakpoints={breakpoints}
      priority={priority}
      loading={loading}
      decoding={decoding}
      onError={handleError}
      {...props}
    />
  );
});
