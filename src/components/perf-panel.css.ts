// src/components/perf-panel.css.ts

import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const controls = style({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: vars.space.sm,
    padding: `${vars.space.sm} ${vars.space.md}`,
    borderBottom: `1px solid ${vars.color.border}`,
});

export const periodGroup = style({
    display: 'inline-flex',
    gap: '2px',
});

const toggleBase = {
    padding: '2px 10px',
    fontSize: '0.66rem',
    fontFamily: vars.font.display,
    borderRadius: '999px',
    border: `1px solid ${vars.color.border}`,
    background: 'none',
    color: vars.color.mutedForeground,
    cursor: 'pointer',
} as const;

export const toggle = style(toggleBase);

export const toggleOn = style({
    ...toggleBase,
    color: vars.color.foreground,
    borderColor: vars.color.borderBright,
    background: vars.color.muted,
});

export const hero = style({
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: vars.space.md,
    padding: `${vars.space.sm} ${vars.space.md} 0`,
});

export const heroLabel = style({
    fontSize: '0.68rem',
    fontFamily: vars.font.display,
    color: vars.color.mutedForeground,
});

export const heroValue = style({
    fontSize: '1.3rem',
    fontWeight: 600,
    fontFamily: vars.font.mono,
    fontVariantNumeric: 'tabular-nums',
});

export const heroDelta = style({
    fontSize: '0.74rem',
    fontFamily: vars.font.mono,
});

export const info = style({
    marginLeft: '4px',
    cursor: 'help',
    color: vars.color.mutedForeground,
});

export const heroDate = style({
    marginLeft: '6px',
    fontFamily: vars.font.mono,
    fontSize: '0.66rem',
    color: vars.color.accent,
});

export const chartWrap = style({
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: `${vars.space.sm} ${vars.space.md}`,
    transition: 'opacity 0.15s',
});

export const chartArea = style({
    position: 'relative',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    cursor: 'crosshair',
});

export const crosshair = style({
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
});

export const crosshairLine = style({
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '1px',
    background: vars.color.mutedForeground,
    opacity: 0.6,
    transform: 'translateX(-50%)',
});

export const crosshairDot = style({
    position: 'absolute',
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    border: `1px solid ${vars.color.panel}`,
    transform: 'translate(-50%, -50%)',
});

export const chart = style({
    flex: 1,
    minHeight: 0,
    width: '100%',
});

const yLabel = {
    position: 'absolute',
    left: 2,
    fontSize: '0.6rem',
    fontFamily: vars.font.mono,
    color: vars.color.mutedForeground,
    pointerEvents: 'none',
} as const;

export const yMax = style({ ...yLabel, top: 0 });

export const yMin = style({ ...yLabel, bottom: 0 });

export const zeroLine = style({
    stroke: vars.color.border,
    strokeWidth: 1,
    strokeDasharray: '2 3',
    vectorEffect: 'non-scaling-stroke',
});

export const line = style({
    fill: 'none',
    vectorEffect: 'non-scaling-stroke',
});

export const axisRow = style({
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.6rem',
    fontFamily: vars.font.mono,
    color: vars.color.mutedForeground,
});

export const legend = style({
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${vars.space.xs} ${vars.space.lg}`,
    padding: `${vars.space.xs} ${vars.space.md} ${vars.space.sm}`,
    fontSize: '0.68rem',
});

export const legendItem = style({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: vars.font.mono,
});

export const dot = style({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
});

export const warn = style({
    padding: `0 ${vars.space.md} ${vars.space.sm}`,
    fontSize: '0.62rem',
    lineHeight: 1.6,
    color: vars.color.mutedForeground,
});
