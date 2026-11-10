export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sneak'
  | 'sprint'
  | 'attack'
  | 'use'
  | 'perspective'
  | 'pick';

/** Plain action state supplied by a browser adapter or a server. */
export type InputState = Readonly<Partial<Record<Action, boolean>>>;
