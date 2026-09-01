import {
  COACH_MASCOT_ASSET,
  COACH_MASCOT_LABEL,
  type CoachMascotState,
} from './coach-mascot-state';

interface CoachMascotProps {
  state: CoachMascotState;
}

export function CoachMascot({ state }: CoachMascotProps) {
  const label = COACH_MASCOT_LABEL[state];

  return (
    <figure
      className="coach-mascot"
      data-mascot-state={state}
      role="img"
      aria-label={label}
      title={label}
    >
      <img
        key={state}
        src={COACH_MASCOT_ASSET[state]}
        alt=""
        width="512"
        height="512"
        aria-hidden="true"
        decoding="async"
        draggable={false}
      />
    </figure>
  );
}
