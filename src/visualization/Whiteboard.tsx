import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { DrawConcept, VisualPrimitive } from './schema';
import './whiteboard.css';

interface WhiteboardProps {
  scene: DrawConcept;
}

const GUTTER = 70;

type Emphasis = 'normal' | 'active' | 'secondary';

const stateClass = (base: string, state: string) => `${base} state-${state}`;

const emphasisAt = (index: number, active: number[], secondary: number[]): Emphasis =>
  active.includes(index)
    ? 'active'
    : secondary.includes(index)
      ? 'secondary'
      : 'normal';

function Layer({
  label,
  top,
  children,
}: {
  label: string;
  top: number;
  children: ReactNode;
}) {
  return (
    <g transform={`translate(0 ${top})`}>
      {label ? (
        <text className="visual-label" x="24" y="22">
          {label}
        </text>
      ) : null}
      {children}
    </g>
  );
}

function ArrayVisual({
  primitive,
  top,
  arrowId,
}: {
  primitive: Extract<VisualPrimitive, { type: 'array' }>;
  top: number;
  arrowId: string;
}) {
  const cellWidth = Math.min(52, 500 / primitive.values.length);
  const left = (index: number) => GUTTER + index * cellWidth;
  const center = (index: number) => left(index) + cellWidth / 2;
  const indexStart = primitive.indexStart ?? 0;
  const secondary = primitive.secondaryHighlighted ?? [];
  const ranges = (primitive.ranges ?? []).filter(
    ({ start, end }) =>
      start >= indexStart && end >= start && end < indexStart + primitive.values.length,
  );
  const pointers = primitive.pointers.filter(
    ({ index }) => index >= indexStart && index < indexStart + primitive.values.length,
  );

  return (
    <Layer label={primitive.label} top={top}>
      {primitive.values.map((value, offset) => {
        const index = indexStart + offset;
        const state = emphasisAt(index, primitive.highlighted, secondary);
        return (
          <g key={`${primitive.id}-${index}`}>
            <text className="visual-array-index" x={center(offset)} y="32">
              {index}
            </text>
            <rect
              className={stateClass('visual-cell', state)}
              x={left(offset)}
              y="38"
              width={cellWidth}
              height="46"
            />
            <text
              className={stateClass('visual-value', state)}
              x={center(offset)}
              y="66"
            >
              {value}
            </text>
          </g>
        );
      })}
      {ranges.map((range, index) => {
        const y = 98 + index * 18;
        const start = range.start - indexStart;
        const end = range.end - indexStart;
        return (
          <g key={`${primitive.id}-range-${index}`}>
            <line
              className={stateClass('visual-range', range.state)}
              x1={left(start) + 2}
              y1={y}
              x2={left(end + 1) - 2}
              y2={y}
            />
            <text
              className={stateClass('visual-range-label', range.state)}
              x={(left(start) + left(end + 1)) / 2}
              y={y + 13}
            >
              {range.label}
            </text>
          </g>
        );
      })}
      {pointers.map((pointer, index) => {
        const x = center(pointer.index - indexStart);
        const y = 112 + ranges.length * 18;
        return (
          <g key={`${primitive.id}-pointer-${index}`}>
            <path
              className="visual-pointer"
              d={`M ${x} ${y + 18} L ${x} 90`}
              markerEnd={`url(#${arrowId})`}
            />
            <text className="visual-pointer-label" x={x} y={y + 34}>
              {pointer.label}
            </text>
          </g>
        );
      })}
    </Layer>
  );
}

const matrixCellSize = (primitive: Extract<VisualPrimitive, { type: 'matrix' }>) =>
  Math.min(42, 440 / Math.max(...primitive.values.map((row) => row.length)));

function MatrixVisual({
  primitive,
  top,
}: {
  primitive: Extract<VisualPrimitive, { type: 'matrix' }>;
  top: number;
}) {
  const cellSize = matrixCellSize(primitive);
  const secondary = primitive.secondaryHighlighted ?? [];

  return (
    <Layer label={primitive.label} top={top}>
      {primitive.values.flatMap((row, rowIndex) =>
        row.map((value, columnIndex) => {
          const x = GUTTER + columnIndex * cellSize;
          const y = 36 + rowIndex * cellSize;
          const cell = { row: rowIndex, column: columnIndex };
          const state = primitive.highlighted.some(
            (active) => active.row === cell.row && active.column === cell.column,
          )
            ? 'active'
            : secondary.some(
                  (other) => other.row === cell.row && other.column === cell.column,
                )
              ? 'secondary'
              : 'normal';
          return (
            <g key={`${primitive.id}-${rowIndex}-${columnIndex}`}>
              <rect
                className={stateClass('visual-cell', state)}
                x={x}
                y={y}
                width={cellSize}
                height={cellSize}
              />
              <text
                className={stateClass('visual-value', state)}
                x={x + cellSize / 2}
                y={y + cellSize / 2 + 5}
              >
                {value}
              </text>
            </g>
          );
        }),
      )}
    </Layer>
  );
}

