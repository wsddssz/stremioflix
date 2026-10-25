import { useMemo, useState } from 'react';
import { proxiedImage, proxiedBackdrop, placeholderFor } from '../utils/images';

interface Props {
  src?: string;
  alt: string;
  kind?: 'poster' | 'backdrop';
  className?: string;
  eager?: boolean;
}

export default function SmartImage({ src, alt, kind = 'poster', className, eager }: Props) {
  const chain = useMemo(() => {
    const prox = kind === 'backdrop' ? proxiedBackdrop(src) : proxiedImage(src);
    const steps = [prox, src, placeholderFor(alt || 'NF')].filter(Boolean) as string[];
    return Array.from(new Set(steps));
  }, [src, alt, kind]);
  const [idx, setIdx] = useState(0);

  if (chain.length === 0) {
    return <div className={className}>{alt}</div>;
  }
  return (
    <img
      src={chain[Math.min(idx, chain.length - 1)]}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      draggable={false}
      className={className}
      onError={() => setIdx((i) => Math.min(i + 1, chain.length - 1))}
    />
  );
}
