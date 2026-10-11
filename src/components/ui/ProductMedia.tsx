import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Package, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { ProductMediaItem } from '../../types/app.ts';
import { isVideoMedia } from '../../utils/formatters.ts';

// Resilient Product Image with Zero-Broken-Image Policy
export const ProductImage: React.FC<{
  src?: string | null;
  alt: string;
  className?: string;
}> = ({ src, alt, className = 'w-full h-full object-cover' }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="w-full h-full bg-[#F3F2EE] flex flex-col items-center justify-center p-4 text-center select-none">
        <Package className="w-8 h-8 text-stone-400 mb-2 stroke-[1.5]" />
        <span className="text-xs font-medium text-stone-500 line-clamp-2 max-w-[16ch]">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};

// Swipeable / Scrollable Product Media Carousel (Supports up to 5 photos and/or 1 video <= 30s + Top-Right % Discount Badge)
export const ProductMediaCarousel: React.FC<{
  images?: ProductMediaItem[];
  fallbackImageUrl?: string | null;
  alt: string;
  discountPercent?: number;
  linkTo?: string;
  onLinkClick?: () => void;
  aspectClassName?: string;
}> = ({
  images,
  fallbackImageUrl,
  alt,
  discountPercent = 0,
  linkTo,
  onLinkClick,
  aspectClassName = 'aspect-4/3',
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const mediaList: ProductMediaItem[] =
    images && images.length > 0
      ? images
      : fallbackImageUrl
      ? [{ imageUrl: fallbackImageUrl, mediaType: 'IMAGE' }]
      : [];

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== activeIndex) {
      setActiveIndex(Math.max(0, Math.min(mediaList.length - 1, idx)));
    }
  };

  const scrollToSlide = (index: number, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const el = scrollRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(mediaList.length - 1, index));
    el.scrollTo({
      left: clamped * el.clientWidth,
      behavior: 'smooth',
    });
    setActiveIndex(clamped);
  };

  return (
    <div className="w-full flex flex-col">
      <div className={`relative w-full bg-[#F9F9F8] overflow-hidden select-none ${aspectClassName}`}>
        {/* Top-Right Discount Percentage Badge (Requisito 1) */}
        {discountPercent > 0 && (
          <div className="absolute top-2.5 right-2.5 z-20 px-2.5 py-1 rounded-md bg-emerald-700 text-white text-xs font-mono font-bold shadow-sm pointer-events-none">
            -{discountPercent}%
          </div>
        )}

        {mediaList.length === 0 ? (
          linkTo ? (
            <Link to={linkTo} onClick={onLinkClick} className="block w-full h-full">
              <ProductImage src={null} alt={alt} />
            </Link>
          ) : (
            <ProductImage src={null} alt={alt} />
          )
        ) : (
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {mediaList.map((item, idx) => {
              const isVid = isVideoMedia(item);
              return (
                <div
                  key={item.id || `${item.imageUrl}_${idx}`}
                  className="w-full h-full shrink-0 snap-center relative"
                >
                  {isVid ? (
                    <video
                      src={item.imageUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover bg-black"
                    />
                  ) : linkTo ? (
                    <Link to={linkTo} onClick={onLinkClick} className="block w-full h-full">
                      <ProductImage
                        src={item.imageUrl}
                        alt={`${alt} - Foto ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </Link>
                  ) : (
                    <ProductImage
                      src={item.imageUrl}
                      alt={`${alt} - Foto ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Sideways Navigation Arrows & Dots when there are multiple media items (Requisito 3) */}
        {mediaList.length > 1 && (
          <>
            {activeIndex > 0 && (
              <button
                type="button"
                onClick={(e) => scrollToSlide(activeIndex - 1, e)}
                aria-label="Foto anterior"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full bg-white/90 hover:bg-white text-zinc-900 border border-stone-200 shadow-xs flex items-center justify-center transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            {activeIndex < mediaList.length - 1 && (
              <button
                type="button"
                onClick={(e) => scrollToSlide(activeIndex + 1, e)}
                aria-label="Próxima foto"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full bg-white/90 hover:bg-white text-zinc-900 border border-stone-200 shadow-xs flex items-center justify-center transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {/* Slide Indicator Dots */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 backdrop-blur-xs">
              {mediaList.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={(e) => scrollToSlide(idx, e)}
                  aria-label={`Ver mídia ${idx + 1}`}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === activeIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/60 hover:bg-white/80'
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

    </div>
  );
};

// Expandable Product Description with "Mais" / "Menos" toggle (Requisito 1)
export const ExpandableDescription: React.FC<{
  text?: string | null;
  maxChars?: number;
  className?: string;
}> = ({ text, maxChars = 85, className = 'text-xs text-zinc-500 leading-relaxed' }) => {
  const [expanded, setExpanded] = useState(false);

  if (!text || !text.trim()) return null;
  const cleanText = text.trim();
  const needsTruncation = cleanText.length > maxChars || cleanText.includes('\n');

  if (!needsTruncation) {
    return <p className={className}>{cleanText}</p>;
  }

  const displayStr = expanded ? cleanText : `${cleanText.slice(0, maxChars).trim()}...`;

  return (
    <div className={className}>
      <span className="whitespace-pre-line">{displayStr}</span>{' '}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setExpanded((prev) => !prev);
        }}
        className="inline-flex items-center font-bold text-zinc-900 hover:text-emerald-700 underline underline-offset-2 ml-1 cursor-pointer transition-colors"
      >
        {expanded ? 'Menos' : 'Mais'}
      </button>
    </div>
  );
};

// Live Decreasing Promotional Countdown Timer (Requisito 2)
export const PromoCountdown: React.FC<{
  promoEndsAt?: string | Date | null;
  compact?: boolean;
  onExpire?: () => void;
}> = ({ promoEndsAt, compact = false, onExpire }) => {
  const calculateRemaining = useCallback(() => {
    if (!promoEndsAt) return null;
    const endMs = new Date(promoEndsAt).getTime();
    if (isNaN(endMs)) return null;
    const diffSec = Math.floor((endMs - Date.now()) / 1000);
    if (diffSec <= 0) return 0;
    return diffSec;
  }, [promoEndsAt]);

  const [remainingSec, setRemainingSec] = useState<number | null>(() => calculateRemaining());

  useEffect(() => {
    setRemainingSec(calculateRemaining());
    if (!promoEndsAt) return;

    const timer = setInterval(() => {
      const next = calculateRemaining();
      setRemainingSec(next);
      if (next === 0 && onExpire) {
        onExpire();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [promoEndsAt, calculateRemaining, onExpire]);

  if (remainingSec === null || remainingSec <= 0) return null;

  const days = Math.floor(remainingSec / 86400);
  const hours = Math.floor((remainingSec % 86400) / 3600);
  const minutes = Math.floor((remainingSec % 3600) / 60);
  const seconds = remainingSec % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  const formattedTime =
    days > 0
      ? `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
      : `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;

  return (
    <div
      className={`inline-flex items-center gap-1.5 font-mono tabular-nums rounded-md border ${
        compact
          ? 'px-2 py-0.5 text-[11px] font-semibold bg-amber-50 border-amber-200 text-amber-900'
          : 'px-2.5 py-1 text-xs font-semibold bg-amber-50 border-amber-200 text-amber-900'
      }`}
      title="Tempo restante da promoção"
    >
      <Clock
        className={
          compact ? 'w-3 h-3 text-amber-700 shrink-0' : 'w-3.5 h-3.5 text-amber-700 shrink-0'
        }
      />
      <span>Oferta termina em:</span>
      <strong className="font-bold text-amber-950">{formattedTime}</strong>
    </div>
  );
};