function GraphVisual({
  primitive,
  top,
  arrowId,
}: {
  primitive: Extract<VisualPrimitive, { type: 'graph' | 'tree' }>;
  top: number;
  arrowId: string;
}) {
  const nodes = new Map(primitive.nodes.map((node) => [node.id, node]));
  const point = (id: string) => {
    const node = nodes.get(id);
    return node ? { x: GUTTER + node.x * 4.8, y: 38 + node.y * 1.15 } : { x: 0, y: 0 };
  };

  return (
    <Layer label={primitive.label} top={top}>
      {primitive.edges.map((edge, index) => {
        const from = point(edge.from);
        const to = point(edge.to);
        return (
          <g key={`${primitive.id}-edge-${index}`}>
            <line
              className={`visual-edge state-${edge.state}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              markerEnd={edge.directed ? `url(#${arrowId})` : undefined}
            />
            {edge.label ? (
              <text
                className={stateClass('visual-index', edge.state)}
                x={(from.x + to.x) / 2}
                y={(from.y + to.y) / 2 - 5}
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {primitive.nodes.map((node) => {
        const position = point(node.id);
        return (
          <g key={`${primitive.id}-node-${node.id}`}>
            <circle
              className={`visual-node state-${node.state}`}
              cx={position.x}
              cy={position.y}
              r="20"
            />
            <text
              className={stateClass('visual-value', node.state)}
              x={position.x}
              y={position.y + 5}
            >
              {node.label}
            </text>
          </g>
        );
      })}
    </Layer>
  );
}

function Primitive({
  primitive,
  top,
  arrowId,
}: {
  primitive: VisualPrimitive;
  top: number;
  arrowId: string;
}) {
  if (primitive.type === 'array') {
    return <ArrayVisual primitive={primitive} top={top} arrowId={arrowId} />;
  }
  if (primitive.type === 'matrix') {
    return <MatrixVisual primitive={primitive} top={top} />;
  }
  if (primitive.type === 'graph' || primitive.type === 'tree') {
    return <GraphVisual primitive={primitive} top={top} arrowId={arrowId} />;
  }
  return (
    <text className={`visual-note state-${primitive.state}`} x="24" y={top + 40}>
      {primitive.text}
    </text>
  );
}

function primitiveHeight(primitive: VisualPrimitive): number {
  if (primitive.type === 'array') {
    return (
      126 + (primitive.ranges?.length ?? 0) * 18 + (primitive.pointers.length ? 42 : 0)
    );
  }
  if (primitive.type === 'matrix') {
    return 56 + primitive.values.length * matrixCellSize(primitive);
  }
  if (primitive.type === 'graph' || primitive.type === 'tree') return 190;
  return 70;
}

export function Whiteboard({ scene }: WhiteboardProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const visualId = useId().replaceAll(':', '');
  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const frame = scene.frames[frameIndex] ?? scene.frames[0];

  useEffect(() => {
    if (!playing || reducedMotion || !frame) return;
    const timeout = window.setTimeout(() => {
      if (frameIndex >= scene.frames.length - 1) {
        setPlaying(false);
      } else {
        setFrameIndex((value) => value + 1);
      }
    }, frame.durationMs);
    return () => window.clearTimeout(timeout);
  }, [frame, frameIndex, playing, reducedMotion, scene.frames.length]);

  if (!frame) return null;
  const layers = frame.primitives.map((primitive, index) => ({
    primitive,
    top: frame.primitives
      .slice(0, index)
      .reduce((sum, previous) => sum + primitiveHeight(previous), 0),
  }));
  const height = Math.max(
    190,
    frame.primitives.reduce((sum, primitive) => sum + primitiveHeight(primitive), 0),
  );
  const titleId = `${visualId}-title`;
  const captionId = `${visualId}-caption`;
  const arrowId = `${visualId}-arrow`;
  const lastFrame = frameIndex === scene.frames.length - 1;
  const hasAnimation = scene.frames.length > 1;

  return (
    <figure className="whiteboard" aria-labelledby={titleId}>
      <figcaption className="whiteboard-heading">
        <p className="eyebrow">Figure</p>
        <h3 id={titleId}>{scene.title}</h3>
      </figcaption>
      <svg
        key={frameIndex}
        className="whiteboard-canvas"
        viewBox={`0 0 640 ${height}`}
        role="img"
        aria-labelledby={`${titleId} ${captionId}`}
      >
        <defs>
          <marker
            id={arrowId}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" className="visual-arrowhead" />
          </marker>
        </defs>
        {layers.map(({ primitive, top: layerTop }) => (
          <Primitive
            key={`${frameIndex}-${primitive.id}`}
            primitive={primitive}
            top={layerTop}
            arrowId={arrowId}
          />
        ))}
      </svg>
      <p id={captionId} className="whiteboard-caption" aria-live="polite">
        {frame.caption}
      </p>
      {hasAnimation ? (
        <div className="whiteboard-controls" aria-label="Animation controls">
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setFrameIndex((value) => Math.max(0, value - 1));
            }}
            disabled={frameIndex === 0}
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => {
              if (playing) {
                setPlaying(false);
                return;
              }
              if (lastFrame) setFrameIndex(0);
              setPlaying(true);
            }}
            disabled={reducedMotion}
          >
            {playing ? 'Pause' : lastFrame ? 'Replay' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setFrameIndex((value) => Math.min(scene.frames.length - 1, value + 1));
            }}
            disabled={lastFrame}
          >
            Next
          </button>
          <span>
            {frameIndex + 1} / {scene.frames.length}
          </span>
        </div>
      ) : null}
      <p className="whiteboard-question">{scene.question}</p>
    </figure>
  );
}
