import React, { useState } from 'react';
import { Logo } from './Logo';

interface LogoImageProps {
  height?: number; // desired rendered height in pixels
  className?: string;
  fallbackVariant?: 'mark' | 'full';
  alt?: string;
  src?: string; // override image src, defaults to /readis-logo.png served from public
}

export const LogoImage: React.FC<LogoImageProps> = ({
  height = 40,
  className = '',
  fallbackVariant = 'mark',
  alt = 'ReaDis logo',
  src = '/readis-logo.png',
}) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <Logo size={height} variant={fallbackVariant} className={className} />;
  }

  return (
    <img
      src={src}
      alt={alt}
      height={height}
      style={{ height, width: 'auto' }}
      className={className}
      onError={() => setFailed(true)}
    />
  );
};