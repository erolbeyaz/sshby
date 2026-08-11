import clsx from 'clsx';

/**
 * Marka ikonu. `sshby-images/sshby-icon.svg` ile birebir aynı geometri.
 * Chevron ile alt çizgi tek bir işarettir — ayrılmaz (marka panosu kuralı).
 */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      className={clsx('shrink-0', className)}
      role="img"
      aria-label="sshby"
    >
      <rect width="256" height="256" rx="60" fill="#10B981" />
      <path
        d="M52 78 L102 128 L52 178"
        fill="none"
        stroke="#08201A"
        strokeWidth="20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill="#08201A">
        <rect x="124" y="168" width="44" height="20" rx="10" />
        <rect x="180" y="168" width="16" height="20" rx="8" opacity="0.55" />
        <rect x="206" y="168" width="8" height="20" rx="4" opacity="0.28" />
      </g>
    </svg>
  );
}

/** İkon + kelime işareti. Wordmark her zaman küçük harf. */
export function Logo({
  size = 24,
  showCaret = false,
  className,
}: {
  size?: number;
  showCaret?: boolean;
  className?: string;
}) {
  return (
    <span className={clsx('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <span
        className="font-mono font-extrabold tracking-[-0.03em] leading-none"
        style={{ fontSize: size * 0.72 }}
      >
        sshby
      </span>
      {showCaret && (
        <span
          className="inline-block rounded-[2px] bg-accent animate-blink"
          style={{ width: size * 0.28, height: size * 0.62 }}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
