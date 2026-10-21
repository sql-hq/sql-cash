import { type SVGProps } from 'react';

export interface LogoProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

/** The SQL pixel mark: braces around a quiet face. Inherits the surrounding foreground color. */
export function Logo({ size = 24, className = '', ...props }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="266 304 724 724" fill="currentColor" shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg" className={`sql-logo ${className}`} aria-hidden="true" {...props}>
      <rect x="434" y="312" width="81" height="83" />
      <rect x="739" y="312" width="80" height="83" />
      <rect x="343" y="404" width="91" height="246" />
      <rect x="819" y="404" width="92" height="244" />
      <rect x="271" y="640" width="78" height="82" />
      <rect x="906" y="640" width="78" height="82" />
      <rect x="344" y="722" width="91" height="216" />
      <rect x="819" y="722" width="92" height="216" />
      <rect x="436" y="940" width="77" height="76" />
      <rect x="741" y="940" width="77" height="76" />
      <rect x="514" y="490" width="75" height="75" />
      <rect x="665" y="490" width="75" height="75" />
      <rect x="509" y="639" width="235" height="83" />
    </svg>
  );
}
