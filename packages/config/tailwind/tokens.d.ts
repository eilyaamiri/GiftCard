export declare const colors: {
  readonly brand: {
    readonly navy: '#0B1D33';
    readonly navy2: '#102A46';
    readonly ink: '#13243A';
    readonly teal: '#21B4B0';
    readonly teal2: '#46D0CB';
    readonly slate: '#6B7C93';
  };
  readonly surface: {
    readonly paper: '#FFFFFF';
    readonly soft: '#F6F8FA';
    readonly mint: '#DFF7F5';
    readonly line: '#DCE4EA';
    readonly line2: '#E6EBF0';
  };
  readonly status: {
    readonly green: '#18A66A';
    readonly red: '#D94A4A';
    readonly amber: '#D98B19';
    readonly purple: '#7157D9';
    readonly okBg: '#E7F7F0';
    readonly okFg: '#12835D';
    readonly waitBg: '#FFF5DC';
    readonly waitFg: '#9D6B00';
    readonly infoBg: '#EAF4FF';
    readonly infoFg: '#2B69A0';
  };
};

export declare const radius: {
  readonly sm: 8;
  readonly md: 12;
  readonly lg: 18;
  readonly xl: 22;
  readonly '2xl': 28;
  readonly full: 999;
};

export declare const shadows: {
  readonly card: string;
  readonly modal: string;
};

export declare const focusRing: {
  readonly outline: string;
  readonly offset: 2;
};

export declare const breakpoints: {
  readonly sm: 560;
  readonly md: 900;
  readonly lg: 1440;
};

export declare const containers: {
  readonly marketing: 1440;
  readonly admin: 1600;
};

export declare const fontFamily: {
  readonly sans: string;
  readonly num: string;
};

declare const tokens: {
  readonly colors: typeof colors;
  readonly radius: typeof radius;
  readonly shadows: typeof shadows;
  readonly focusRing: typeof focusRing;
  readonly breakpoints: typeof breakpoints;
  readonly containers: typeof containers;
  readonly fontFamily: typeof fontFamily;
};

export default tokens;
