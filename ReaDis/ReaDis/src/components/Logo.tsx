import React from 'react';

interface LogoProps {
  size?: number; // overall height for mark; for full, mark height
  variant?: 'mark' | 'full';
  className?: string;
  textColor?: string; // used only for 'full' variant
}

export const Logo: React.FC<LogoProps> = ({
  size = 40,
  variant = 'mark',
  className = '',
  textColor = 'currentColor',
}) => {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="ReaDis logo"
    >
      <g>
        {/* Leaf */}
        <path
          d="M34 12c8 2 12 10 9 16-5-4-11-2-15 6-2-9 3-20 6-22z"
          fill="#37b24d"
        />
        <path
          d="M35 14c-3 4-5 9-6 14 4-5 9-6 12-4-2-4-3-7-6-10z"
          fill="#8fdc3f"
          opacity="0.8"
        />
        {/* Book */}
        <path
          d="M12 40c9-4 15-4 20-1 5-3 11-3 20 1v10c-9-5-15-5-20-2-5-3-11-3-20 2V40z"
          fill="#2f9e44"
        />
        <path d="M32 39v11" stroke="#1f7a36" strokeWidth="2" opacity="0.5" />
      </g>
    </svg>
  );

  if (variant === 'full') {
    return (
      <div className={`flex items-center ${className}`} style={{ height: size }}>
        {mark}
        <span
          className="ml-2 font-bold tracking-wide"
          style={{ color: textColor, fontSize: Math.round(size * 0.5) }}
        >
          ReaDis
        </span>
      </div>
    );
  }

  return <div className={className}>{mark}</div>;
};