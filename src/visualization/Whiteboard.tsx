import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DrawConcept, VisualPrimitive } from './schema';
import './whiteboard.css';

interface WhiteboardProps {
  scene: DrawConcept;
}

const GUTTER = 70;

const cellClass = (active: boolean) =>
  active ? 'visual-cell is-active' : 'visual-cell';

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
      <text className="visual-label" x="24" y="22">
        {label}
      </text>
      {children}
    </g>
  );
}

function ArrayVisual({
  primitive,
  top,
}: {
  primitive: Extract<VisualPrimitive, { type: 'array' }>;
  top: number;
}) {
  const cellWidth = Math.min(52, 500 / primitive.values.length);
  const left = (index: number) => GUTTER + index * cellWidth;
  const center = (index: number) => left(index) + cellWidth / 2;

  return (
    <Layer label={primitive.label} top={top}>
      {primitive.values.map((value, index) => (
        <g key={`${primitive.id}-${index}`}>
          <rect
            className={cellClass(primitive.highlighted.includes(index))}
            x={left(index)}
            y="38"
            width={cellWidth}
            height="46"
            rx="2"
          />
          <text className="visual-value" x={center(index)} y="66">
            {value}
          </text>
          <text className="visual-index" x={center(index)} y="101">
            {index}
          </text>
        </g>
      ))}
      {primitive.pointers.map((pointer, index) => (
        <g key={`${primitive.id}-pointer-${index}`}>
          <path
            className="visual-pointer"
            d={`M ${center(pointer.index)} 132 L ${center(pointer.index)} 108`}
            markerEnd="url(#arrow)"
          />
          <text className="visual-index" x={center(pointer.index)} y="148">
            {pointer.label}
          </text>
        </g>
      ))}
    </Layer>
  );
}

function MatrixVisual({
  primitive,
  top,
}: {
  primitive: Extract<VisualPrimitive, { type: 'matrix' }>;
  top: number;
}) {
  const cellSize = Math.min(
    42,
    440 / Math.max(...primitive.values.map((row) => row.length)),
  );

  return (
    <Layer label={primitive.label} top={top}>
      {primitive.values.flatMap((row, rowIndex) =>
        row.map((value, columnIndex) => {
          const x = GUTTER + columnIndex * cellSize;
          const y = 36 + rowIndex * cellSize;
          return (
            <g key={`${primitive.id}-${rowIndex}-${columnIndex}`}>
              <rect
                className={cellClass(
                  primitive.highlighted.some(
                    (cell) => cell.row === rowIndex && cell.column === columnIndex,
                  ),
                )}
                x={x}
                y={y}
                width={cellSize}
                height={cellSize}
                rx="2"
              />
              <text
                className="visual-value"
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
}: {
  primitive: Extract<VisualPrimitive, { type: 'graph' | 'tree' }>;
  top: number;
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
              markerEnd={edge.directed ? 'url(#arrow)' : undefined}
            />
            {edge.label ? (
              <text
                className="visual-index"
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
            <text className="visual-value" x={position.x} y={position.y + 5}>
              {node.label}
            </text>
          </g>
        );
      })}
    </Layer>
  );
}

function Primitive({ primitive, top }: { primitive: VisualPrimitive; top: number }) {
  if (primitive.type === 'array') {
    return <ArrayVisual primitive={primitive} top={top} />;
  }
  if (primitive.type === 'matrix') {
    return <MatrixVisual primitive={primitive} top={top} />;
  }
  if (primitive.type === 'graph' || primitive.type === 'tree') {
    return <GraphVisual primitive={primitive} top={top} />;
  }
  return (
    <text className={`visual-note state-${primitive.state}`} x="24" y={top + 40}>
      {primitive.text}
    </text>
  );
}

export function Whiteboard({ scene }: WhiteboardProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
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
  const height = Math.max(190, frame.primitives.length * 175);

  return (
    <section className="whiteboard" aria-label={`Whiteboard: ${scene.title}`}>
      <header>
        <p className="eyebrow">Whiteboard</p>
        <h3>{scene.title}</h3>
      </header>
      <svg
        key={frameIndex}
        className="whiteboard-canvas"
        viewBox={`0 0 640 ${height}`}
        role="img"
        aria-labelledby={`whiteboard-caption-${frameIndex}`}
      >
        <defs>
          <marker
            id="arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" className="visual-arrowhead" />
          </marker>
        </defs>
        {frame.primitives.map((primitive, index) => (
          <Primitive
            key={`${frameIndex}-${primitive.id}`}
            primitive={primitive}
            top={index * 175}
          />
        ))}
      </svg>
      <p
        id={`whiteboard-caption-${frameIndex}`}
        className="whiteboard-caption"
        aria-live="polite"
      >
        {frame.caption}
      </p>
      <div className="whiteboard-controls" aria-label="Animation controls">
        <button
          type="button"
          onClick={() => setFrameIndex((value) => Math.max(0, value - 1))}
          disabled={frameIndex === 0}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          disabled={reducedMotion || scene.frames.length < 2}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={() =>
            setFrameIndex((value) => Math.min(scene.frames.length - 1, value + 1))
          }
          disabled={frameIndex === scene.frames.length - 1}
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => {
            setFrameIndex(0);
            setPlaying(!reducedMotion);
          }}
        >
          Replay
        </button>
        <span>
          {frameIndex + 1} / {scene.frames.length}
        </span>
      </div>
      <p className="whiteboard-question">{scene.question}</p>
    </section>
  );
}
